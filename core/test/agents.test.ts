import { test, expect } from "bun:test";
import { buildAgentGraph } from "../src/agents";
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
