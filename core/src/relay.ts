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
  /** Flipped true on SubagentStop. Done subagents linger briefly then are pruned; one that never
   *  reports a stop is swept on age instead (see RUNNING_SUBAGENT_MAX_MS). */
  done: boolean;
  doneAt?: number;
  /** SubagentStop last_assistant_message (the subagent's final output), if any. */
  lastMessage?: string;
}

export interface RelaySnapshot {
  sessions: RelaySession[];
  subagents: RelaySubagent[];
}

/** How long a finished subagent stays in the snapshot before being pruned, so brief subagents
 *  are still visible for a beat after they complete. A *beat* — long enough to register at the
 *  2s agent-graph poll, short enough that the view reflects what is actually running. This was
 *  60s, which read as "finished subagents never leave": a whole minute of dead nodes, and with
 *  agents starting continuously the view was mostly corpses. */
export const DONE_SUBAGENT_TTL_MS = 8_000;

/**
 * Backstop age after which a subagent that never reported a stop is presumed finished.
 *
 * A subagent's normal exit is its SubagentStop (→ {@link stopSubagent}), reported by a
 * best-effort hook: 2s timeout, all errors swallowed, no retry — and Claude Code itself can fail
 * to deliver it ("[runAgent] SubagentStop on interrupted query failed" when a query is
 * interrupted). That was the ONLY exit for a subagent under a live session: `done` never
 * flipped, so DONE_SUBAGENT_TTL_MS never applied, and the sole remaining sweep (orphan prune)
 * needs the PARENT SESSION to die. One dropped packet therefore pinned an "awake" node in the
 * graph forever. Nothing may hinge on a single lossy signal, so running subagents get an age
 * bound too.
 *
 * Deliberately far beyond any real subagent rather than a tight guess, because there is NO
 * cheap signal that proves one is still alive:
 * - the parent's Stop hook is NOT a turn boundary for subagents — verified against claude
 *   2.1.211: an async/background subagent outlives several parent Stops, so finishing subagents
 *   on Stop would reap live ones;
 * - a tool-call heartbeat can't work either — a subagent sitting in one long Bash call emits
 *   nothing for its whole duration.
 * So this only guarantees "no node is immortal"; SubagentStop remains the path that makes a
 * finished subagent leave promptly.
 */
export const RUNNING_SUBAGENT_MAX_MS = 2 * 60 * 60 * 1000;

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
/**
 * Drop subagents that are no longer worth showing. Shared by prune() and snapshot().
 *
 * Two exits, because a subagent must never depend on a single signal to leave:
 * - it reported a stop and its brief linger has elapsed (the normal path); or
 * - it never reported one and is older than the backstop age, so its stop was lost
 *   (see RUNNING_SUBAGENT_MAX_MS) — without this a dropped SubagentStop pinned the node forever.
 */
function sweepDoneSubagents(now: number): void {
  for (const [agentId, sub] of subagents) {
    const finished = sub.done && sub.doneAt !== undefined && now - sub.doneAt > DONE_SUBAGENT_TTL_MS;
    const abandoned = !sub.done && now - sub.startedAt > RUNNING_SUBAGENT_MAX_MS;
    if (finished || abandoned) subagents.delete(agentId);
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
