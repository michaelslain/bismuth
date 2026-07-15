import { test, expect } from "bun:test";
import { buildAgentGraph, type ChatAgentSession } from "../src/agents";
import type { RelaySnapshot } from "../src/relay";

const NOW = 1_000_000_000_000;
const TWO_MIN_AGO = NOW - 2 * 60 * 1000;
const ELEVEN_MIN_AGO = NOW - 11 * 60 * 1000;

function snap(partial: Partial<RelaySnapshot>): RelaySnapshot {
  return { sessions: partial.sessions ?? [], subagents: partial.subagents ?? [] };
}

test("empty snapshot → empty graph", () => {
  expect(buildAgentGraph(snap({}), new Set(), NOW)).toEqual({ nodes: [], edges: [] });
});

test("a live terminal session becomes one root agent node", () => {
  const g = buildAgentGraph(
    snap({ sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/Users/m/dev/bismuth", lastSeen: TWO_MIN_AGO }] }),
    new Set(["tab-1"]),
    NOW,
  );
  expect(g.nodes).toHaveLength(1);
  expect(g.nodes[0]).toMatchObject({ id: "agent:sess:s1", label: "bismuth", kind: "agent", state: "awake" });
  expect(g.nodes[0].parent).toBeUndefined(); // root
  expect(g.edges).toHaveLength(0);
});

test("a session whose terminal tab is closed is dropped", () => {
  const g = buildAgentGraph(
    snap({ sessions: [{ sessionId: "s1", terminalId: "tab-closed", cwd: "/x/y", lastSeen: TWO_MIN_AGO }] }),
    new Set(["tab-other"]),
    NOW,
  );
  expect(g.nodes).toHaveLength(0);
});

test("subagent hangs off its parent session with a message edge", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }],
      subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false }],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  const sub = g.nodes.find((n) => n.id === "agent:sub:a1");
  expect(sub).toMatchObject({ label: "Explore", kind: "agent", state: "awake", parent: "agent:sess:s1" });
  expect(g.edges).toEqual([{ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" }]);
});

test("Bug #107: a live session with subagents yields the full you → session → subagent chain", () => {
  // Regression guard for "subagents don't show in the agents view". Given a live terminal
  // session that spawned two subagents, buildAgentGraph must emit BOTH subagent nodes as
  // depth-1 children of the session, each with a session → subagent "message" edge — and the
  // session itself must be a ROOT (no parent) so the frontend's `you` hub wires to it
  // (`agentLayout.ts` adds the you → session "open" edge off every parent-less agent node).
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }],
      subagents: [
        { agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false },
        { agentId: "a2", parentSessionId: "s1", agentType: "code-review", startedAt: TWO_MIN_AGO, done: false },
      ],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  // The session node is a root the "you" hub attaches to.
  const session = g.nodes.find((n) => n.id === "agent:sess:s1");
  expect(session).toMatchObject({ kind: "agent" });
  expect(session!.parent).toBeUndefined();
  // BOTH subagents appear, parented to the session.
  const subs = g.nodes.filter((n) => n.parent === "agent:sess:s1");
  expect(subs.map((n) => n.id).sort()).toEqual(["agent:sub:a1", "agent:sub:a2"]);
  expect(subs.every((n) => n.kind === "agent")).toBe(true);
  // …with a session → subagent edge for each (the depth-1 tree), and no phantom workflow key on
  // an ordinary subagent (Bug #107's root cause was ordinary subagents being mis-tagged workflow).
  expect(g.edges).toContainEqual({ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" });
  expect(g.edges).toContainEqual({ from: "agent:sess:s1", to: "agent:sub:a2", kind: "message" });
  expect(g.edges.every((e) => !("workflow" in e))).toBe(true);
  expect(subs.every((n) => n.workflow === undefined)).toBe(true);
});

test("a subagent whose parent session is closed is dropped (no orphan)", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-closed", cwd: "/x", lastSeen: TWO_MIN_AGO }],
      subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Plan", startedAt: TWO_MIN_AGO, done: false }],
    }),
    new Set(["tab-open-but-different"]),
    NOW,
  );
  expect(g.nodes).toHaveLength(0);
  expect(g.edges).toHaveLength(0);
});

test("session idle after the awake window; finished subagent is idle", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: ELEVEN_MIN_AGO }],
      subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: ELEVEN_MIN_AGO, done: true, doneAt: NOW }],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  expect(g.nodes.find((n) => n.id === "agent:sess:s1")?.state).toBe("idle");
  expect(g.nodes.find((n) => n.id === "agent:sub:a1")?.state).toBe("idle");
});

