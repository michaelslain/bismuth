import { basename } from "node:path";
import type { GraphData, GraphNode, GraphEdge } from "./graph";
import type { RelaySnapshot } from "./relay";

/** A session counts as "awake" if it heartbeat within this window, else "idle". */
const AWAKE_MS = 10 * 60 * 1000;

const sessionNodeId = (sessionId: string): string => `agent:sess:${sessionId}`;
const subagentNodeId = (agentId: string): string => `agent:sub:${agentId}`;
const chatNodeId = (chatId: string): string => `agent:chat:${chatId}`;
const chatSubNodeId = (agentId: string): string => `agent:chatsub:${agentId}`;

/** A subagent (SDK Task tool) spawned by a visual chat session. Mirrors RelaySubagent's shape
 *  but sourced from chat.ts's drain loop rather than the relay hooks. */
export interface ChatAgentSubagent {
  /** The Task tool_use id — stable for the subagent's lifetime. */
  agentId: string;
  /** e.g. "general-purpose", "Explore" — from the Task tool's `subagent_type`. */
  agentType: string;
  /** True once the Task tool_result came back (the subagent finished). */
  done: boolean;
}

/** One live visual-chat session (core/src/chat.ts), projected for the agents graph. A chat is a
 *  first-class session node — same tier as a terminal-tab session — hanging off the "you" hub. */
export interface ChatAgentSession {
  /** The client chat id (the ::chat: tab's id) — the durable identity of this chat session. */
  chatId: string;
  /** Node label: the chat's conversation summary/title, or a cwd-basename fallback. */
  label: string;
  /** A turn is currently in flight (keeps the node awake even past the heartbeat window). */
  active: boolean;
  /** ms epoch of the last turn activity (drives awake/idle like a relay session's lastSeen). */
  lastActivityAt: number;
  /** Subagents this chat spawned via the SDK Task tool (depth 1). */
  subagents: ChatAgentSubagent[];
}

/**
 * Build the "agents" graph: a tree of the Claude Code work running inside Bismuth's
 * terminal tabs — each live terminal session, with its subagents hanging off it.
 *
 * Pure over its inputs:
 * - `snapshot` is the relay registry's current contents (see relay.ts).
 * - `liveTerminalIds` is the set of pty ids currently open in the app
 *   (terminal.ts `listSessionIds()`); a session whose terminal tab has closed is
 *   dropped, so the graph reflects only what's actually open right now.
 * - `chatSessions` are the live visual-chat sessions (core/src/chat.ts) — each
 *   becomes a first-class session node hanging off "you", same tier as a terminal
 *   session, with its SDK subagents as depth-1 children. A closed chat isn't in the
 *   snapshot at all (chat.ts drops it from its registry), so no extra pruning is
 *   needed here — the passed-in list IS the live set.
 *
 * The "you" hub and the you→session edges are injected on the frontend (like the
 * other brain views); this returns only session + subagent nodes and the
 * session→subagent edges. Subagent nodes carry `parent` so the frontend can wire
 * "you" to every parent-less (root) agent node.
 */
export function buildAgentGraph(
  snapshot: RelaySnapshot,
  liveTerminalIds: Set<string>,
  now: number = Date.now(),
  chatSessions: ChatAgentSession[] = [],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const liveSessionIds = new Set<string>();

  // A session with a running (not-done) subagent is actively working even if it hasn't
  // heartbeat recently (UserPromptSubmit doesn't fire mid-turn), so it stays awake —
  // avoids an "idle" root with an "awake" child during long Agent-tool calls.
  const sessionsWithRunningSub = new Set(
    snapshot.subagents.filter((sub) => !sub.done).map((sub) => sub.parentSessionId),
  );

  for (const s of snapshot.sessions) {
    // Only sessions whose terminal tab is still open. (Closing a tab kills the pty —
    // and the claude process in it — so there's nothing live to show.)
    if (!liveTerminalIds.has(s.terminalId)) continue;
    liveSessionIds.add(s.sessionId);
    const awake = now - s.lastSeen <= AWAKE_MS || sessionsWithRunningSub.has(s.sessionId);
    nodes.push({
      id: sessionNodeId(s.sessionId),
      label: basename(s.cwd) || s.terminalId,
      kind: "agent",
      state: awake ? "awake" : "idle",
    });
  }

  for (const sub of snapshot.subagents) {
    // Drop orphans whose parent session is gone (closed tab / re-run claude).
    if (!liveSessionIds.has(sub.parentSessionId)) continue;
    const parentId = sessionNodeId(sub.parentSessionId);
    // Subagents spawned by a workflow orchestration carry a workflow-group key (reported
    // by the relay). Stamp it on BOTH the node (lane grouping) and the session→subagent
    // edge (the distinct workflow-lane connection). A plain Agent-tool subagent has no
    // workflowId, so both stay undefined and render exactly as they do today.
    nodes.push({
      id: subagentNodeId(sub.agentId),
      label: sub.agentType,
      kind: "agent",
      state: sub.done ? "idle" : "awake",
      parent: parentId,
      ...(sub.workflowId ? { workflow: sub.workflowId } : {}),
    });
    edges.push({
      from: parentId,
      to: subagentNodeId(sub.agentId),
      kind: "message",
      ...(sub.workflowId ? { workflow: sub.workflowId } : {}),
    });
  }

  // Visual chat sessions: each a root ("you"→chat) session node in the SAME tier as a terminal
  // session, with its SDK subagents (Task tool) as depth-1 children — mirroring the relay shape.
  // The `agent:chat:` id namespace keeps a chat distinguishable from a terminal session downstream.
  for (const c of chatSessions) {
    const awake = c.active || now - c.lastActivityAt <= AWAKE_MS;
    const parentId = chatNodeId(c.chatId);
    nodes.push({
      id: parentId,
      label: c.label,
      kind: "agent",
      state: awake ? "awake" : "idle",
    });
    for (const sub of c.subagents) {
      nodes.push({
        id: chatSubNodeId(sub.agentId),
        label: sub.agentType,
        kind: "agent",
        state: sub.done ? "idle" : "awake",
        parent: parentId,
      });
      edges.push({ from: parentId, to: chatSubNodeId(sub.agentId), kind: "message" });
    }
  }

  return { nodes, edges };
}
