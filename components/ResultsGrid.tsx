'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Table,
  type Updater,
  type VisibilityState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type FieldInfo,
  deriveFields,
  docKey,
  getByEscapedPath,
  isDollarDate,
  isFieldIndexed,
  unwrapScalar,
} from '@/lib/astra/schema';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import { SCORE_FIELDS, cycleSort, displayPath } from '@/lib/query/compile';
import type { SearchMode, SortKey } from '@/lib/query/types';
import { useTrace } from '@/lib/trace/TraceContext';
import { type ColumnLayout, loadLayout, saveLayout } from '@/lib/ui/columnLayout';

type Doc = Record<string, unknown>;

interface ResultsGridProps {
  documents: Doc[];
  keyspace: string;
  collection: string;
  /**
   * Active sort keys (priority order). The grid never sorts rows itself (`manualSorting`):
   * in browse mode the server sorts; in search modes the parent sorts the results locally.
   */
  sort: SortKey[];
  /** Called with the next sort after a header click. */
  onSortChange: (sort: SortKey[]) => void;
  /** The collection's `indexing` option; non-indexed fields can't be sorted. */
  indexing?: CollectionCapabilities['indexing'];
  /** Called with the clicked row's document. */
  onRowClick?: (doc: Doc) => void;
  /** Called with the clicked row's document and the clicked column's escaped field path. */
  onCellClick?: (doc: Doc, field: string) => void;
  /** `docKey` of the row currently shown in the detail panel (highlighted). */
  selectedKey?: string | null;
  /** Called whenever the `$vector` column is shown/hidden so the parent can re-fetch. */
  onShowVectorChange?: (show: boolean) => void;
  /** Search modes sort locally (badge on sorted headers) and show score columns. */
  searchMode?: SearchMode;
  /** When set, every row gets a "Find similar" action. */
  onFindSimilar?: (doc: Doc) => void;
}

/** Per-column UI info that doesn't belong in the TanStack column definition. */
interface ColumnUiInfo {
  /** Object column that can be expanded into sub-columns. */
  expandable: boolean;
  /** Set on the first sub-column of an expanded object: the parent path to collapse. */
  collapseParent?: string;
  /** Why this column can't be sorted (shown as a tooltip), or null when sortable. */
  sortBlockedReason: string | null;
}

