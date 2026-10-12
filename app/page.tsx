import { configError } from '@/lib/astra/gateway';
import ConfigErrorScreen from '@/components/ConfigErrorScreen';

export default function Home() {
  if (configError !== null) {
    return <ConfigErrorScreen message={configError} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 border-r flex flex-col p-4"
        style={{
          background: 'var(--astra-sidebar)',
          borderColor: 'var(--astra-border)',
        }}
      >
        <p className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: 'var(--astra-muted)' }}>
          Keyspaces
        </p>
        <div
          className="flex-1 rounded text-sm flex items-center justify-center"
          style={{ color: 'var(--astra-muted)' }}
        >
          {/* Keyspace list will go here */}
          No keyspaces loaded
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
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

        {/* Content area */}
        <main
          className="flex-1 overflow-auto p-6"
          style={{ background: 'var(--astra-bg)', color: 'var(--astra-text)' }}
        >
          <p className="text-sm" style={{ color: 'var(--astra-muted)' }}>
            Select a keyspace and collection to get started.
          </p>
        </main>
      </div>
    </div>
  );
}
