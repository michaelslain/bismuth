import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  daemonSnapshot,
  buildDaemonGraph,
  daemonGraph,
  DAEMON_NODE_ID,
  type DaemonSnapshot,
} from "../src/daemonGraph";

// --- Fixture home ---------------------------------------------------------
// A mkdtemp'd ~/.claude-bot lookalike: a success cron, a failed cron, a running cron, a disabled
// cron, a STALE .last-fired entry with no backing file (must be excluded), and a process.
let home: string;

const RECENT = new Date().toISOString(); // within the recent window → drives "recently fired"

function cronFile(name: string, fm: string): void {
  writeFileSync(join(home, "crons", `${name}.md`), `---\n${fm}\n---\n\nbody for ${name}\n`);
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "claude-bot-fixture-"));
  mkdirSync(join(home, "crons"), { recursive: true });
  mkdirSync(join(home, "processes"), { recursive: true });

  cronFile("success-cron", "name: success-cron\nschedule: 0 * * * *");
  cronFile("failed-cron", "name: failed-cron\nschedule: 30 * * * *");
  cronFile("running-cron", "name: running-cron\nschedule: 0 0 * * *");
  cronFile("disabled-cron", "name: disabled-cron\nschedule: 0 6 * * *\nenabled: false");
  // #51: a file-change cron — the daemon's on-disk shape the reader must tolerate (no `schedule`
  // key at all).
  cronFile("on-edit", "name: on-edit\non: file-change\nwatch: inbox.md");

  // .last-fired.json — includes "ghost-cron", which has NO backing .md (stale → must be dropped).
  writeFileSync(
    join(home, "crons", ".last-fired.json"),
    JSON.stringify({
      "success-cron": { timestamp: RECENT, result: "success" },
      "failed-cron": { timestamp: RECENT, result: "failed" },
      "ghost-cron": { timestamp: RECENT, result: "success" }, // stale: no ghost-cron.md
    }),
  );

  // .running.json — only running-cron is mid-execution.
  writeFileSync(
    join(home, "crons", ".running.json"),
    JSON.stringify({ "running-cron": { startedAt: RECENT } }),
  );

  // A process (no `name` in fm → falls back to filename); enabled by default.
  writeFileSync(join(home, "processes", "my-proc.md"), `---\ncommand: /bin/true\n---\n\nproc\n`);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

test("daemonSnapshot reads crons from *.md files only — stale .last-fired entries are excluded", () => {
  const snap = daemonSnapshot(home);
  const names = snap.crons.map((c) => c.name).sort();
  expect(names).toEqual(["disabled-cron", "failed-cron", "on-edit", "running-cron", "success-cron"]);
  expect(names).not.toContain("ghost-cron"); // stale .last-fired entry with no file
});

test("#51: daemonSnapshot reads a file-change cron's on/watch, and defaults every other cron to on:schedule/watch:null", () => {
  const snap = daemonSnapshot(home);
  const by = Object.fromEntries(snap.crons.map((c) => [c.name, c]));

  expect(by["on-edit"]).toMatchObject({ schedule: "", on: "file-change", watch: "inbox.md" });
  // Every pre-existing schedule cron still reads as on:"schedule", watch:null — the reader never
  // breaks on a file lacking the new frontmatter keys.
  expect(by["success-cron"]).toMatchObject({ on: "schedule", watch: null });
  expect(by["disabled-cron"]).toMatchObject({ on: "schedule", watch: null });
});

test("daemonSnapshot merges schedule, enabled, last-fired, and running state", () => {
  const snap = daemonSnapshot(home);
  const by = Object.fromEntries(snap.crons.map((c) => [c.name, c]));

  expect(by["success-cron"]).toMatchObject({
    schedule: "0 * * * *",
    enabled: true,
    running: false,
    startedAt: null,
    lastFired: { timestamp: RECENT, result: "success" },
  });
  expect(by["failed-cron"].lastFired).toEqual({ timestamp: RECENT, result: "failed" });
  expect(by["disabled-cron"].enabled).toBe(false);
  expect(by["disabled-cron"].lastFired).toBeNull(); // no .last-fired entry

  // running-cron: in .running.json → running true + startedAt set.
  expect(by["running-cron"].running).toBe(true);
  expect(by["running-cron"].startedAt).toBe(RECENT);
});

test("daemonSnapshot reads processes (filename fallback when no `name`), enabled by default", () => {
  const snap = daemonSnapshot(home);
  expect(snap.processes).toEqual([{ name: "my-proc", enabled: true, running: false }]);
});

test("daemonSnapshot sets the daemon hub label + home, never throws on a fresh home", () => {
  const snap = daemonSnapshot(home);
  expect(snap.daemon.label).toBe("daemon"); // default name; the real name comes from .daemon/identity.md frontmatter
  expect(snap.daemon.home).toBe(home);
  expect(typeof snap.daemon.running).toBe("boolean"); // no daemon.pid → false, but always a bool
});

