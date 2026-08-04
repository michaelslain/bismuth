import { test, expect, beforeEach } from "bun:test";
import {
  registerSession,
  endSession,
  startSubagent,
  stopSubagent,
  snapshot,
  prune,
  resetRelay,
  redactSnapshot,
  DONE_SUBAGENT_TTL_MS,
} from "../src/relay";

beforeEach(() => resetRelay());

test("register then snapshot returns the session", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj" }, 1000);
  const s = snapshot(1000);
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]).toMatchObject({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: 1000 });
});

test("re-registering the same sessionId is a heartbeat: bumps lastSeen, keeps subagents + cwd", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  // UserPromptSubmit re-posts the session (possibly with an empty cwd) — must not wipe a1 or cwd.
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "" }, 5000);
  const s = snapshot(5000);
  expect(s.sessions[0]).toMatchObject({ sessionId: "s1", lastSeen: 5000, cwd: "/x/proj" });
  expect(s.subagents.map((x) => x.agentId)).toEqual(["a1"]);
});

test("re-running claude in the same tab replaces the old session + drops its subagents", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  // New session_id, SAME terminalId → the old one is evicted.
  registerSession({ sessionId: "s2", terminalId: "tab-1", cwd: "/x" }, 2000);
  const s = snapshot(2000);
  expect(s.sessions.map((x) => x.sessionId)).toEqual(["s2"]);
  expect(s.subagents).toHaveLength(0);
});

test("endSession removes the session and its subagents", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Plan" }, 1100);
  endSession("s1");
  const s = snapshot(1200);
  expect(s.sessions).toHaveLength(0);
  expect(s.subagents).toHaveLength(0);
});

test("subagent start/stop lifecycle; stop stores last message", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  expect(snapshot(1100).subagents[0]).toMatchObject({ agentId: "a1", done: false });
  stopSubagent({ agentId: "a1", lastMessage: "hello from subagent" }, 1200);
  const sub = snapshot(1200).subagents[0];
  expect(sub).toMatchObject({ done: true, doneAt: 1200, lastMessage: "hello from subagent" });
});

test("stopping an unknown subagent is a no-op", () => {
  stopSubagent({ agentId: "ghost" }, 1000);
  expect(snapshot(1000).subagents).toHaveLength(0);
});

test("finished subagents are pruned after the TTL", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  stopSubagent({ agentId: "a1" }, 1200);
  // Within TTL → still present.
  expect(snapshot(1200 + 4_000).subagents).toHaveLength(1);
  // Past TTL → pruned.
  expect(snapshot(1200 + 9_000).subagents).toHaveLength(0);
});

// stopSubagent's only caller is the SubagentStop hook, which fires throughout a terminal tab's
// entire life — the registry's other sweep site, prune(), only runs on tab close. Without an
// eager sweep inside stopSubagent itself, a long-lived tab that runs many sequential Task calls
// would pile up one done RelaySubagent (full lastMessage and all) per call for as long as the tab
// stays open, since nothing else ever visits the registry in between.
test("stopSubagent eagerly sweeps other expired-done subagents, so a long-lived tab doesn't need snapshot() or prune() to bound the registry", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  startSubagent({ parentSessionId: "s1", agentId: "a2", agentType: "Plan" }, 1150);
  stopSubagent({ agentId: "a1" }, 1200); // a1 done at 1200 — just finished, not swept yet.

  // Much later in the SAME tab (no prune(), no snapshot() called in between), a2 finishes too.
  // stopSubagent's own internal sweep must evict a1 (long past its TTL) as a side effect of THIS
  // call alone.
  stopSubagent({ agentId: "a2" }, 1200 + DONE_SUBAGENT_TTL_MS + 1000);

  // Probe with a "now" that, on its own, is NOT enough to evict a1 (only ~1s past its own doneAt,
  // nowhere near the TTL) — if a1 still showed up here it would mean eviction only ever happens
  // when snapshot()/prune() itself is later called with a late-enough clock, not eagerly from
  // stopSubagent as this fix requires.
  const probeNow = 1200 + 1000;
  expect(snapshot(probeNow).subagents.map((s) => s.agentId)).toEqual(["a2"]);
});

// The linger must be a BEAT, not a minute. It exists so a subagent that starts and finishes
// between two 2s polls is still seen; at 60s the agents view was a wall of finished agents and
// read as "they never get removed". Guards the intent, since the constant is otherwise invisible.
test("a finished subagent's linger is brief — gone within ~10s, not a minute", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  stopSubagent({ agentId: "a1" }, 1200);
  // Survives a couple of poll intervals (a brief, intentional linger)...
  expect(snapshot(1200 + 3_000).subagents).toHaveLength(1);
  // ...and is gone well inside 10s. The parent tab never closed.
  const live = new Set(["tab-1"]);
  prune(live, 1200 + 10_000);
  expect(snapshot(1200 + 10_000).subagents).toHaveLength(0);
  expect(snapshot(1200 + 10_000).sessions.map((s) => s.sessionId)).toEqual(["s1"]);
});

