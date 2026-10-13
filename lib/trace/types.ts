export type SortingNodeId =
  | 'click'
  | 'gate'
  | 'noop'
  | 'change'
  | 'mode'
  | 'local'
  | 'compile'
  | 'find'
  | 'errors'
  | 'render';

export type SortingEdgeId =
  | 'click-gate'
  | 'gate-change'
  | 'gate-noop'
  | 'change-mode'
  | 'mode-compile'
  | 'mode-local'
  | 'compile-find'
  | 'find-render'
  | 'local-render'
  | 'find-errors';

export type TraceStatus = 'active' | 'ok' | 'blocked' | 'error';

export interface TraceStep {
  nodeId: SortingNodeId;
  edgeId?: SortingEdgeId;
  status: TraceStatus;
  timestamp: number;
  elapsedMs?: number;
  label?: string;
  detail?: string;
}

export interface SortFieldSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface TraceRun {
  id: string;
  timestamp: number;
  sortSpec: SortFieldSpec[];
  searchMode: string;
  outcome: 'ok' | 'blocked' | 'error';
  totalMs: number;
  steps: TraceStep[];
  nodeTimings: Partial<Record<SortingNodeId, number>>;
  activeNodeId?: SortingNodeId | null;
  activeEdgeId?: SortingEdgeId | null;
  completedNodeIds: Set<SortingNodeId>;
  completedEdgeIds: Set<SortingEdgeId>;
  nodeStatuses: Partial<Record<SortingNodeId, TraceStatus>>;
  errorDetail?: string;
}

export interface ServerTraceEvent {
  node: 'compile' | 'find' | 'errors';
  t: number;
  ms?: number;
  detail?: Record<string, unknown>;
}
