'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  SortingEdgeId,
  SortingNodeId,
  SortFieldSpec,
  TraceRun,
  TraceStatus,
  TraceStep,
} from './types';

interface TraceContextValue {
  isPanelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  currentRun: TraceRun | null;
  history: TraceRun[];
  startRun: (meta: { sortSpec: SortFieldSpec[]; searchMode: string }) => string;
  emitStep: (step: {
    nodeId: SortingNodeId;
    edgeId?: SortingEdgeId;
    status: TraceStatus;
    label?: string;
    detail?: string;
    elapsedMs?: number;
  }) => void;
  finishRun: (outcome: 'ok' | 'blocked' | 'error', errorDetail?: string) => void;
  replayRun: (runId?: string) => void;
  clearHistory: () => void;
  selectedNodeId: SortingNodeId | null;
  setSelectedNodeId: (nodeId: SortingNodeId | null) => void;
}

const TraceContext = createContext<TraceContextValue | null>(null);

const MAX_HISTORY = 15;
const FADE_DELAY_MS = 3000;

export function TraceProvider({ children }: { children: React.ReactNode }) {
  const [isPanelOpen, setPanelOpenState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('astra_explorer_trace_open') === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });
  const [currentRun, setCurrentRun] = useState<TraceRun | null>(null);
  const [history, setHistory] = useState<TraceRun[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<SortingNodeId | null>(null);

  const setPanelOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setPanelOpenState((prev) => {
      const next = typeof open === 'function' ? open(prev) : open;
      try {
        localStorage.setItem('astra_explorer_trace_open', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const runStartTimeRef = useRef<number>(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, [setPanelOpen]);

  const clearReplayTimers = useCallback(() => {
    replayTimersRef.current.forEach(clearTimeout);
    replayTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      clearReplayTimers();
    };
  }, [clearReplayTimers]);

  const startRun = useCallback(
    (meta: { sortSpec: SortFieldSpec[]; searchMode: string }): string => {
      // If panel is closed, tracing can still record into history or act as lightweight tracker
      clearReplayTimers();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

      const now = performance.now();
      runStartTimeRef.current = now;
      const runId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const newRun: TraceRun = {
        id: runId,
        timestamp: Date.now(),
        sortSpec: meta.sortSpec,
        searchMode: meta.searchMode,
        outcome: 'ok',
        totalMs: 0,
        steps: [],
        nodeTimings: {},
        activeNodeId: null,
        activeEdgeId: null,
        completedNodeIds: new Set<SortingNodeId>(),
        completedEdgeIds: new Set<SortingEdgeId>(),
        nodeStatuses: {},
      };

      setCurrentRun(newRun);
      return runId;
    },
    [clearReplayTimers],
  );

  const emitStep = useCallback(
    (step: {
      nodeId: SortingNodeId;
      edgeId?: SortingEdgeId;
      status: TraceStatus;
      label?: string;
      detail?: string;
      elapsedMs?: number;
    }) => {
      const now = performance.now();
      const elapsed =
        step.elapsedMs ?? (runStartTimeRef.current > 0 ? Math.round(now - runStartTimeRef.current) : 0);

      setCurrentRun((prev) => {
        if (!prev) return null;

        const nextCompletedNodes = new Set(prev.completedNodeIds);
        const nextCompletedEdges = new Set(prev.completedEdgeIds);
        const nextNodeStatuses = { ...prev.nodeStatuses };
        const nextTimings = { ...prev.nodeTimings };

        nextCompletedNodes.add(step.nodeId);
        if (step.edgeId) {
          nextCompletedEdges.add(step.edgeId);
        }
        nextNodeStatuses[step.nodeId] = step.status;
        nextTimings[step.nodeId] = elapsed;

        const traceStep: TraceStep = {
          nodeId: step.nodeId,
          edgeId: step.edgeId,
          status: step.status,
          timestamp: Date.now(),
          elapsedMs: elapsed,
          label: step.label,
          detail: step.detail,
        };

        return {
          ...prev,
          totalMs: elapsed,
          activeNodeId: step.nodeId,
          activeEdgeId: step.edgeId ?? null,
          completedNodeIds: nextCompletedNodes,
          completedEdgeIds: nextCompletedEdges,
          nodeStatuses: nextNodeStatuses,
          nodeTimings: nextTimings,
          steps: [...prev.steps, traceStep],
        };
      });
    },
    [],
  );

  const finishRun = useCallback(
    (outcome: 'ok' | 'blocked' | 'error', errorDetail?: string) => {
      const now = performance.now();
      const total = runStartTimeRef.current > 0 ? Math.round(now - runStartTimeRef.current) : 0;

      setCurrentRun((prev) => {
        if (!prev) return null;
        const finalized: TraceRun = {
          ...prev,
          outcome,
          totalMs: total,
          errorDetail,
          activeNodeId: null,
          activeEdgeId: null,
        };

        setHistory((hist) => [finalized, ...hist.filter((h) => h.id !== finalized.id)].slice(0, MAX_HISTORY));

        // Start fade timer to un-highlight active tracks after 3s
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          setCurrentRun((curr) => {
            if (!curr || curr.id !== finalized.id) return curr;
            return {
              ...curr,
              activeNodeId: null,
              activeEdgeId: null,
            };
          });
        }, FADE_DELAY_MS);

        return finalized;
      });
    },
    [],
  );

  const replayRun = useCallback(
    (runId?: string) => {
      clearReplayTimers();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

      const target = runId ? history.find((h) => h.id === runId) : currentRun || history[0];
      if (!target || target.steps.length === 0) return;

      // Reset run view
      const resetRun: TraceRun = {
        ...target,
        activeNodeId: null,
        activeEdgeId: null,
        completedNodeIds: new Set<SortingNodeId>(),
        completedEdgeIds: new Set<SortingEdgeId>(),
        nodeStatuses: {},
        nodeTimings: {},
      };
      setCurrentRun(resetRun);

      const baseDelay = 260; // ms per step
      target.steps.forEach((step, index) => {
        const timer = setTimeout(() => {
          setCurrentRun((prev) => {
            if (!prev) return null;
            const nextCompletedNodes = new Set(prev.completedNodeIds);
            const nextCompletedEdges = new Set(prev.completedEdgeIds);
            const nextNodeStatuses = { ...prev.nodeStatuses };
            const nextTimings = { ...prev.nodeTimings };

            nextCompletedNodes.add(step.nodeId);
            if (step.edgeId) nextCompletedEdges.add(step.edgeId);
            nextNodeStatuses[step.nodeId] = step.status;
            if (step.elapsedMs !== undefined) nextTimings[step.nodeId] = step.elapsedMs;

            return {
              ...prev,
              activeNodeId: step.nodeId,
              activeEdgeId: step.edgeId ?? null,
              completedNodeIds: nextCompletedNodes,
              completedEdgeIds: nextCompletedEdges,
              nodeStatuses: nextNodeStatuses,
              nodeTimings: nextTimings,
            };
          });

          // Final step cleanup
          if (index === target.steps.length - 1) {
            const endTimer = setTimeout(() => {
              setCurrentRun((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  activeNodeId: null,
                  activeEdgeId: null,
                };
              });
            }, FADE_DELAY_MS);
            replayTimersRef.current.push(endTimer);
          }
        }, index * baseDelay);

        replayTimersRef.current.push(timer);
      });
    },
    [clearReplayTimers, currentRun, history],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <TraceContext.Provider
      value={{
        isPanelOpen,
        setPanelOpen,
        togglePanel,
        currentRun,
        history,
        startRun,
        emitStep,
        finishRun,
        replayRun,
        clearHistory,
        selectedNodeId,
        setSelectedNodeId,
      }}
    >
      {children}
    </TraceContext.Provider>
  );
}

export function useTrace() {
  const context = useContext(TraceContext);
  if (!context) {
    throw new Error('useTrace must be used within a TraceProvider');
  }
  return context;
}
