import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

interface RelayAgent {
  id: string;
  host: string;
  cwd: string;
  pid?: number;
  registered_at?: string;
  last_seen: string;
  status?: Record<string, unknown>;
}

interface RelayMessage {
  id?: string;
  from: string;
  to?: string;
  kind?: string;
  body?: string;
  ts?: string;
}

interface RelayState {
  agents: Record<string, RelayAgent>;
  inboxes: Record<string, RelayMessage[]>;
  board?: RelayMessage[];
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function buildAgentGraph(statePath?: string): GraphData {
  const path = statePath ?? join(homedir(), ".claude-communicate", "relay-state.json");

  let state: RelayState;
  try {
    const file = Bun.file(path);
    // Synchronous read using readFileSync equivalent in Bun
    const text = require("node:fs").readFileSync(path, "utf-8");
    state = JSON.parse(text) as RelayState;
  } catch {
    return { nodes: [], edges: [] };
  }

  const agents = state.agents ?? {};
  const inboxes = state.inboxes ?? {};
  const agentIds = new Set(Object.keys(agents));

  // Build nodes
  const now = Date.now();
  const nodes: GraphNode[] = Object.values(agents).map((agent): GraphNode => {
    const label = agent.cwd
      ? basename(agent.cwd)
      : agent.id.includes(":") ? agent.id.split(":").slice(1).join(":") : agent.id;

    const lastSeenMs = new Date(agent.last_seen).getTime();
    const state: "awake" | "idle" = (now - lastSeenMs) <= TEN_MINUTES_MS ? "awake" : "idle";

    return {
      id: agent.id,
      label,
      kind: "agent",
      state,
    };
  });

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  function addEdge(edge: GraphEdge) {
    const key = `${edge.from}|${edge.to}|${edge.kind}`;
    if (!edgeKeys.has(key) && agentIds.has(edge.from) && agentIds.has(edge.to)) {
      edgeKeys.add(key);
      edges.push(edge);
    }
  }

  // Directed message edges: from inbox messages
  for (const [recipientId, messages] of Object.entries(inboxes)) {
    if (!agentIds.has(recipientId)) continue;
    for (const msg of messages) {
      if (msg.from && agentIds.has(msg.from)) {
        addEdge({ from: msg.from, to: recipientId, kind: "message" });
      }
    }
  }

  // Same-project link edges: group by label, connect pairs with different ids
  const byLabel = new Map<string, string[]>();
  for (const node of nodes) {
    const group = byLabel.get(node.label) ?? [];
    group.push(node.id);
    byLabel.set(node.label, group);
  }

  for (const [, ids] of byLabel) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addEdge({ from: ids[i], to: ids[j], kind: "link" });
      }
    }
  }

  return { nodes, edges };
}
