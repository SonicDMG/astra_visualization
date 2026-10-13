'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'astra-theme';
type Theme = 'dark' | 'light';

// The theme lives on <html class="light"> (set pre-paint by a script in layout.tsx),
// so the DOM class is the source of truth and we subscribe to it.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('light', next === 'light');
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the theme still applies for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="ml-auto rounded border px-3 py-1 text-sm"
      style={{
        borderColor: 'var(--astra-border)',
        color: 'var(--astra-text)',
        background: 'var(--astra-surface)',
      }}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
