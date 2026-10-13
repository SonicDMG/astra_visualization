'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import ExplorerState from '@/components/ExplorerState';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TraceProvider, useTrace } from '@/lib/trace/TraceContext';

function HeaderTraceToggle() {
  const { isPanelOpen, togglePanel, currentRun } = useTrace();

  return (
    <button
      type="button"
      onClick={togglePanel}
      className={`ml-auto mr-3 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition ${
        isPanelOpen
          ? 'bg-sky-500/10 text-sky-400 border-sky-500/40 shadow-sm'
          : 'hover:bg-slate-800/40'
      }`}
      style={{
        borderColor: isPanelOpen ? undefined : 'var(--astra-border)',
        background: isPanelOpen ? undefined : 'var(--astra-surface)',
        color: isPanelOpen ? undefined : 'var(--astra-text)',
      }}
      title="Toggle Live Request Trace Panel"
      aria-label="Toggle Live Request Trace Panel"
      aria-pressed={isPanelOpen}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isPanelOpen ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
        }`}
      />
      <span>Live Trace</span>
      {currentRun && isPanelOpen && (
        <span className="text-[10px] px-1 py-0.2 rounded bg-sky-950 text-sky-300 font-mono">
          {currentRun.totalMs}ms
        </span>
      )}
    </button>
  );
}

function Content() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const keyspace = searchParams.get('keyspace');
  const collection = searchParams.get('collection');

  const handleCollectionSelect = (ks: string, coll: string) => {
    const params = new URLSearchParams();
    params.set('keyspace', ks);
    params.set('collection', coll);
    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        urlKeyspace={keyspace}
        urlCollection={collection}
        onCollectionSelect={handleCollectionSelect}
      />

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
          <HeaderTraceToggle />
          <ThemeToggle />
        </header>

        <main
          className="flex-1 min-h-0 overflow-hidden"
          style={{ background: 'var(--astra-bg)', color: 'var(--astra-text)' }}
        >
          {keyspace && collection ? (
            <ExplorerState key={`${keyspace}/${collection}`} keyspace={keyspace} collection={collection} />
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
      <TraceProvider>
        <Content />
      </TraceProvider>
    </Suspense>
  );
}