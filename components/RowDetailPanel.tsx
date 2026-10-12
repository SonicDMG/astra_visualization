'use client';

import { useEffect, useRef, useState } from 'react';
import { unwrapScalar } from '@/lib/astra/schema';

type Doc = Record<string, unknown>;

interface RowDetailPanelProps {
  doc: Doc;
  onClose: () => void;
  /** Provided only for vector collections; enables the "Find similar" button. */
  onFindSimilar?: (doc: Doc) => void;
}

/** Height of the app header (Tailwind `h-14`), which the panel sits below. */
const HEADER_HEIGHT = '3.5rem';
const PANEL_WIDTH = 480;
const MAX_CHILDREN = 200;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function childPath(parent: string, key: string): string {
  return `${parent}/${encodeURIComponent(key)}`;
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
}

function JsonNode({ name, value, path, expanded, onToggle }: JsonNodeProps) {
  if (!isContainer(value)) {
    return (
      <div className="py-0.5 pl-4 break-all">
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

export default function RowDetailPanel({ doc, onClose, onFindSimilar }: RowDetailPanelProps) {
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
      className="flex flex-col border-l shadow-xl"
      style={{
        position: 'fixed',
        right: 0,
        top: HEADER_HEIGHT,
        height: `calc(100vh - ${HEADER_HEIGHT})`,
        width: PANEL_WIDTH,
        maxWidth: '100vw',
        zIndex: 20,
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
          />
        ))}
      </div>
    </aside>
  );
}
