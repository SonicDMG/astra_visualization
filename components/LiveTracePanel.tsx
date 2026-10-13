'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTrace } from '@/lib/trace/TraceContext';
import { SortingFlowDiagram } from './SortingFlowDiagram';
import type { SortingNodeId, TraceRun } from '@/lib/trace/types';

const NODE_DESCRIPTIONS: Record<SortingNodeId, { name: string; role: string; location: string }> = {
  click: {
    name: 'Header Click',
    role: 'User clicks column header (or Shift-clicks for multi-column sort)',
    location: 'components/ResultsGrid.tsx',
  },
  gate: {
    name: 'Sortable Gate',
    role: 'Checks if field is indexed and sortable in Astra collection capabilities',
    location: 'components/ResultsGrid.tsx',
  },
  noop: {
    name: 'Blocked (No-op)',
    role: 'Sort blocked; column is not indexed. Tooltip displays reason',
    location: 'components/ResultsGrid.tsx',
  },
  change: {
    name: 'cycleSort',
    role: 'Calculates new sort array (asc → desc → off) and updates URL query params (so=)',
    location: 'lib/query/compile.ts & components/ExplorerState.tsx',
  },
  mode: {
    name: 'Search Mode Check',
    role: 'Branches between Browse mode (remote sort) and Vector/Search modes (local sort)',
    location: 'components/ExplorerState.tsx',
  },
  local: {
    name: 'Local Sort',
    role: 'Sorts already-loaded documents in-memory in browser (no network refetch)',
    location: 'lib/query/compile.ts (sortDocumentsLocally)',
  },
  compile: {
    name: 'compileSort (Server)',
    role: 'Translates sort keys to Astra Data API format ({ field: 1 | -1 }) and configures skip/limit',
    location: 'lib/query/compile.ts & lib/astra/gateway.ts',
  },
  find: {
    name: 'Astra find (Server)',
    role: 'Executes Data API find command against Astra DB (sorts up to 10,000 matches)',
    location: 'lib/astra/gateway.ts',
  },
  errors: {
    name: 'Error Banner',
    role: 'Handles errors (e.g. 10k sort limit reached, invalid sort fields) and offers Clear Sort',
    location: 'components/ExplorerState.tsx & lib/astra/gateway.ts',
  },
  render: {
    name: 'Grid Renders',
    role: 'ResultsGrid renders updated sorted documents and updates pagination controls',
    location: 'components/ResultsGrid.tsx',
  },
};

const APP_HEADER_PX = 56; // h-14 app header above the explorer
const MIN_PANEL_PX = 220;
const DEFAULT_PANEL_PX = 420;
const MIN_REMAINING_PX = 160; // always leave room for the results grid
const KEY_STEP_PX = 24;

