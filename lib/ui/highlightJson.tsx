import type React from 'react';

export function scalarStyle(value: unknown): React.CSSProperties {
  if (value === null) return { color: 'var(--astra-muted)' };
  if (typeof value === 'string') return { color: '#7ee787' };
  if (typeof value === 'number') return { color: '#79c0ff' };
  return { color: '#ffa657' };
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Pretty-prints a value as indented, syntax-highlighted JSON (React nodes, no raw HTML). */
export function highlightJson(value: unknown): React.ReactNode[] {
  const text = JSON.stringify(value, null, 2) ?? '';
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const [token, str, colon, bool, nul, num] = match;
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    if (str !== undefined && colon !== undefined) {
      nodes.push(
        <span key={start} style={{ color: 'var(--astra-text)' }}>
          {str}
        </span>,
        colon,
      );
    } else {
      const style =
        str !== undefined
          ? scalarStyle('')
          : bool !== undefined
            ? scalarStyle(true)
            : nul !== undefined
              ? scalarStyle(null)
              : num !== undefined
                ? scalarStyle(0)
                : undefined;
      nodes.push(
        <span key={start} style={style}>
          {token}
        </span>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