// The root cause of the stale nodes: a subagent's ONLY exit under a live session was its own
// SubagentStop — a best-effort, 2s-timeout, errors-swallowed, no-retry POST that Claude Code can
// itself fail to deliver ("[runAgent] SubagentStop on interrupted query failed"). Lose that one
// packet and `done` never flipped, so the done-TTL never applied, and the only other sweep
// (orphan prune) needs the PARENT SESSION to die. The node stayed "awake" forever.
test("a subagent whose stop was lost is eventually pruned, while a running one is kept — parent tab open throughout", () => {
  const t0 = 1_000_000;
  // tab-1: finishes, but its SubagentStop never lands (interrupt / dropped POST).
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, t0);
  startSubagent({ parentSessionId: "s1", agentId: "lost", agentType: "Explore" }, t0);
  const live = new Set(["tab-1"]);

  // Long-lived subagents are legitimate, so it must still be there an hour in.
  prune(live, t0 + 60 * 60_000);
  expect(snapshot(t0 + 60 * 60_000).subagents.map((s) => s.agentId)).toEqual(["lost"]);

  // Past the backstop it's presumed finished — and a subagent that started later is untouched,
  // so "still running" work survives the same sweep.
  const late = t0 + 2 * 60 * 60_000 + 1;
  startSubagent({ parentSessionId: "s1", agentId: "running", agentType: "Plan" }, late - 1000);
  prune(live, late);
  const after = snapshot(late);
  expect(after.subagents.map((s) => s.agentId)).toEqual(["running"]);
  // Closing the parent was never required — the tab (and its session) is still open.
  expect(after.sessions.map((s) => s.sessionId)).toEqual(["s1"]);
});

test("prune drops sessions whose terminal tab has closed, plus their subagents", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  registerSession({ sessionId: "s2", terminalId: "tab-2", cwd: "/y" }, 1000);
  // tab-1 closed → s1 + a1 gone; tab-2 still open → s2 survives.
  prune(new Set(["tab-2"]), 1200);
  const s = snapshot(1200);
  expect(s.sessions.map((x) => x.sessionId)).toEqual(["s2"]);
  expect(s.subagents).toHaveLength(0);
});

test("prune drops orphaned subagents whose parent session is gone (even if not done)", () => {
  // a running subagent whose parent session was never registered (out-of-order event)
  startSubagent({ parentSessionId: "ghost", agentId: "a1", agentType: "Plan" }, 1100);
  expect(snapshot(1100).subagents).toHaveLength(1); // present until pruned
  prune(new Set(), 1200);
  expect(snapshot(1200).subagents).toHaveLength(0);
});

// --- multi-backend provenance -------------------------------------------------------------------
// Several agent CLIs now report into this one registry, so a session carries WHICH one it is.

test("an omitted backend defaults to claude (the original Claude-only hooks send no backend)", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj" }, 1000);
  expect(snapshot(1000).sessions[0]?.backend).toBe("claude");
});

test("an explicit backend is recorded", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", backend: "codex" }, 1000);
  expect(snapshot(1000).sessions[0]?.backend).toBe("codex");
});

test("a heartbeat that omits the backend does NOT downgrade an identified session to claude", () => {
  // Same hazard as cwd: the heartbeat payload may carry less than the registration did, and losing
  // the backend would silently relabel a codex tab as claude mid-session.
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", backend: "codex" }, 1000);
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "" }, 5000);
  expect(snapshot(5000).sessions[0]).toMatchObject({ backend: "codex", cwd: "/x/proj", lastSeen: 5000 });
});

test("re-running a DIFFERENT CLI in the same tab replaces the session (one session per tab)", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", backend: "claude" }, 1000);
  registerSession({ sessionId: "s2", terminalId: "tab-1", cwd: "/x/proj", backend: "codex" }, 2000);
  const s = snapshot(2000);
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]).toMatchObject({ sessionId: "s2", backend: "codex" });
});

// --- redactSnapshot: the non-owner projection powering GET /relay/snapshot -----------------------
// RelaySubagent.lastMessage is the ONE content field in the whole registry (free-text final
// output that can quote vault notes); everything else on RelaySession/RelaySubagent is
// bookkeeping (ids, types, timestamps, cwd, backend, workflow key) and must survive redaction
// untouched, field-by-field, not as a loose "shape" match.

test("redactSnapshot drops lastMessage from a subagent that has one", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", backend: "codex" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore", workflowId: "wf-1" }, 1100);
  stopSubagent({ agentId: "a1", lastMessage: "quotes secret-note.md content here" }, 1200);

  const raw = snapshot(1200);
  expect(raw.subagents[0].lastMessage).toBe("quotes secret-note.md content here");

  const redacted = redactSnapshot(raw);
  const sub = redacted.subagents[0];
  // Content field: gone, not blanked to "".
  expect("lastMessage" in sub).toBe(false);
  // Every bookkeeping field on the subagent: preserved exactly, one assertion per field.
  expect(sub.agentId).toBe("a1");
  expect(sub.parentSessionId).toBe("s1");
  expect(sub.agentType).toBe("Explore");
  expect(sub.workflowId).toBe("wf-1");
  expect(sub.startedAt).toBe(1100);
  expect(sub.done).toBe(true);
  expect(sub.doneAt).toBe(1200);
});

test("redactSnapshot preserves every RelaySession bookkeeping field untouched", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x/my-proj", backend: "codex" }, 1000);
  const redacted = redactSnapshot(snapshot(1000));
  const s = redacted.sessions[0];
  expect(s.sessionId).toBe("s1");
  expect(s.terminalId).toBe("tab-1");
  expect(s.cwd).toBe("/x/my-proj");
  expect(s.backend).toBe("codex");
  expect(s.lastSeen).toBe(1000);
});

test("redactSnapshot leaves a subagent with no lastMessage (still running) unchanged", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Plan" }, 1100);
  const redacted = redactSnapshot(snapshot(1100));
  const sub = redacted.subagents[0];
  expect("lastMessage" in sub).toBe(false);
  expect(sub.done).toBe(false);
});

test("redactSnapshot does not mutate the input snapshot", () => {
  registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/x" }, 1000);
  startSubagent({ parentSessionId: "s1", agentId: "a1", agentType: "Explore" }, 1100);
  stopSubagent({ agentId: "a1", lastMessage: "original output" }, 1200);
  const raw = snapshot(1200);
  redactSnapshot(raw);
  expect(raw.subagents[0].lastMessage).toBe("original output");
});
