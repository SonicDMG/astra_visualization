'use client';

import { useState, useEffect } from 'react';
import { vectorLabel, vectorizeLabel } from '@/lib/astra/schema';
import type { CollectionDescriptor, CollectionCapabilities } from '@/lib/astra/gateway';

interface KeyspacePickerProps {
  onKeyspaceChange: (keyspace: string) => void;
  disabled?: boolean;
}

export function KeyspacePicker({ onKeyspaceChange, disabled = false }: KeyspacePickerProps) {
  const [keyspaces, setKeyspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/keyspaces');
        const data = await res.json();
        if (!mounted) return;
        if ('error' in data) {
          setError(data.error);
        } else {
          setKeyspaces(data.keyspaces);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load keyspaces');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-8">
        <svg
          className="animate-spin h-5 w-5"
          style={{ color: 'var(--astra-muted)' }}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="text-sm p-2 rounded"
        style={{ color: 'var(--astra-error)', background: 'var(--astra-bg)' }}
      >
        {error}
      </div>
    );
  }

  return (
    <select
      className="w-full rounded border bg-transparent text-sm appearance-none px-3 py-2"
      style={{
        color: 'var(--astra-text)',
        borderColor: 'var(--astra-border)',
        backgroundColor: 'var(--astra-surface)',
      }}
      onChange={(e) => onKeyspaceChange(e.target.value)}
      disabled={disabled || keyspaces.length === 0}
      defaultValue=""
    >
      <option value="" disabled>
        Select a keyspace
      </option>
      {keyspaces.map((ks) => (
        <option key={ks} value={ks}>
          {ks}
        </option>
      ))}
    </select>
  );
}

interface CollectionBadgeProps {
  caps: CollectionCapabilities;
}

function CollectionBadge({ caps }: CollectionBadgeProps) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {vectorLabel(caps) && (
        <span
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
          style={{
            background: 'rgba(30, 144, 255, 0.15)',
            color: 'var(--astra-accent)',
            border: '1px solid rgba(30, 144, 255, 0.3)',
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          {vectorLabel(caps)}
        </span>
      )}
      {vectorizeLabel(caps) && (
        <span
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
          style={{
            background: 'rgba(124, 92, 216, 0.15)',
            color: '#7c5cd8',
            border: '1px solid rgba(124, 92, 216, 0.3)',
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          {vectorizeLabel(caps)}
        </span>
      )}
      {caps.hasLexical && (
        <span
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            color: '#22c55e',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          Lexical
        </span>
      )}
      {caps.hasRerank && (
        <span
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
          style={{
            background: 'rgba(249, 115, 22, 0.15)',
            color: '#f97316',
            border: '1px solid rgba(249, 115, 22, 0.3)',
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          Rerank
        </span>
      )}
    </div>
  );
}

interface CollectionListProps {
  keyspace: string;
  onCollectionSelect: (keyspace: string, collectionName: string) => void;
}

export function CollectionList({ keyspace, onCollectionSelect }: CollectionListProps) {
  const [collections, setCollections] = useState<CollectionDescriptor[]>([]);
  const [tables, setTables] = useState<{ name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keyspace) return;

    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    { setLoading(true); setError(null); }

    async function load() {
      try {
        const res = await fetch(`/api/collections?keyspace=${encodeURIComponent(keyspace)}`);
        const data = await res.json();
        if (!mounted) return;
        if ('error' in data) {
          setError(data.error);
        } else {
          setCollections(data.collections);
          setTables(data.tables);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load collections');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [keyspace]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 mt-4">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--astra-muted)' }}>
          Collections
        </p>
        <div className="flex-1 flex items-center justify-center">
          <svg
            className="animate-spin h-6 w-6"
            style={{ color: 'var(--astra-muted)' }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3 mt-4">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--astra-muted)' }}>
          Collections
        </p>
        <div
          className="text-sm p-3 rounded"
          style={{ color: 'var(--astra-error)', background: 'var(--astra-bg)' }}
        >
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 mt-4 flex-1 overflow-auto">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--astra-muted)' }}>
        Collections ({collections.length})
      </p>
      {collections.length === 0 && (
        <p className="text-sm flex-1 flex items-center justify-center" style={{ color: 'var(--astra-muted)' }}>
          No collections in this keyspace
        </p>
      )}
      <ul className="flex-1 flex flex-col gap-1 overflow-auto">
        {collections.map((col) => (
          <li key={col.name}>
            <button
              className="w-full text-left rounded px-3 py-2 text-sm transition-colors hover:bg-opacity-10 focus:outline-none focus:ring-2 focus:ring-inset"
              style={{
                color: 'var(--astra-text)',
                backgroundColor: 'transparent',
                borderColor: 'var(--astra-border)',
              }}
              onClick={() => onCollectionSelect(keyspace, col.name)}
            >
              <div className="font-medium truncate">{col.name}</div>
              <CollectionBadge caps={col.capabilities} />
            </button>
          </li>
        ))}
      </ul>

      {tables.length > 0 && (
        <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--astra-border)' }}>
          <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--astra-muted)' }}>
            Tables (coming soon)
          </p>
          <ul className="flex flex-col gap-1">
            {tables.map((table) => (
              <li key={table.name}>
                <span
                  className="px-3 py-2 text-sm truncate opacity-50 cursor-not-allowed pointer-events-none"
                  style={{ color: 'var(--astra-text)' }}
                >
                  {table.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  onCollectionSelect: (keyspace: string, collectionName: string) => void;
}

export default function Sidebar({ onCollectionSelect }: SidebarProps) {
  const [keyspace, setKeyspace] = useState('');

  return (
    <aside
      className="w-64 flex-shrink-0 border-r flex flex-col p-4"
      style={{
        background: 'var(--astra-sidebar)',
        borderColor: 'var(--astra-border)',
      }}
    >
      <KeyspacePicker onKeyspaceChange={setKeyspace} />
      {keyspace && (
        <CollectionList keyspace={keyspace} onCollectionSelect={onCollectionSelect} />
      )}
      {!keyspace && (
        <div className="mt-4 text-sm flex-1 flex items-center justify-center" style={{ color: 'var(--astra-muted)' }}>
          Select a keyspace to view collections
        </div>
      )}
    </aside>
  );
}