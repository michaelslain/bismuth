/* app/src/intro/marks.tsx — first-run intro visuals (Solid port of the mock).
   The brand lockup + crystal hero reuse the REAL logo marks shipped in
   /logos/*.svg (spun via CSS); the knowledge-graph hero is a seeded point cloud;
   the daemon/claude heroes are static terminal panels. Every color comes from the
   theme CSS vars (--bg/--fg/--accent/--grad/--graph-0..4/…) so the intro's theme
   picker re-themes all of it live. */
import { For, type JSX } from "solid-js";

/** Palette pulled from CSS vars so swatches track the chosen theme. */
const NODE_COLS = ["var(--graph-0)", "var(--graph-1)", "var(--graph-2)", "var(--graph-3)", "var(--graph-4)"];

// ---- small persistent brand lockup (logo mark only — no wordmark) ------
export function Lockup(props: { icon: string }) {
  return (
    <div class="vi-lockup">
      <span class="vi-lockup-mark">
        <img src={`/logos/${props.icon}.svg`} width={30} height={30} alt="Bismuth" />
      </span>
    </div>
  );
}

// ---- crystal hero: the real logo mark, glowing + slowly spinning --------
export function CrystalStage(props: { icon: string; size?: number }) {
  const size = () => props.size ?? 240;
  return (
    <div class="vi-crystal" style={{ width: `${size()}px`, height: `${size()}px` }}>
      <div class="vi-crystal-glow" />
      <div class="vi-crystal-ring" />
      <div class="vi-crystal-spin">
        <img src={`/logos/${props.icon}.svg`} width={size() * 0.82} height={size() * 0.82} alt="" />
      </div>
    </div>
  );
}

// ---- seeded knowledge-graph point cloud --------------------------------
// Deterministic LCG so every render is identical (no Math.random).
export type Cloud = {
  nodes: { x: number; y: number; hot: boolean; col: string; r: number }[];
  edges: [number, number][];
  w: number;
  h: number;
};
export function makeCloud(opts: { N?: number; w?: number; h?: number; seed?: number; rad?: number; hotRate?: number } = {}): Cloud {
  const N = opts.N ?? 240;
  const w = opts.w ?? 540;
  const h = opts.h ?? 430;
  const rad = opts.rad ?? Math.min(w, h) * 0.44;
  const hotRate = opts.hotRate ?? 0.11;
  let s = opts.seed ?? 11;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const cx = w / 2;
  const cy = h / 2;
  const nodes: Cloud["nodes"] = [];
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = (0.18 + 0.82 * Math.sqrt(rnd())) * rad;
    const hot = rnd() < hotRate;
    nodes.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r * 0.84,
      hot,
      col: NODE_COLS[i % NODE_COLS.length],
      r: hot ? 1.6 + rnd() * 1.8 : 0.8 + rnd() * 0.9,
    });
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best > i) edges.push([i, best]);
  }
  return { nodes, edges, w, h };
}

export function GraphStage(props: { w?: number; h?: number }) {
  const w = () => props.w ?? 540;
  const h = () => props.h ?? 430;
  const g = makeCloud({ w: w(), h: h(), seed: 11 });
  return (
    <div class="vi-graph" style={{ width: `${w()}px`, height: `${h()}px` }}>
      <div class="vi-graph-glow" />
      <div class="vi-graph-drift">
        <svg viewBox={`0 0 ${g.w} ${g.h}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
          <g stroke="var(--graph-edge)" stroke-width={0.5} opacity={0.45}>
            <For each={g.edges}>
              {([a, b]) => (
                <line x1={g.nodes[a].x.toFixed(1)} y1={g.nodes[a].y.toFixed(1)} x2={g.nodes[b].x.toFixed(1)} y2={g.nodes[b].y.toFixed(1)} />
              )}
            </For>
          </g>
          <For each={g.nodes}>
            {(n) => (
              <circle cx={n.x.toFixed(1)} cy={n.y.toFixed(1)} r={n.r.toFixed(1)} fill={n.hot ? n.col : "var(--node-cold)"} opacity={n.hot ? 1 : 0.75} />
            )}
          </For>
        </svg>
      </div>
      <div class="vi-you">
        <span>You</span>
      </div>
    </div>
  );
}

// ---- daemon / claude terminal panels (static) --------------------------
type TermLine =
  | { p: string; c: string }
  | { user: string }
  | { status: string }
  | { d: string; accent?: string; dd?: string; ok?: string };

const DAEMON_LINES: TermLine[] = [
  { p: "~/vault", c: "❯ bismuth daemon status" },
  { d: "∴ crons", dd: "· 4 scheduled", ok: "running" },
  { d: "∴ weaving memory into graph", ok: "+12 edges" },
  { d: "∴ surfaced", accent: "3 forgotten notes", dd: "from “last spring”" },
  { status: "daemon online — tending the vault" },
];
const CLAUDE_LINES: TermLine[] = [
  { p: "~/vault", c: "❯ claude" },
  { user: "make a base of my unread books, by rating" },
  { d: "∴ bismuth_docs_search", accent: "“bases · query syntax”" },
  { d: "∴ writing reading.md", dd: "· type: base" },
  { status: "created base — table view · 23 rows" },
];

function Line(props: { ln: TermLine }): JSX.Element {
  const ln = props.ln;
  if ("p" in ln)
    return (
      <span>
        <span class="t-pmt">{ln.p} </span>
        <span class="t-cmd">{ln.c}</span>
      </span>
    );
  if ("user" in ln)
    return (
      <span>
        <span class="t-prompt">› </span>
        <span class="t-cmd">{ln.user}</span>
      </span>
    );
  if ("status" in ln)
    return (
      <span>
        <span class="t-on">●</span> <span class="t-status">{ln.status}</span>
      </span>
    );
  return (
    <span>
      <span class="t-dim">{ln.d}</span>
      {ln.accent && (
        <span>
          {" "}
          <span class="t-accent">{ln.accent}</span>
        </span>
      )}
      {ln.dd && <span class="t-dim"> {ln.dd}</span>}
      {ln.ok && <span class="t-dots"> {"·".repeat(14)} </span>}
      {ln.ok && <span class="t-ok">{ln.ok}</span>}
    </span>
  );
}

function TermPanel(props: { name: string; lines: TermLine[] }) {
  return (
    <div class="vi-term">
      <div class="vi-term-bar">
        <span class="vi-term-dot" />
        <span class="vi-term-dot" />
        <span class="vi-term-dot" />
        <span class="vi-term-name">{props.name}</span>
      </div>
      <div class="vi-term-body">
        <For each={props.lines}>
          {(ln, i) => (
            <div class="vi-term-line" style={{ "animation-delay": `${0.15 + i() * 0.28}s` }}>
              <Line ln={ln} />
            </div>
          )}
        </For>
        <div class="vi-term-line" style={{ "animation-delay": `${0.15 + props.lines.length * 0.28}s` }}>
          <span class="t-pmt">~/vault ❯ </span>
          <span class="vi-cursor" />
        </div>
      </div>
    </div>
  );
}

export function DaemonStage() {
  return <TermPanel name="DAEMON · live" lines={DAEMON_LINES} />;
}
export function ClaudeStage() {
  return <TermPanel name="claude code" lines={CLAUDE_LINES} />;
}
