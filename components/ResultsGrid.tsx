'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

type Doc = Record<string, unknown>;

interface ResultsGridProps {
  documents: Doc[];
}

const ROW_HEIGHT = 36;
const COL_WIDTH = 200;
const ID_COL_WIDTH = 260;
const MAX_CELL_CHARS = 40;
const ID_COLUMN = '_id';

function deriveColumnKeys(documents: Doc[]): string[] {
  const keys = new Set<string>([ID_COLUMN]);
  for (const doc of documents) {
    for (const key of Object.keys(doc)) keys.add(key);
  }
  return Array.from(keys);
}

function formatCell(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (Array.isArray(value)) return `[${value.length} ${value.length === 1 ? 'item' : 'items'}]`;
  if (typeof value === 'object') return '{…}';
  const text = String(value);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

function pinnedStyle(isPinned: boolean, zIndex: number): React.CSSProperties {
  return isPinned
    ? { position: 'sticky', left: 0, zIndex, background: 'var(--astra-sidebar)' }
    : {};
}

function GridTable({ documents }: ResultsGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<Doc>[]>(
    () =>
      deriveColumnKeys(documents).map((key) => ({
        id: key,
        header: key,
        accessorFn: (row: Doc) => row[key],
        size: key === ID_COLUMN ? ID_COL_WIDTH : COL_WIDTH,
        cell: (info) => formatCell(info.getValue()),
      })),
    [documents],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unstable function refs by design
  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnPinning: { left: [ID_COLUMN] } },
  });

  const rows = table.getRowModel().rows;

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

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border"
      style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-bg)' }}
    >
      <table
        className="text-sm"
        style={{ display: 'grid', width: table.getTotalSize(), color: 'var(--astra-text)' }}
      >
        <thead className="sticky top-0 z-10" style={{ display: 'grid', background: 'var(--astra-sidebar)' }}>
          {headerGroups.map((group) => (
            <tr key={group.id} style={{ display: 'flex', width: '100%' }}>
              {group.headers.map((header) => {
                const pinned = header.column.getIsPinned() === 'left';
                return (
                  <th
                    key={header.id}
                    className="px-3 text-left font-medium text-xs uppercase tracking-wider truncate border-b border-r"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: header.getSize(),
                      height: ROW_HEIGHT,
                      flexShrink: 0,
                      color: 'var(--astra-muted)',
                      borderColor: 'var(--astra-border)',
                      background: 'var(--astra-sidebar)',
                      ...pinnedStyle(pinned, 3),
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody style={{ display: 'grid', position: 'relative', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                style={{
                  display: 'flex',
                  position: 'absolute',
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const pinned = cell.column.getIsPinned() === 'left';
                  const raw = cell.getValue();
                  return (
                    <td
                      key={cell.id}
                      className="px-3 font-mono text-xs truncate border-b border-r"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        width: cell.column.getSize(),
                        flexShrink: 0,
                        borderColor: 'var(--astra-border)',
                        color: raw === null ? 'var(--astra-muted)' : undefined,
                        ...pinnedStyle(pinned, 1),
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ResultsGrid({ documents }: ResultsGridProps) {
  const [view, setView] = useState<'table' | 'json'>('table');

  const tabClass = (active: boolean) =>
    `px-3 py-1 text-xs font-medium rounded ${active ? 'text-white' : ''}`;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex gap-1" role="group" aria-label="Result view">
        <button
          type="button"
          className={tabClass(view === 'table')}
          style={{
            background: view === 'table' ? 'var(--astra-accent)' : 'var(--astra-surface)',
            color: view === 'table' ? undefined : 'var(--astra-muted)',
          }}
          aria-pressed={view === 'table'}
          onClick={() => setView('table')}
        >
          Table
        </button>
        <button
          type="button"
          className={tabClass(view === 'json')}
          style={{
            background: view === 'json' ? 'var(--astra-accent)' : 'var(--astra-surface)',
            color: view === 'json' ? undefined : 'var(--astra-muted)',
          }}
          aria-pressed={view === 'json'}
          onClick={() => setView('json')}
        >
          JSON
        </button>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--astra-muted)' }}>
          No documents.
        </p>
      ) : view === 'table' ? (
        <GridTable documents={documents} />
      ) : (
        <pre
          className="flex-1 min-h-0 overflow-auto rounded-lg border p-4 text-xs font-mono"
          style={{
            borderColor: 'var(--astra-border)',
            background: 'var(--astra-surface)',
            color: 'var(--astra-text)',
          }}
        >
          {JSON.stringify(documents, null, 2)}
        </pre>
      )}
    </div>
  );
}
