'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isFieldIndexed,
  isFieldEditable,
  setByEscapedPath,
  unwrapScalar,
} from '@/lib/astra/schema';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import {
  displayPath,
  escapeFieldSegment,
  splitEscapedPath,
  unescapeFieldSegment,
} from '@/lib/query/compile';
import type { FilterValue } from '@/lib/query/types';
import FieldEditor from './FieldEditor';
import { highlightJson, scalarStyle } from '@/lib/ui/highlightJson';

type Doc = Record<string, unknown>;

interface RowDetailPanelProps {
  doc: Doc;
  keyspace: string;
  collection: string;
  onClose: () => void;
  /** Provided only for vector collections; enables the "Find similar" button. */
  onFindSimilar?: (doc: Doc) => void;
  /** Adds an `eq` filter for a scalar field. `field` is an escaped dotted path. */
  onQuickFilter?: (field: string, value: FilterValue) => void;
  /** Notifies parent when a field is edited and saved. */
  onUpdateDoc?: (updatedDoc: Doc) => void;
  /** Collection indexing options; quick filter is offered only for indexed fields. */
  indexing?: CollectionCapabilities['indexing'];
  /**
   * Field to reveal (escaped dotted path). Pass a new object identity each time to
   * re-trigger even when clicking the same field on the same row.
   */
  focus?: { field: string } | null;
}

const PANEL_WIDTH = 480;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;
const MAX_CHILDREN = 200;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function childPath(parent: string, key: string): string {
  return `${parent}/${encodeURIComponent(key)}`;
}

/** Panel paths from the top-level key down to the (escaped dotted) field, one per segment. */
function fieldToPanelPaths(field: string): string[] {
  let current = '';
  return splitEscapedPath(field).map((segment) => {
    current = childPath(current, unescapeFieldSegment(segment));
    return current;
  });
}

/** Returns `expanded` plus every ancestor of `field` (and the field itself, if a container). */
function expandToField(expanded: ReadonlySet<string>, field: string): Set<string> {
  const next = new Set(expanded);
  for (const path of fieldToPanelPaths(field)) next.add(path);
  return next;
}

/** Converts a panel path (`/a/b%2Ec`) to the escaped dotted path used by filters (`a.b&.c`). */
function panelPathToEscapedField(path: string): string {
  return path
    .split('/')
    .slice(1)
    .map((segment) => escapeFieldSegment(decodeURIComponent(segment)))
    .join('.');
}

function isFilterValue(value: unknown): value is FilterValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function idToString(id: unknown): string {
  const scalar = unwrapScalar(id);
  return typeof scalar === 'object' && scalar !== null ? JSON.stringify(scalar) : String(scalar);
}