const ROW_HEIGHT = 36;
const COL_WIDTH = 200;
const ID_COL_WIDTH = 260;
const MIN_COL_WIDTH = 60;
const MAX_CELL_CHARS = 40;
const MAX_TOOLTIP_CHARS = 2000;
const ID_COLUMN = '_id';
const VECTOR_COLUMN = '$vector';
const VECTORIZE_COLUMN = '$vectorize';
const COLUMN_PINNING = { left: [ID_COLUMN] };
const ACTION_COL_WIDTH = 110;
const SCORE_DECIMALS = 4;
const SCORE_COLUMNS: ReadonlySet<string> = new Set(SCORE_FIELDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for object values that are expandable (not arrays, dates, or `{ $uuid }`-style wrappers). */
function isExpandableObject(value: unknown): boolean {
  return isPlainObject(value) && !isDollarDate(value) && unwrapScalar(value) === value;
}

function dateToIso(millis: number): string {
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? String(millis) : date.toISOString();
}

function formatCell(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (Array.isArray(value)) return `[${value.length} ${value.length === 1 ? 'item' : 'items'}]`;
  if (isDollarDate(value)) return dateToIso(value.$date);
  const scalar = unwrapScalar(value);
  if (typeof scalar === 'object') return '{…}';
  const text = String(scalar);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

/** Full value for the cell tooltip (`title` attribute). */
function formatTooltip(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (isDollarDate(value)) return dateToIso(value.$date);
  const scalar = unwrapScalar(value);
  const text = typeof scalar === 'object' ? (JSON.stringify(scalar) ?? '') : String(scalar);
  return text.length > MAX_TOOLTIP_CHARS ? `${text.slice(0, MAX_TOOLTIP_CHARS)}…` : text;
}

function pinnedStyle(isPinned: boolean, zIndex: number, left: number): React.CSSProperties {
  return isPinned
    ? { position: 'sticky', left, zIndex, background: 'var(--astra-sidebar)' }
    : { position: 'relative' };
}

function pinnedRightStyle(zIndex: number): React.CSSProperties {
  return { position: 'sticky', right: 0, zIndex, background: 'var(--astra-sidebar)' };
}

function parentPath(escapedPath: string): string | null {
  const index = escapedPath.lastIndexOf('.');
  return index === -1 ? null : escapedPath.slice(0, index);
}

interface BuiltColumns {
  columns: ColumnDef<Doc>[];
  /** Leaf column ids in default (data-derived) order. */
  ids: string[];
  ui: Map<string, ColumnUiInfo>;
}

function sortBlockedReason(
  field: FieldInfo,
  indexing: CollectionCapabilities['indexing'] | undefined,
): string | null {
  // Score columns are synthetic (not stored), so indexing doesn't apply; they sort locally.
  if (SCORE_COLUMNS.has(field.escapedPath)) return null;
  if (field.escapedPath === VECTOR_COLUMN || field.escapedPath === VECTORIZE_COLUMN) {
    return "Vectors can't be sorted";
  }
  if (field.type === 'object' || field.type === 'array') return "Objects/arrays can't be sorted";
  if (!isFieldIndexed(field.escapedPath, indexing)) return 'Not indexed';
  return null;
}

function buildColumns(
  fields: FieldInfo[],
  expanded: ReadonlySet<string>,
  onToggleExpand: (escapedPath: string) => void,
  indexing: CollectionCapabilities['indexing'] | undefined,
): BuiltColumns {
  const children = new Map<string, FieldInfo[]>();
  const topLevel: FieldInfo[] = [];
  for (const field of fields) {
    const parent = parentPath(field.escapedPath);
    if (parent === null) {
      topLevel.push(field);
    } else {
      const list = children.get(parent) ?? [];
      list.push(field);
      children.set(parent, list);
    }
  }

  const columns: ColumnDef<Doc>[] = [];
  const ids: string[] = [];
  const ui = new Map<string, ColumnUiInfo>();

  const emit = (field: FieldInfo, collapseParent?: string): void => {
    const subFields = field.type === 'object' ? (children.get(field.escapedPath) ?? []) : [];
    if (subFields.length > 0 && expanded.has(field.escapedPath)) {
      subFields.forEach((sub, index) => emit(sub, index === 0 ? field.escapedPath : undefined));
      return;
    }

    const expandable = subFields.length > 0;
    const id = field.escapedPath;
    const blocked = sortBlockedReason(field, indexing);
    ids.push(id);
    ui.set(id, { expandable, collapseParent, sortBlockedReason: blocked });
    columns.push({
      id,
      header: field.path,
      enableSorting: blocked === null,
      accessorFn: (row: Doc) => getByEscapedPath(row, id),
      size: id === ID_COLUMN ? ID_COL_WIDTH : COL_WIDTH,
      minSize: MIN_COL_WIDTH,
      cell: (info) => {
        const value = info.getValue();
        if (expandable && isExpandableObject(value)) {
          return (
            <>
              <span className="truncate">{'{…}'}</span>
              <button
                type="button"
                className="ml-1 shrink-0 rounded px-1"
                style={{ color: 'var(--astra-accent)' }}
                title={`Expand ${field.path}`}
                aria-label={`Expand ${field.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(id);
                }}
              >
                ⤢
              </button>
            </>
          );
        }
        if (SCORE_COLUMNS.has(id) && typeof value === 'number') return value.toFixed(SCORE_DECIMALS);
        return formatCell(value);
      },
    });
  };

  // Score columns (`$similarity`, `$rerank`, …) come first, right after `_id`.
  const isScore = (f: FieldInfo) => SCORE_COLUMNS.has(f.escapedPath);
  const ordered = [
    ...topLevel.filter((f) => f.escapedPath === ID_COLUMN),
    ...SCORE_FIELDS.flatMap((name) => topLevel.filter((f) => f.escapedPath === name)),
    ...topLevel.filter((f) => f.escapedPath !== ID_COLUMN && !isScore(f)),
  ];
  ordered.filter((f) => f.escapedPath !== VECTOR_COLUMN).forEach((f) => emit(f));
  // $vector is always offered (hidden by default) and kept last.
  const vector = topLevel.find((f) => f.escapedPath === VECTOR_COLUMN) ?? {
    path: VECTOR_COLUMN,
    escapedPath: VECTOR_COLUMN,
    type: 'array' as const,
    isNested: false,
  };
  emit(vector);

  return { columns, ids, ui };
}

/**
 * Merges the user's saved order with the data-derived order: saved ids that no longer
 * exist are dropped, and new ids (e.g. sub-columns after an expand) are inserted after
 * their predecessor in the default order.
 */
function reconcileOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults);
  const result = saved.filter((id) => known.has(id));
  const present = new Set(result);
  defaults.forEach((id, index) => {
    if (present.has(id)) return;
    let insertAt = 0;
    for (let i = index - 1; i >= 0; i--) {
      const at = result.indexOf(defaults[i]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    result.splice(insertAt, 0, id);
    present.add(id);
  });
  return result;
}

interface GridTableProps {
  table: Table<Doc>;
  ui: ReadonlyMap<string, ColumnUiInfo>;
  selectedKey: string | null;
  onRowClick?: (doc: Doc) => void;
  onCellClick?: (doc: Doc, field: string) => void;
  onToggleExpand: (escapedPath: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  /** Header click; `additive` is true for Shift-click. */
  onHeaderSort: (columnId: string, additive: boolean, blockedReason: string | null) => void;
  /** Sorting happens in the browser (search modes): sorted headers get a "local" badge. */
  localSort: boolean;
  onFindSimilar?: (doc: Doc) => void;
}

function GridTable({
  table,
  ui,
  selectedKey,
  onRowClick,
  onCellClick,
  onToggleExpand,
  onReorder,
  onHeaderSort,
  localSort,
  onFindSimilar,
}: GridTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const rows = table.getRowModel().rows;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable function refs by design
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Shift+wheel scrolls horizontally. Must be non-passive so preventDefault works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const headerGroups = table.getHeaderGroups();
  const sortCount = table.getState().sorting.length;

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border"
      style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-bg)' }}
    >
      <table
        className="text-sm"
        style={{
          display: 'grid',
          width: table.getTotalSize() + (onFindSimilar ? ACTION_COL_WIDTH : 0),
          color: 'var(--astra-text)',
        }}
      >
        <thead className="sticky top-0 z-10" style={{ display: 'grid', background: 'var(--astra-sidebar)' }}>
          {headerGroups.map((group) => (
            <tr key={group.id} style={{ display: 'flex', width: '100%' }}>
              {group.headers.map((header) => {
                const column = header.column;
                const pinned = column.getIsPinned() === 'left';
                const info = ui.get(column.id);
                const collapseParent = info?.collapseParent;
                const blockedReason = info?.sortBlockedReason ?? null;
                const sortDir = column.getIsSorted();
                const sortIndex = column.getSortIndex();
                const isDropTarget = dragOverId === column.id && draggingId !== column.id;
                const dragHint = pinned ? '' : ' · Drag to reorder';
                const sortTitle =
                  blockedReason ??
                  `Click to sort (asc → desc → off) · Shift-click to add a secondary sort${dragHint}`;
                const triggerSort = (e: { shiftKey: boolean }) => {
                  onHeaderSort(column.id, e.shiftKey, blockedReason);
                };
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'
                    }
                    className="pl-3 pr-2 text-left font-medium text-xs uppercase tracking-wider border-b border-r"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: header.getSize(),
                      height: ROW_HEIGHT,
                      flexShrink: 0,
                      color: 'var(--astra-muted)',
                      borderColor: 'var(--astra-border)',
                      background: 'var(--astra-sidebar)',
                      boxShadow: isDropTarget ? 'inset 2px 0 0 var(--astra-accent)' : undefined,
                      ...pinnedStyle(pinned, 3, column.getStart('left')),
                    }}
                    onDragOver={
                      pinned
                        ? undefined
                        : (e) => {
                            if (draggingId === null) return;
                            e.preventDefault();
                            setDragOverId(column.id);
                          }
                    }
                    onDrop={
                      pinned
                        ? undefined
                        : (e) => {
                            e.preventDefault();
                            if (draggingId !== null) onReorder(draggingId, column.id);
                            setDraggingId(null);
                            setDragOverId(null);
                          }
                    }
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-disabled={blockedReason !== null}
                      className={`min-w-0 flex-1 flex items-center gap-1 select-none ${
                        blockedReason !== null
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer'
                      }`}
                      draggable={!pinned}
                      title={sortTitle}
                      onClick={triggerSort}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          triggerSort(e);
                        }
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', column.id);
                        setDraggingId(column.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                    >
                      <span className="truncate">
                        {flexRender(column.columnDef.header, header.getContext())}
                      </span>
                      {sortDir !== false && (
                        <span
                          className="shrink-0 normal-case"
                          style={{ color: 'var(--astra-accent)' }}
                          aria-hidden="true"
                        >
                          {sortDir === 'asc' ? '▲' : '▼'}
                          {sortCount > 1 ? sortIndex + 1 : ''}
                          {localSort && (
                            <span
                              className="ml-1 rounded border px-1 text-[10px] font-medium"
                              title="Sorted in your browser"
                            >
                              local
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {info?.expandable && (
                      <button
                        type="button"
                        className="ml-1 shrink-0 rounded px-1"
                        style={{ color: 'var(--astra-accent)' }}
                        title={`Expand ${String(column.columnDef.header)}`}
                        aria-label={`Expand ${String(column.columnDef.header)}`}
                        onClick={() => onToggleExpand(column.id)}
                      >
                        ⤢
                      </button>
                    )}
                    {collapseParent !== undefined && (
                      <button
                        type="button"
                        className="ml-1 shrink-0 rounded px-1"
                        style={{ color: 'var(--astra-accent)' }}
                        title={`Collapse ${displayPath(collapseParent)}`}
                        aria-label={`Collapse ${displayPath(collapseParent)}`}
                        onClick={() => onToggleExpand(collapseParent)}
                      >
                        ⤡
                      </button>
                    )}
                    {column.getCanResize() && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${String(column.columnDef.header)}`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => column.resetSize()}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none"
                        style={{
                          background: column.getIsResizing() ? 'var(--astra-accent)' : 'transparent',
                        }}
                      />
                    )}
                  </th>
                );
              })}
              {onFindSimilar && (
                <th
                  scope="col"
                  className="px-2 text-left font-medium text-xs uppercase tracking-wider border-b"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: ACTION_COL_WIDTH,
                    height: ROW_HEIGHT,
                    flexShrink: 0,
                    color: 'var(--astra-muted)',
                    borderColor: 'var(--astra-border)',
                    ...pinnedRightStyle(3),
                  }}
                >
                  Actions
                </th>
              )}
            </tr>
          ))}
        </thead>
        <tbody style={{ display: 'grid', position: 'relative', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const selected = selectedKey !== null && docKey(row.original) === selectedKey;
            const rowBackground = selected ? 'var(--astra-surface)' : undefined;
            return (
              <tr
                key={row.id}
                tabIndex={0}
                aria-selected={selected}
                className="cursor-pointer"
                style={{
                  display: 'flex',
                  position: 'absolute',
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                  background: rowBackground,
                }}
                onClick={() => onRowClick?.(row.original)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick?.(row.original);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const pinned = cell.column.getIsPinned() === 'left';
                  const raw = cell.getValue();
                  const sticky = pinnedStyle(pinned, 1, cell.column.getStart('left'));
                  return (
                    <td
                      key={cell.id}
                      title={formatTooltip(raw)}
                      className="px-3 font-mono text-xs truncate border-b border-r"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        width: cell.column.getSize(),
                        flexShrink: 0,
                        borderColor: 'var(--astra-border)',
                        color: raw === null ? 'var(--astra-muted)' : undefined,
                        ...sticky,
                        ...(pinned && selected ? { background: 'var(--astra-surface)' } : {}),
                      }}
                      onClick={
                        onCellClick
                          ? (e) => {
                              e.stopPropagation();
                              onCellClick(row.original, cell.column.id);
                            }
                          : undefined
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
                {onFindSimilar && (
                  <td
                    className="px-2 border-b"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: ACTION_COL_WIDTH,
                      flexShrink: 0,
                      borderColor: 'var(--astra-border)',
                      ...pinnedRightStyle(1),
                      ...(selected ? { background: 'var(--astra-surface)' } : {}),
                    }}
                  >
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-xs"
                      style={{
                        background: 'var(--astra-surface)',
                        borderColor: 'var(--astra-border)',
                        color: 'var(--astra-text)',
                      }}
                      title="Search for documents similar to this one"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFindSimilar(row.original);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      Find similar
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ColumnsMenu({ table }: { table: Table<Doc> }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const columns = table.getAllLeafColumns();
  const hiddenCount = columns.filter((c) => !c.getIsVisible()).length;

  return (
    <div ref={wrapperRef} className="relative ml-auto">
      <button
        type="button"
        className="px-3 py-1 text-xs font-medium rounded border"
        style={{
          background: 'var(--astra-surface)',
          borderColor: 'var(--astra-border)',
          color: 'var(--astra-text)',
        }}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Column visibility"
          className="absolute right-0 top-full mt-1 max-h-80 w-64 overflow-auto rounded border p-2 shadow-lg"
          style={{
            zIndex: 30,
            background: 'var(--astra-sidebar)',
            borderColor: 'var(--astra-border)',
            color: 'var(--astra-text)',
          }}
        >
          {columns.map((column) => {
            const label = String(column.columnDef.header);
            return (
              <label key={column.id} className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={(e) => column.toggleVisibility(e.target.checked)}
                />
                <span className="truncate font-mono" title={label}>
                  {label}
                </span>
                {column.id === VECTOR_COLUMN && (
                  <span className="ml-auto shrink-0" style={{ color: 'var(--astra-muted)' }}>
                    loads vectors
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ResultsGrid({
  documents,
  keyspace,
  collection,
  sort,
  onSortChange,
  indexing,
  onRowClick,
  onCellClick,
  selectedKey = null,
  onShowVectorChange,
  searchMode = 'browse',
  onFindSimilar,
}: ResultsGridProps) {
  // Restored from localStorage on mount (parent remounts this component per collection).
  const [layout, setLayout] = useState<ColumnLayout>(() => loadLayout(keyspace, collection));

  useEffect(() => {
    saveLayout(keyspace, collection, layout);
  }, [keyspace, collection, layout]);

  const showVector = layout.columnVisibility[VECTOR_COLUMN] === true;
  useEffect(() => {
    onShowVectorChange?.(showVector);
  }, [showVector, onShowVectorChange]);

  const fields = useMemo(() => deriveFields(documents), [documents]);
  const expanded = useMemo(() => new Set(layout.expanded), [layout.expanded]);

  const toggleExpand = useCallback((escapedPath: string) => {
    setLayout((prev) => ({
      ...prev,
      expanded: prev.expanded.includes(escapedPath)
        ? prev.expanded.filter((p) => p !== escapedPath)
        : [...prev.expanded, escapedPath],
    }));
  }, []);

  const built = useMemo(
    // Local sorting (search modes) doesn't need an index, so indexing only blocks server sorts.
    () => buildColumns(fields, expanded, toggleExpand, searchMode === 'browse' ? indexing : null),
    [fields, expanded, toggleExpand, indexing, searchMode],
  );

  const sorting = useMemo(
    () => sort.map((k) => ({ id: k.field, desc: k.dir === 'desc' })),
    [sort],
  );

  const columnOrder = useMemo(
    () => reconcileOrder(layout.columnOrder, built.ids),
    [layout.columnOrder, built.ids],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unstable function refs by design
  const table = useReactTable({
    data: documents,
    columns: built.columns,
    getCoreRowModel: getCoreRowModel(),
    // The grid only displays the sort and reports header clicks; the server (browse) or the
    // parent (search modes, locally) orders the rows.
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnPinning: COLUMN_PINNING,
      columnVisibility: layout.columnVisibility,
      columnOrder,
      columnSizing: layout.columnSizing,
    },
    onColumnVisibilityChange: (updater: Updater<VisibilityState>) =>
      setLayout((prev) => ({
        ...prev,
        columnVisibility: functionalUpdate(updater, prev.columnVisibility),
      })),
    onColumnOrderChange: (updater: Updater<ColumnOrderState>) =>
      setLayout((prev) => ({
        ...prev,
        columnOrder: functionalUpdate(updater, prev.columnOrder),
      })),
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) =>
      setLayout((prev) => ({
        ...prev,
        columnSizing: functionalUpdate(updater, prev.columnSizing),
      })),
  });

  const { isPanelOpen, startRun, setVerdict, emitStep, finishRun } = useTrace();

  const handleHeaderSort = (
    columnId: string,
    additive: boolean,
    blockedReason: string | null,
  ) => {
    if (blockedReason !== null) {
      if (isPanelOpen) {
        startRun({
          sortSpec: sort.map((k) => ({ field: k.field, dir: k.dir })),
          searchMode: searchMode ?? 'browse',
          trigger: `Clicked "${displayPath(columnId)}" header`,
          source: 'header-click',
        });
        setVerdict({
          handling: 'blocked',
          reason: `This column cannot be sorted, so nothing was sent anywhere. ${blockedReason}`,
        });
        emitStep({
          where: 'browser',
          status: 'ok',
          label: `Clicked the "${displayPath(columnId)}" header`,
        });
        emitStep({
          where: 'browser',
          status: 'blocked',
          label: 'Sort refused',
          detail: `${blockedReason}. Nothing was sent.`,
        });
        finishRun('blocked', blockedReason);
      }
      return;
    }

    const nextSort = cycleSort(sort, columnId, additive);
    if (isPanelOpen) {
      const nextSummary =
        nextSort.map((s) => `${displayPath(s.field)} ${s.dir === 'asc' ? 'ascending' : 'descending'}`).join(', ') ||
        'no sort (original order)';
      startRun({
        sortSpec: nextSort.map((k) => ({ field: k.field, dir: k.dir })),
        searchMode: searchMode ?? 'browse',
        trigger: `Clicked "${displayPath(columnId)}" header`,
        source: 'header-click',
      });
      emitStep({
        where: 'browser',
        status: 'ok',
        label: `Clicked "${displayPath(columnId)}": sort by ${nextSummary}`,
        detail: additive ? 'Shift-click adds to the sort' : undefined,
      });
    }
    onSortChange(nextSort);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = [...columnOrder];
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    table.setColumnOrder(ids);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex items-center gap-1">
        <ColumnsMenu table={table} />
      </div>

      {documents.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--astra-muted)' }}>
          No documents.
        </p>
      ) : (
        <GridTable
          table={table}
          ui={built.ui}
          selectedKey={selectedKey}
          onRowClick={onRowClick}
          onCellClick={onCellClick}
          onToggleExpand={toggleExpand}
          onReorder={reorder}
          onHeaderSort={handleHeaderSort}
          localSort={searchMode !== 'browse'}
          onFindSimilar={onFindSimilar}
        />
      )}
    </div>
  );
}
