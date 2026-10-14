'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTrace } from '@/lib/trace/TraceContext';
import {
  HANDLING_COLOR,
  HANDLING_LABEL,
  HANDLING_SHORT,
  callAsCurl,
  consoleTarget,
} from '@/lib/trace/describe';
import type { TraceHandling, TraceRun } from '@/lib/trace/types';
import { QueryFlowDiagram } from './QueryFlowDiagram';
import { highlightJson } from '@/lib/ui/highlightJson';

const IDLE_HANDLING: { handling: TraceHandling; text: string }[] = [
  { handling: 'local', text: 'Re-sorting search results you already have. Nothing is sent to Astra.' },
  {
    handling: 'astra-memory',
    text: 'Sorting a browse. Astra loads up to 10,000 matching documents, sorts them in memory and returns one page.',
  },
  {
    handling: 'astra-live',
    text: 'Unsorted browse, filters and searches. Astra reads the data directly.',
  },
];

const APP_HEADER_PX = 56; // h-14 app header above the explorer
const MIN_PANEL_PX = 220;
const DEFAULT_PANEL_PX = 420;
const MIN_REMAINING_PX = 160; // always leave room for the results grid
const KEY_STEP_PX = 24;
const ACTION_BUTTON_CLASS =
  'text-[11px] px-2 py-0.5 rounded border cursor-pointer transition-[transform,background-color] duration-100 hover:bg-slate-800/40 active:translate-y-px active:scale-95 active:bg-slate-800/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 motion-reduce:transition-none motion-reduce:active:transform-none';

