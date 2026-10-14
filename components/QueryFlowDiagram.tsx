'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
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

type NodeKind = 'frontend' | 'backend' | 'database' | 'cloud' | 'security' | 'external';

const LANE_ORDER: StepWhere[] = ['browser', 'server', 'astra'];
const LANE_TITLE: Record<StepWhere, string> = {
  browser: 'Browser',
  server: 'App server',
  astra: 'Astra Data API',
};

// Layout, in SVG units.
const NODE_W = 190;
const NODE_H = 80;
const GAP = 50;
const LANE_PAD_X = 20;
const LANE_HEAD = 28;
const LANE_H = LANE_HEAD + NODE_H + 16;
const LANE_GAP = 14;
const OUTER = 8;
const CORNER = 8;

const ENTER_STAGGER_MS = 140; // gap between boxes that arrive in the same update
const EDGE_LEAD_MS = 150; // an arrow starts fading in this long before the box it points to
const EXIT_MS = 300; // how long a removed box fades out before it is dropped
const RESIZE_MS = 450; // how long the diagram takes to change size

/** Eases a number toward `target`, so the diagram resizes smoothly instead of snapping. */
function useTween(target: number, ms: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  useEffect(() => {
    const from = valueRef.current;
    if (from === target) return;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : ms;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      valueRef.current = from + (target - from) * eased;
      setValue(valueRef.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

function nodeKind(step: TraceStep, handling: TraceHandling): NodeKind {
  if (step.status === 'error' || step.status === 'blocked') return 'security';
  if (step.where === 'browser') return 'frontend';
  if (step.where === 'server') return 'external';
  if (handling === 'astra-live') return 'backend';
  if (handling === 'astra-memory') return 'cloud';
  return 'database';
}

/** Greedy word wrap into at most `maxLines` lines; the last line ends in an ellipsis if cut. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = truncate(`${shown[maxLines - 1]} …`, maxChars);
  return shown.map((line) => truncate(line, maxChars));
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** Orthogonal route with rounded corners from the right edge of one node to the left edge of the next. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`;
  const mx = (x1 + x2) / 2;
  const dir = y2 > y1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `H ${mx - CORNER}`,
    `Q ${mx} ${y1} ${mx} ${y1 + dir * CORNER}`,
    `V ${y2 - dir * CORNER}`,
    `Q ${mx} ${y2} ${mx + CORNER} ${y2}`,
    `H ${x2}`,
  ].join(' ');
}

function Sigil({ where, failed }: { where: StepWhere; failed: boolean }) {
  if (failed) {
    return (
      <>
        <path d="M8 2.2 13 4v3.5c0 3.1-1.8 5.4-5 6.5-3.2-1.1-5-3.4-5-6.5V4Z" />
        <path d="m6 6.2 4 4m0-4-4 4" />
      </>
    );
  }
  if (where === 'browser') {
    return (
      <>
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <path d="M2 6.5h12" />
        <circle cx="4.1" cy="4.8" r=".7" className="sigil-fill" />
        <circle cx="6.3" cy="4.8" r=".7" className="sigil-fill" />
      </>
    );
  }
  if (where === 'server') return <path d="M6 3 3 8l3 5M10 3l3 5-3 5" />;
  return (
    <>
      <path d="M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2Z" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  );
}

/**
 * The path a request took, drawn like an architecture diagram: one lane per place the work ran
 * (browser, app server, Astra), one card per real step, and arrows between them. Only steps that
 * happened are drawn, so every query type gets its own flow. The path takes the colour of where the
 * request was handled; the step in flight glows (no scaling). Select a card to see the request.
 */
export function QueryFlowDiagram({
  steps,
  handling,
  activeStepIndex,
  selectedIndex,
  onSelect,
}: QueryFlowDiagramProps) {
  // When a new run replaces a longer one, the boxes that no longer exist fade out instead of
  // vanishing. Adjusting state while rendering is the supported way to react to a prop change.
  const [prevSteps, setPrevSteps] = useState(steps);
  const [ghosts, setGhosts] = useState<{ step: TraceStep; index: number }[]>([]);
  // Boxes at or after this index arrived in the latest update; they slide in one after another.
  const [enterFrom, setEnterFrom] = useState(0);
  if (prevSteps !== steps) {
    setPrevSteps(steps);
    setEnterFrom(Math.min(prevSteps.length, steps.length));
    if (prevSteps.length > steps.length) {
      setGhosts(prevSteps.slice(steps.length).map((step, k) => ({ step, index: steps.length + k })));
    }
  }
  // While the new run is still in flight the old boxes stay as dimmed placeholders, so the layout
  // holds still and the real boxes land on top of them. Once it settles, leftovers fade out.
  const settled = steps.length > 0 && activeStepIndex === null;
  useEffect(() => {
    if (ghosts.length === 0 || !settled) return;
    const timer = setTimeout(() => setGhosts([]), EXIT_MS + 50);
    return () => clearTimeout(timer);
  }, [ghosts, settled]);

  // Existing boxes keep their element (same key), so their entrance never replays.
  const enterDelay = (index: number) => Math.max(0, index - enterFrom) * ENTER_STAGGER_MS;

  const ghostClass = settled ? 'qf-exit' : 'qf-pending';
  const visibleGhosts = ghosts.filter((ghost) => ghost.index >= steps.length);
  const display: TraceStep[] = [...steps, ...visibleGhosts.map((ghost) => ghost.step)];
  const count = display.length;

  const lanes = LANE_ORDER.filter((where) => display.some((step) => step.where === where));
  const laneY = (where: StepWhere) => OUTER + lanes.indexOf(where) * (LANE_H + LANE_GAP);
  const nodeX = (index: number) => OUTER + LANE_PAD_X + index * (NODE_W + GAP);
  const nodeY = (step: TraceStep) => laneY(step.where) + LANE_HEAD;

  const targetWidth =
    count === 0 ? 0 : OUTER * 2 + LANE_PAD_X * 2 + count * NODE_W + (count - 1) * GAP;
  const targetHeight =
    count === 0 ? 0 : OUTER * 2 + lanes.length * LANE_H + (lanes.length - 1) * LANE_GAP;
  const width = useTween(targetWidth, RESIZE_MS);
  const height = useTween(targetHeight, RESIZE_MS);

  if (count === 0) return null;

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(index);
    }
  };

  return (
    <div
      className="query-flow w-full h-full overflow-auto"
      style={{ ['--trace-path' as string]: HANDLING_COLOR[handling] }}
    >
      <style>{`
        .query-flow {
          --qf-frontend: #38bdf8;
          --qf-backend: #34d399;
          --qf-database: #a78bfa;
          --qf-cloud: #fbbf24;
          --qf-security: #fb7185;
          --qf-external: #94a3b8;
          --qf-mask: var(--astra-bg);
        }
        .query-flow svg { display: block; margin: 0 auto; }
        .query-flow .qf-enter,
        .query-flow .qf-edge-enter,
        .query-flow .qf-lane-enter,
        .query-flow .qf-pending,
        .query-flow .qf-exit { transform-box: fill-box; transform-origin: center; }
        .query-flow .qf-enter { animation: qf-enter .4s cubic-bezier(.2,.7,.2,1) var(--qf-delay, 0ms) both; }
        .query-flow .qf-edge-enter { animation: qf-fade .35s ease var(--qf-delay, 0ms) both; }
        .query-flow .qf-lane-enter { animation: qf-fade .4s ease both; }
        .query-flow .qf-pending { animation: qf-dim .3s ease forwards; pointer-events: none; }
        .query-flow .qf-exit { animation: qf-exit ${EXIT_MS}ms ease forwards; pointer-events: none; }
        @keyframes qf-dim { from { opacity: 1; } to { opacity: .3; } }
        @keyframes qf-enter {
          from { opacity: 0; transform: translateX(-18px) scale(.94); }
          to { opacity: 1; transform: none; }
        }
        @keyframes qf-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes qf-exit { from { opacity: .3; } to { opacity: 0; transform: scale(.94); } }
        .query-flow .qf-lane { fill: var(--astra-sidebar); stroke: var(--astra-border); }
        .query-flow .qf-lane-label { fill: var(--astra-muted); font-size: 11px; font-weight: 600; }
        .query-flow .qf-mask { fill: var(--qf-mask); stroke: none; }
        .query-flow .qf-chip { fill: var(--qf-mask); stroke: var(--astra-border); stroke-width: .75px; }
        .query-flow .qf-chip-text { fill: var(--astra-muted); font-size: 9px; font-weight: 600; }
        .query-flow .qf-title { fill: var(--astra-text); font-size: 13.5px; font-weight: 600; }
        .query-flow .qf-sub { fill: var(--astra-muted); font-size: 11px; }
        .query-flow .qf-edge { stroke: var(--trace-path); fill: none; stroke-width: 1.8px; }
        .query-flow .qf-edge[data-error="true"] { stroke: var(--qf-security); }
        .query-flow .qf-edge[data-active="true"] { stroke-dasharray: 6 3; animation: qf-flow .8s linear infinite; }
        .query-flow .qf-arrow { fill: var(--trace-path); }
        .query-flow .qf-arrow-error { fill: var(--qf-security); }
        .query-flow .qf-sigil { fill: none; stroke: currentColor; stroke-width: 1.25; }
        .query-flow .qf-sigil .sigil-fill { fill: currentColor; stroke: none; }
        .query-flow [data-kind] > .qf-card {
          stroke-width: 1.5px;
          fill: color-mix(in srgb, var(--qf-stroke) 13%, var(--qf-mask));
          stroke: color-mix(in srgb, var(--qf-stroke) 75%, var(--qf-mask));
        }
        .query-flow [data-kind="frontend"] { --qf-stroke: var(--qf-frontend); }
        .query-flow [data-kind="backend"] { --qf-stroke: var(--qf-backend); }
        .query-flow [data-kind="database"] { --qf-stroke: var(--qf-database); }
        .query-flow [data-kind="cloud"] { --qf-stroke: var(--qf-cloud); }
        .query-flow [data-kind="security"] { --qf-stroke: var(--qf-security); }
        .query-flow [data-kind="external"] { --qf-stroke: var(--qf-external); }
        .query-flow [data-kind] { color: var(--qf-stroke); cursor: pointer; outline: none; }
        .query-flow [data-kind] .qf-tag { fill: var(--qf-stroke); font-size: 10.5px; font-weight: 600; }
        .query-flow [data-kind]:hover > .qf-card { filter: brightness(1.15); }
        .query-flow [data-kind]:focus-visible > .qf-card { stroke-width: 2.5px; }
        .query-flow [data-kind][data-selected="true"] > .qf-card { stroke: var(--qf-stroke); stroke-width: 2.5px; }
        .query-flow [data-kind][data-active="true"] > .qf-card { animation: qf-glow 1.2s ease-in-out infinite alternate; }
        @keyframes qf-glow {
          from { filter: drop-shadow(0 0 2px var(--qf-stroke)); }
          to { filter: drop-shadow(0 0 10px var(--qf-stroke)); }
        }
        @keyframes qf-flow { from { stroke-dashoffset: 18; } to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .query-flow [data-kind][data-active="true"] > .qf-card,
          .query-flow .qf-edge[data-active="true"],
          .query-flow .qf-enter,
          .query-flow .qf-edge-enter,
          .query-flow .qf-lane-enter { animation: none !important; }
          .query-flow .qf-pending,
          .query-flow .qf-exit { animation-duration: 1ms !important; }
        }
      `}</style>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ minWidth: Math.round(width * 0.7), maxHeight: height * 1.6 }}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Path of the request"
      >
        <defs>
          <marker id="qf-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" className="qf-arrow" />
          </marker>
          <marker id="qf-arrowhead-error" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" className="qf-arrow-error" />
          </marker>
        </defs>

        {lanes.map((where, laneIndex) => (
          <g key={where} className="qf-lane-enter">
            <rect
              className="qf-lane"
              x={OUTER}
              y={laneY(where)}
              width={width - OUTER * 2}
              height={LANE_H}
              rx={10}
              strokeWidth={1}
            />
            <text className="qf-lane-label" x={OUTER + 14} y={laneY(where) + 18}>
              {`${String(laneIndex + 1).padStart(2, '0')} / ${LANE_TITLE[where]}`}
            </text>
          </g>
        ))}

        {display.slice(1).map((step, i) => {
          const from = display[i];
          const index = i + 1;
          const ghost = index >= steps.length;
          const delay = ghost ? 0 : enterDelay(index) - EDGE_LEAD_MS;
          const x1 = nodeX(i) + NODE_W;
          const y1 = nodeY(from) + NODE_H / 2;
          const x2 = nodeX(index);
          const y2 = nodeY(step) + NODE_H / 2;
          const failed = step.status === 'error' || step.status === 'blocked';
          const crossing = y1 !== y2;
          const chip = y2 > y1 ? 'request' : 'result';
          return (
            <g
              key={ghost ? `ghost-edge-${index}` : `edge-${index}`}
              className={ghost ? ghostClass : 'qf-edge-enter'}
              style={{ ['--qf-delay' as string]: `${Math.max(0, delay)}ms` }}
            >
              <path
                className="qf-edge"
                d={edgePath(x1, y1, x2, y2)}
                data-error={failed}
                data-active={activeStepIndex === index}
                markerEnd={`url(#${failed ? 'qf-arrowhead-error' : 'qf-arrowhead'})`}
              />
              {crossing && (
                <g aria-hidden="true">
                  <rect
                    className="qf-chip"
                    x={(x1 + x2) / 2 - 23}
                    y={(y1 + y2) / 2 - 8}
                    width={46}
                    height={16}
                    rx={8}
                  />
                  <text
                    className="qf-chip-text"
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 + 3}
                    textAnchor="middle"
                  >
                    {chip}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {display.map((step, index) => {
          const ghost = index >= steps.length;
          const x = nodeX(index);
          const y = nodeY(step);
          const failed = step.status === 'error' || step.status === 'blocked';
          const subLines = wrap(step.detail ?? step.endpoint ?? '', 30, 2);
          const tagParts = [
            step.call?.command,
            step.durationMs !== undefined ? `${step.durationMs} ms` : undefined,
          ].filter(Boolean);
          const tag = tagParts.join(' · ');
          const full = [step.label, step.detail, step.endpoint].filter(Boolean).join(' — ');
          if (ghost) {
            return (
              <g
                key={`ghost-${step.where}-${index}`}
                className={ghostClass}
                data-kind={nodeKind(step, handling)}
                aria-hidden="true"
              >
                <rect className="qf-mask" x={x} y={y} width={NODE_W} height={NODE_H} rx={8} />
                <rect className="qf-card" x={x} y={y} width={NODE_W} height={NODE_H} rx={8} />
                <text className="qf-title" x={x + NODE_W / 2 + 8} y={y + 21} textAnchor="middle">
                  {truncate(step.label, 21)}
                </text>
                {subLines.map((line, lineIndex) => (
                  <text
                    key={lineIndex}
                    className="qf-sub"
                    x={x + NODE_W / 2}
                    y={y + 40 + lineIndex * 12}
                    textAnchor="middle"
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          }
          return (
            <g
              key={`${step.where}-${index}`}
              className="qf-enter"
              style={{ ['--qf-delay' as string]: `${enterDelay(index)}ms` }}
              data-kind={nodeKind(step, handling)}
              data-flow-step={index}
              data-active={activeStepIndex === index}
              data-selected={selectedIndex === index}
              data-status={step.status}
              tabIndex={0}
              role="button"
              aria-pressed={selectedIndex === index}
              aria-label={`${LANE_TITLE[step.where]}: ${full}`}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <title>{full}</title>
              <rect className="qf-mask" x={x} y={y} width={NODE_W} height={NODE_H} rx={8} />
              <rect className="qf-card" x={x} y={y} width={NODE_W} height={NODE_H} rx={8} />
              <g
                aria-hidden="true"
                className="qf-sigil"
                transform={`translate(${x + 7} ${y + 6}) scale(0.9)`}
              >
                <Sigil where={step.where} failed={failed} />
              </g>
              <text className="qf-title" x={x + NODE_W / 2 + 8} y={y + 21} textAnchor="middle">
                {truncate(step.label, 21)}
              </text>
              {subLines.map((line, lineIndex) => (
                <text
                  key={lineIndex}
                  className="qf-sub"
                  x={x + NODE_W / 2}
                  y={y + 40 + lineIndex * 12}
                  textAnchor="middle"
                >
                  {line}
                </text>
              ))}
              {tag && (
                <text className="qf-tag" x={x + NODE_W / 2} y={y + NODE_H - 8} textAnchor="middle">
                  {truncate(tag, 28)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