export default function LiveTracePanel() {
  const {
    isPanelOpen,
    setPanelOpen,
    currentRun,
    history,
    replayRun,
    clearHistory,
    selectedNodeId,
    setSelectedNodeId,
  } = useTrace();

  const [inspectRunId, setInspectRunId] = useState<string | null>(null);
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

  const nodeTimings = activeRun?.nodeTimings || {};
  const nodeStatuses = activeRun?.nodeStatuses || {};
  const completedNodes = activeRun?.completedNodeIds || new Set();
  const completedEdges = activeRun?.completedEdgeIds || new Set();

  const formatSortSpec = (run: TraceRun | null) => {
    if (!run || run.sortSpec.length === 0) return 'None (natural order)';
    return run.sortSpec.map((s) => `${s.field} ${s.dir.toUpperCase()}`).join(', ');
  };

  const selectedNodeInfo = selectedNodeId ? NODE_DESCRIPTIONS[selectedNodeId] : null;

  return (
    <section
      aria-label="Live Sorting Trace"
      className="relative flex flex-col flex-shrink-0 border-b select-none overflow-hidden"
      style={{
        height: panelHeight,
        background: 'var(--astra-sidebar)',
        borderColor: 'var(--astra-border)',
        color: 'var(--astra-text)',
      }}
    >
      {/* Top Header Bar */}
      <div
        className="flex items-center justify-between px-6 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--astra-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight">Live Sorting Trace</h2>
          {activeRun && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded font-mono font-medium ${
                activeRun.outcome === 'ok'
                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                  : activeRun.outcome === 'blocked'
                    ? 'bg-amber-950/60 text-amber-400 border border-amber-800'
                    : 'bg-rose-950/60 text-rose-400 border border-rose-800'
              }`}
            >
              {activeRun.outcome.toUpperCase()}
            </span>
          )}
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
            <span>Replay Last Request</span>
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

      {/* Main Horizontal Content Area */}
      <div className="flex flex-col lg:flex-row gap-4 p-4 flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Wide Diagram Section */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
          <div
            className="flex-1 min-h-0 rounded border p-2 flex items-center justify-center overflow-hidden"
            style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-bg)' }}
          >
            <SortingFlowDiagram
              activeNodeId={activeRun?.activeNodeId}
              completedNodeIds={completedNodes}
              activeEdgeId={activeRun?.activeEdgeId}
              completedEdgeIds={completedEdges}
              nodeStatuses={nodeStatuses}
              nodeTimings={nodeTimings}
              className="h-full w-full"
              onNodeClick={(nodeId) =>
                setSelectedNodeId(selectedNodeId === nodeId ? null : nodeId)
              }
            />
          </div>

          {/* Selected Node Inspector info */}
          {selectedNodeInfo ? (
            <div
              className="text-xs px-3 py-2 rounded border flex items-center justify-between gap-4 transition"
              style={{
                borderColor: 'var(--astra-border)',
                background: 'var(--astra-surface)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sky-400">{selectedNodeInfo.name}</span>
                <span className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
                  · {selectedNodeInfo.role}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {selectedNodeId && nodeTimings[selectedNodeId] !== undefined && (
                  <span className="text-[11px] font-mono text-emerald-400">
                    +{nodeTimings[selectedNodeId]} ms
                  </span>
                )}
                <span className="text-[10px] font-mono" style={{ color: 'var(--astra-muted)' }}>
                  {selectedNodeInfo.location}
                </span>
              </div>
            </div>
          ) : (
            <div
              className="text-[11px] px-3 py-1.5 rounded border text-center transition"
              style={{
                borderColor: 'var(--astra-border)',
                background: 'var(--astra-surface)',
                color: 'var(--astra-muted)',
              }}
            >
              Click any node in the diagram above to inspect where it executes in the codebase.
            </div>
          )}
        </div>

        {/* Right Column: Execution Timeline, Details & History */}
        <div className="w-full lg:w-96 flex-shrink-0 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1 max-lg:max-h-40">
          {/* Active Request Details */}
          <div
            className="p-2.5 rounded border text-xs font-mono flex flex-col gap-1 flex-shrink-0"
            style={{ borderColor: 'var(--astra-border)', background: 'var(--astra-surface)' }}
          >
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--astra-muted)' }}>Sort Spec:</span>
              <span className="font-semibold text-sky-400 truncate max-w-[200px]" title={formatSortSpec(activeRun)}>
                {formatSortSpec(activeRun)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--astra-muted)' }}>Search Mode:</span>
              <span>{activeRun?.searchMode || 'browse'}</span>
            </div>
            {activeRun?.errorDetail && (
              <div className="flex justify-between text-rose-400 font-semibold">
                <span>Error:</span>
                <span>{activeRun.errorDetail}</span>
              </div>
            )}
          </div>

          {/* Timeline Steps */}
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <h3
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--astra-muted)' }}
            >
              Timeline Steps ({activeRun?.steps.length ?? 0})
            </h3>

            {activeRun && activeRun.steps.length > 0 ? (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
                {activeRun.steps.map((step, idx) => (
                  <div
                    key={`${step.nodeId}-${idx}`}
                    className="flex items-center justify-between p-1.5 px-2 rounded border text-xs transition"
                    style={{
                      borderColor: 'var(--astra-border)',
                      background: 'var(--astra-surface)',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          step.status === 'ok'
                            ? 'bg-emerald-400'
                            : step.status === 'blocked'
                              ? 'bg-amber-400'
                              : step.status === 'error'
                                ? 'bg-rose-500'
                                : 'bg-sky-400 animate-pulse'
                        }`}
                      />
                      <span className="font-mono text-[11px] text-sky-300 truncate">
                        {NODE_DESCRIPTIONS[step.nodeId]?.name || step.nodeId}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px] flex-shrink-0">
                      {step.detail && (
                        <span className="text-[10px] truncate max-w-[100px]" style={{ color: 'var(--astra-muted)' }} title={step.detail}>
                          {step.detail}
                        </span>
                      )}
                      <span className="text-emerald-400">+{step.elapsedMs ?? 0}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs py-1" style={{ color: 'var(--astra-muted)' }}>
                Click a column header to record a trace.
              </p>
            )}
          </div>

          {/* Recent History Log */}
          <div className="flex flex-col gap-1.5 flex-1 min-h-0">
            <div className="flex items-center justify-between">
              <h3
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--astra-muted)' }}
              >
                Recent Requests ({history.length})
              </h3>
              {history.length > 0 && (
                <button
                  type="button"
                  className="text-xs hover:underline"
                  style={{ color: 'var(--astra-muted)' }}
                  onClick={clearHistory}
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
                      className={`flex items-center justify-between p-1.5 px-2 rounded border text-left text-xs transition ${
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
                      <span className="font-mono text-[11px] text-sky-300 truncate max-w-[180px]">
                        {formatSortSpec(run)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-emerald-400">{run.totalMs} ms</span>
                        <span
                          className={`text-[9px] px-1 py-0.2 rounded font-mono font-medium ${
                            run.outcome === 'ok'
                              ? 'bg-emerald-950/60 text-emerald-400'
                              : run.outcome === 'blocked'
                                ? 'bg-amber-950/60 text-amber-400'
                                : 'bg-rose-950/60 text-rose-400'
                          }`}
                        >
                          {run.outcome.toUpperCase()}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
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
