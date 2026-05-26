import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAgentGraph } from "../src/agents";

let tmpDir: string;
let fixturePath: string;

const NOW = new Date();
const TEN_MIN_AGO = new Date(NOW.getTime() - 10 * 60 * 1000 - 1000).toISOString(); // > 10 min ago → idle
const TWO_MIN_AGO = new Date(NOW.getTime() - 2 * 60 * 1000).toISOString();         // < 10 min ago → awake
const FIVE_MIN_AGO = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();        // < 10 min ago → awake

const fixtureState = {
  agents: {
    "host-A:my-project": {
      id: "host-A:my-project",
      host: "host-A",
      cwd: "/Users/alice/Documents/dev/my-project",
      pid: 1001,
      registered_at: "2026-05-25T00:00:00.000Z",
      last_seen: TWO_MIN_AGO,
      status: { text: "Working", kind: "thinking", ts: TWO_MIN_AGO },
    },
    "host-B:my-project": {
      id: "host-B:my-project",
      host: "host-B",
      cwd: "/Users/bob/projects/my-project",
      pid: 2001,
      registered_at: "2026-05-25T00:00:00.000Z",
      last_seen: FIVE_MIN_AGO,
      status: { text: "Ready", kind: "finished", ts: FIVE_MIN_AGO },
    },
    "host-A:other-tool": {
      id: "host-A:other-tool",
      host: "host-A",
      cwd: "/Users/alice/Documents/dev/other-tool",
      pid: 1002,
      registered_at: "2026-05-25T00:00:00.000Z",
      last_seen: TEN_MIN_AGO,
      status: { text: "Idle", kind: "finished", ts: TEN_MIN_AGO },
    },
  },
  inboxes: {
    "host-B:my-project": [
      {
        id: "msg_001",
        from: "host-A:my-project",
        to: "host-B:my-project",
        kind: "chat",
        body: "Hello from A",
        ts: TWO_MIN_AGO,
      },
    ],
  },
  board: [],
};

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "oa-agents-test-"));
  fixturePath = join(tmpDir, "relay-state.json");
  writeFileSync(fixturePath, JSON.stringify(fixtureState), "utf-8");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("returns empty graph when file does not exist", () => {
  const result = buildAgentGraph("/nonexistent/path/relay-state.json");
  expect(result).toEqual({ nodes: [], edges: [] });
});

test("returns 3 agent nodes from fixture", () => {
  const result = buildAgentGraph(fixturePath);
  expect(result.nodes).toHaveLength(3);
  expect(result.nodes.every((n) => n.kind === "agent")).toBe(true);
});

test("agent node ids match relay agent ids", () => {
  const result = buildAgentGraph(fixturePath);
  const ids = result.nodes.map((n) => n.id).sort();
  expect(ids).toEqual([
    "host-A:my-project",
    "host-A:other-tool",
    "host-B:my-project",
  ].sort());
});

test("label is last path segment of cwd", () => {
  const result = buildAgentGraph(fixturePath);
  const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
  expect(byId["host-A:my-project"].label).toBe("my-project");
  expect(byId["host-B:my-project"].label).toBe("my-project");
  expect(byId["host-A:other-tool"].label).toBe("other-tool");
});

test("state is awake when last_seen is within 10 minutes", () => {
  const result = buildAgentGraph(fixturePath);
  const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
  expect(byId["host-A:my-project"].state).toBe("awake");  // 2 min ago
  expect(byId["host-B:my-project"].state).toBe("awake");  // 5 min ago
});

test("state is idle when last_seen is older than 10 minutes", () => {
  const result = buildAgentGraph(fixturePath);
  const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
  expect(byId["host-A:other-tool"].state).toBe("idle");   // > 10 min ago
});

test("directed message edge exists from inbox", () => {
  const result = buildAgentGraph(fixturePath);
  const messageEdge = result.edges.find(
    (e) => e.from === "host-A:my-project" && e.to === "host-B:my-project" && e.kind === "message"
  );
  expect(messageEdge).toBeDefined();
});

test("same-project link edge connects agents sharing label across different ids", () => {
  const result = buildAgentGraph(fixturePath);
  // host-A:my-project and host-B:my-project share label "my-project"
  const linkEdge = result.edges.find(
    (e) => e.kind === "link" &&
      ((e.from === "host-A:my-project" && e.to === "host-B:my-project") ||
       (e.from === "host-B:my-project" && e.to === "host-A:my-project"))
  );
  expect(linkEdge).toBeDefined();
});

test("no edges reference unknown agent ids", () => {
  const result = buildAgentGraph(fixturePath);
  const nodeIds = new Set(result.nodes.map((n) => n.id));
  for (const edge of result.edges) {
    expect(nodeIds.has(edge.from)).toBe(true);
    expect(nodeIds.has(edge.to)).toBe(true);
  }
});

test("duplicate message edges are deduped", () => {
  // Create a fixture with two identical messages
  const dupeState = {
    ...fixtureState,
    inboxes: {
      "host-B:my-project": [
        { id: "msg_001", from: "host-A:my-project", to: "host-B:my-project", kind: "chat", body: "Hello", ts: TWO_MIN_AGO },
        { id: "msg_002", from: "host-A:my-project", to: "host-B:my-project", kind: "chat", body: "Hello again", ts: TWO_MIN_AGO },
      ],
    },
  };
  const dupePath = join(tmpDir, "dupe-relay-state.json");
  writeFileSync(dupePath, JSON.stringify(dupeState), "utf-8");

  const result = buildAgentGraph(dupePath);
  const messageEdges = result.edges.filter(
    (e) => e.from === "host-A:my-project" && e.to === "host-B:my-project" && e.kind === "message"
  );
  expect(messageEdges).toHaveLength(1);
});
