// app/src/graph/agentOrg.ts
// The "organization" of the agent network determines which agents communicate. Pure +
// unit-tested so the topology rules are pinned independent of rendering.
//
//   • democracy   — every agent ↔ every other agent (one flat mesh)
//   • republic    — sessions ↔ each other; within each session, its subagents ↔ each
//                   other; no cross-group links (federated tiers)
//   • dictatorship — no lateral communication (atomized; only the ownership tree remains)

export type Org = "democracy" | "republic" | "dictatorship";

export interface AgentSub { id: string; parent: string }

/** Unordered pairs of a list (i<j), as [a,b] tuples. */
function pairs(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

/** Communication channels (undirected edges) implied by the organization. */
export function commChannels(sessionIds: string[], subs: AgentSub[], org: Org): [string, string][] {
  if (org === "dictatorship") return [];
  if (org === "democracy") return pairs([...sessionIds, ...subs.map((s) => s.id)]);
  // republic: sessions mesh + each session's subagents mesh
  const edges = pairs(sessionIds);
  for (const sid of sessionIds) {
    edges.push(...pairs(subs.filter((s) => s.parent === sid).map((s) => s.id)));
  }
  return edges;
}
