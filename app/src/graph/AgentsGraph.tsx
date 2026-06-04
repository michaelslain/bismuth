// app/src/graph/AgentsGraph.tsx
// The "Agents" graph mode: an interactive governance-structure picker over the
// Claude Communicate agent network. Selecting a structure re-wires which agents
// connect (directed edges get arrowheads), recomputes each node's degree (·N),
// and crowns the ruler. SVG/DOM — distinct from the WebGL knowledge graph.
import { For, Show, createSignal } from "solid-js";
import { Icon } from "../icons/Icon";

type Agent = { id: string; x: number; y: number; label: string; color: string; r: number; self?: boolean };

// Synthetic agent set (positions in % of the viewBox). Colors track the theme ramp.
const AGENTS: Agent[] = [
  { id: "you", x: 50, y: 48, label: "You", color: "var(--fg)", r: 11, self: true },
  { id: "a1", x: 24, y: 26, label: "agent · mbp-16", color: "var(--graph-0)", r: 8 },
  { id: "a2", x: 78, y: 30, label: "agent · linux-01", color: "var(--graph-2)", r: 8 },
  { id: "a3", x: 80, y: 70, label: "agent · ci-runner", color: "var(--graph-3)", r: 7 },
  { id: "a4", x: 22, y: 72, label: "agent · studio", color: "var(--graph-1)", r: 7 },
  { id: "a5", x: 50, y: 84, label: "relay", color: "var(--graph-4)", r: 6 },
];

type Structure = { name: string; icon: string; ruler: string | null; directed: boolean; desc: string; edges: [string, string][] };

const STRUCTURES: Record<string, Structure> = {
  dictatorship: { name: "Dictatorship", icon: "Shield", ruler: "you", directed: true,
    desc: "One agent commands; all others obey.",
    edges: [["you", "a1"], ["you", "a2"], ["you", "a3"], ["you", "a4"], ["you", "a5"]] },
  democracy: { name: "Democracy", icon: "Vote", ruler: null, directed: false,
    desc: "Every agent is equal; consensus by quorum.",
    edges: [["you", "a1"], ["you", "a2"], ["you", "a3"], ["you", "a4"], ["you", "a5"],
      ["a1", "a2"], ["a2", "a3"], ["a3", "a4"], ["a4", "a5"], ["a5", "a1"], ["a1", "a3"], ["a2", "a4"]] },
  republic: { name: "Republic", icon: "Landmark", ruler: null, directed: true,
    desc: "Agents elect representatives who decide.",
    edges: [["a3", "a1"], ["a4", "a1"], ["a5", "a2"], ["a1", "you"], ["a2", "you"]] },
};

const W = 1054, H = 772;
const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const px = (a: Agent): [number, number] => [(a.x / 100) * W, (a.y / 100) * H];

export function AgentsGraph() {
  const [skey, setSkey] = createSignal<keyof typeof STRUCTURES>("democracy");
  const struct = () => STRUCTURES[skey()];
  const degree = () => {
    const d: Record<string, number> = Object.fromEntries(AGENTS.map((a) => [a.id, 0]));
    struct().edges.forEach(([a, b]) => { d[a]++; d[b]++; });
    return d;
  };

  return (
    <div class="agents-graph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" class="agents-svg">
        <defs>
          <marker id="agents-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--graph-edge, #4a5179)" />
          </marker>
        </defs>
        <For each={struct().edges}>
          {([a, b]) => {
            const [x1, y1] = px(byId[a]); const [x2, y2] = px(byId[b]);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--graph-edge, #3A4068)" stroke-width={1.4}
              marker-end={struct().directed ? "url(#agents-arrow)" : undefined} opacity={0.8} />;
          }}
        </For>
        <For each={AGENTS}>
          {(a) => {
            const [x, y] = px(a);
            const isRuler = () => struct().ruler === a.id;
            return (
              <>
                <Show when={a.self || isRuler()}>
                  <circle cx={x} cy={y} r={a.r + 7} fill="none" stroke={isRuler() ? "var(--graph-4)" : "var(--graph-2)"} stroke-width={1.4} opacity={0.6} />
                </Show>
                <circle cx={x} cy={y} r={a.r} fill={a.color} />
              </>
            );
          }}
        </For>
      </svg>

      {/* crown on the ruler node */}
      <Show when={struct().ruler}>
        {(rid) => {
          const a = byId[rid()];
          return <div class="agents-crown" style={{ left: `${a.x}%`, top: `${a.y}%` }}><Icon value="Crown" size={18} /></div>;
        }}
      </Show>

      {/* node labels + degree */}
      <For each={AGENTS}>
        {(a) => (
          <div class="agents-label" classList={{ self: !!a.self }}
            style={{ left: `${a.x}%`, top: `${a.y}%`, transform: `translate(${a.r + 6}px, -50%)` }}>
            {a.label}<span class="agents-deg">·{degree()[a.id]}</span>
          </div>
        )}
      </For>

      {/* Agent Network status card */}
      <div class="agents-card agents-status">
        <div class="agents-card-h">Agent Network</div>
        <div class="agents-status-body">
          5 active agents<br />via Claude Communicate relay<br />
          <span style={{ color: "var(--green)" }}>● 3 online</span> · <span style={{ color: "var(--faint)" }}>2 idle</span>
        </div>
      </div>

      {/* Structure selector */}
      <div class="agents-card agents-structures">
        <div class="agents-card-h">Structure</div>
        <div class="agents-struct-list">
          <For each={Object.entries(STRUCTURES)}>
            {([key, s]) => (
              <div class="structopt" classList={{ on: key === skey() }} onClick={() => setSkey(key as keyof typeof STRUCTURES)}>
                <Icon value={s.icon} size={14} />{s.name}
              </div>
            )}
          </For>
        </div>
        <div class="agents-struct-desc">{struct().desc}</div>
      </div>

      {/* footer */}
      <div class="agents-foot">{struct().name} · {struct().edges.length} channels</div>
    </div>
  );
}
