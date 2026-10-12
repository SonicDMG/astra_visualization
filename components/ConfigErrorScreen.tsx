interface ConfigErrorScreenProps {
  message: string;
}

export default function ConfigErrorScreen({ message }: ConfigErrorScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div
        className="max-w-lg w-full rounded-lg border p-8"
        style={{
          background: 'var(--astra-surface)',
          borderColor: 'var(--astra-error)',
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          {/* Warning icon */}
          <svg
            className="w-6 h-6 flex-shrink-0"
            style={{ color: 'var(--astra-error)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--astra-error)' }}
          >
            Configuration Error
          </h1>
        </div>

        <p className="mb-4 text-sm" style={{ color: 'var(--astra-muted)' }}>
          Astra Data Explorer cannot start because of a missing or invalid
          configuration:
        </p>

        <pre
          className="text-sm rounded p-4 mb-6 whitespace-pre-wrap break-words"
          style={{
            background: 'var(--astra-bg)',
            color: 'var(--astra-text)',
            border: '1px solid var(--astra-border)',
          }}
        >
          {message}
        </pre>

        <div className="space-y-2 text-sm" style={{ color: 'var(--astra-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--astra-text)' }}>
            How to fix:
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              Copy <code className="font-mono text-xs px-1 py-0.5 rounded" style={{ background: 'var(--astra-border)' }}>.env.example</code> to{' '}
              <code className="font-mono text-xs px-1 py-0.5 rounded" style={{ background: 'var(--astra-border)' }}>.env.local</code>
            </li>
            <li>Fill in your Astra DB API endpoint and application token</li>
            <li>Restart the development server</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