test("two terminal tabs each produce their own root", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [
        { sessionId: "s1", terminalId: "tab-1", cwd: "/x/a", lastSeen: TWO_MIN_AGO },
        { sessionId: "s2", terminalId: "tab-2", cwd: "/x/b", lastSeen: TWO_MIN_AGO },
      ],
    }),
    new Set(["tab-1", "tab-2"]),
    NOW,
  );
  const roots = g.nodes.filter((n) => !n.parent);
  expect(roots.map((n) => n.label).sort()).toEqual(["a", "b"]);
});

test("a session past its heartbeat window stays awake while a subagent is running", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: ELEVEN_MIN_AGO }],
      subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: ELEVEN_MIN_AGO, done: false }],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  // No "idle root with an awake child": the running subagent keeps the session awake.
  expect(g.nodes.find((n) => n.id === "agent:sess:s1")?.state).toBe("awake");
  expect(g.nodes.find((n) => n.id === "agent:sub:a1")?.state).toBe("awake");
});

test("a workflow-spawned subagent carries the workflow marker on its node AND edge", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }],
      subagents: [
        { agentId: "a1", parentSessionId: "s1", agentType: "impl", startedAt: TWO_MIN_AGO, done: false, workflowId: "wf-42" },
        { agentId: "a2", parentSessionId: "s1", agentType: "impl", startedAt: TWO_MIN_AGO, done: false, workflowId: "wf-42" },
      ],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  // Both subagents of the same workflow share the group key on their nodes.
  expect(g.nodes.find((n) => n.id === "agent:sub:a1")?.workflow).toBe("wf-42");
  expect(g.nodes.find((n) => n.id === "agent:sub:a2")?.workflow).toBe("wf-42");
  // Their session→subagent edges are marked as workflow-lane connections.
  const e1 = g.edges.find((e) => e.to === "agent:sub:a1");
  const e2 = g.edges.find((e) => e.to === "agent:sub:a2");
  expect(e1).toEqual({ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message", workflow: "wf-42" });
  expect(e2).toEqual({ from: "agent:sess:s1", to: "agent:sub:a2", kind: "message", workflow: "wf-42" });
});

test("an ordinary (non-workflow) subagent carries NO workflow marker — unchanged rendering", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }],
      subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false }],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  const node = g.nodes.find((n) => n.id === "agent:sub:a1")!;
  const edge = g.edges.find((e) => e.to === "agent:sub:a1")!;
  expect(node.workflow).toBeUndefined();
  expect("workflow" in edge).toBe(false); // exactly the ordinary { from, to, kind } shape
  expect(edge).toEqual({ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" });
});

test("workflow and ordinary subagents coexist under one session — only the workflow ones are marked", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }],
      subagents: [
        { agentId: "wf", parentSessionId: "s1", agentType: "impl", startedAt: TWO_MIN_AGO, done: false, workflowId: "wf-7" },
        { agentId: "plain", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false },
      ],
    }),
    new Set(["tab-1"]),
    NOW,
  );
  expect(g.edges.find((e) => e.to === "agent:sub:wf")?.workflow).toBe("wf-7");
  expect(g.edges.find((e) => e.to === "agent:sub:plain")?.workflow).toBeUndefined();
});

// --- Visual chat sessions -------------------------------------------------------------------

function chat(partial: Partial<ChatAgentSession>): ChatAgentSession {
  return {
    chatId: partial.chatId ?? "c1",
    label: partial.label ?? "Chat",
    active: partial.active ?? false,
    lastActivityAt: partial.lastActivityAt ?? TWO_MIN_AGO,
    subagents: partial.subagents ?? [],
  };
}

test("an active chat session becomes a root agent node under the self hub", () => {
  const g = buildAgentGraph(snap({}), new Set(), NOW, [
    chat({ chatId: "c1", label: "Refactor the parser", active: true }),
  ]);
  expect(g.nodes).toHaveLength(1);
  expect(g.nodes[0]).toMatchObject({ id: "agent:chat:c1", label: "Refactor the parser", kind: "agent", state: "awake" });
  expect(g.nodes[0].parent).toBeUndefined(); // a root — the frontend wires "you" → it
  expect(g.edges).toHaveLength(0);
});

