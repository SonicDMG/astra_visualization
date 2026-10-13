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
  StepWhere,
  SortFieldSpec,
  TraceHandling,
  TraceRun,
  TraceRunSource,
  TraceStatus,
  TraceStep,
  DataApiCallInfo,
} from './types';

export interface TraceVerdictInput {
  handling: TraceHandling;
  reason: string;
  paging?: string;
}

interface TraceContextValue {
  isPanelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  currentRun: TraceRun | null;
  history: TraceRun[];
  startRun: (meta: {
    sortSpec: SortFieldSpec[];
    searchMode: string;
    trigger: string;
    source: TraceRunSource;
  }) => string;
  /** Source of the run between startRun and finishRun, else null; lets later code continue it. */
  openRunSource: () => TraceRunSource | null;
  /** Says where the open run is handled (local / Astra memory / live Astra); may be called early. */
  setVerdict: (verdict: TraceVerdictInput) => void;
  emitStep: (step: {
    where: StepWhere;
    status: TraceStatus;
    label: string;
    detail?: string;
    endpoint?: string;
    call?: DataApiCallInfo;
    /** How long this step itself took. */
    durationMs?: number;
  }) => void;
  finishRun: (outcome: 'ok' | 'blocked' | 'error', errorDetail?: string) => void;
  replayRun: (runId?: string) => void;
  clearHistory: () => void;
}

const TraceContext = createContext<TraceContextValue | null>(null);

const MAX_HISTORY = 15;

export function TraceProvider({ children }: { children: React.ReactNode }) {
  // Starts closed on server and client alike; the saved preference is applied after mount so
  // hydration matches.
  const [isPanelOpen, setPanelOpenState] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('astra_explorer_trace_open') === 'true') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPanelOpenState(true);
      }
    } catch {
      // ignore
    }
  }, []);
  const [currentRun, setCurrentRun] = useState<TraceRun | null>(null);
  const [history, setHistory] = useState<TraceRun[]>([]);

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
  const runSourceRef = useRef<TraceRunSource | null>(null);
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
      clearReplayTimers();
    };
  }, [clearReplayTimers]);

  const startRun = useCallback(
    (meta: {
      sortSpec: SortFieldSpec[];
      searchMode: string;
      trigger: string;
      source: TraceRunSource;
    }): string => {
      clearReplayTimers();

      runStartTimeRef.current = performance.now();
      runSourceRef.current = meta.source;
      const runId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const newRun: TraceRun = {
        id: runId,
        timestamp: Date.now(),
        trigger: meta.trigger,
        handling: 'astra-live',
        reason: '',
        sortSpec: meta.sortSpec,
        searchMode: meta.searchMode,
        outcome: 'ok',
        totalMs: 0,
        steps: [],
        activeStepIndex: null,
      };

      setCurrentRun(newRun);
      return runId;
    },
    [clearReplayTimers],
  );

  const openRunSource = useCallback(() => runSourceRef.current, []);

  const setVerdict = useCallback((verdict: TraceVerdictInput) => {
    if (runSourceRef.current === null) return;
    setCurrentRun((prev) =>
      prev
        ? { ...prev, handling: verdict.handling, reason: verdict.reason, paging: verdict.paging }
        : null,
    );
  }, []);

  const emitStep = useCallback(
    (step: {
      where: StepWhere;
      status: TraceStatus;
      label: string;
      detail?: string;
      endpoint?: string;
      call?: DataApiCallInfo;
      durationMs?: number;
    }) => {
      // Steps after a run finished (e.g. a refetch of the same request) must not rewrite it.
      if (runSourceRef.current === null) return;
      const elapsed =
        runStartTimeRef.current > 0 ? Math.round(performance.now() - runStartTimeRef.current) : 0;

      setCurrentRun((prev) => {
        if (!prev) return null;
        // A step still "active" is a placeholder for work in flight; the real step replaces it.
        const last = prev.steps[prev.steps.length - 1];
        const base = last?.status === 'active' ? prev.steps.slice(0, -1) : prev.steps;
        const traceStep: TraceStep = {
          where: step.where,
          status: step.status,
          timestamp: Date.now(),
          elapsedMs: elapsed,
          durationMs: step.durationMs,
          label: step.label,
          detail: step.detail,
          endpoint: step.endpoint,
          call: step.call,
        };
        const steps = [...base, traceStep];
        return {
          ...prev,
          totalMs: elapsed,
          steps,
          activeStepIndex: step.status === 'active' ? steps.length - 1 : null,
        };
      });
    },
    [],
  );

  const finishRun = useCallback((outcome: 'ok' | 'blocked' | 'error', errorDetail?: string) => {
    if (runSourceRef.current === null) return;
    runSourceRef.current = null;
    const total =
      runStartTimeRef.current > 0 ? Math.round(performance.now() - runStartTimeRef.current) : 0;

    setCurrentRun((prev) => {
      if (!prev) return null;
      const finalized: TraceRun = {
        ...prev,
        outcome,
        totalMs: total,
        errorDetail,
        activeStepIndex: null,
      };

      setHistory((hist) => [finalized, ...hist.filter((h) => h.id !== finalized.id)].slice(0, MAX_HISTORY));
      return finalized;
    });
  }, []);

  const replayRun = useCallback(
    (runId?: string) => {
      clearReplayTimers();

      const target = runId ? history.find((h) => h.id === runId) : currentRun || history[0];
      if (!target || target.steps.length === 0) return;

      setCurrentRun({ ...target, steps: [], activeStepIndex: null });

      const baseDelay = 320; // ms per step
      target.steps.forEach((_step, index) => {
        const timer = setTimeout(() => {
          setCurrentRun((prev) =>
            prev
              ? {
                  ...prev,
                  steps: target.steps.slice(0, index + 1),
                  activeStepIndex: index === target.steps.length - 1 ? null : index,
                }
              : null,
          );
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
        openRunSource,
        setVerdict,
        emitStep,
        finishRun,
        replayRun,
        clearHistory,
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