interface JsonNodeProps {
  name: string;
  value: unknown;
  path: string;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  /** True when the parent is an array: array indexes are not filterable field paths. */
  inArray?: boolean;
  onQuickFilter?: (field: string, value: FilterValue) => void;
  indexing?: CollectionCapabilities['indexing'];
  editingPath: string | null;
  onStartEdit: (path: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (escapedPath: string, newValue: unknown) => void;
  keyspace: string;
  collection: string;
  docId: unknown;
  allowEdit: boolean;
}

function JsonNode({
  name,
  value,
  path,
  expanded,
  onToggle,
  inArray,
  onQuickFilter,
  indexing,
  editingPath,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  keyspace,
  collection,
  docId,
  allowEdit,
}: JsonNodeProps) {
  const escapedField = !inArray ? panelPathToEscapedField(path) : '';
  const { editable, reason: readOnlyReason } = isFieldEditable(escapedField);
  const isCurrentlyEditing = editingPath === path;

  if (isCurrentlyEditing && escapedField !== '') {
    return (
      <div data-path={path} className="py-1 pl-2">
        <FieldEditor
          name={name}
          escapedPath={escapedField}
          currentValue={value}
          keyspace={keyspace}
          collection={collection}
          docId={docId}
          onSaveSuccess={(updatedVal) => onSaveEdit(escapedField, updatedVal)}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  if (!isContainer(value)) {
    const filterable =
      onQuickFilter !== undefined &&
      escapedField !== '' &&
      isFilterValue(value) &&
      isFieldIndexed(escapedField, indexing);
    const label = filterable ? `Filter where ${displayPath(escapedField)} = ${JSON.stringify(value)}` : '';

    return (
      <div data-path={path} className="group relative flex items-center py-0.5 pl-4 break-all flex-wrap">
        {filterable && (
          <button
            type="button"
            className="absolute left-0 top-0.5 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            style={{ color: 'var(--astra-accent)' }}
            title={label}
            aria-label={label}
            onClick={() => onQuickFilter(escapedField, value)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5L1 2z" />
            </svg>
          </button>
        )}
        <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
        <span style={scalarStyle(value)} className="ml-1">
          {JSON.stringify(value) ?? String(value)}
        </span>

        {/* Read-only indicator */}
        {!inArray && !editable && (
          <span
            className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.2 rounded text-[10px] font-sans opacity-75"
            style={{
              background: 'var(--astra-surface)',
              color: 'var(--astra-muted)',
              border: '1px solid var(--astra-border)',
            }}
            title={readOnlyReason ?? 'Read-only field'}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4 4v2h-.5A1.5 1.5 0 0 0 2 7.5v6A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12.5 6H12V4a4 4 0 0 0-8 0zm6.5 2V4a2.5 2.5 0 0 0-5 0v2h5z" />
            </svg>
            <span>Read-only</span>
          </span>
        )}

        {/* Inline edit button */}
        {!inArray && editable && allowEdit && (
          <button
            type="button"
            className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            style={{ color: 'var(--astra-accent)' }}
            title={`Edit ${name}`}
            aria-label={`Edit ${name}`}
            onClick={() => onStartEdit(path)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a2.25 2.25 0 0 1 .446-.757l8.609-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.8 3.76l1.44 1.44 1.273-1.273a.25.25 0 0 0 0-.354l-1.086-1.086zM11.18 6.26 9.74 4.82 3.32 11.24a.75.75 0 0 0-.149.252l-.59 2.064 2.064-.59a.75.75 0 0 0 .252-.149L11.18 6.26z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];

  if (entries.length === 0) {
    return (
      <div data-path={path} className="group flex items-center py-0.5 pl-4">
        <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
        <span>
          {open}
          {close}
        </span>
        {!inArray && editable && allowEdit && (
          <button
            type="button"
            className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            style={{ color: 'var(--astra-accent)' }}
            title={`Edit ${name}`}
            aria-label={`Edit ${name}`}
            onClick={() => onStartEdit(path)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a2.25 2.25 0 0 1 .446-.757l8.609-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.8 3.76l1.44 1.44 1.273-1.273a.25.25 0 0 0 0-.354l-1.086-1.086zM11.18 6.26 9.74 4.82 3.32 11.24a.75.75 0 0 0-.149.252l-.59 2.064 2.064-.59a.75.75 0 0 0 .252-.149L11.18 6.26z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  const isOpen = expanded.has(path);
  const summary = `${entries.length} ${isArray ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;

  return (
    <div data-path={path}>
      <div className="group flex items-center py-0.5">
        <button
          type="button"
          className="flex items-center gap-1 text-left"
          aria-expanded={isOpen}
          onClick={() => onToggle(path)}
        >
          <span className="inline-block w-3 text-center" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
          <span>{isOpen ? open : `${open} ${summary} ${close}`}</span>
        </button>

        {!inArray && editable && allowEdit && (
          <button
            type="button"
            className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            style={{ color: 'var(--astra-accent)' }}
            title={`Edit ${name}`}
            aria-label={`Edit ${name}`}
            onClick={() => onStartEdit(path)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a2.25 2.25 0 0 1 .446-.757l8.609-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.8 3.76l1.44 1.44 1.273-1.273a.25.25 0 0 0 0-.354l-1.086-1.086zM11.18 6.26 9.74 4.82 3.32 11.24a.75.75 0 0 0-.149.252l-.59 2.064 2.064-.59a.75.75 0 0 0 .252-.149L11.18 6.26z" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && (
        <>
          <div className="ml-1.5 border-l pl-3" style={{ borderColor: 'var(--astra-border)' }}>
            {entries.slice(0, MAX_CHILDREN).map(([key, child]) => (
              <JsonNode
                key={key}
                name={key}
                value={child}
                path={childPath(path, key)}
                expanded={expanded}
                onToggle={onToggle}
                inArray={isArray}
                onQuickFilter={onQuickFilter}
                indexing={indexing}
                editingPath={editingPath}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                keyspace={keyspace}
                collection={collection}
                docId={docId}
                allowEdit={allowEdit}
              />
            ))}
            {entries.length > MAX_CHILDREN && (
              <div className="py-0.5 pl-4" style={{ color: 'var(--astra-muted)' }}>
                … {entries.length - MAX_CHILDREN} more
              </div>
            )}
          </div>
          <div className="pl-4">{close}</div>
        </>
      )}
    </div>
  );
}

function initialExpanded(doc: Doc): Set<string> {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(doc)) {
    if (isContainer(value)) paths.add(childPath('', key));
  }
  return paths;
}

export default function RowDetailPanel({
  doc,
  keyspace,
  collection,
  onClose,
  onFindSimilar,
  onQuickFilter,
  onUpdateDoc,
  indexing,
  focus = null,
}: RowDetailPanelProps) {
  // Top-level keys start expanded; nested containers start collapsed (unless a field is focused).
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    focus ? expandToField(initialExpanded(doc), focus.field) : initialExpanded(doc),
  );
  const [view, setView] = useState<'tree' | 'raw'>('tree');
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);
  const onDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setPanelWidth(next);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelWidth],
  );

  // A new focus on the already-open row: show the field tree and expand down to the field.
  const [appliedFocus, setAppliedFocus] = useState(focus);
  if (focus !== appliedFocus) {
    setAppliedFocus(focus);
    if (focus) {
      setView('tree');
      setExpanded((prev) => expandToField(prev, focus.field));
    }
  }

  useEffect(() => {
    if (!focus) return;
    const paths = fieldToPanelPaths(focus.field);
    const target = paths[paths.length - 1];
    const nodes = bodyRef.current?.querySelectorAll<HTMLElement>('[data-path]');
    const el = nodes && Array.from(nodes).find((node) => node.dataset.path === target);
    if (!el) return; // e.g. the column is not present in this document
    el.scrollIntoView({ block: 'center' });
    el.animate?.(
      [
        { backgroundColor: 'color-mix(in srgb, var(--astra-accent) 35%, transparent)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1500, easing: 'ease-out' },
    );
  }, [focus]);

  const [copied, setCopied] = useState<'json' | 'id' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copy = (kind: 'json' | 'id', text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(kind);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {
        // Clipboard may be unavailable (insecure context / permission denied).
      });
  };

  const handleStartEdit = (path: string) => {
    setEditingPath(path);
    setSaveSuccessMsg(null);
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
  };

  const handleSaveEdit = (escapedField: string, newValue: unknown) => {
    const updated = setByEscapedPath(doc, escapedField, newValue);
    setEditingPath(null);
    setSaveSuccessMsg(`Updated ${displayPath(escapedField)} successfully.`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
    onUpdateDoc?.(updated);
  };

  const buttonClass = 'px-2 py-1 text-xs font-medium rounded border disabled:opacity-40';
  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <aside
      aria-label="Row detail"
      className="flex flex-col flex-shrink-0 min-h-0 relative"
      style={{
        width: panelWidth,
        maxWidth: '50vw',
        background: 'var(--astra-sidebar)',
        color: 'var(--astra-text)',
        animation: 'astra-slide-in 150ms ease-out',
      }}
    >
      {/* Drag handle — sits on the left border */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center"
        style={{ width: 5, cursor: 'col-resize', borderLeft: '1px solid var(--astra-border)' }}
        onMouseDown={onDragMouseDown}
      >
        {/* Subtle grip dots */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            pointerEvents: 'none',
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 3,
                height: 3,
                borderRadius: '50%',
                background: 'var(--astra-border)',
              }}
            />
          ))}
        </div>
      </div>

      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--astra-border)', paddingLeft: '1rem' }}
      >
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={() => copy('json', JSON.stringify(doc, null, 2))}
        >
          {copied === 'json' ? 'Copied' : 'Copy JSON'}
        </button>
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={() => copy('id', idToString(doc._id))}
        >
          {copied === 'id' ? 'Copied' : 'Copy _id'}
        </button>
        <span
          title={
            onFindSimilar
              ? 'Search for documents similar to this one'
              : 'Find similar — available for vector collections'
          }
        >
          <button
            type="button"
            className={`${buttonClass} ${onFindSimilar ? '' : 'cursor-not-allowed'}`}
            style={buttonStyle}
            disabled={!onFindSimilar}
            onClick={() => onFindSimilar?.(doc)}
          >
            Find similar
          </button>
        </span>
        <button
          type="button"
          className="ml-auto rounded px-2 py-1 text-sm"
          style={{ color: 'var(--astra-muted)' }}
          aria-label="Close row detail"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {saveSuccessMsg && (
        <div
          role="status"
          className="mx-3 mt-2 flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs animate-fade-in"
          style={{
            background: 'color-mix(in srgb, #2ea043 15%, transparent)',
            borderColor: '#2ea043',
            color: '#7ee787',
          }}
        >
          <span>✓</span>
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      <div
        className="flex gap-1 border-b px-3 py-1.5"
        style={{ borderColor: 'var(--astra-border)' }}
        role="group"
        aria-label="Row detail view"
      >
        {(['tree', 'raw'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`px-2 py-0.5 text-xs font-medium rounded ${view === mode ? 'text-white' : ''}`}
            style={{
              background: view === mode ? 'var(--astra-accent)' : 'var(--astra-surface)',
              color: view === mode ? undefined : 'var(--astra-muted)',
            }}
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
          >
            {mode === 'tree' ? 'Fields' : 'Raw JSON'}
          </button>
        ))}
      </div>

      {view === 'tree' ? (
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs">
          {Object.entries(doc).map(([key, value]) => (
            <JsonNode
              key={key}
              name={key}
              value={value}
              path={childPath('', key)}
              expanded={expanded}
              onToggle={toggle}
              onQuickFilter={onQuickFilter}
              indexing={indexing}
              editingPath={editingPath}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              keyspace={keyspace}
              collection={collection}
              docId={doc._id}
              allowEdit={Boolean(onUpdateDoc)}
            />
          ))}
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
          <button
            type="button"
            className={`${buttonClass} absolute right-4 top-2 z-10`}
            style={buttonStyle}
            aria-label="Copy raw JSON"
            title="Copy raw JSON"
            onClick={() => copy('json', JSON.stringify(doc, null, 2))}
          >
            {copied === 'json' ? 'Copied' : 'Copy'}
          </button>
          <pre className="h-full overflow-auto p-3 font-mono text-xs whitespace-pre-wrap break-all">
            {highlightJson(doc)}
          </pre>
        </div>
      )}
    </aside>
  );
}
