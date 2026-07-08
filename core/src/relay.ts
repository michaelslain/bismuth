// In-process registry of the Claude Code work happening inside Bismuth's own
// terminal tabs: top-level sessions and the subagents they spawn. Populated by the
// relay hooks (POST /relay/*), read by agents.ts to build the "agents" graph.
//
// This lives in core (not a standalone daemon) on purpose: the ONLY clients are
// Claude Code sessions launched from app terminal tabs, which exist only while this
// server is running. Provenance is established by terminal.ts injecting
// CLAUDE_RELAY_URL (this server) + CLAUDE_TERMINAL_ID (the pty id) into each tab's
// env, and by the hooks loading per-session via `claude --plugin-dir <relay>` — so
// nothing outside an app terminal can report in. See relay-merge-spec for the
// confirmed Claude Code hook payloads this models.

/** A top-level Claude Code session running in one terminal tab. */
export interface RelaySession {
  /** Claude Code session_id (from the SessionStart hook payload). */
  sessionId: string;
  /** CLAUDE_TERMINAL_ID — the pty id of the app terminal tab hosting this session. */
  terminalId: string;
  /** Working directory of the session (used for the node label). */
  cwd: string;
  /** ms epoch; set on register and bumped on every heartbeat (UserPromptSubmit). */
  lastSeen: number;
}

/** A subagent spawned by a session via the Agent tool (guaranteed depth 1 — subagents
 *  cannot spawn their own subagents). */
export interface RelaySubagent {
  /** SubagentStart agent_id — stable for the subagent's lifetime. */
  agentId: string;
  /** session_id of the session that spawned it. */
  parentSessionId: string;
  /** e.g. "general-purpose", "Explore", "Plan", or a custom agent name. */
  agentType: string;
  /** Workflow-group key, when this subagent was spawned as part of a workflow
   *  orchestration (reported by the relay's SubagentStart hook from the workflow's
   *  env — CLAUDE_WORKFLOW_ID / CLAUDE_JOB_DIR). Subagents of the SAME workflow share
   *  this key; a plain Agent-tool subagent leaves it undefined (ordinary rendering). */
  workflowId?: string;
  startedAt: number;
  /** Flipped true on SubagentStop; done subagents linger briefly then are pruned. */
  done: boolean;
  doneAt?: number;
  /** SubagentStop last_assistant_message (the subagent's final output), if any. */
  lastMessage?: string;
}

export interface RelaySnapshot {
  sessions: RelaySession[];
  subagents: RelaySubagent[];
}

/** How long a finished subagent stays in the snapshot before being pruned, so brief
 *  subagents are still visible for a beat after they complete. */
const DONE_SUBAGENT_TTL_MS = 60_000;

const sessions = new Map<string, RelaySession>();
const subagents = new Map<string, RelaySubagent>();

/** Register (or refresh) a terminal-tab session. Also the heartbeat path: the
 *  UserPromptSubmit hook re-posts this so re-registering the SAME sessionId just bumps
 *  lastSeen and keeps its subagents. A terminal tab hosts at most one live session: if a
 *  DIFFERENT session_id reports the same terminalId (the user re-ran `claude`), the
 *  previous session and its subagents are dropped. An empty cwd preserves the existing
 *  one (the heartbeat payload may omit it). */
export function registerSession(s: { sessionId: string; terminalId: string; cwd: string }, now = Date.now()): void {
  for (const [id, existing] of sessions) {
    if (existing.terminalId === s.terminalId && id !== s.sessionId) {
      removeSessionSubtree(id);
    }
  }
  const cwd = s.cwd || sessions.get(s.sessionId)?.cwd || "";
  sessions.set(s.sessionId, { sessionId: s.sessionId, terminalId: s.terminalId, cwd, lastSeen: now });
}

/** Drop a session and its subagents (Stop / session end). */
export function endSession(sessionId: string): void {
  removeSessionSubtree(sessionId);
}

function removeSessionSubtree(sessionId: string): void {
  sessions.delete(sessionId);
  for (const [agentId, sub] of subagents) {
    if (sub.parentSessionId === sessionId) subagents.delete(agentId);
  }
}

export function startSubagent(
  s: { parentSessionId: string; agentId: string; agentType: string; workflowId?: string },
  now = Date.now(),
): void {
  subagents.set(s.agentId, {
    agentId: s.agentId,
    parentSessionId: s.parentSessionId,
    agentType: s.agentType,
    // Only carry a workflow key when the hook reported a non-empty one, so ordinary
    // subagents stay `workflowId: undefined` and render exactly as before.
    ...(s.workflowId ? { workflowId: s.workflowId } : {}),
    startedAt: now,
    done: false,
  });
}

/** Mark a subagent finished (SubagentStop). Unknown ids are ignored (we may have missed
 *  its start). */
export function stopSubagent(s: { agentId: string; lastMessage?: string }, now = Date.now()): void {
  const sub = subagents.get(s.agentId);
  if (!sub) return;
  sub.done = true;
  sub.doneAt = now;
  if (s.lastMessage !== undefined) sub.lastMessage = s.lastMessage;
}

/**
 * Bound the registry: drop sessions whose terminal tab has closed (terminalId no longer
 * live) along with their subagents, drop orphaned subagents whose parent session is gone,
 * and drop finished subagents past their TTL. Called from GET /agent-graph with the live
 * pty set (terminal.listSessionIds()) so the registry tracks only currently-open tabs —
 * without this, closed-tab sessions and never-stopped subagents would leak forever (there
 * is no terminal-close hook; cleanup happens here at read time).
 */
/** Drop finished subagents whose done-TTL has elapsed. Shared by prune() and snapshot(). */
function sweepDoneSubagents(now: number): void {
  for (const [agentId, sub] of subagents) {
    if (sub.done && sub.doneAt !== undefined && now - sub.doneAt > DONE_SUBAGENT_TTL_MS) {
      subagents.delete(agentId);
    }
  }
}

export function prune(liveTerminalIds: Set<string>, now = Date.now()): void {
  for (const [id, s] of sessions) {
    if (!liveTerminalIds.has(s.terminalId)) removeSessionSubtree(id);
  }
  for (const [agentId, sub] of subagents) {
    if (!sessions.has(sub.parentSessionId)) subagents.delete(agentId); // orphan
  }
  sweepDoneSubagents(now);
}

/** Current registry contents, with finished subagents past their TTL pruned. (Full
 *  liveness pruning is done by {@link prune}; this keeps the done-TTL sweep so a snapshot
 *  taken without a preceding prune — e.g. in tests — still sheds stale subagents.) */
export function snapshot(now = Date.now()): RelaySnapshot {
  sweepDoneSubagents(now);
  return { sessions: [...sessions.values()], subagents: [...subagents.values()] };
}

/** Clear all registry state (tests). */
export function resetRelay(): void {
  sessions.clear();
  subagents.clear();
}