test("daemonSnapshot uses the provided daemon name as the hub label", () => {
  const snap = daemonSnapshot(home, "Atlas");
  expect(snap.daemon.label).toBe("Atlas");
});

test("daemonSnapshot on a nonexistent home degrades to empty (never throws)", () => {
  const ne = join(tmpdir(), "does-not-exist-claude-bot-xyz");
  // `running` comes from daemonRunning() (the MACHINE dir), not the `home` arg — so isolate
  // BISMUTH_DAEMON_DIR too, else a real daemon actually running on this machine flips it to true.
  const prev = process.env.BISMUTH_DAEMON_DIR;
  process.env.BISMUTH_DAEMON_DIR = ne;
  try {
    const snap = daemonSnapshot(ne);
    expect(snap.crons).toEqual([]);
    expect(snap.processes).toEqual([]);
    expect(snap.daemon.running).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.BISMUTH_DAEMON_DIR;
    else process.env.BISMUTH_DAEMON_DIR = prev;
  }
});

test("buildDaemonGraph: one hub + a node per cron/process, all edges from the hub, NO you-node", () => {
  const snap: DaemonSnapshot = {
    daemon: { label: "claude-bot", running: true, home: "/tmp/x" },
    crons: [
      {
        name: "success-cron",
        schedule: "0 * * * *",
        on: "schedule",
        watch: null,
        enabled: true,
        lastFired: { timestamp: RECENT, result: "success" },
        running: false,
        startedAt: null,
      },
      {
        name: "running-cron",
        schedule: "0 0 * * *",
        on: "schedule",
        watch: null,
        enabled: true,
        lastFired: null,
        running: true,
        startedAt: RECENT,
      },
    ],
    processes: [{ name: "my-proc", enabled: true, running: false }],
  };

  const g = buildDaemonGraph(snap);

  // No "you"/self node — the daemon hub is the center.
  expect(g.nodes.some((n) => n.kind === "self")).toBe(false);

  const hub = g.nodes.find((n) => n.id === DAEMON_NODE_ID);
  expect(hub).toMatchObject({ kind: "daemon", label: "claude-bot" });

  const ids = g.nodes.map((n) => n.id);
  expect(ids).toEqual([DAEMON_NODE_ID, "cron:success-cron", "cron:running-cron", "process:my-proc"]);

  // Every edge runs from the hub to a node, kind "supervises".
  expect(g.edges).toEqual([
    { from: DAEMON_NODE_ID, to: "cron:success-cron", kind: "supervises" },
    { from: DAEMON_NODE_ID, to: "cron:running-cron", kind: "supervises" },
    { from: DAEMON_NODE_ID, to: "process:my-proc", kind: "supervises" },
  ]);

  // Cron nodes carry viz-state metadata for nodeVisualState.
  const success = g.nodes.find((n) => n.id === "cron:success-cron")!;
  expect(success.daemon).toMatchObject({ enabled: true, running: false, lastResult: "success" });
  expect(typeof success.daemon!.lastFiredMs).toBe("number");

  const running = g.nodes.find((n) => n.id === "cron:running-cron")!;
  expect(running.daemon).toMatchObject({ enabled: true, running: true, lastResult: null, lastFiredMs: null });

  // Process node carries viz state too (no last-fired info).
  const proc = g.nodes.find((n) => n.id === "process:my-proc")!;
  expect(proc.daemon).toEqual({ enabled: true, running: false, lastResult: null, lastFiredMs: null });
});

test("daemonGraph(home) end-to-end: reads the fixture and builds the graph", () => {
  const g = daemonGraph(home);
  const ids = g.nodes.map((n) => n.id);
  expect(ids).toContain(DAEMON_NODE_ID);
  expect(ids).toContain("cron:success-cron");
  expect(ids).toContain("cron:on-edit");
  expect(ids).toContain("process:my-proc");
  expect(ids).not.toContain("cron:ghost-cron"); // stale entry stays excluded end-to-end
  // hub + 5 crons + 1 process = 7 nodes; 6 supervises edges.
  expect(g.nodes).toHaveLength(7);
  expect(g.edges).toHaveLength(6);
  expect(g.edges.every((e) => e.from === DAEMON_NODE_ID && e.kind === "supervises")).toBe(true);

  // #51: the file-change cron's node carries on/watch through to the graph's viz metadata,
  // and a plain schedule cron gets on:"schedule" with no watch.
  const onEdit = g.nodes.find((n) => n.id === "cron:on-edit")!;
  expect(onEdit.daemon).toMatchObject({ on: "file-change", watch: "inbox.md" });
  const success = g.nodes.find((n) => n.id === "cron:success-cron")!;
  expect(success.daemon).toMatchObject({ on: "schedule", watch: undefined });
});
