'use client';

import { useMemo, useState } from 'react';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import {
  SEARCH_MODE_LABELS,
  canVectorizeText,
  parseVectorInput,
  supportedSearchModes,
  validateSearch,
} from '@/lib/query/compile';
import {
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
  type QuerySpec,
  type SearchMode,
  type SemanticSource,
  clampSearchLimit,
} from '@/lib/query/types';

/** The part of a `QuerySpec` that the search bar owns. */
export type SearchPatch = Pick<
  QuerySpec,
  'searchMode' | 'searchInput' | 'semanticSource' | 'similarTo' | 'searchLimit'
>;

interface SearchBarProps {
  spec: QuerySpec;
  /** Null while capabilities load: only Browse is offered. */
  capabilities: CollectionCapabilities | null;
  onApply: (patch: SearchPatch) => void;
}

/** Issues that explain *why* a search can't run; "required" ones just disable the button. */
const INFORMATIVE_ISSUE_CODES: ReadonlySet<string> = new Set([
  'SEARCH_MODE_UNSUPPORTED',
  'SEARCH_VECTOR_DIMENSION',
  'SEARCH_VECTORIZE_UNAVAILABLE',
]);

const controlStyle = {
  background: 'var(--astra-surface)',
  borderColor: 'var(--astra-border)',
  color: 'var(--astra-text)',
};

export default function SearchBar({ spec, capabilities, onApply }: SearchBarProps) {
  // Draft state; the parent remounts this component (via `key`) when the applied search changes.
  const [mode, setMode] = useState<SearchMode>(spec.searchMode);
  const [text, setText] = useState(spec.searchInput.text);
  const [vectorText, setVectorText] = useState(
    spec.searchInput.vector ? spec.searchInput.vector.join(', ') : '',
  );
  const [source, setSource] = useState<SemanticSource>(spec.semanticSource);
  const [limitText, setLimitText] = useState(String(spec.searchLimit));

  const modes: SearchMode[] = capabilities ? supportedSearchModes(capabilities) : ['browse'];
  const vectorizeOk = capabilities !== null && canVectorizeText(capabilities);
  // Without a usable vectorize service the only semantic input is a vector.
  const effectiveSource: SemanticSource = vectorizeOk ? source : 'vector';
  const usesVector = mode === 'semantic' && effectiveSource === 'vector';
  const usesText = mode === 'keyword' || mode === 'hybrid' || (mode === 'semantic' && !usesVector);

  const parsedVector = useMemo(
    () => (vectorText.trim() === '' ? null : parseVectorInput(vectorText)),
    [vectorText],
  );
  const vectorParseError =
    usesVector && parsedVector !== null && 'error' in parsedVector ? parsedVector.error : null;

  const patch: SearchPatch = {
    searchMode: mode,
    searchInput: {
      text: text.trim(),
      vector:
        usesVector && parsedVector !== null && 'vector' in parsedVector
          ? parsedVector.vector
          : null,
    },
    semanticSource: effectiveSource,
    similarTo: null,
    searchLimit: clampSearchLimit(Number(limitText)),
  };

  const issues =
    capabilities !== null && mode !== 'browse'
      ? validateSearch({ ...spec, ...patch }, capabilities)
      : [];
  const informative = issues.filter((i) => INFORMATIVE_ISSUE_CODES.has(i.code));
  const canSubmit =
    capabilities !== null && mode !== 'browse' && issues.length === 0 && vectorParseError === null;

  const textBlockedReason =
    capabilities === null
      ? null
      : capabilities.vectorizeNeedsKey
        ? 'This collection’s embedding provider needs an API key that this app does not send. Use a vector instead.'
        : !vectorizeOk
          ? 'This collection has no vectorize service. Use a vector instead.'
          : null;

  const selectMode = (next: SearchMode) => {
    setMode(next);
    // Browse has no query to submit: leaving a search applies immediately.
    if (next === 'browse' && spec.searchMode !== 'browse') {
      onApply({
        searchMode: 'browse',
        searchInput: { text: '', vector: null },
        semanticSource: spec.semanticSource,
        similarTo: null,
        searchLimit: spec.searchLimit,
      });
    }
  };

  const submit = () => {
    if (canSubmit) onApply(patch);
  };

  const segment = (active: boolean, disabled = false) => ({
    background: active ? 'var(--astra-accent)' : 'var(--astra-surface)',
    color: active ? '#fff' : 'var(--astra-muted)',
    opacity: disabled ? 0.4 : 1,
  });

  return (
    <form
      aria-label="Search"
      className="flex flex-col gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1" role="group" aria-label="Search mode">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              className="px-3 py-1 text-xs font-medium rounded"
              style={segment(mode === m)}
              aria-pressed={mode === m}
              onClick={() => selectMode(m)}
            >
              {SEARCH_MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {mode === 'semantic' && (
          <div className="flex gap-1" role="group" aria-label="Semantic query type">
            <button
              type="button"
              className="px-3 py-1 text-xs font-medium rounded"
              style={segment(effectiveSource === 'text', !vectorizeOk)}
              aria-pressed={effectiveSource === 'text'}
              disabled={!vectorizeOk}
              title={
                textBlockedReason ?? 'Embed the query text with the collection’s vectorize service'
              }
              onClick={() => setSource('text')}
            >
              Text
            </button>
            <button
              type="button"
              className="px-3 py-1 text-xs font-medium rounded"
              style={segment(effectiveSource === 'vector')}
              aria-pressed={effectiveSource === 'vector'}
              title="Search with a pasted vector"
              onClick={() => setSource('vector')}
            >
              Vector
            </button>
          </div>
        )}

        {usesText && (
          <input
            type="search"
            aria-label={`${SEARCH_MODE_LABELS[mode]} search text`}
            placeholder={mode === 'keyword' ? 'Keywords…' : 'Search text…'}
            className="min-w-64 flex-1 rounded border px-2 py-1"
            style={controlStyle}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        {mode !== 'browse' && (
          <>
            <label className="flex items-center gap-1" style={{ color: 'var(--astra-muted)' }}>
              Results
              <input
                type="number"
                min={MIN_SEARCH_LIMIT}
                max={MAX_SEARCH_LIMIT}
                className="w-20 rounded border px-1 py-1"
                style={controlStyle}
                value={limitText}
                onChange={(e) => setLimitText(e.target.value)}
                onBlur={() => setLimitText(String(clampSearchLimit(Number(limitText))))}
              />
            </label>
            <button
              type="submit"
              className="px-3 py-1 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed"
              style={controlStyle}
              disabled={!canSubmit}
            >
              Search
            </button>
          </>
        )}
      </div>

      {usesVector && (
        <textarea
          aria-label="Query vector"
          aria-invalid={vectorParseError !== null}
          placeholder={
            capabilities?.vectorDimension
              ? `Paste a JSON array or comma-separated numbers (${capabilities.vectorDimension} values)`
              : 'Paste a JSON array or comma-separated numbers'
          }
          rows={3}
          className="w-full rounded border px-2 py-1 font-mono"
          style={controlStyle}
          value={vectorText}
          onChange={(e) => setVectorText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}

      {(vectorParseError !== null || informative.length > 0) && (
        <p role="alert" style={{ color: 'var(--astra-error)' }}>
          {vectorParseError ?? informative.map((i) => i.message).join(' ')}
        </p>
      )}
    </form>
  );
}
