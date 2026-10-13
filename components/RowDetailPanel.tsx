'use client';

import { useEffect, useRef, useState } from 'react';
import { isFieldIndexed, unwrapScalar } from '@/lib/astra/schema';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import { displayPath, escapeFieldSegment } from '@/lib/query/compile';
import type { FilterValue } from '@/lib/query/types';

type Doc = Record<string, unknown>;

interface RowDetailPanelProps {
  doc: Doc;
  onClose: () => void;
  /** Provided only for vector collections; enables the "Find similar" button. */
  onFindSimilar?: (doc: Doc) => void;
  /** Adds an `eq` filter for a scalar field. `field` is an escaped dotted path. */
  onQuickFilter?: (field: string, value: FilterValue) => void;
  /** Collection indexing options; quick filter is offered only for indexed fields. */
  indexing?: CollectionCapabilities['indexing'];
}

const PANEL_WIDTH = 480;
const MAX_CHILDREN = 200;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function childPath(parent: string, key: string): string {
  return `${parent}/${encodeURIComponent(key)}`;
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

function scalarStyle(value: unknown): React.CSSProperties {
  if (value === null) return { color: 'var(--astra-muted)' };
  if (typeof value === 'string') return { color: '#7ee787' };
  if (typeof value === 'number') return { color: '#79c0ff' };
  return { color: '#ffa657' };
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
}: JsonNodeProps) {
  if (!isContainer(value)) {
    const field = onQuickFilter !== undefined && !inArray ? panelPathToEscapedField(path) : '';
    const filterable =
      onQuickFilter !== undefined &&
      field !== '' &&
      isFilterValue(value) &&
      isFieldIndexed(field, indexing);
    const label = filterable ? `Filter where ${displayPath(field)} = ${JSON.stringify(value)}` : '';
    return (
      <div className="group relative py-0.5 pl-4 break-all">
        {filterable && (
          <button
            type="button"
            className="absolute left-0 top-0.5 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            style={{ color: 'var(--astra-accent)' }}
            title={label}
            aria-label={label}
            onClick={() => onQuickFilter(field, value)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5L1 2z" />
            </svg>
          </button>
        )}
        <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
        <span style={scalarStyle(value)}>{JSON.stringify(value) ?? String(value)}</span>
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
      <div className="py-0.5 pl-4">
        <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
        <span>
          {open}
          {close}
        </span>
      </div>
    );
  }

  const isOpen = expanded.has(path);
  const summary = `${entries.length} ${isArray ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 py-0.5 text-left"
        aria-expanded={isOpen}
        onClick={() => onToggle(path)}
      >
        <span className="inline-block w-3 text-center" aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
        <span style={{ color: 'var(--astra-muted)' }}>{name}: </span>
        <span>{isOpen ? open : `${open} ${summary} ${close}`}</span>
      </button>
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
  onClose,
  onFindSimilar,
  onQuickFilter,
  indexing,
}: RowDetailPanelProps) {
  // Top-level keys start expanded; nested containers start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(doc));
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

  const buttonClass = 'px-2 py-1 text-xs font-medium rounded border disabled:opacity-40';
  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <aside
      aria-label="Row detail"
      className="flex flex-col flex-shrink-0 min-h-0 border-l"
      style={{
        width: PANEL_WIDTH,
        maxWidth: '50vw',
        background: 'var(--astra-sidebar)',
        borderColor: 'var(--astra-border)',
        color: 'var(--astra-text)',
        animation: 'astra-slide-in 150ms ease-out',
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--astra-border)' }}
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

      <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs">
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
          />
        ))}
      </div>
    </aside>
  );
}