test("a chat idle past the awake window is idle; a mid-turn chat stays awake", () => {
  const idle = buildAgentGraph(snap({}), new Set(), NOW, [
    chat({ chatId: "c1", active: false, lastActivityAt: ELEVEN_MIN_AGO }),
  ]);
  expect(idle.nodes.find((n) => n.id === "agent:chat:c1")?.state).toBe("idle");
  // Even long past the heartbeat window, an in-flight turn (active) keeps the node awake.
  const busy = buildAgentGraph(snap({}), new Set(), NOW, [
    chat({ chatId: "c1", active: true, lastActivityAt: ELEVEN_MIN_AGO }),
  ]);
  expect(busy.nodes.find((n) => n.id === "agent:chat:c1")?.state).toBe("awake");
});

test("a closed chat is pruned — absent from the snapshot means absent from the graph", () => {
  // chat.ts drops a closed chat from its registry, so the snapshot no longer contains it.
  const g = buildAgentGraph(snap({}), new Set(), NOW, []);
  expect(g.nodes.filter((n) => n.id.startsWith("agent:chat:"))).toHaveLength(0);
});

test("a chat's SDK subagent hangs off the chat node with a message edge", () => {
  const g = buildAgentGraph(snap({}), new Set(), NOW, [
    chat({
      chatId: "c1",
      label: "Investigate flake",
      active: true,
      subagents: [{ agentId: "t1", agentType: "Explore", done: false }],
    }),
  ]);
  const sub = g.nodes.find((n) => n.id === "agent:chatsub:t1");
  expect(sub).toMatchObject({ label: "Explore", kind: "agent", state: "awake", parent: "agent:chat:c1" });
  expect(g.edges).toEqual([{ from: "agent:chat:c1", to: "agent:chatsub:t1", kind: "message" }]);
  // A finished chat subagent reads as idle.
  const done = buildAgentGraph(snap({}), new Set(), NOW, [
    chat({ chatId: "c1", subagents: [{ agentId: "t1", agentType: "Explore", done: true }] }),
  ]);
  expect(done.nodes.find((n) => n.id === "agent:chatsub:t1")?.state).toBe("idle");
});

test("chat sessions and terminal sessions coexist as sibling roots in one agents graph", () => {
  const g = buildAgentGraph(
    snap({ sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }] }),
    new Set(["tab-1"]),
    NOW,
    [chat({ chatId: "c1", label: "My chat", active: true })],
  );
  const roots = g.nodes.filter((n) => !n.parent);
  expect(roots.map((n) => n.id).sort()).toEqual(["agent:chat:c1", "agent:sess:s1"]);
});

test("omitting the chat argument entirely leaves the terminal graph unchanged (back-compat)", () => {
  const withArg = buildAgentGraph(
    snap({ sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }] }),
    new Set(["tab-1"]),
    NOW,
    [],
  );
  const withoutArg = buildAgentGraph(
    snap({ sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/x/proj", lastSeen: TWO_MIN_AGO }] }),
    new Set(["tab-1"]),
    NOW,
  );
  expect(withoutArg).toEqual(withArg);
});

test("several subagents under one session, plus a second session whose tab is closed", () => {
  const g = buildAgentGraph(
    snap({
      sessions: [
        { sessionId: "s1", terminalId: "tab-1", cwd: "/x/a", lastSeen: TWO_MIN_AGO },
        { sessionId: "s2", terminalId: "tab-closed", cwd: "/x/b", lastSeen: TWO_MIN_AGO },
      ],
      subagents: [
        { agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false },
        { agentId: "a2", parentSessionId: "s1", agentType: "Plan", startedAt: TWO_MIN_AGO, done: false },
        { agentId: "a3", parentSessionId: "s2", agentType: "code-review", startedAt: TWO_MIN_AGO, done: false }, // orphan (tab closed)
      ],
    }),
    new Set(["tab-1"]), // only tab-1 open
    NOW,
  );
  // s1's two children survive with correct parent edges; s2 + its child are dropped.
  expect(g.nodes.map((n) => n.id).sort()).toEqual(["agent:sess:s1", "agent:sub:a1", "agent:sub:a2"]);
  expect(g.edges).toContainEqual({ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" });
  expect(g.edges).toContainEqual({ from: "agent:sess:s1", to: "agent:sub:a2", kind: "message" });
  expect(g.edges.some((e) => e.to === "agent:sub:a3")).toBe(false);
});
