// app/src/graph/AgentsGraph.tsx
// The "Agents" mode OVERLAY: status card + organization picker, layered over the WebGL
// graph (which renders the actual you → session → subagent nodes in 2D pyramid / 3D
// molecule — same renderer as the knowledge graph). The org picker re-wires the
// communication channels (see agentLayout.ts / agentOrg.ts). Pure DOM, no graph drawing.
import { For, Show, createMemo } from "solid-js";
import { Icon } from "../icons/Icon";
import type { GraphData } from "../../../core/src/graph";
import { commChannels, type Org } from "./agentOrg";

const ORGS: { key: Org; name: string; icon: string; desc: string }[] = [
  { key: "democracy", name: "Democracy", icon: "Vote", desc: "Every agent communicates with every other — one flat mesh." },
  { key: "republic", name: "Republic", icon: "Landmark", desc: "Sessions talk among themselves; each session's subagents talk among themselves. Tiered." },
  { key: "dictatorship", name: "Dictatorship", icon: "Lock", desc: "No lateral communication — agents are atomized under the ownership tree." },
];

export function AgentsGraph(props: { agents: GraphData; org: Org; setOrg: (o: Org) => void }) {
  const sessions = createMemo(() => props.agents.nodes.filter((n) => n.kind === "agent" && !n.parent));
  const subs = createMemo(() => props.agents.nodes.filter((n) => n.kind === "agent" && n.parent));
  const awake = createMemo(() => sessions().filter((s) => s.state !== "idle").length);
  const orgMeta = createMemo(() => ORGS.find((o) => o.key === props.org)!);
  const channelCount = createMemo(() =>
    commChannels(sessions().map((s) => s.id), subs().map((s) => ({ id: s.id, parent: s.parent! })), props.org).length,
  );

  return (
    <div class="agents-graph">
      {/* Agent Network status card — real counts */}
      <div class="agents-card agents-status">
        <div class="agents-card-h">Agent Network</div>
        <div class="agents-status-body">
          <Show when={sessions().length > 0} fallback={<>No Claude sessions<br />in terminal tabs yet<br /><span style={{ color: "var(--faint)" }}>run <code>claude</code> in a terminal</span></>}>
            {sessions().length} terminal session{sessions().length === 1 ? "" : "s"}<br />
            {subs().length} subagent{subs().length === 1 ? "" : "s"}<br />
            <span style={{ color: "var(--green)" }}>● {awake()} awake</span> · <span style={{ color: "var(--faint)" }}>{sessions().length - awake()} idle</span>
          </Show>
        </div>
      </div>

      {/* Organization selector — determines the communication channels */}
      <div class="agents-card agents-structures">
        <div class="agents-card-h">Organization</div>
        <div class="agents-struct-list">
          <For each={ORGS}>
            {(o) => (
              <div class="structopt" classList={{ on: o.key === props.org }} onClick={() => props.setOrg(o.key)}>
                <Icon value={o.icon} size={14} />{o.name}
              </div>
            )}
          </For>
        </div>
        <div class="agents-struct-desc">{orgMeta().desc}</div>
      </div>

      <div class="agents-foot">{orgMeta().name} · {channelCount()} channel{channelCount() === 1 ? "" : "s"}</div>
    </div>
  );
}
