'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { vectorLabel, vectorizeLabel } from '@/lib/astra/schema';
import type { CollectionCapabilities } from '@/lib/astra/gateway';

interface CollectionInfoProps {
  keyspace: string;
  collection: string;
  capabilities: CollectionCapabilities;
}

function CollectionInfo({ keyspace, collection, capabilities }: CollectionInfoProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--astra-text)' }}>
          {collection}
        </h2>
        <span className="text-sm px-2 py-1 rounded" style={{ color: 'var(--astra-muted)', background: 'var(--astra-surface)' }}>
          Keyspace: {keyspace}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CapabilityCard
          title="Vector Index"
          value={vectorLabel(capabilities) ?? 'Not configured'}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          }
          hasValue={capabilities.hasVector}
        />
        <CapabilityCard
          title="Vectorize"
          value={vectorizeLabel(capabilities) ?? 'Not configured'}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
          hasValue={!!capabilities.vectorizeProvider}
        />
        <CapabilityCard
          title="Lexical Search"
          value={capabilities.hasLexical ? 'Enabled' : 'Disabled'}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          }
          hasValue={capabilities.hasLexical}
        />
        <CapabilityCard
          title="Rerank"
          value={capabilities.hasRerank ? 'Enabled' : 'Disabled'}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          }
          hasValue={capabilities.hasRerank}
        />
        {capabilities.hasVector && (
          <>
            <CapabilityCard
              title="Dimension"
              value={capabilities.vectorDimension?.toString() ?? 'Unknown'}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
              hasValue={true}
            />
            <CapabilityCard
              title="Metric"
              value={capabilities.vectorMetric ?? 'Unknown'}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
              hasValue={true}
            />
          </>
        )}
      </div>

      <p className="text-sm mt-8" style={{ color: 'var(--astra-muted)' }}>
        Data grid and query interface coming in Phase 3.
      </p>
    </div>
  );
}

interface CapabilityCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  hasValue: boolean;
}

function CapabilityCard({ title, value, icon, hasValue }: CapabilityCardProps) {
  return (
    <div
      className="rounded-lg border p-4 transition-colors"
      style={{
        background: 'var(--astra-surface)',
        borderColor: 'var(--astra-border)',
        color: hasValue ? 'var(--astra-text)' : 'var(--astra-muted)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: 'var(--astra-accent)' }}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--astra-muted)' }}>
          {title}
        </span>
      </div>
      <p className="font-mono text-lg">{value}</p>
    </div>
  );
}

function Content() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<CollectionCapabilities | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(false);

  const keyspace = searchParams.get('keyspace');
  const collection = searchParams.get('collection');

  const handleCollectionSelect = (ks: string, coll: string) => {
    const params = new URLSearchParams();
    params.set('keyspace', ks);
    params.set('collection', coll);
    router.push(`/?${params.toString()}`);
  };

  // Fetch capabilities when collection changes
  useEffect(() => {
    if (!keyspace || !collection) {
      return;
    }

    const ks = keyspace;
    const collName = collection;
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingCaps(true);
    async function loadCapabilities() {
      try {
        const res = await fetch(`/api/collections?keyspace=${encodeURIComponent(ks)}`);
        const data = await res.json();
        if (!mounted) return;
        if (!('error' in data)) {
          const coll = data.collections.find((c: { name: string }) => c.name === collName);
          if (coll) {
            setCapabilities(coll.capabilities);
          } else {
            setCapabilities(null);
          }
        } else {
          setCapabilities(null);
        }
      } catch {
        // Ignore errors, capabilities will remain null
        setCapabilities(null);
      } finally {
        if (mounted) setLoadingCaps(false);
      }
    }
    loadCapabilities();
    return () => {
      mounted = false;
    };
  }, [keyspace, collection]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onCollectionSelect={handleCollectionSelect} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <header
          className="h-14 flex items-center px-6 border-b flex-shrink-0"
          style={{
            background: 'var(--astra-bg)',
            borderColor: 'var(--astra-border)',
          }}
        >
          <span
            className="text-lg font-semibold tracking-tight"
            style={{ color: 'var(--astra-accent)' }}
          >
            Astra Data Explorer
          </span>
        </header>

        <main
          className="flex-1 overflow-auto p-6"
          style={{ background: 'var(--astra-bg)', color: 'var(--astra-text)' }}
        >
          {keyspace && collection && capabilities ? (
            <CollectionInfo keyspace={keyspace} collection={collection} capabilities={capabilities} />
          ) : keyspace && collection && loadingCaps ? (
            <div className="flex items-center justify-center h-full">
              <svg
                className="animate-spin h-8 w-8"
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
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <svg
                className="w-16 h-16"
                style={{ color: 'var(--astra-muted)' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              <p className="text-base" style={{ color: 'var(--astra-muted)' }}>
                Select a collection from the sidebar to view its details
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <svg
            className="animate-spin h-8 w-8"
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
      }
    >
      <Content />
    </Suspense>
  );
}