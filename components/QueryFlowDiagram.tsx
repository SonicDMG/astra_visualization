'use client';

import type { StepWhere, TraceHandling, TraceStep } from '@/lib/trace/types';
import { HANDLING_COLOR } from '@/lib/trace/describe';

interface QueryFlowDiagramProps {
  steps: TraceStep[];
  handling: TraceHandling;
  /** Index of the step still in flight (or being replayed). */
  activeStepIndex: number | null;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

const WHERE_LABEL: Record<StepWhere, string> = {
  browser: 'Browser',
  server: 'App server',
  astra: 'Astra Data API',
};

/**
 * The path a request took, one box per real step: what you asked for, the Data API request the
 * app server created, what Astra did, and what the grid shows. Boxes are only drawn for steps that
 * happened, so each query type gets its own flow. The path takes the colour of where the request
 * was handled; the step in flight glows (no scaling). Select a box to see the full request.
 */
export function QueryFlowDiagram({
  steps,
  handling,
  activeStepIndex,
  selectedIndex,
  onSelect,
}: QueryFlowDiagramProps) {
  return (
    <>
      <style>{`
        @keyframes trace-glow {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          50% { box-shadow: 0 0 14px 2px color-mix(in srgb, var(--trace-path) 70%, transparent); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-flow-step][data-active="true"] { animation: none !important; }
        }
      `}</style>
      <ol
        aria-label="Path of the request"
        className="flex flex-wrap items-stretch justify-center gap-y-2 w-full list-none m-0 p-0 overflow-y-auto max-h-full"
        style={{ ['--trace-path' as string]: HANDLING_COLOR[handling] }}
      >
        {steps.map((step, index) => {
          const active = activeStepIndex === index;
          const selected = selectedIndex === index;
          const failed = step.status === 'error' || step.status === 'blocked';
          const color = failed ? '#fb7185' : 'var(--trace-path)';
          const ms = step.durationMs;
          return (
            <li key={`${step.where}-${index}`} className="flex items-center gap-1 min-w-0">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 text-lg leading-none px-1"
                  style={{ color: 'var(--trace-path)' }}
                >
                  →
                </span>
              )}
              <button
                type="button"
                data-flow-step={index}
                data-active={active ? 'true' : 'false'}
                data-status={step.status}
                aria-pressed={selected}
                onClick={() => onSelect(index)}
                className="w-52 min-w-0 rounded border px-3 py-2 flex flex-col gap-1 text-left transition-colors cursor-pointer"
                style={{
                  borderColor: color,
                  borderWidth: selected ? 3 : 2,
                  background: `color-mix(in srgb, ${color} 10%, var(--astra-surface))`,
                  color: 'var(--astra-text)',
                  animation: active ? 'trace-glow 1.2s ease-in-out infinite' : undefined,
                }}
              >
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--astra-muted)' }}
                >
                  {WHERE_LABEL[step.where]}
                </span>
                <span className="text-sm font-semibold leading-tight break-words">{step.label}</span>
                {step.endpoint && (
                  <span
                    className="text-[10px] font-mono leading-snug break-all"
                    style={{ color }}
                    title={step.endpoint}
                  >
                    {step.endpoint}
                  </span>
                )}
                {step.detail && (
                  <span
                    className="text-[11px] leading-snug break-words"
                    style={{ color: 'var(--astra-muted)' }}
                  >
                    {step.detail}
                  </span>
                )}
                {ms !== undefined && (
                  <span className="text-[11px] font-mono" style={{ color }}>
                    {ms} ms
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