export default function LiveTracePanel() {
  const {
    isPanelOpen,
    setPanelOpen,
    currentRun,
    history,
    replayRun,
    clearHistory,
  } = useTrace();

  const [inspectRunId, setInspectRunId] = useState<string | null>(null);
  // Chosen box in the diagram; reset whenever a different run is shown.
  const [selection, setSelection] = useState<{ runId: string; index: number } | null>(null);
  // Message shown in the ephemeral tooltip next to the copy buttons (null = hidden).
  const [toast, setToast] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Astra portal API Console for this database, or null if it could not be worked out.
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Looked up while the panel is open, so the console tab can open straight from a click
  // (a window opened after an await would be blocked as a popup).
  useEffect(() => {
    if (!isPanelOpen || consoleUrl) return;
    let cancelled = false;
    fetch('/api/keyspaces')
      .then((res) => res.json())
      .then((data: { consoleBaseUrl?: string | null }) => {
        if (!cancelled && data.consoleBaseUrl) setConsoleUrl(data.consoleBaseUrl);
      })
      .catch(() => {
        // The button just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [isPanelOpen, consoleUrl]);

  // Confirm briefly; the buttons stay usable, and each click restarts the confirmation.
  const showToast = (message: string, ms = 1800) => {
    setToast(message);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setToast(null), ms);
  };

  // Plain copy of the request JSON as displayed (the curl button copies a full command instead).
  const [jsonCopied, setJsonCopied] = useState(false);
  const jsonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (jsonTimerRef.current) clearTimeout(jsonTimerRef.current);
    };
  }, []);
  const copyJson = (body: unknown) => {
    void navigator.clipboard
      .writeText(JSON.stringify(body, null, 2))
      .then(() => {
        setJsonCopied(true);
        if (jsonTimerRef.current) clearTimeout(jsonTimerRef.current);
        jsonTimerRef.current = setTimeout(() => setJsonCopied(false), 1500);
      })
      .catch(() => setJsonCopied(false));
  };

  // The console cannot be prefilled from a link, so the request goes on the clipboard and the
  // console opens for a paste. `label` is the command the user must pick there.
  const sendToConsole = (url: string, body: unknown, label: string) => {
    window.open(url, '_blank', 'noopener');
    void navigator.clipboard
      .writeText(JSON.stringify(body, null, 2))
      .then(() => showToast(`Request copied. In the console choose "${label}", then paste.`, 6000))
      .catch(() => setToast(null));
  };
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_PX);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const clampHeight = useCallback((h: number) => {
    const max = Math.max(MIN_PANEL_PX, window.innerHeight - APP_HEADER_PX - MIN_REMAINING_PX);
    return Math.min(max, Math.max(MIN_PANEL_PX, h));
  }, []);

  // Keep the panel inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setPanelHeight((h) => clampHeight(h));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampHeight]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: panelHeight };
    setIsResizing(true);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPanelHeight(clampHeight(drag.startHeight + (e.clientY - drag.startY)));
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setIsResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPanelHeight((h) => clampHeight(h - KEY_STEP_PX));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPanelHeight((h) => clampHeight(h + KEY_STEP_PX));
    }
  };

  if (!isPanelOpen) return null;

  const activeRun: TraceRun | null = inspectRunId
    ? history.find((h) => h.id === inspectRunId) || currentRun
    : currentRun || history[0] || null;

  // Default to the main query (find / findAndRerank), not a supporting call like findCollections.
  const mainQuery = (command: string) => command === 'find' || command === 'findAndRerank';
  const firstCallIndex = activeRun
    ? Math.max(
        activeRun.steps.findIndex((step) => step.call && mainQuery(step.call.command)),
        activeRun.steps.findIndex((step) => step.call),
      )
    : -1;
  const selectedIndex =
    selection && activeRun && selection.runId === activeRun.id
      ? selection.index
      : firstCallIndex >= 0
        ? firstCallIndex
        : null;
  const selectedStep = activeRun && selectedIndex !== null ? activeRun.steps[selectedIndex] : null;

  const color = activeRun ? HANDLING_COLOR[activeRun.handling] : 'var(--astra-border)';

  return (
    <section
      aria-label="Live query trace"
      className="relative flex flex-col flex-shrink-0 border-b select-none overflow-hidden"
      style={{
        height: panelHeight,
        background: 'var(--astra-sidebar)',
        borderColor: 'var(--astra-border)',
        color: 'var(--astra-text)',
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--astra-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight">Live Query Trace</h2>
          {activeRun && (
            <span className="text-xs font-mono" style={{ color: 'var(--astra-muted)' }}>
              Total: <strong className="text-emerald-400 font-semibold">{activeRun.totalMs} ms</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border hover:bg-slate-800/40 transition disabled:opacity-40"
            style={{
              borderColor: 'var(--astra-border)',
              background: 'var(--astra-surface)',
              color: 'var(--astra-text)',
            }}
            onClick={() => replayRun(activeRun?.id)}
            disabled={!activeRun || activeRun.steps.length === 0}
            title="Replay step-by-step animation"
          >
            <span className="text-[10px]">▶</span>
            <span>Replay</span>
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-slate-800/40 transition"
            style={{
              borderColor: 'var(--astra-border)',
              background: 'var(--astra-surface)',
              color: 'var(--astra-muted)',
            }}
            onClick={() => setPanelOpen(false)}
            aria-label="Close live trace panel"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-hidden">
        {/* Verdict strip: where was it handled, and why */}
        {activeRun ? (
          <div
            className="rounded border px-3 py-2 flex flex-col gap-0.5 flex-shrink-0"
            style={{
              borderColor: color,
              borderLeftWidth: 4,
              background: 'color-mix(in srgb, ' + color + ' 10%, var(--astra-surface))',
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold" style={{ color }}>
                {HANDLING_LABEL[activeRun.handling]}
                {activeRun.handling === 'astra-memory' && ' (up to 10,000 documents)'}
              </span>
              <span
                className="text-[11px] truncate min-w-0"
                style={{ color: 'var(--astra-muted)' }}
                title={activeRun.trigger}
              >
                {activeRun.trigger}
              </span>
            </div>
            <p className="text-xs">{activeRun.reason}</p>
            {activeRun.paging && (
              <p className="text-xs" style={{ color: 'var(--astra-muted)' }}>
                {activeRun.paging}
              </p>
            )}
            {activeRun.outcome === 'error' && activeRun.errorDetail && (
              <p className="text-xs font-semibold text-rose-400">Error: {activeRun.errorDetail}</p>
            )}
          </div>
        ) : (
          <div
            className="rounded border px-3 py-2 flex flex-col gap-1 flex-shrink-0"
            style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-surface)' }}
          >
            <span className="text-xs font-semibold">
              Run a query, sort, search or filter to see where it is handled.
            </span>
            {IDLE_HANDLING.map(({ handling, text }) => (
              <div key={handling} className="flex items-baseline gap-2 text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: HANDLING_COLOR[handling] }}
                />
                <span className="font-semibold flex-shrink-0">{HANDLING_LABEL[handling]}.</span>
                <span style={{ color: 'var(--astra-muted)' }}>{text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Diagram: only the stages this request used */}
          <div
            className="flex-1 min-w-0 min-h-0 rounded border p-3 flex items-center justify-center overflow-hidden"
            style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-bg)' }}
          >
            {activeRun ? (
              <QueryFlowDiagram
                steps={activeRun.steps}
                handling={activeRun.handling}
                activeStepIndex={activeRun.activeStepIndex}
                selectedIndex={selectedIndex}
                onSelect={(index) => {
                  setToast(null);
                  setJsonCopied(false);
                  setSelection({ runId: activeRun.id, index });
                }}
              />
            ) : (
              <p className="text-xs" style={{ color: 'var(--astra-muted)' }}>
                The path of each request appears here.
              </p>
            )}
          </div>

          {/* What happened + recent requests */}
          <div className="w-full lg:w-96 flex-shrink-0 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1 max-lg:max-h-40">
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <h3
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--astra-muted)' }}
              >
                {selectedStep?.call ? 'Data API request' : 'Selected step'}
              </h3>
              {selectedStep ? (
                <div
                  className="rounded border p-2 flex flex-col gap-1.5 text-xs select-text"
                  style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-surface)' }}
                >
                  <div className="font-semibold">{selectedStep.label}</div>
                  {selectedStep.call ? (
                    <>
                      <div className="font-mono text-[11px] break-all" style={{ color: 'var(--astra-muted)' }}>
                        {selectedStep.call.method} {'{ASTRA_DB_API_ENDPOINT}'}
                        {selectedStep.call.path}
                      </div>
                      <div>
                        {/* The button lives inside the scroll area (sticky, floated right), so it
                            sits left of the scrollbar instead of covering it. */}
                        <div
                          className="overflow-auto max-h-28 rounded"
                          style={{ background: 'var(--astra-bg)' }}
                        >
                        <button
                          type="button"
                          aria-label="Copy JSON"
                          title="Copy JSON"
                          className="sticky top-1 right-1 float-right mt-1 mr-1 z-10 w-6 h-6 flex items-center justify-center rounded border cursor-pointer transition-[transform,background-color] duration-100 hover:bg-slate-800/60 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 motion-reduce:transition-none motion-reduce:active:transform-none"
                          style={{
                            borderColor: 'var(--astra-border)',
                            background: 'var(--astra-surface)',
                            color: jsonCopied ? 'var(--astra-accent)' : 'var(--astra-muted)',
                          }}
                          onClick={() => copyJson(selectedStep.call?.body)}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            {jsonCopied ? (
                              <path d="m3 8.5 3.2 3.2L13 4.8" />
                            ) : (
                              <>
                                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                                <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1.5" />
                              </>
                            )}
                          </svg>
                        </button>
                        <pre className="font-mono text-[11px] leading-snug p-1.5 m-0">
                           {highlightJson(selectedStep.call.body)}
                         </pre>
                        </div>
                        <span role="status" aria-live="polite" className="sr-only">
                          {jsonCopied ? 'Copied JSON to clipboard' : ''}
                        </span>
                      </div>
                      <div className="relative self-start flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          className={ACTION_BUTTON_CLASS}
                          style={{ borderColor: 'var(--astra-border)' }}
                          onClick={() => {
                            const call = selectedStep.call;
                            if (!call) return;
                            void navigator.clipboard
                              .writeText(callAsCurl(call))
                              .then(() => showToast('Copied to clipboard'))
                              .catch(() => setToast(null));
                          }}
                        >
                          Copy as curl
                        </button>
                        {consoleUrl && (() => {
                          const call = selectedStep.call;
                          const target = consoleTarget(call);
                          return (
                            <button
                              type="button"
                              disabled={!target.ok}
                              className={`${ACTION_BUTTON_CLASS} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:transform-none`}
                              style={{ borderColor: 'var(--astra-border)' }}
                              title={
                                target.ok
                                  ? `Copies the request and opens the Astra API Console. There, choose "${target.label}" and paste.`
                                  : target.reason
                              }
                              onClick={() => target.ok && sendToConsole(consoleUrl, call.body, target.label)}
                            >
                              Send to API Console
                            </button>
                          );
                        })()}
                        {toast && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-full mt-1.5 z-10 max-w-full rounded px-2 py-1 text-[11px] font-medium pointer-events-none"
                            style={{
                              background: 'var(--astra-text)',
                              color: 'var(--astra-bg)',
                            }}
                          >
                            {toast}
                          </span>
                        )}
                        <span role="status" aria-live="polite" className="sr-only">
                          {toast ?? ''}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {selectedStep.endpoint && (
                        <div className="font-mono text-[11px] break-all" style={{ color: 'var(--astra-muted)' }}>
                          {selectedStep.endpoint}
                        </div>
                      )}
                      {selectedStep.detail && (
                        <div style={{ color: 'var(--astra-muted)' }}>{selectedStep.detail}</div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs py-1" style={{ color: 'var(--astra-muted)' }}>
                  Select a step in the diagram to see the request behind it.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <h3
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--astra-muted)' }}
                >
                  Recent requests ({history.length})
                </h3>
                {history.length > 0 && (
                  <button
                    type="button"
                    className="text-xs hover:underline"
                    style={{ color: 'var(--astra-muted)' }}
                    onClick={() => {
                      clearHistory();
                      setInspectRunId(null);
                      setSelection(null);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {history.length > 0 && (
                <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
                  {history.map((run) => {
                    const isSelected = run.id === activeRun?.id;
                    return (
                      <button
                        key={run.id}
                        type="button"
                        className={`flex items-center justify-between gap-2 p-1.5 px-2 rounded border text-left text-xs transition ${
                          isSelected ? 'ring-1 ring-sky-500' : 'hover:bg-slate-800/30'
                        }`}
                        style={{
                          borderColor: 'var(--astra-border)',
                          background: isSelected
                            ? 'color-mix(in srgb, var(--astra-accent) 15%, var(--astra-surface))'
                            : 'var(--astra-surface)',
                        }}
                        onClick={() => setInspectRunId(run.id)}
                      >
                        <span className="truncate min-w-0" title={run.trigger}>
                          {run.trigger}
                        </span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          <span
                            className="text-[10px] px-1.5 rounded font-medium"
                            style={{
                              color: HANDLING_COLOR[run.handling],
                              border: `1px solid ${HANDLING_COLOR[run.handling]}`,
                            }}
                          >
                            {HANDLING_SHORT[run.handling]}
                          </span>
                          <span className="font-mono text-[10px] text-emerald-400">{run.totalMs} ms</span>
                          {run.outcome === 'error' && (
                            <span className="text-[10px] font-mono text-rose-400">ERROR</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drag handle: resize the panel height (also ArrowUp/ArrowDown when focused) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize live trace panel"
        aria-valuenow={Math.round(panelHeight)}
        aria-valuemin={MIN_PANEL_PX}
        tabIndex={0}
        className="absolute left-0 right-0 bottom-0 h-2 cursor-row-resize touch-none flex items-center justify-center focus:outline-none group"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onKeyDown={onHandleKeyDown}
      >
        <span
          className="h-1 w-12 rounded-full transition-colors group-hover:bg-sky-400 group-focus-visible:bg-sky-400"
          style={{ background: isResizing ? 'var(--astra-accent)' : 'var(--astra-border)' }}
        />
      </div>
    </section>
  );
}
