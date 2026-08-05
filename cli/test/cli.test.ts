import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSampleVault, makeVault } from "../../core/test/helpers";
import { resolveCore } from "../src/commands/app";

test("`bismuth graph --vault <dir>` prints graph JSON with the vault nodes", async () => {
  const { vault } = await makeSampleVault();
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "graph", "--vault", vault], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  expect(proc.exitCode).toBe(0);
  const g = JSON.parse(out);
  expect(g.nodes.some((n: any) => n.id === "internship")).toBe(true);
  expect(g.nodes.some((n: any) => n.id === "essay")).toBe(true);
});

// --- visibility CLI gate (core/src/visibilityCliGate.ts), wired at the real dispatch point --------
// End-to-end through an ACTUAL spawned `bismuth` process (not just the gate function's own unit
// tests) — this is the exact invocation shape an agent's Bash tool uses.

test("BISMUTH_AGENT_CHANNEL unset (the owner's own hand) reads a hidden note straight through", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n" });
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "read", "Private/secret.md", "--vault", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
  });
  const [out, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(0);
  expect(out).toContain("THE-SECRET-STRING-42");
});

test("the SAME command with BISMUTH_AGENT_CHANNEL=daemon is refused before it ever reads the file", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n" });
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "read", "Private/secret.md", "--vault", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: "daemon" },
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(out).not.toContain("THE-SECRET-STRING-42");
  expect(err).toContain("Private/secret.md");
});

test("`checkpoint diff` refuses under an agent channel against a REAL git repo, via --dir", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n" }, "bismuth-checkpoint-vis-");
  await Bun.spawn(["git", "init", "-q"], { cwd: vault }).exited;
  await Bun.spawn(["git", "-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"], { cwd: vault }).exited;
  await Bun.spawn(["git", "-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "initial"], { cwd: vault }).exited;

  const daemon = Bun.spawn(["bun", "run", "cli/src/index.ts", "checkpoint", "diff", "vis-test", "--dir", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: "daemon" },
  });
  const [, daemonErr, daemonCode] = await Promise.all([
    new Response(daemon.stdout).text(),
    new Response(daemon.stderr).text(),
    daemon.exited,
  ]);
  expect(daemonCode).toBe(1);
  expect(daemonErr).toContain("checkpoint");

  // The owner (channel unset) still gets the real diff.
  const owner = Bun.spawn(["bun", "run", "cli/src/index.ts", "checkpoint", "diff", "vis-test", "--dir", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
  });
  const [ownerOut, , ownerCode] = await Promise.all([
    new Response(owner.stdout).text(),
    new Response(owner.stderr).text(),
    owner.exited,
  ]);
  expect(ownerCode).toBe(0);
  expect(JSON.parse(ownerOut).files.some((f: any) => f.path === "Private/secret.md")).toBe(true);
}, 30_000);

// --- `app` group: core discovery precedence + `page` group headless create ---------------------

// These tests mutate BISMUTH_API/CLAUDE_RELAY_URL/BISMUTH_RUN_DIR — snapshot + restore (file-wide).
let savedEnv: Record<string, string | undefined>;
let runDir: string;
beforeEach(() => {
  savedEnv = { api: process.env.BISMUTH_API, relay: process.env.CLAUDE_RELAY_URL, run: process.env.BISMUTH_RUN_DIR, vault: process.env.BISMUTH_VAULT };
  delete process.env.BISMUTH_API;
  delete process.env.CLAUDE_RELAY_URL;
  delete process.env.BISMUTH_VAULT;
  runDir = mkdtempSync(join(tmpdir(), "bismuth-cli-run-"));
  process.env.BISMUTH_RUN_DIR = runDir;
});
afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
  for (const [k, envKey] of [["api", "BISMUTH_API"], ["relay", "CLAUDE_RELAY_URL"], ["run", "BISMUTH_RUN_DIR"], ["vault", "BISMUTH_VAULT"]] as const) {
    if (savedEnv[k] === undefined) delete process.env[envKey];
    else process.env[envKey] = savedEnv[k]!;
  }
});

test("resolveCore precedence: --api > BISMUTH_API > CLAUDE_RELAY_URL > run-registry > :4321", async () => {
  const { writeRunRecord } = await import("../../core/src/runRegistry");
  // Nothing set → default port.
  expect(resolveCore([])).toBe("http://localhost:4321");
  // Run-registry single match. readRunRecords filters dead pids (core/src/runRegistry.ts), so use
  // this test process's own — the one pid guaranteed alive for the test's duration.
  writeRunRecord({ port: 4399, vault: "/v/one", pid: process.pid });
  expect(resolveCore([])).toBe("http://localhost:4399");
  // CLAUDE_RELAY_URL beats the registry.
  process.env.CLAUDE_RELAY_URL = "http://localhost:5000";
  expect(resolveCore([])).toBe("http://localhost:5000");
  // BISMUTH_API beats CLAUDE_RELAY_URL.
  process.env.BISMUTH_API = "http://localhost:6000/";
  expect(resolveCore([])).toBe("http://localhost:6000"); // trailing slash trimmed
  // --api beats everything.
  expect(resolveCore(["--api", "http://localhost:7000"])).toBe("http://localhost:7000");
});

test("`bismuth app windows` fails cleanly (no crash) when no app is running", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "windows", "--api", "http://localhost:59999"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1); // fail() exits non-zero, doesn't throw an uncaught error
});

// --- `app rename`/`app pin`/`app reorder`: dispatch + arg validation --------------------------
// A tiny in-test mock of POST /ui/command captures exactly what the CLI sent (action + args), so
// these tests prove the argument-building logic in cli/src/commands/app.ts — not just "it didn't
// crash" — without needing a real Bismuth window.

/** Spin up a throwaway HTTP server that records every POST /ui/command body and answers it with
 *  `reply`. Caller must `stop()` it. */
function mockUiControlServer(reply: unknown = { ok: true }): { url: string; calls: any[]; stop: () => void } {
  const calls: any[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (req.method === "POST" && new URL(req.url).pathname === "/ui/command") {
        calls.push(await req.json());
        return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, calls, stop: () => server.stop(true) };
}

test("`bismuth app rename <tabId> <name>` dispatches rename-tab with {tabId, name}", async () => {
  const mock = mockUiControlServer({ ok: true });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "rename", "t1", "New Name", "--api", mock.url], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ action: "rename-tab", args: { tabId: "t1", name: "New Name" } });
  } finally {
    mock.stop();
  }
});

test("`bismuth app rename <tabId>` (missing name) fails before ever reaching the network", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "rename", "t1", "--api", "http://localhost:59999"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("usage: bismuth app rename");
});

test("`bismuth app pin <tabId>` dispatches pin-tab with pinned:true; `--off` sends pinned:false", async () => {
  const mock = mockUiControlServer({ ok: true });
  try {
    const on = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "pin", "t1", "--api", mock.url], { stdout: "pipe", stderr: "pipe" });
    expect(await on.exited).toBe(0);
    const off = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "pin", "t1", "--off", "--api", mock.url], { stdout: "pipe", stderr: "pipe" });
    expect(await off.exited).toBe(0);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]).toMatchObject({ action: "pin-tab", args: { tabId: "t1", pinned: true } });
    expect(mock.calls[1]).toMatchObject({ action: "pin-tab", args: { tabId: "t1", pinned: false } });
  } finally {
    mock.stop();
  }
});

test("`bismuth app reorder <tabId> <index>` dispatches reorder-tab with a numeric index", async () => {
  const mock = mockUiControlServer({ ok: true });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "reorder", "t1", "2", "--api", mock.url], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ action: "reorder-tab", args: { tabId: "t1", index: 2 } });
  } finally {
    mock.stop();
  }
});

test("`bismuth app reorder <tabId> <index>` rejects a non-integer index before ever reaching the network", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "app", "reorder", "t1", "notanumber", "--api", "http://localhost:59999"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("invalid index");
});

// --- `calendar` group: headless calendar-base CRUD end-to-end --------------------------------

/** Spawn `bismuth <args>` against a vault; returns { code, json } (json parsed from stdout). */
async function runCli(vault: string, ...args: string[]): Promise<{ code: number | null; json: any; err: string }> {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", ...args, "--vault", vault], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [outText, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let json: any = undefined;
  try {
    json = JSON.parse(outText);
  } catch {
    /* non-JSON output (or empty) */
  }
  return { code, json, err };
}

test("`bismuth calendar …` create → category → add → list/range/search → move → delete, headlessly", async () => {
  const { vault } = await makeSampleVault();
  const cal = "Bases/Team Cal.md";

  // Create a fresh calendar base; discover it.
  const create = await runCli(vault, "calendar", "create", cal, "--title", "Team Cal");
  expect(create.code).toBe(0);
  expect(create.json).toMatchObject({ ok: true, path: cal });
  // Creating again fails (EEXIST), doesn't clobber.
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(1);
  const bases = await runCli(vault, "calendar", "bases");
  expect(bases.code).toBe(0);
  expect(bases.json).toContainEqual({ path: cal, title: "Team Cal", events: 0, categories: [] });

  // Categories.
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work", "--color", "#b00020")).code).toBe(0);
  const cats = await runCli(vault, "calendar", "categories", cal);
  expect(cats.json).toEqual([{ name: "Work", color: "#b00020" }]);

  // Events: one single + one weekly via --rrule (2026-01-01 is a Thursday → first MO is Jan 5).
  const single = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-06", "--title", "Dentist", "--start", "09:00", "--end", "10:00", "--category", "Work");
  expect(single.code).toBe(0);
  const singleId = single.json.event.id as string;
  expect(singleId).toBeTruthy();
  const weekly = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO");
  expect(weekly.code).toBe(0);
  expect(weekly.json.event.date).toBe("2026-01-05"); // normalized to the first Monday
  expect(weekly.json.event.recurrence.type).toBe("weekly");

  // list (raw) / range (expanded) / search / get.
  const list = await runCli(vault, "calendar", "list", cal);
  expect(list.json).toHaveLength(2);
  const range = await runCli(vault, "calendar", "range", cal, "2026-01-05", "2026-01-13");
  // Mondays Jan 5 + Jan 12 from the series, plus the Jan 6 single = 3 instances.
  expect(range.json.map((e: any) => e.date)).toEqual(["2026-01-05", "2026-01-06", "2026-01-12"]);
  const search = await runCli(vault, "calendar", "search", cal, "dentist");
  expect(search.json.map((e: any) => e.id)).toEqual([singleId]);
  const get = await runCli(vault, "calendar", "get", cal, singleId);
  expect(get.json).toMatchObject({ id: singleId, title: "Dentist", category: "Work" });

  // Rename the category — cascades into the event.
  expect((await runCli(vault, "calendar", "category", "update", cal, "Work", "--rename", "Job")).code).toBe(0);
  expect((await runCli(vault, "calendar", "get", cal, singleId)).json.category).toBe("Job");

  // Move + delete.
  expect((await runCli(vault, "calendar", "move", cal, singleId, "--date", "2026-01-07")).json.event.date).toBe("2026-01-07");
  expect((await runCli(vault, "calendar", "delete", cal, singleId)).json).toEqual({ ok: true });
  expect((await runCli(vault, "calendar", "list", cal)).json).toHaveLength(1);
}, 60_000);

// --- `card review` must honour settings.srs (not the hardcoded SM-2 defaults) ------------------

test("`card review` honours settings.srs instead of the hardcoded defaults", async () => {
  const { readNote } = await import("../../core/src/files");
  const { parseBaseFile } = await import("../../core/src/bases/parse");
  const { applyReviewToRow } = await import("../../core/src/srs/reviewRow");
  const { DEFAULT_SRS } = await import("../../core/src/srs/scheduler");
  const { today } = await import("../src/args");

  const deckPath = "Deck.md";
  const vault = makeVault({
    ".settings": "srs:\n  easyGraduatingInterval: 9\n",
    [deckPath]: "---\ntype: base\nview: flashcards\n---\n\n| front | back | due | ease | interval |\n| --- | --- | --- | --- | --- |\n| a | b |  |  |  |\n",
  });

  // Capture the pre-review row so the expectation is computed from the SAME input the CLI sees.
  const before = parseBaseFile(await readNote(vault, deckPath), { name: "Deck", path: deckPath });
  const expected = applyReviewToRow(before.rows[0].note, "easy", today(), { ...DEFAULT_SRS, easyGraduatingInterval: 9 }, undefined);

  const result = await runCli(vault, "card", "review", "--file", deckPath, "--index", "0", "--response", "easy");
  expect(result.code).toBe(0);

  const after = parseBaseFile(await readNote(vault, deckPath), { name: "Deck", path: deckPath });
  expect(after.rows[0].note.interval).toBe(expected.interval);
  // Sanity: the configured value actually diverges from what the hardcoded default would produce.
  expect(expected.interval).not.toBe(DEFAULT_SRS.easyGraduatingInterval);
});

test("`card review` (legacy inline note card) honours settings.srs instead of the hardcoded defaults", async () => {
  const { noteCards } = await import("../../core/src/srs/cards");
  const { schedule, DEFAULT_SRS } = await import("../../core/src/srs/scheduler");
  const { today } = await import("../src/args");

  const notePath = "Card.md";
  const vault = makeVault({
    ".settings": "srs:\n  easyGraduatingInterval: 9\n",
    [notePath]: "Q1::A1\n",
  });
  const cardId = `${notePath}::0::0`;

  // Independent expectation: the scheduler itself, given the explicit configured value. Only
  // `interval` is asserted below (not `due`) — `due` is derived from "today", and bun's test
  // runner forces its own process clock to UTC while the spawned CLI subprocess uses the real
  // system timezone, so comparing ISO due-dates across that boundary is flaky near midnight UTC.
  const expected = schedule(null, "easy", today(), { ...DEFAULT_SRS, easyGraduatingInterval: 9 });
  // Sanity: the configured value actually diverges from what the hardcoded default would produce.
  expect(expected.interval).not.toBe(DEFAULT_SRS.easyGraduatingInterval);

  const result = await runCli(vault, "card", "review", cardId, "easy");
  expect(result.code).toBe(0);

  const reviewed = (await noteCards(vault, notePath)).find((c) => c.id === cardId);
  expect(reviewed?.interval).toBe(expected.interval);
});

test("`bismuth page create` + `page list` author and read back a page headlessly", async () => {
  const { vault } = await makeSampleVault();
  const create = Bun.spawn(
    ["bun", "run", "cli/src/index.ts", "page", "create", "cli-page", "--title", "From CLI", "--body", "hello", "--vault", vault],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [createOut, , createCode] = await Promise.all([
    new Response(create.stdout).text(),
    new Response(create.stderr).text(),
    create.exited,
  ]);
  expect(createCode).toBe(0);
  expect(JSON.parse(createOut)).toMatchObject({ path: ".daemon/pages/cli-page.md", slug: "cli-page" });

  const list = Bun.spawn(["bun", "run", "cli/src/index.ts", "page", "list", "--vault", vault], { stdout: "pipe" });
  const listOut = await new Response(list.stdout).text();
  await list.exited;
  const pages = JSON.parse(listOut);
  expect(pages.some((p: any) => p.slug === "cli-page" && p.title === "From CLI")).toBe(true);
});

// --- `replace` scoping + snapshot (cli/src/commands/search.ts) --------------------------------

test("`replace --scope <path>` only rewrites the named note", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({ "A.md": "target here\n", "B.md": "target here\n" });

  const result = await runCli(vault, "replace", "target", "changed", "--scope", "A.md");
  expect(result.code).toBe(0);

  expect(await readNote(vault, "A.md")).toContain("changed");
  expect(await readNote(vault, "B.md")).toContain("target");
});

test("a vault-wide replace leaves a git snapshot to undo from", async () => {
  const vault = makeVault({ "A.md": "target here\n" });

  const result = await runCli(vault, "replace", "target", "changed");
  expect(result.code).toBe(0);

  const log = await Bun.spawn(["git", "-C", vault, "log", "--oneline"], { stdout: "pipe" });
  const logOut = await new Response(log.stdout).text();
  await log.exited;
  expect(logOut.trim()).not.toBe("");
});

test("a snapshot failure warns on stderr but the replace still proceeds", async () => {
  const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({ "A.md": "target here\n" });

  // First replace git-inits the vault and commits the pre-replace state, then rewrites A.md —
  // leaving an uncommitted change behind for the NEXT snapshot attempt to actually have to commit.
  const first = await runCli(vault, "replace", "target", "changed1");
  expect(first.code).toBe(0);

  // Install a pre-commit hook that always fails, the way the reviewer reproduced the silent bug.
  const hookDir = join(vault, ".git", "hooks");
  mkdirSync(hookDir, { recursive: true });
  const hookPath = join(hookDir, "pre-commit");
  writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
  chmodSync(hookPath, 0o755);

  const before = await Bun.spawn(["git", "-C", vault, "log", "--oneline"], { stdout: "pipe" });
  const commitsBefore = (await new Response(before.stdout).text()).trim().split("\n").length;

  const result = await runCli(vault, "replace", "changed1", "changed2");
  expect(result.code).toBe(0); // best-effort: the replace still proceeds
  expect(result.err).toContain("warning: snapshot failed");
  expect(await readNote(vault, "A.md")).toContain("changed2"); // the replace itself wasn't blocked

  const after = await Bun.spawn(["git", "-C", vault, "log", "--oneline"], { stdout: "pipe" });
  const commitsAfter = (await new Response(after.stdout).text()).trim().split("\n").length;
  expect(commitsAfter).toBe(commitsBefore); // the failed snapshot really didn't commit anything
});

// --- `daily --id <n>` selects a configured daily-note type by index (note.ts) -----------------

test("`daily --id <n>` selects a configured daily-note type by index; out-of-range fails naming the count", async () => {
  const vault = makeVault({
    ".settings":
      "dailyNotes:\n" +
      '  - id: journal\n    label: Journal\n    icon: BookOpen\n    folder: Journal\n    fileName: "{{date}} journal"\n    template: ""\n' +
      '  - id: work\n    label: Work\n    icon: Briefcase\n    folder: Work\n    fileName: "{{date}} work"\n    template: ""\n',
  });

  // --id 1 picks the SECOND configured type (Work/), not the first (Journal/). A date-derived
  // filename can't be asserted exactly (bun test forces UTC, the spawned CLI uses local time —
  // see the module docstring on the daily-note filename/timezone caveat), so assert on the
  // stable part: which folder the path landed under.
  const second = await runCli(vault, "daily", "--id", "1");
  expect(second.code).toBe(0);
  expect(second.json.path.startsWith("Work/")).toBe(true);

  // Out of range fails, naming how many types the vault configures.
  const outOfRange = await runCli(vault, "daily", "--id", "5");
  expect(outOfRange.code).toBe(1);
  expect(outOfRange.err).toContain("2");
});

test("`daily --id <n>` against a vault with `dailyNotes: []` (explicit empty): --id 0 falls back to the built-in default, --id 1 fails naming 0 configured types", async () => {
  const vault = makeVault({ ".settings": "dailyNotes: []\n" });

  const zero = await runCli(vault, "daily", "--id", "0");
  expect(zero.code).toBe(0);
  // The built-in default is { folder: "", fileName: "{{date}}" } → a root-level "<date>.md", no
  // folder prefix. Exact date not asserted (bun test forces UTC; the spawned CLI uses local
  // time — see the earlier daily-note test's note on that mismatch).
  expect(zero.json.path).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);

  const outOfRange = await runCli(vault, "daily", "--id", "1");
  expect(outOfRange.code).toBe(1);
  expect(outOfRange.err).toContain("0 daily-note type");
});

// --- `task toggle --status <char>` sets an explicit status instead of the binary toggle -------

test("`task toggle --status <char>` sets an explicit status char; without it, the binary toggle is unchanged", async () => {
  const vault = makeVault({ "Todo.md": "- [ ] buy milk\n" });
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "task", "toggle", "Todo.md", "1", "--status", "/");
  expect(result.code).toBe(0);
  expect(await readNote(vault, "Todo.md")).toContain("- [/] buy milk");
});

test("`task toggle --status <multi-char>` is rejected", async () => {
  const vault = makeVault({ "Todo.md": "- [ ] buy milk\n" });
  const result = await runCli(vault, "task", "toggle", "Todo.md", "1", "--status", "ab");
  expect(result.code).toBe(1);
  expect(result.err).toContain("--status");
});

test("`task toggle --status <newline>` is rejected — a control char would silently corrupt the file", async () => {
  const vault = makeVault({ "Todo.md": "- [ ] buy milk\n" });
  const { readNote } = await import("../../core/src/files");
  const before = await readNote(vault, "Todo.md");

  const result = await runCli(vault, "task", "toggle", "Todo.md", "1", "--status", "\n");
  expect(result.code).toBe(1);
  expect(result.err).toContain("--status");
  expect(await readNote(vault, "Todo.md")).toBe(before); // the file must be untouched, not half-written
});

test("`task toggle --status <tab>` still round-trips (tab isn't destructive — TASK_LINE's `.` matches it)", async () => {
  const vault = makeVault({ "Todo.md": "- [ ] buy milk\n" });
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "task", "toggle", "Todo.md", "1", "--status", "\t");
  expect(result.code).toBe(0);
  expect(await readNote(vault, "Todo.md")).toContain("- [\t] buy milk");
});

// --- `render --theme` / `export --theme` (draw.ts / export.ts) --------------------------------

test("`render --theme light` produces bytes that differ from the default dark theme", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { emptyDoc } = await import("../../core/src/drawing/model");
  const dir = mkdtempSync(join(tmpdir(), "bismuth-draw-render-"));
  const drawPath = join(dir, "Sketch.draw");
  writeFileSync(drawPath, JSON.stringify(emptyDoc()));
  const darkOut = join(dir, "dark.png");
  const lightOut = join(dir, "light.png");

  const dark = Bun.spawn(["bun", "run", "cli/src/index.ts", "render", drawPath, "--out", darkOut], { stdout: "pipe", stderr: "pipe" });
  expect((await dark.exited)).toBe(0);
  const light = Bun.spawn(["bun", "run", "cli/src/index.ts", "render", drawPath, "--out", lightOut, "--theme", "light"], { stdout: "pipe", stderr: "pipe" });
  expect((await light.exited)).toBe(0);

  expect(Buffer.compare(readFileSync(darkOut), readFileSync(lightOut))).not.toBe(0);
});

test("`render --theme purple` is rejected", async () => {
  const { writeFileSync } = await import("node:fs");
  const { emptyDoc } = await import("../../core/src/drawing/model");
  const dir = mkdtempSync(join(tmpdir(), "bismuth-draw-render-bad-"));
  const drawPath = join(dir, "Sketch.draw");
  writeFileSync(drawPath, JSON.stringify(emptyDoc()));

  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "render", drawPath, "--theme", "purple"], { stdout: "pipe", stderr: "pipe" });
  const [, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("--theme");
});

test("`export <file.draw> --theme light` produces bytes that differ from the default dark theme", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { emptyDoc } = await import("../../core/src/drawing/model");
  const dir = mkdtempSync(join(tmpdir(), "bismuth-draw-export-"));
  const drawPath = join(dir, "Sketch.draw");
  writeFileSync(drawPath, JSON.stringify(emptyDoc()));
  const darkOut = join(dir, "dark.png");
  const lightOut = join(dir, "light.png");

  const dark = Bun.spawn(["bun", "run", "cli/src/index.ts", "export", drawPath, "--out", darkOut], { stdout: "pipe", stderr: "pipe" });
  expect((await dark.exited)).toBe(0);
  const light = Bun.spawn(["bun", "run", "cli/src/index.ts", "export", drawPath, "--out", lightOut, "--theme", "light"], { stdout: "pipe", stderr: "pipe" });
  expect((await light.exited)).toBe(0);

  expect(Buffer.compare(readFileSync(darkOut), readFileSync(lightOut))).not.toBe(0);
});

// --- `note new` applies the vault's configured default template (note.ts) ---------------------

test("`note new` applies the vault's configured default template when --template is omitted", async () => {
  const vault = makeVault({
    ".settings": "templates:\n  folder: Templates\n  newNote: Templates/Default.md\n",
    "Templates/Default.md": "# {{title}}\n\nDefault body.\n",
  });
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "note", "new", "Quick.md");
  expect(result.code).toBe(0);
  expect(await readNote(vault, "Quick.md")).toBe("# Quick\n\nDefault body.\n");
});

test("`note new --no-template` skips the vault's configured default template", async () => {
  const vault = makeVault({
    ".settings": "templates:\n  folder: Templates\n  newNote: Templates/Default.md\n",
    "Templates/Default.md": "# {{title}}\n\nDefault body.\n",
  });
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "note", "new", "Quick.md", "--no-template");
  expect(result.code).toBe(0);
  expect(await readNote(vault, "Quick.md")).toBe("");
});

// --- `base create` (base.ts) -------------------------------------------------------------------

test("`base create --view kanban --group-by ...` writes a file that parses back with the kanban view + defaults", async () => {
  const vault = makeVault({});
  const { parseBaseFile } = await import("../../core/src/bases/parse");
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "base", "create", "Board.md", "--view", "kanban", "--group-by", "note.status");
  expect(result.code).toBe(0);
  expect(result.json).toMatchObject({ ok: true, path: "Board.md", view: "kanban", source: "notes", title: "Board" });
  expect(result.json.missing).toBeUndefined(); // groupBy was supplied — nothing left to fill in

  const text = await readNote(vault, "Board.md");
  const { config } = parseBaseFile(text, { name: "Board", path: "Board.md" });
  expect(config.views).toHaveLength(1);
  expect(config.views[0].type).toBe("kanban");
  expect(config.views[0].groupBy).toEqual({ property: "note.status", direction: "ASC" });
  expect(config.source).toEqual({ kind: "notes" }); // --source omitted -> defaults to "notes"
});

test("`base create --view gantt` (not a real view kind) fails and names the valid kinds", async () => {
  const vault = makeVault({});
  const { VIEW_TYPES } = await import("../../core/src/bases/types");

  const result = await runCli(vault, "base", "create", "Board.md", "--view", "gantt");
  expect(result.code).toBe(1);
  for (const kind of VIEW_TYPES) expect(result.err).toContain(kind);
});

test("`base create --view kanban` without --group-by still writes the file, but reports the missing key", async () => {
  const vault = makeVault({});
  const { parseBaseFile } = await import("../../core/src/bases/parse");
  const { readNote } = await import("../../core/src/files");

  const result = await runCli(vault, "base", "create", "Board.md", "--view", "kanban");
  expect(result.code).toBe(0);
  expect(result.json.missing).toEqual(["groupBy"]);
  expect(result.json.note).toContain("groupBy");

  // The view still parses — groupBy is present with a blank property, not omitted entirely
  // (an omitted groupBy would make the board silently render a hint message instead of data).
  const text = await readNote(vault, "Board.md");
  const { config } = parseBaseFile(text, { name: "Board", path: "Board.md" });
  expect(config.views[0].groupBy).toEqual({ property: "", direction: "ASC" });
});

test("`base create` reports missing config for map (lat/lng) and chart (x) views too, cleared once supplied", async () => {
  const vault = makeVault({});

  const map = await runCli(vault, "base", "create", "Atlas.md", "--view", "map");
  expect(map.code).toBe(0);
  expect(map.json.missing).toEqual(["lat", "lng"]);

  const bar = await runCli(vault, "base", "create", "Chart.md", "--view", "bar");
  expect(bar.code).toBe(0);
  expect(bar.json.missing).toEqual(["x"]);

  const mapFilled = await runCli(vault, "base", "create", "Atlas2.md", "--view", "map", "--lat", "latitude", "--lng", "longitude");
  expect(mapFilled.code).toBe(0);
  expect(mapFilled.json.missing).toBeUndefined();
});

test("`base create` refuses to clobber an existing file", async () => {
  const vault = makeVault({});
  expect((await runCli(vault, "base", "create", "Board.md", "--view", "table")).code).toBe(0);
  expect((await runCli(vault, "base", "create", "Board.md", "--view", "table")).code).toBe(1);
});

// --- `base validate` (base.ts) -------------------------------------------------------------------

test("`base validate` on a base with an unknown view type reports it AND exits non-zero", async () => {
  const vault = makeVault({
    "Bad.md": "---\ntype: base\nviews:\n  - type: gantt\n    name: Bad\n---\n",
  });
  const result = await runCli(vault, "base", "validate", "Bad.md");
  expect(result.code).toBe(1);
  expect(result.json.ok).toBe(false);
  expect(result.json.errors.some((e: string) => e.includes("gantt"))).toBe(true);
  expect(result.json.errors.some((e: string) => e.includes("not a valid view type"))).toBe(true);
});

test("`base validate` on a well-formed base returns ok: true, exit 0", async () => {
  const vault = makeVault({
    "Good.md": "---\ntype: base\nsource: notes\nviews:\n  - type: table\n    name: Table\n---\n",
  });
  const result = await runCli(vault, "base", "validate", "Good.md");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ ok: true, errors: [] });
});

test("`base validate` flags a declared property default that fails its own type", async () => {
  const vault = makeVault({
    "Typed.md":
      "---\ntype: base\nproperties:\n  - name: age\n    type: number\n    default: not-a-number\nviews:\n  - type: table\n    name: Table\n---\n",
  });
  const result = await runCli(vault, "base", "validate", "Typed.md");
  expect(result.code).toBe(1);
  expect(result.json.ok).toBe(false);
  expect(result.json.errors.some((e: string) => e.includes("properties.age.default"))).toBe(true);
});

test("`base validate` flags a source ref that doesn't resolve to a file in the vault", async () => {
  const vault = makeVault({
    "Composed.md": "---\ntype: base\nsource:\n  kind: base\n  ref: '[[Nonexistent]]'\nviews:\n  - type: table\n    name: Table\n---\n",
  });
  const result = await runCli(vault, "base", "validate", "Composed.md");
  expect(result.code).toBe(1);
  expect(result.json.ok).toBe(false);
  expect(result.json.errors.some((e: string) => e.includes("Nonexistent"))).toBe(true);
});

// --- `base render` (base.ts) ---------------------------------------------------------------------

test("`base render` on a kanban base returns GROUPED output, not raw rows", async () => {
  const vault = makeVault({
    "Board.md":
      "---\ntype: base\nsource: notes where status\nviews:\n  - type: kanban\n    name: Board\n    groupBy: { property: note.status }\n---\n",
    "Task1.md": "---\nstatus: todo\n---\nfirst\n",
    "Task2.md": "---\nstatus: done\n---\nsecond\n",
    "Task3.md": "---\nstatus: todo\n---\nthird\n",
  });
  const result = await runCli(vault, "base", "render", "Board.md");
  expect(result.code).toBe(0);
  expect(Array.isArray(result.json.groups)).toBe(true);
  const keys = result.json.groups.map((g: any) => g.key).sort();
  expect(keys).toEqual(["done", "todo"]);
  const todoGroup = result.json.groups.find((g: any) => g.key === "todo");
  expect(todoGroup.rows).toHaveLength(2);
});

test("`base render` on a stat base returns a computed aggregate, not the row list", async () => {
  const vault = makeVault({
    "Chart.md": "---\ntype: base\nsource: notes where amount\nviews:\n  - type: stat\n    name: Stat\n    x: category\n---\n",
    "Sale1.md": "---\ncategory: A\namount: 10\n---\n",
    "Sale2.md": "---\ncategory: A\namount: 20\n---\n",
    "Sale3.md": "---\ncategory: B\namount: 5\n---\n",
  });
  const result = await runCli(vault, "base", "render", "Chart.md");
  expect(result.code).toBe(0);
  expect(result.json.groups).toBeUndefined(); // aggregate series, not raw grouped rows
  expect(Array.isArray(result.json.chart.points)).toBe(true);
  const byKey = Object.fromEntries(result.json.chart.points.map((p: any) => [p.key, p.value]));
  expect(byKey.A).toBe(30); // sum of the two "A" rows' amount
  expect(byKey.B).toBe(5);
});

test("`base render --view <n>` picks a non-default view", async () => {
  const vault = makeVault({
    "Multi.md":
      "---\ntype: base\nsource: notes\nviews:\n  - type: table\n    name: Table\n  - type: list\n    name: List\n---\n",
  });
  const result = await runCli(vault, "base", "render", "Multi.md", "--view", "1");
  expect(result.code).toBe(0);
  expect(result.json.view.type).toBe("list");
});

// --- `daemon stop` / `daemon restart` (daemon.ts) — wiring to the platform module ---------------
// unloadDaemon/restartDaemon drive REAL launchctl/systemctl, so a round-trip isn't testable in
// CI (and must never run against this machine's real daemon — see the hard constraint in the
// task brief). These assert the WIRING instead: the command calls the platform function with the
// right args, forwards its result through `out()`, and exits non-zero when `ok` is false.
//
// The platform module is mocked BEFORE daemon.ts is ever imported in this process, so
// daemonConfigPath/unloadDaemon/restartDaemon are stubbed and any real spawnSync of
// launchctl/systemctl is never invoked here. Each test reconfigures `platformMock`'s fields
// rather than re-registering the mock, since mock.module's replacement module object is shared
// (live ES-module bindings) across every already-resolved import of the specifier. The
// replacement spreads the REAL module's other exports (notify, planEnsureInstalled, …) first —
// mock.module swaps the module out for every consumer process-wide (not just this file), so a
// bare `{ daemonConfigPath, unloadDaemon, restartDaemon }` would erase those exports for any
// daemon-workspace test that imports platform.ts later in the same `bun test` run.
const realPlatform = await import("../../daemon/src/lib/platform");
const platformMock: {
  configPath: string;
  unload: (configPath: string) => { ok: boolean; error?: string };
  restart: () => { ok: boolean; error?: string };
} = {
  configPath: "/fake/.bismuth-test/config.plist",
  unload: () => ({ ok: true }),
  restart: () => ({ ok: true }),
};
mock.module("../../daemon/src/lib/platform", () => ({
  ...realPlatform,
  daemonConfigPath: () => platformMock.configPath,
  unloadDaemon: (configPath: string) => platformMock.unload(configPath),
  restartDaemon: () => platformMock.restart(),
}));
const { commands: daemonCommands } = await import("../src/commands/daemon");

/** Capture console.log output AND process.exit's code around `fn()`, restoring both afterward.
 *  process.exit is stubbed to record the code and abort via throw (a real exit would kill the
 *  test runner) — that throw is swallowed here so callers get a plain `{ logs, code }` back
 *  whether or not `fn()`'s command called process.exit. A single combined helper (rather than
 *  nesting a logs-capture inside an exit-capture) matters: if `fn()` throws to unwind the stubbed
 *  exit, an *outer* capture's `return` after `await fn()` never runs, silently discarding
 *  whatever the inner capture collected. */
async function captureLogsAndExit(fn: () => void | Promise<void>): Promise<{ logs: string[]; code: number | undefined }> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalExit = process.exit;
  let code: number | undefined;
  console.log = (s: unknown) => { logs.push(String(s)); };
  process.exit = ((c?: number) => {
    code = c;
    throw new Error("__test_process_exit__");
  }) as never;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__test_process_exit__") throw e;
  } finally {
    console.log = originalLog;
    process.exit = originalExit;
  }
  return { logs, code };
}

test("`daemon stop`/`daemon restart` are registered, take no positionals, and accept --pretty", () => {
  expect(daemonCommands["daemon stop"]).toBeDefined();
  expect(daemonCommands["daemon restart"]).toBeDefined();
  expect(daemonCommands["daemon stop"].usage).toBe("[--pretty]");
  expect(daemonCommands["daemon restart"].usage).toBe("[--pretty]");
});

test("`daemon stop` calls unloadDaemon(daemonConfigPath()) and reports {ok:true} on success", async () => {
  let calledWith: string | undefined;
  platformMock.unload = (configPath) => { calledWith = configPath; return { ok: true }; };

  const { logs, code } = await captureLogsAndExit(() => daemonCommands["daemon stop"].run([]));

  expect(calledWith).toBe(platformMock.configPath);
  expect(JSON.parse(logs[0])).toEqual({ ok: true });
  expect(code).toBeUndefined(); // success never calls process.exit
});

test("`daemon stop` exits non-zero and reports {ok:false,error} when unloadDaemon reports failure", async () => {
  platformMock.unload = () => ({ ok: false, error: "launchctl unload failed: boom" });

  const { logs, code } = await captureLogsAndExit(() => daemonCommands["daemon stop"].run([]));

  expect(code).toBe(1);
  expect(JSON.parse(logs[0])).toEqual({ ok: false, error: "launchctl unload failed: boom" });
});

test("`daemon restart` calls restartDaemon() and forwards {ok:true}, exit 0", async () => {
  let restartCalled = false;
  platformMock.restart = () => { restartCalled = true; return { ok: true }; };

  const { logs, code } = await captureLogsAndExit(() => daemonCommands["daemon restart"].run([]));

  expect(restartCalled).toBe(true);
  expect(JSON.parse(logs[0])).toEqual({ ok: true });
  expect(code).toBeUndefined(); // success never calls process.exit
});

test("`daemon restart` exits non-zero when restartDaemon() reports {ok:false,error}", async () => {
  platformMock.restart = () => ({ ok: false, error: "launchctl kickstart failed: boom" });

  const { logs, code } = await captureLogsAndExit(() => daemonCommands["daemon restart"].run([]));

  expect(code).toBe(1);
  expect(JSON.parse(logs[0])).toEqual({ ok: false, error: "launchctl kickstart failed: boom" });
});

test("`daemon restart --pretty` pretty-prints the JSON result (argument parsing works)", async () => {
  platformMock.restart = () => ({ ok: true });

  const { logs } = await captureLogsAndExit(() => daemonCommands["daemon restart"].run(["--pretty"]));

  expect(logs[0]).toBe(JSON.stringify({ ok: true }, null, 2));
});

// --- `update status` / `update apply` (commands/update.ts) — dispatch + route JSON passthrough --

/** Spin up a throwaway HTTP server that records every request and answers GET /update/status /
 *  POST /update/apply with the given payloads. Caller must `stop()` it. */
function mockUpdateServer(replies: { status?: unknown; apply?: unknown } = {}): {
  url: string;
  calls: { method: string; path: string }[];
  stop: () => void;
} {
  const calls: { method: string; path: string }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const { pathname } = new URL(req.url);
      calls.push({ method: req.method, path: pathname });
      if (req.method === "GET" && pathname === "/update/status") {
        return new Response(JSON.stringify(replies.status ?? { available: false, behind: 0 }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "POST" && pathname === "/update/apply") {
        return new Response(JSON.stringify(replies.apply ?? { phase: "idle" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, calls, stop: () => server.stop(true) };
}

test("`bismuth update status` GETs /update/status and prints the route's JSON", async () => {
  const mockSrv = mockUpdateServer({
    status: { available: true, behind: 3, localSha: "abc123", remoteSha: "def456", builtSha: "abc123", dirty: false },
  });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "update", "status", "--api", mockSrv.url], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls).toEqual([{ method: "GET", path: "/update/status" }]);
    expect(JSON.parse(outText)).toEqual({
      available: true,
      behind: 3,
      localSha: "abc123",
      remoteSha: "def456",
      builtSha: "abc123",
      dirty: false,
    });
  } finally {
    mockSrv.stop();
  }
});

test("`bismuth update apply` POSTs /update/apply and prints the route's JSON", async () => {
  const mockSrv = mockUpdateServer({ apply: { phase: "pulling", message: "pulling latest…" } });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "update", "apply", "--api", mockSrv.url], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls).toEqual([{ method: "POST", path: "/update/apply" }]);
    expect(JSON.parse(outText)).toEqual({ phase: "pulling", message: "pulling latest…" });
  } finally {
    mockSrv.stop();
  }
});

test("`bismuth update status` fails cleanly (no crash) when no server is running", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "update", "status", "--api", "http://localhost:59998"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
});

// --- `gcal targets` / `gcal health` (commands/gcal.ts) — headless, no server needed ------------
// Both had NO caller reachable from the CLI/an agent before this: `listGcalSyncTargets` was only
// called by the internal 60s auto-sync ticker; `readManifest`/`baseSyncOf` read a file OUTSIDE
// the vault that no vault-scoped command could reach either.

test("`gcal targets` lists calendar bases with Google sync enabled — ignores sync-off bases and non-base notes", async () => {
  const vault = makeVault({
    "Work.md": "---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: true\n    googleCalendarId: work-cal\ncategories: []\n---\n",
    "Off.md": "---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: false\ncategories: []\n---\n",
    "Note.md": "# Just a note, not a base\n",
  });
  const result = await runCli(vault, "gcal", "targets");
  expect(result.code).toBe(0);
  expect(result.json).toEqual([{ basePath: "Work.md", calendarId: "work-cal" }]);
});

test("`gcal health` reads the manifest at BISMUTH_GCAL_DIR (outside the vault) — per-base and whole-manifest shapes", async () => {
  const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const gcalDir = mkdtempSync(join(tmpdir(), "bismuth-gcal-health-"));
  mkdirSync(gcalDir, { recursive: true });
  writeFileSync(
    join(gcalDir, "sync.json"),
    JSON.stringify({
      bases: {
        "Work.md": {
          lastSyncAt: "2026-01-01T00:00:00.000Z",
          syncToken: "tok1",
          calendarId: "work-cal",
          links: { ev1: { bismuthId: "b1" }, ev2: { bismuthId: "b2" } },
        },
        "Home.md": { calendarId: "home-cal", links: {} },
      },
    }),
  );
  try {
    const all = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "health"], {
      stdout: "pipe",
      env: { ...process.env, BISMUTH_GCAL_DIR: gcalDir },
    });
    const allOut = await new Response(all.stdout).text();
    expect(await all.exited).toBe(0);
    const parsed = JSON.parse(allOut);
    expect(parsed).toContainEqual({ basePath: "Work.md", calendarId: "work-cal", lastSyncAt: "2026-01-01T00:00:00.000Z", linkedEvents: 2, hasSyncToken: true });
    expect(parsed).toContainEqual({ basePath: "Home.md", calendarId: "home-cal", linkedEvents: 0, hasSyncToken: false }); // no lastSyncAt key — never synced

    const single = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "health", "Work.md"], {
      stdout: "pipe",
      env: { ...process.env, BISMUTH_GCAL_DIR: gcalDir },
    });
    const singleOut = await new Response(single.stdout).text();
    expect(await single.exited).toBe(0);
    expect(JSON.parse(singleOut)).toEqual({ basePath: "Work.md", calendarId: "work-cal", lastSyncAt: "2026-01-01T00:00:00.000Z", linkedEvents: 2, hasSyncToken: true });
  } finally {
    rmSync(gcalDir, { recursive: true, force: true });
  }
});

// --- `gcal status/connect/sync/disconnect` (commands/gcal.ts) — server-backed, fake server ------
// Per the hard constraint (never touch the user's real Google account), these hit a throwaway
// in-test HTTP server that mimics the real `/gcal/*` route contracts, never core/src/gcal/index.ts
// itself — proving the CLI's dispatch/argument-building/output-passthrough, not live OAuth/sync.

function mockGcalServer(replies: { status?: unknown; authStart?: unknown; sync?: unknown } = {}): {
  url: string;
  calls: { method: string; path: string; body: unknown }[];
  stop: () => void;
} {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const { pathname } = new URL(req.url);
      let body: unknown;
      if (req.method !== "GET") {
        try {
          body = await req.json();
        } catch {
          body = undefined;
        }
      }
      calls.push({ method: req.method, path: pathname, body });
      if (req.method === "GET" && pathname === "/gcal/status") return Response.json(replies.status ?? { connected: false, needsCredentials: true });
      if (req.method === "POST" && pathname === "/gcal/credentials") return Response.json({ ok: true });
      if (req.method === "POST" && pathname === "/gcal/auth/start") return Response.json(replies.authStart ?? { url: "https://accounts.google.com/o/oauth2/v2/auth?fake=1" });
      if (req.method === "POST" && pathname === "/gcal/sync") {
        return Response.json(
          replies.sync ?? { total: 0, pulledNew: 0, pulledUpdate: 0, pushedNew: 0, pushedUpdate: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, skipped: 0, failed: 0, relinked: 0 },
        );
      }
      if (req.method === "POST" && pathname === "/gcal/disconnect") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, calls, stop: () => server.stop(true) };
}

test("`gcal status` GETs /gcal/status and prints the route's JSON", async () => {
  const mockSrv = mockGcalServer({ status: { connected: true, needsCredentials: false, account: "me@example.com", timeZone: "UTC", connectedAt: "2026-01-01T00:00:00Z" } });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "status", "--api", mockSrv.url], { stdout: "pipe", stderr: "pipe" });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls).toEqual([{ method: "GET", path: "/gcal/status", body: undefined }]);
    expect(JSON.parse(outText)).toEqual({ connected: true, needsCredentials: false, account: "me@example.com", timeZone: "UTC", connectedAt: "2026-01-01T00:00:00Z" });
  } finally {
    mockSrv.stop();
  }
});

test("`gcal connect --client-id --client-secret` POSTs credentials then auth/start, prints the consent URL + a browser note (never claims the flow completed)", async () => {
  const mockSrv = mockGcalServer({ authStart: { url: "https://accounts.google.com/fake-consent" } });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "gcal", "connect", "--client-id", "cid", "--client-secret", "csecret", "--api", mockSrv.url],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls.map((c) => ({ method: c.method, path: c.path }))).toEqual([
      { method: "POST", path: "/gcal/credentials" },
      { method: "POST", path: "/gcal/auth/start" },
    ]);
    expect(mockSrv.calls[0].body).toEqual({ clientId: "cid", clientSecret: "csecret" });
    const parsed = JSON.parse(outText);
    expect(parsed.url).toBe("https://accounts.google.com/fake-consent");
    expect(String(parsed.note).toLowerCase()).toContain("browser"); // must say a PERSON finishes this, never imply it already did
  } finally {
    mockSrv.stop();
  }
});

test("`gcal connect --client-id` without --client-secret fails before ever reaching the network", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "connect", "--client-id", "cid", "--api", "http://localhost:59999"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("usage: gcal connect");
});

test("`gcal sync <basePath>` POSTs {basePath} to /gcal/sync and prints the SyncResult", async () => {
  const mockSrv = mockGcalServer({ sync: { total: 3, pulledNew: 1, pulledUpdate: 0, pushedNew: 2, pushedUpdate: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 1, skipped: 0, failed: 0, relinked: 0 } });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "sync", "Bases/Team.md", "--api", mockSrv.url], { stdout: "pipe", stderr: "pipe" });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls).toHaveLength(1);
    expect(mockSrv.calls[0]).toMatchObject({ method: "POST", path: "/gcal/sync", body: { basePath: "Bases/Team.md" } });
    expect(JSON.parse(outText).conflicts).toBe(1);
  } finally {
    mockSrv.stop();
  }
});

test("`gcal sync` without <basePath> fails before ever reaching the network", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "sync", "--api", "http://localhost:59999"], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("usage: gcal sync");
});

test("`gcal disconnect` POSTs /gcal/disconnect and prints {ok:true}", async () => {
  const mockSrv = mockGcalServer();
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "disconnect", "--api", mockSrv.url], { stdout: "pipe", stderr: "pipe" });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(mockSrv.calls).toEqual([{ method: "POST", path: "/gcal/disconnect", body: undefined }]);
    expect(JSON.parse(outText)).toEqual({ ok: true });
  } finally {
    mockSrv.stop();
  }
});

test("`gcal status` fails cleanly (no crash) when no server is running", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "gcal", "status", "--api", "http://localhost:59997"], { stdout: "pipe", stderr: "pipe" });
  const [, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
});

// --- `relay list` (commands/relay.ts) — contract test against a FAKE server -------------------
// core/src/relay.ts's `snapshot()` had ZERO callers before this command. IMPORTANT, stated here
// too (not just in the source header): core/src/server.ts does not expose `GET /relay/snapshot`
// yet, so this command will fail with a normal 404 against a REAL running `bismuth serve`/app
// today. This test proves the CLI's own dispatch/URL/passthrough logic is correct against the
// intended contract — it is not a claim that the real server currently serves this route.

test("`relay list` GETs /relay/snapshot and passes the route's JSON straight through", async () => {
  const calls: { method: string; path: string }[] = [];
  const snapshot = {
    sessions: [{ sessionId: "s1", terminalId: "t1", cwd: "/vault", backend: "claude", lastSeen: 1000 }],
    subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "general-purpose", startedAt: 900, done: false }],
  };
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const { pathname } = new URL(req.url);
      calls.push({ method: req.method, path: pathname });
      if (req.method === "GET" && pathname === "/relay/snapshot") return Response.json(snapshot);
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "relay", "list", "--api", `http://localhost:${server.port}`], { stdout: "pipe", stderr: "pipe" });
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(calls).toEqual([{ method: "GET", path: "/relay/snapshot" }]);
    expect(JSON.parse(outText)).toEqual(snapshot);
  } finally {
    server.stop(true);
  }
});

test("`relay list` fails cleanly (no crash) when no server is running", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "relay", "list", "--api", "http://localhost:59996"], { stdout: "pipe", stderr: "pipe" });
  const [, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
});

// --- `chat` group (commands/chat.ts) — owner-token attach (http.ts) + route contracts + the ----
// --- mandatory proof that a restricted agent channel still can't reach it -----------------------
// `chat` wraps three owner-gated server routes (GET /chat/sessions, GET /chat/session-messages,
// POST /chat/search) that were completely unreachable from any CLI invocation before this task:
// cli/src/http.ts's call() never sent X-Bismuth-Token, so every CLI request looked like a
// non-owner request no matter who ran it. Covered below: (1) http.ts's token attach/omit logic
// directly, (2) each chat subcommand's dispatch against a fake server, and (3) — the mandatory
// security assertion — that a RESTRICTED agent channel is refused before ever reaching the
// network, so the CLI's new owner identity stays confined to the owner's own hand.

test("http.ts call() attaches X-Bismuth-Token when the run registry has a token for the target port", async () => {
  const { call } = await import("../src/http");
  const { writeRunRecord } = await import("../../core/src/runRegistry");
  const seenTokens: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      seenTokens.push(req.headers.get("x-bismuth-token"));
      return Response.json({ ok: true });
    },
  });
  try {
    writeRunRecord({ port: server.port!, vault: "/v/chat-owner-token-test", pid: process.pid, token: "TEST-OWNER-TOKEN-1" });
    await call(`http://localhost:${server.port}`, "GET", "/whatever");
    expect(seenTokens).toEqual(["TEST-OWNER-TOKEN-1"]);
  } finally {
    server.stop(true);
  }
});

test("http.ts call() sends NO token header when the run record is missing or tokenless — never crashes, never fabricates", async () => {
  const { call } = await import("../src/http");
  const { writeRunRecord } = await import("../../core/src/runRegistry");
  const seenTokens: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      seenTokens.push(req.headers.get("x-bismuth-token"));
      return Response.json({ ok: true });
    },
  });
  try {
    // No run record at all for this port.
    await call(`http://localhost:${server.port}`, "GET", "/whatever");
    // A record exists for this port but carries no token (an older core build, predating the
    // owner-token gate).
    writeRunRecord({ port: server.port!, vault: "/v/chat-tokenless-test", pid: process.pid });
    await call(`http://localhost:${server.port}`, "GET", "/whatever");
    expect(seenTokens).toEqual([null, null]);
  } finally {
    server.stop(true);
  }
});

test("`chat list [--scope]` GETs /chat/sessions and passes the route's JSON straight through", async () => {
  const calls: { method: string; path: string; search: string }[] = [];
  const sessions = [{ sessionId: "s1", summary: "hello", lastModified: 1000, origin: "user" }];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const u = new URL(req.url);
      calls.push({ method: req.method, path: u.pathname, search: u.search });
      if (req.method === "GET" && u.pathname === "/chat/sessions") return Response.json({ sessions });
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "chat", "list", "--scope", "daemon", "--api", `http://localhost:${server.port}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(calls).toEqual([{ method: "GET", path: "/chat/sessions", search: "?scope=daemon" }]);
    expect(JSON.parse(outText)).toEqual({ sessions });
  } finally {
    server.stop(true);
  }
});

test("`chat read <id> [--provider]` GETs /chat/session-messages and passes frames straight through", async () => {
  const frames = [{ type: "assistant-text", text: "hi" }];
  const seen: { path: string; id: string | null; provider: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const u = new URL(req.url);
      seen.push({ path: u.pathname, id: u.searchParams.get("id"), provider: u.searchParams.get("provider") });
      if (req.method === "GET" && u.pathname === "/chat/session-messages") return Response.json({ frames });
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "chat", "read", "sess-1", "--provider", "opencode", "--api", `http://localhost:${server.port}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(seen).toEqual([{ path: "/chat/session-messages", id: "sess-1", provider: "opencode" }]);
    expect(JSON.parse(outText)).toEqual({ frames });
  } finally {
    server.stop(true);
  }
});

test("`chat read` (missing id) fails before ever reaching the network", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "chat", "read", "--api", "http://localhost:59995"], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
  expect(err).toContain("usage: bismuth chat read");
});

test("`chat search <query> [--scope]` POSTs /chat/search with {query, scope} and passes hits straight through", async () => {
  const calls: any[] = [];
  const hits = [{ sessionId: "s1", summary: "hi", lastModified: 1000, origin: "user", snippet: "…hello…" }];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      if (req.method === "POST" && u.pathname === "/chat/search") {
        calls.push(await req.json());
        return Response.json({ hits });
      }
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "chat", "search", "hello", "--scope", "all", "--api", `http://localhost:${server.port}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(0);
    expect(calls).toEqual([{ query: "hello", scope: "all" }]);
    expect(JSON.parse(outText)).toEqual({ hits });
  } finally {
    server.stop(true);
  }
});

test("`chat list` fails cleanly (no crash) when no server is running", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "chat", "list", "--api", "http://localhost:59994"], { stdout: "pipe", stderr: "pipe" });
  const [, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(1);
});

// SECURITY (MANDATORY per this task's brief): a RESTRICTED agent channel must refuse `chat`
// before it ever reaches the network — otherwise the CLI's new owner-token identity would leak
// past chat transcripts to exactly the caller the owner-token gate exists to keep them from. The
// fake server below would happily serve a session containing a seeded secret string if the CLI
// ever called it; asserting on RAW STDOUT (not just exit code) proves the secret never reached
// the process's own output, and asserting zero server calls proves the gate fired BEFORE any
// network attempt — not that the server merely declined to answer.
test("SECURITY: a RESTRICTED agent channel refuses `chat list` before ever reaching the network — the seeded transcript never appears in stdout", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nirrelevant body\n" });
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      calls.push(new URL(req.url).pathname);
      return Response.json({ sessions: [{ sessionId: "s1", summary: "SEEDED-TRANSCRIPT-SECRET-99" }] });
    },
  });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "chat", "list", "--vault", vault, "--api", `http://localhost:${server.port}`],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, BISMUTH_AGENT_CHANNEL: "daemon" } },
    );
    const [outText, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(1);
    expect(err).toContain("chat");
    expect(outText).not.toContain("SEEDED-TRANSCRIPT-SECRET-99");
    expect(calls).toHaveLength(0); // the gate refused before ever touching the network
  } finally {
    server.stop(true);
  }
});

// Same restricted vault, same command — the owner's own hand (BISMUTH_AGENT_CHANNEL unset) is
// NOT refused. Only the channel differs, proving the block above is about identity, not the vault.
test("the SAME restricted vault does NOT refuse `chat list` for the owner (BISMUTH_AGENT_CHANNEL unset)", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nirrelevant body\n" });
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ sessions: [] }),
  });
  try {
    const proc = Bun.spawn(
      ["bun", "run", "cli/src/index.ts", "chat", "list", "--vault", vault, "--api", `http://localhost:${server.port}`],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined } },
    );
    const code = await proc.exited;
    expect(code).toBe(0);
  } finally {
    server.stop(true);
  }
});

// --- `task archive` (commands/task.ts) — mirrors POST /tasks/archive, headlessly ----------------

test("`task archive <file>` removes only resolved (done/cancelled) tasks from that note; open/in-progress tasks + other files stay", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({
    "Todo.md": "- [ ] open task\n- [x] done task\n- [-] cancelled task\n- [/] in progress\n",
    "Other.md": "- [x] should stay (different file)\n",
  });
  const result = await runCli(vault, "task", "archive", "Todo.md");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ removed: 2, files: 1 });
  const after = await readNote(vault, "Todo.md");
  expect(after).toContain("open task");
  expect(after).toContain("in progress");
  expect(after).not.toContain("done task");
  expect(after).not.toContain("cancelled task");
  expect(await readNote(vault, "Other.md")).toContain("should stay"); // untouched — no <file> given, but this call was scoped
});

test("`task archive` (no file) sweeps the whole vault and reports files touched", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({
    "A.md": "- [x] done in A\n- [ ] open in A\n",
    "B.md": "- [-] cancelled in B\n",
    "C.md": "- [ ] nothing resolved here\n",
  });
  const result = await runCli(vault, "task", "archive");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ removed: 2, files: 2 });
  expect(await readNote(vault, "A.md")).not.toContain("done in A");
  expect(await readNote(vault, "A.md")).toContain("open in A");
  expect(await readNote(vault, "B.md")).not.toContain("cancelled in B");
  expect(await readNote(vault, "C.md")).toContain("nothing resolved here"); // untouched — nothing resolved
});

test("`task archive <file>` with nothing to archive reports {removed:0, files:0} and doesn't touch the file", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({ "Clean.md": "- [ ] still open\n" });
  const before = await readNote(vault, "Clean.md");
  const result = await runCli(vault, "task", "archive", "Clean.md");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ removed: 0, files: 0 });
  expect(await readNote(vault, "Clean.md")).toBe(before);
});

// --- `settings deny-list` (commands/settings.ts) — the visibility preflight, gated correctly ---
// MANDATORY per the task brief: a restricted (agent-channel) caller must get a COUNT, never a
// path list — otherwise the command becomes an enumeration oracle for exactly what it exists to
// protect. `settings` is Tier A ("always-safe") in core/src/visibilityCliGate.ts's command
// classification (by its `settings`-prefixed group, unchanged by this task), so the command
// always RUNS even under a restricted vault + agent channel — the count-only behavior below is
// what actually protects it, not the outer gate refusing the command wholesale.

test("`settings deny-list` — the OWNER (BISMUTH_AGENT_CHANNEL unset) gets the full path list", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nsecret body\n", "Public.md": "# public\n" });
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "settings", "deny-list", "--vault", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
  });
  const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(0);
  expect(JSON.parse(outText)).toEqual({ channel: "daemon", determined: true, count: 1, entries: ["Private/secret.md"] });
});

test("`settings deny-list` — a RESTRICTED (agent-channel) caller gets a COUNT ONLY, never a path — mandatory security assertion", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nsecret body\n", "Public.md": "# public\n" });
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "settings", "deny-list", "--vault", vault], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BISMUTH_AGENT_CHANNEL: "daemon" },
  });
  const [outText, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code).toBe(0); // NOT refused wholesale — Tier A runs; the internal count-only branch is the real protection
  expect(JSON.parse(outText)).toEqual({ channel: "daemon", determined: true, count: 1 }); // no `entries` key at all
  expect(outText).not.toContain("secret.md"); // belt-and-suspenders: the path never appears anywhere in the raw output
  expect(outText).not.toContain("Private");
});

test("`settings deny-list --channel chat` vs the default `daemon` channel: a chat-only note is visible to chat but restricted for daemon", async () => {
  const vault = makeVault({ "Draft.md": "---\nvisibility: chat-only\n---\nwork in progress\n" });
  const daemonView = await runCli(vault, "settings", "deny-list"); // default channel = daemon (stricter)
  expect(daemonView.json).toMatchObject({ channel: "daemon", count: 1 });
  const chatView = await runCli(vault, "settings", "deny-list", "--channel", "chat");
  expect(chatView.json).toMatchObject({ channel: "chat", count: 0 });
});

test("`settings deny-list --channel bogus` is rejected before touching the vault", async () => {
  const vault = makeVault({ "Private/secret.md": "---\nvisibility: hidden\n---\nx\n" });
  const result = await runCli(vault, "settings", "deny-list", "--channel", "bogus");
  expect(result.code).toBe(1);
  expect(result.err).toContain("usage: settings deny-list");
});

// --- `calendar` group (cli/src/commands/calendar.ts) — full dispatch-level coverage -------------
// The workflow test above (create → category → add → list/range/search → move → delete) already
// proves the happy path for most commands. These fill the gaps: `day`/`overlaps`/`override`/
// `delete-occurrence`/`category remove` had ZERO coverage before this; every command below is
// checked for (1) exit 0 on a valid call, (2) non-zero + a usable message on a bad call, and
// (3) a REAL observable effect — read back via another CLI call or the file on disk, not just
// "didn't crash". Every fixture is built through the CLI itself (create/add/category add), never
// hand-authored row-table markdown, so these tests don't need to know `bases/rows.ts`'s format.
//
// Dates use 2026 Mondays (2026-01-05/12/19/26 — 2026-01-01 is a Thursday, confirmed by the
// existing `--rrule` workflow test above) so a `FREQ=WEEKLY;BYDAY=MO` series lands on known days.

test("`calendar bases` lists only calendar-view bases (type:base + view:calendar), skipping other bases and notes", async () => {
  const vault = makeVault({
    "Board.md": "---\ntype: base\nview: table\n---\n",
    "Note.md": "# Just a note\n",
  });
  expect((await runCli(vault, "calendar", "create", "Cal.md", "--title", "Cal")).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", "Cal.md", "Work")).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", "Cal.md", "--date", "2026-01-05", "--title", "Standup")).code).toBe(0);

  const result = await runCli(vault, "calendar", "bases");
  expect(result.code).toBe(0);
  expect(result.json).toEqual([{ path: "Cal.md", title: "Cal", events: 1, categories: ["Work"] }]);
});

test("`calendar create <path-without-.md>` appends .md and writes a base the rest of the group can discover", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({});
  const result = await runCli(vault, "calendar", "create", "Bases/NoExt", "--title", "No Ext");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ ok: true, path: "Bases/NoExt.md" });

  expect(await readNote(vault, "Bases/NoExt.md")).toContain("view: calendar");
  const bases = await runCli(vault, "calendar", "bases");
  expect(bases.json).toContainEqual({ path: "Bases/NoExt.md", title: "No Ext", events: 0, categories: [] });
});

test("`calendar list --from/--to` windows RAW stored events by series/instance window (masters unexpanded, not per-occurrence)", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const weekly = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO");
  expect(weekly.code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-06-01", "--title", "Offsite")).code).toBe(0);

  const windowed = await runCli(vault, "calendar", "list", cal, "--from", "2026-01-01", "--to", "2026-01-31");
  expect(windowed.code).toBe(0);
  expect(windowed.json.map((e: any) => e.title)).toEqual(["Standup"]); // one raw master, not four expanded Mondays
});

test("`calendar get <path> <bogus-id>` fails naming the id instead of crashing", async () => {
  const vault = makeVault({});
  expect((await runCli(vault, "calendar", "create", "Cal.md")).code).toBe(0);
  const result = await runCli(vault, "calendar", "get", "Cal.md", "does-not-exist");
  expect(result.code).toBe(1);
  expect(result.err).toContain("does-not-exist");
});

test("`calendar search --from/--to` searches EXPANDED instances of a recurring event; without a window it searches the raw master", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO")).code).toBe(0);

  const windowed = await runCli(vault, "calendar", "search", cal, "standup", "--from", "2026-01-05", "--to", "2026-01-19");
  expect(windowed.code).toBe(0);
  expect(windowed.json.map((e: any) => e.date)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]); // 3 expanded Mondays

  const raw = await runCli(vault, "calendar", "search", cal, "standup");
  expect(raw.code).toBe(0);
  expect(raw.json).toHaveLength(1); // one raw master, no window
});

test("`calendar day <path> <date>` returns that day's concrete instances, including an expanded recurring occurrence", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO")).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-06", "--title", "Dentist")).code).toBe(0);

  const onSeries = await runCli(vault, "calendar", "day", cal, "2026-01-12"); // a later Monday in the series
  expect(onSeries.code).toBe(0);
  expect(onSeries.json.map((e: any) => e.title)).toEqual(["Standup"]);

  const onSingle = await runCli(vault, "calendar", "day", cal, "2026-01-06");
  expect(onSingle.json.map((e: any) => e.title)).toEqual(["Dentist"]);

  const onEmpty = await runCli(vault, "calendar", "day", cal, "2026-01-07");
  expect(onEmpty.code).toBe(0);
  expect(onEmpty.json).toEqual([]);
});

test("`calendar overlaps <path> <date>` detects intersecting timed events on THAT day, ignores a non-overlapping one, and ignores a same-time overlap on a DIFFERENT day", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-06", "--title", "A", "--start", "09:00", "--end", "10:00")).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-06", "--title", "B", "--start", "09:30", "--end", "10:30")).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-06", "--title", "C", "--start", "11:00", "--end", "12:00")).code).toBe(0);
  // Same time-of-day as A/B, but a DIFFERENT date. detectOverlaps() itself is date-blind (it only
  // compares startTime/endTime strings), so this only stays excluded if the command filters to the
  // requested day BEFORE calling it — this is the case a wiring bug (e.g. forgetting that filter)
  // would slip past a same-day-only fixture without ever failing.
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-07", "--title", "D-other-day", "--start", "09:15", "--end", "10:15")).code).toBe(0);

  const result = await runCli(vault, "calendar", "overlaps", cal, "2026-01-06");
  expect(result.code).toBe(0);
  expect(result.json.date).toBe("2026-01-06");
  expect(result.json.overlaps).toHaveLength(1); // only A/B intersect; C starts after both end; D is a different day
  expect([result.json.overlaps[0].a.title, result.json.overlaps[0].b.title].sort()).toEqual(["A", "B"]);
});

test("`calendar add --rrule <unsupported>` fails naming the supported subset, and writes NOTHING", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const result = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "X", "--rrule", "FREQ=YEARLY");
  expect(result.code).toBe(1);
  expect(result.err).toContain("unsupported RRULE");
  expect((await runCli(vault, "calendar", "list", cal)).json).toEqual([]); // rejected before any write happened
});

test("`calendar move` actually applies the given field updates (date/start/end), verified by reading the event back", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const added = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "Dentist", "--start", "09:00", "--end", "10:00");
  expect(added.code).toBe(0);
  const id = added.json.event.id as string;

  const result = await runCli(vault, "calendar", "move", cal, id, "--date", "2026-01-07", "--start", "14:00", "--end", "15:00");
  expect(result.code).toBe(0);
  expect(result.json.event).toMatchObject({ id, date: "2026-01-07", startTime: "14:00", endTime: "15:00" });

  // Re-read from disk through a fresh `get` — proves the write landed, not just the in-process return value.
  const reread = await runCli(vault, "calendar", "get", cal, id);
  expect(reread.json).toMatchObject({ date: "2026-01-07", startTime: "14:00", endTime: "15:00" });
});

test("`calendar move <path> <bogus-id>` fails naming the id and leaves the file unchanged", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "Real")).code).toBe(0);
  const before = await runCli(vault, "calendar", "list", cal);

  const result = await runCli(vault, "calendar", "move", cal, "does-not-exist", "--date", "2026-02-01");
  expect(result.code).toBe(1);
  expect(result.err).toContain("does-not-exist");

  expect((await runCli(vault, "calendar", "list", cal)).json).toEqual(before.json); // untouched by the failed move
});

test("`calendar delete <path> <bogus-id>` fails naming the id and leaves the file unchanged", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "Real")).code).toBe(0);

  const result = await runCli(vault, "calendar", "delete", cal, "does-not-exist");
  expect(result.code).toBe(1);
  expect(result.err).toContain("does-not-exist");

  expect((await runCli(vault, "calendar", "list", cal)).json).toHaveLength(1); // the real event survives
});

test("`calendar override` splits a weekly series and overrides exactly ONE occurrence (verified via `range`)", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const weekly = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO");
  expect(weekly.code).toBe(0);
  const masterId = weekly.json.event.id as string;

  const overrideResult = await runCli(vault, "calendar", "override", cal, masterId, "2026-01-12", "--title", "Standup (offsite)");
  expect(overrideResult.code).toBe(0);
  expect(overrideResult.json).toEqual({ ok: true });

  const range = await runCli(vault, "calendar", "range", cal, "2026-01-05", "2026-01-19");
  expect(range.code).toBe(0);
  const byDate = Object.fromEntries(range.json.map((e: any) => [e.date, e.title]));
  expect(byDate["2026-01-05"]).toBe("Standup"); // untouched — before the split
  expect(byDate["2026-01-12"]).toBe("Standup (offsite)"); // the overridden occurrence
  expect(byDate["2026-01-19"]).toBe("Standup"); // untouched — series resumed after the split

  // Raw storage now holds 3 events: the truncated head segment, the resumed tail segment, and the
  // standalone override — not the 1 master it started as.
  expect((await runCli(vault, "calendar", "list", cal)).json).toHaveLength(3);
});

test("`calendar delete-occurrence` removes exactly ONE occurrence from a weekly series, no replacement (verified via `range`)", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const weekly = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-01", "--title", "Standup", "--rrule", "FREQ=WEEKLY;BYDAY=MO");
  const masterId = weekly.json.event.id as string;

  const result = await runCli(vault, "calendar", "delete-occurrence", cal, masterId, "2026-01-12");
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ ok: true });

  const range = await runCli(vault, "calendar", "range", cal, "2026-01-05", "2026-01-19");
  expect(range.json.map((e: any) => e.date)).toEqual(["2026-01-05", "2026-01-19"]); // Jan 12 gone, nothing put in its place
});

test("`calendar override` and `calendar delete-occurrence` both refuse a NON-recurring event, writing nothing", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const single = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "OneOff");
  const id = single.json.event.id as string;

  const override = await runCli(vault, "calendar", "override", cal, id, "2026-01-05", "--title", "Nope");
  expect(override.code).toBe(1);
  expect(override.err).toContain("not a recurring event");

  const del = await runCli(vault, "calendar", "delete-occurrence", cal, id, "2026-01-05");
  expect(del.code).toBe(1);
  expect(del.err).toContain("not a recurring event");

  expect((await runCli(vault, "calendar", "list", cal)).json).toHaveLength(1); // neither failed call wrote anything
});

test("`calendar category add` a duplicate name fails; categories on disk unchanged", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work", "--color", "#111")).code).toBe(0);

  const dup = await runCli(vault, "calendar", "category", "add", cal, "Work", "--color", "#222");
  expect(dup.code).toBe(1);
  expect(dup.err).toContain("already exists");

  expect((await runCli(vault, "calendar", "categories", cal)).json).toEqual([{ name: "Work", color: "#111" }]);
});

test("`calendar category update` on an unknown category fails, doesn't crash", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  const result = await runCli(vault, "calendar", "category", "update", cal, "Ghost", "--color", "#fff");
  expect(result.code).toBe(1);
  expect(result.err).toContain("no category named Ghost");
});

test("`calendar category update --color` (no --rename) recolors without touching the name or any event's category string", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work", "--color", "#111")).code).toBe(0);
  const added = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "Standup", "--category", "Work");
  const id = added.json.event.id as string;

  const result = await runCli(vault, "calendar", "category", "update", cal, "Work", "--color", "#222");
  expect(result.code).toBe(0);
  expect(result.json.categories).toEqual([{ name: "Work", color: "#222" }]);

  const event = await runCli(vault, "calendar", "get", cal, id);
  expect(event.json.category).toBe("Work"); // no rename happened — the event's category string is untouched
});

test("`calendar category remove` (no --reassign) clears the category off every event referencing it", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work")).code).toBe(0);
  const added = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "One", "--category", "Work");
  const id = added.json.event.id as string;

  const result = await runCli(vault, "calendar", "category", "remove", cal, "Work");
  expect(result.code).toBe(0);
  expect(result.json.categories).toEqual([]);

  const event = await runCli(vault, "calendar", "get", cal, id);
  expect(event.json.category).toBeUndefined();
});

test("`calendar category remove --reassign <other>` reassigns events instead of clearing them", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work")).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Personal")).code).toBe(0);
  const added = await runCli(vault, "calendar", "add", cal, "--date", "2026-01-05", "--title", "One", "--category", "Work");
  const id = added.json.event.id as string;

  const result = await runCli(vault, "calendar", "category", "remove", cal, "Work", "--reassign", "Personal");
  expect(result.code).toBe(0);
  expect(result.json.categories).toEqual([{ name: "Personal", color: "accent" }]);

  const event = await runCli(vault, "calendar", "get", cal, id);
  expect(event.json.category).toBe("Personal");
});

test("`calendar category remove` errors: unknown category, unknown reassign target, and reassigning to itself — none of them write", async () => {
  const vault = makeVault({});
  const cal = "Cal.md";
  expect((await runCli(vault, "calendar", "create", cal)).code).toBe(0);
  expect((await runCli(vault, "calendar", "category", "add", cal, "Work")).code).toBe(0);

  const unknownCat = await runCli(vault, "calendar", "category", "remove", cal, "Ghost");
  expect(unknownCat.code).toBe(1);
  expect(unknownCat.err).toContain("no category named Ghost");

  const unknownReassign = await runCli(vault, "calendar", "category", "remove", cal, "Work", "--reassign", "Ghost");
  expect(unknownReassign.code).toBe(1);
  expect(unknownReassign.err).toContain("Ghost");

  const selfReassign = await runCli(vault, "calendar", "category", "remove", cal, "Work", "--reassign", "Work");
  expect(selfReassign.code).toBe(1);
  expect(selfReassign.err).toContain("cannot reassign");

  expect((await runCli(vault, "calendar", "categories", cal)).json).toEqual([{ name: "Work", color: "accent" }]); // untouched
});

// --- `calendar` group: missing/malformed required-arg validation, table-driven over every ------
// command in the group. Each row fails BEFORE any file I/O (verified above per-command for the
// mutating commands; here the table just confirms every command's OWN required-arg guards fire
// with a message that names what's missing, never a raw stack trace). One shared throwaway vault
// is safe since none of these rows ever reach a read/write.
const calendarArgValidationVault = makeVault({});
const calendarArgValidationCases: { label: string; args: string[]; expect: string }[] = [
  { label: "`calendar create` (no basePath)", args: ["calendar", "create"], expect: "<basePath> required" },
  { label: "`calendar list` (no basePath)", args: ["calendar", "list"], expect: "<basePath> required" },
  { label: "`calendar range` (no basePath)", args: ["calendar", "range"], expect: "<basePath> required" },
  { label: "`calendar range <path>` (missing <from>/<to>)", args: ["calendar", "range", "X.md"], expect: "<from> and <to> (YYYY-MM-DD) required" },
  { label: "`calendar get` (no basePath)", args: ["calendar", "get"], expect: "<basePath> required" },
  { label: "`calendar get <path>` (no id)", args: ["calendar", "get", "X.md"], expect: "<id> required" },
  { label: "`calendar search` (no basePath)", args: ["calendar", "search"], expect: "<basePath> required" },
  { label: "`calendar search <path>` (no text)", args: ["calendar", "search", "X.md"], expect: "<text> required" },
  { label: "`calendar day` (no basePath)", args: ["calendar", "day"], expect: "<basePath> required" },
  { label: "`calendar day <path>` (no date)", args: ["calendar", "day", "X.md"], expect: "<date> (YYYY-MM-DD) required" },
  { label: "`calendar overlaps` (no basePath)", args: ["calendar", "overlaps"], expect: "<basePath> required" },
  { label: "`calendar overlaps <path>` (no date)", args: ["calendar", "overlaps", "X.md"], expect: "<date> (YYYY-MM-DD) required" },
  { label: "`calendar add` (no basePath)", args: ["calendar", "add"], expect: "<basePath> required" },
  { label: "`calendar add <path>` (no --date)", args: ["calendar", "add", "X.md"], expect: "--date (YYYY-MM-DD) required" },
  { label: "`calendar move` (no basePath)", args: ["calendar", "move"], expect: "<basePath> required" },
  { label: "`calendar move <path>` (no id)", args: ["calendar", "move", "X.md"], expect: "<id> required" },
  { label: "`calendar move <path> <id>` (nothing to update)", args: ["calendar", "move", "X.md", "some-id"], expect: "nothing to update" },
  { label: "`calendar delete` (no basePath)", args: ["calendar", "delete"], expect: "<basePath> required" },
  { label: "`calendar delete <path>` (no id)", args: ["calendar", "delete", "X.md"], expect: "<id> required" },
  { label: "`calendar override` (no basePath)", args: ["calendar", "override"], expect: "<basePath> required" },
  { label: "`calendar override <path>` (no id)", args: ["calendar", "override", "X.md"], expect: "<id> (recurring event) required" },
  { label: "`calendar override <path> <id>` (no date)", args: ["calendar", "override", "X.md", "some-id"], expect: "<date> (YYYY-MM-DD occurrence) required" },
  { label: "`calendar delete-occurrence` (no basePath)", args: ["calendar", "delete-occurrence"], expect: "<basePath> required" },
  { label: "`calendar delete-occurrence <path>` (no id)", args: ["calendar", "delete-occurrence", "X.md"], expect: "<id> (recurring event) required" },
  { label: "`calendar delete-occurrence <path> <id>` (no date)", args: ["calendar", "delete-occurrence", "X.md", "some-id"], expect: "<date> (YYYY-MM-DD occurrence) required" },
  { label: "`calendar categories` (no basePath)", args: ["calendar", "categories"], expect: "<basePath> required" },
  { label: "`calendar category add` (no basePath)", args: ["calendar", "category", "add"], expect: "<basePath> required" },
  { label: "`calendar category add <path>` (no name)", args: ["calendar", "category", "add", "X.md"], expect: "<name> required" },
  { label: "`calendar category update` (no basePath)", args: ["calendar", "category", "update"], expect: "<basePath> required" },
  { label: "`calendar category update <path>` (no name)", args: ["calendar", "category", "update", "X.md"], expect: "<name> required" },
  { label: "`calendar category update <path> <name>` (nothing to update)", args: ["calendar", "category", "update", "X.md", "SomeCat"], expect: "nothing to update" },
  { label: "`calendar category remove` (no basePath)", args: ["calendar", "category", "remove"], expect: "<basePath> required" },
  { label: "`calendar category remove <path>` (no name)", args: ["calendar", "category", "remove", "X.md"], expect: "<name> required" },
];

for (const c of calendarArgValidationCases) {
  test(`${c.label} fails non-zero with a usable message`, async () => {
    const result = await runCli(calendarArgValidationVault, ...c.args);
    expect(result.code).toBe(1);
    expect(result.err).toContain(c.expect);
  });
}

// --- `card decks` / `card all` / `card due` / `card note` (commands/card.ts) — real reads --------
// `card review` (the settings.srs wiring) is already covered above. collectDecks/collectCards/
// dueCards/noteCards (core/src/srs/cards.ts) take no config the CLI could drop — compared their
// exported signatures against every call site in card.ts and each is a plain passthrough.

test("`card all`/`card decks`/`card due --deck`/`card note` read real flashcards parsed from tagged notes, skipping untagged ones", async () => {
  const vault = makeVault({
    "Deck.md": "---\ntags: [flashcards/Geo]\n---\n\nQ1::A1\n\nQ2::A2\n",
    "Other.md": "---\ntags: [flashcards]\n---\n\nQ3::A3\n",
    "NotACard.md": "# just a note, no flashcards tag\n",
  });

  const all = await runCli(vault, "card", "all");
  expect(all.code).toBe(0);
  expect(all.json).toHaveLength(3); // NotACard.md contributes nothing
  expect(all.json.map((c: any) => c.deck).sort()).toEqual(["", "Geo", "Geo"]);

  const decks = await runCli(vault, "card", "decks");
  expect(decks.code).toBe(0);
  expect(decks.json).toEqual([
    { name: "", total: 1, due: 1 },
    { name: "Geo", total: 2, due: 2 },
  ]);

  const due = await runCli(vault, "card", "due", "--deck", "Geo");
  expect(due.code).toBe(0);
  expect(due.json.map((c: any) => c.question)).toEqual(["Q1", "Q2"]); // filtered to the Geo deck only

  const note = await runCli(vault, "card", "note", "Deck.md");
  expect(note.code).toBe(0);
  expect(note.json.map((c: any) => c.question)).toEqual(["Q1", "Q2"]);
});

test("`card note` (missing path) fails with a usage message", async () => {
  const vault = makeVault({});
  const result = await runCli(vault, "card", "note");
  expect(result.code).toBe(1);
  expect(result.err).toContain("usage: card note <path>");
});

// --- `checkpoint advance` / `checkpoint ref` (checkpoint.ts) — real git refs, throwaway repos ----
// `checkpoint diff` (+ the visibility gate over it) is already covered above; these are the other
// two commands in the group. Every repo here is a fresh tmpdir from makeVault(), never this repo —
// per the task's hard constraint, `checkpoint` must never touch this repo's own git refs.

/** Spawn `bismuth <args>` with NO forced --vault (checkpoint uses --dir, not --vault). Optional
 *  `env` override for the missing-BISMUTH_VAULT arg-validation case below. */
async function spawnCli(args: string[], env: Record<string, string | undefined> = process.env): Promise<{ code: number | null; out: string; err: string }> {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", ...args], { stdout: "pipe", stderr: "pipe", env });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

test("`checkpoint ref` reports sha:null before any checkpoint (auto-inits the repo, like `checkpoint diff` does); `checkpoint advance` commits pending changes and moves the ref — verified via a FRESH `checkpoint ref` read and the git log", async () => {
  const repo = makeVault({ "note.md": "hello\n" }, "bismuth-checkpoint-advance-");

  const before = await spawnCli(["checkpoint", "ref", "cron-x", "--dir", repo]);
  expect(before.code).toBe(0);
  expect(JSON.parse(before.out)).toEqual({ ref: "cron-x", sha: null });

  const advance = await spawnCli(["checkpoint", "advance", "cron-x", "--dir", repo]);
  expect(advance.code).toBe(0);
  const advanceJson = JSON.parse(advance.out);
  expect(advanceJson.ref).toBe("cron-x");
  expect(advanceJson.head).toBeTruthy();

  const after = await spawnCli(["checkpoint", "ref", "cron-x", "--dir", repo]);
  expect(after.code).toBe(0);
  expect(JSON.parse(after.out).sha).toBe(advanceJson.head); // the ref really moved, verified via a FRESH read

  const log = await Bun.spawn(["git", "-C", repo, "log", "--oneline"], { stdout: "pipe" });
  const commits = (await new Response(log.stdout).text()).trim().split("\n").filter(Boolean);
  expect(commits).toHaveLength(1); // note.md really got committed by advance's default commit-before-op behavior
}, 20_000);

test("`checkpoint advance --no-commit` moves the ref to the CURRENT head without committing pending changes", async () => {
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const repo = makeVault({ "note.md": "hello\n" }, "bismuth-checkpoint-nocommit-");

  // Establish a first real commit via a normal advance, then dirty the tree again.
  const first = await spawnCli(["checkpoint", "advance", "x", "--dir", repo]);
  expect(first.code).toBe(0);
  const firstHead = JSON.parse(first.out).head as string;
  writeFileSync(join(repo, "note.md"), "dirty, uncommitted\n");

  const result = await spawnCli(["checkpoint", "advance", "x", "--dir", repo, "--no-commit"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).head).toBe(firstHead); // HEAD never moved — nothing was committed

  const status = await Bun.spawn(["git", "-C", repo, "status", "--porcelain"], { stdout: "pipe" });
  expect((await new Response(status.stdout).text()).trim()).not.toBe(""); // the dirty change is still uncommitted
});

test("`checkpoint advance`/`checkpoint ref` (no ref) fail with a usage message naming the command; (no --dir/--vault, BISMUTH_VAULT unset) fails naming the missing dir", async () => {
  const repo = makeVault({}, "bismuth-checkpoint-argval-");

  const noRefAdvance = await spawnCli(["checkpoint", "advance", "--dir", repo]);
  expect(noRefAdvance.code).toBe(1);
  expect(noRefAdvance.err).toContain("usage: checkpoint advance");

  const noRefRef = await spawnCli(["checkpoint", "ref", "--dir", repo]);
  expect(noRefRef.code).toBe(1);
  expect(noRefRef.err).toContain("usage: checkpoint ref");

  const noDir = await spawnCli(["checkpoint", "advance", "some-ref"], { ...process.env, BISMUTH_VAULT: undefined });
  expect(noDir.code).toBe(1);
  expect(noDir.err).toContain("no dir");
});

// --- `page resolve` / `page mark-failed` (page.ts) — dispatch + real sidecar effect --------------
// `page create`/`page list` are already covered above. These fill the mutating paths: a
// pure-dismiss action, an approve action (checked via the trigger file the daemon's
// processPageTriggers polls), an unknown action, and the mark-failed escape hatch — including that
// it never clobbers an already-settled page (per daemonPages.ts's own compare-and-swap doc).

test("`page resolve <path> <actionId>` on a pure-dismiss action (no prompt) settles the page to dismissed and writes NO trigger file", async () => {
  const { vault } = await makeSampleVault();
  const create = await runCli(vault, "page", "create", "dismiss-me", "--actions", JSON.stringify([{ id: "ok", label: "OK" }]));
  expect(create.code).toBe(0);
  const path = create.json.path as string;

  const resolve = await runCli(vault, "page", "resolve", path, "ok");
  expect(resolve.code).toBe(0);
  expect(resolve.json).toEqual({ status: "dismissed", alreadyResolved: false });

  const list = await runCli(vault, "page", "list");
  expect(list.json.find((p: any) => p.slug === "dismiss-me").status).toBe("dismissed");

  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  expect(existsSync(join(vault, ".daemon", "pages", ".triggers", "dismiss-me"))).toBe(false);
});

test("`page resolve <path> <actionId>` on an approve action (has a prompt) sets status:working and drops a trigger file for the daemon's processPageTriggers to poll", async () => {
  const { vault } = await makeSampleVault();
  const create = await runCli(
    vault, "page", "create", "approve-me",
    "--actions", JSON.stringify([{ id: "go", label: "Go", prompt: "do the thing" }]),
  );
  const path = create.json.path as string;

  const resolve = await runCli(vault, "page", "resolve", path, "go");
  expect(resolve.code).toBe(0);
  expect(resolve.json).toEqual({ status: "working", alreadyResolved: false });

  const list = await runCli(vault, "page", "list");
  expect(list.json.find((p: any) => p.slug === "approve-me").status).toBe("working");

  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  expect(existsSync(join(vault, ".daemon", "pages", ".triggers", "approve-me"))).toBe(true);
});

test("`page resolve <path> <bogus-action>` fails naming the action; the page's state is left untouched", async () => {
  const { vault } = await makeSampleVault();
  const create = await runCli(vault, "page", "create", "unknown-action", "--actions", JSON.stringify([{ id: "ok", label: "OK" }]));
  const path = create.json.path as string;

  const result = await runCli(vault, "page", "resolve", path, "does-not-exist");
  expect(result.code).toBe(1);
  expect(result.err).toContain("does-not-exist");

  const list = await runCli(vault, "page", "list");
  expect(list.json.find((p: any) => p.slug === "unknown-action").status).toBe("pending"); // untouched
});

test("`page resolve`/`page mark-failed` (missing positionals) fail with a usage message", async () => {
  const { vault } = await makeSampleVault();
  const noPath = await runCli(vault, "page", "resolve");
  expect(noPath.code).toBe(1);
  expect(noPath.err).toContain("usage: bismuth page resolve");

  const noAction = await runCli(vault, "page", "resolve", ".daemon/pages/x.md");
  expect(noAction.code).toBe(1);
  expect(noAction.err).toContain("usage: bismuth page resolve");

  const noMarkFailedPath = await runCli(vault, "page", "mark-failed");
  expect(noMarkFailedPath.code).toBe(1);
  expect(noMarkFailedPath.err).toContain("usage: bismuth page mark-failed");
});

test("`page mark-failed <path>` forces a stuck 'working' page to failed (verified via `page list`), but never re-marks an already-settled (dismissed) page", async () => {
  const { vault } = await makeSampleVault();
  const stuck = await runCli(vault, "page", "create", "stuck", "--actions", JSON.stringify([{ id: "go", label: "Go", prompt: "do it" }]));
  const stuckPath = stuck.json.path as string;
  expect((await runCli(vault, "page", "resolve", stuckPath, "go")).json.status).toBe("working");

  const markFailed = await runCli(vault, "page", "mark-failed", stuckPath);
  expect(markFailed.code).toBe(0);
  expect(markFailed.json).toEqual({ ok: true });

  const list1 = await runCli(vault, "page", "list");
  expect(list1.json.find((p: any) => p.slug === "stuck").status).toBe("failed");

  // Compare-and-swap: an already-dismissed page must never be relabeled "failed" by a late click.
  const dismissed = await runCli(vault, "page", "create", "already-dismissed", "--actions", JSON.stringify([{ id: "ok", label: "OK" }]));
  const dismissedPath = dismissed.json.path as string;
  await runCli(vault, "page", "resolve", dismissedPath, "ok"); // -> dismissed
  const markFailed2 = await runCli(vault, "page", "mark-failed", dismissedPath);
  expect(markFailed2.code).toBe(0);
  const list2 = await runCli(vault, "page", "list");
  expect(list2.json.find((p: any) => p.slug === "already-dismissed").status).toBe("dismissed"); // NOT overwritten
});

// --- `prop set` / `prop delete` (prop.ts) — real frontmatter mutation, read back from disk -------

test("`prop set <file> <key> <value>` JSON-parses the value when possible, else keeps it a raw string — verified by reading the note back from disk", async () => {
  const { readNote } = await import("../../core/src/files");
  const { parseFrontmatter } = await import("../../core/src/frontmatter");
  const vault = makeVault({ "Note.md": "---\ntitle: Before\n---\nbody\n" });

  expect((await runCli(vault, "prop", "set", "Note.md", "priority", "3")).code).toBe(0);
  expect((await runCli(vault, "prop", "set", "Note.md", "done", "true")).code).toBe(0);
  expect((await runCli(vault, "prop", "set", "Note.md", "status", "in progress")).code).toBe(0);

  const { data } = parseFrontmatter(await readNote(vault, "Note.md"));
  expect(data.priority).toBe(3); // valid JSON -> number
  expect(data.done).toBe(true); // valid JSON -> boolean
  expect(data.status).toBe("in progress"); // not valid JSON -> raw string
  expect(data.title).toBe("Before"); // untouched by the other sets
});

test("`prop delete <file> <key>` removes exactly that key, preserving the rest of the frontmatter", async () => {
  const { readNote } = await import("../../core/src/files");
  const { parseFrontmatter } = await import("../../core/src/frontmatter");
  const vault = makeVault({ "Note.md": "---\ntitle: Keep\npriority: 3\n---\nbody\n" });

  const result = await runCli(vault, "prop", "delete", "Note.md", "priority");
  expect(result.code).toBe(0);

  const { data } = parseFrontmatter(await readNote(vault, "Note.md"));
  expect(data.priority).toBeUndefined();
  expect(data.title).toBe("Keep");
});

test("`prop set`/`prop delete` (missing required args) fail with a usage message; the file is left untouched", async () => {
  const { readNote } = await import("../../core/src/files");
  const vault = makeVault({ "Note.md": "---\ntitle: X\n---\nbody\n" });
  const before = await readNote(vault, "Note.md");

  const noValue = await runCli(vault, "prop", "set", "Note.md", "key");
  expect(noValue.code).toBe(1);
  expect(noValue.err).toContain("usage: prop set");

  const noKey = await runCli(vault, "prop", "delete", "Note.md");
  expect(noKey.code).toBe(1);
  expect(noKey.err).toContain("usage: prop delete");

  expect(await readNote(vault, "Note.md")).toBe(before);
});

// --- `tree` (file.ts) — real vault file-tree JSON -------------------------------------------------
//
// WIRING GAP FOUND, NOT FIXED (per the task brief — reported here, left alone): core/src/server.ts
// builds its tree cache via listTree(cfg.vault, { daemonEnabled: appConfig.daemon?.enabled,
// daemonName: daemonIdentityName(cfg.vault) }) — core/src/files.ts's listTree only ever shows the
// `.daemon` folder when daemonEnabled is passed true. cli/src/commands/file.ts's `tree` command
// calls listTree(vault) with NO second argument at all, so `bismuth tree` can NEVER surface
// `.daemon` (crons/processes/pages/memory), even on a vault with settings.daemon.enabled: true —
// exactly the "CLI silently drops a config core supports" shape named in the task brief. Not
// fixed here (a fix is a separate reviewed change). This test only exercises the unaffected
// ordinary-file path, since asserting on `.daemon` visibility would just be asserting the bug.

test("`bismuth tree` lists the vault's real file tree, including nested folders and file/dir kinds", async () => {
  const vault = makeVault({
    "Root.md": "# root\n",
    "Folder/Child.md": "# child\n",
    "Folder/Sub/Deep.md": "# deep\n",
  });
  const result = await runCli(vault, "tree");
  expect(result.code).toBe(0);
  const byPath = Object.fromEntries(result.json.map((e: any) => [e.path, e.kind]));
  expect(byPath["Root.md"]).toBe("file");
  expect(byPath["Folder"]).toBe("dir");
  expect(byPath["Folder/Child.md"]).toBe("file");
  expect(byPath["Folder/Sub"]).toBe("dir");
  expect(byPath["Folder/Sub/Deep.md"]).toBe("file");
});

test("`bismuth tree` (no vault, BISMUTH_VAULT unset) fails cleanly naming the missing vault", async () => {
  const result = await spawnCli(["tree"], { ...process.env, BISMUTH_VAULT: undefined });
  expect(result.code).toBe(1);
  expect(result.err).toContain("no vault");
});

// --- `backup` (serve.ts) — commits a real git snapshot of the vault -------------------------------

test("`backup` commits a real git snapshot of the vault; a second call with nothing changed reports 'nothing to commit'", async () => {
  const vault = makeVault({ "Note.md": "hello\n" });

  const first = await runCli(vault, "backup");
  expect(first.code).toBe(0);

  const log = await Bun.spawn(["git", "-C", vault, "log", "--oneline"], { stdout: "pipe" });
  const commits = (await new Response(log.stdout).text()).trim().split("\n").filter(Boolean);
  expect(commits).toHaveLength(1); // the note really got committed

  const second = await runCli(vault, "backup");
  expect(second.code).toBe(0);
});

test("`backup` (no vault, BISMUTH_VAULT unset) fails cleanly naming the missing vault", async () => {
  const result = await spawnCli(["backup"], { ...process.env, BISMUTH_VAULT: undefined });
  expect(result.code).toBe(1);
  expect(result.err).toContain("no vault");
});

// --- `backends` (backends.ts) — read-only machine probe, safe to run for real -------------------
// Per the module's own doc: never runs an agent turn, authenticates, spends money, starts a
// daemon, or writes config — it only resolves binaries already on PATH and asks each for its
// version (bounded per-probe timeout). Safe to spawn for real, unlike install/uninstall below.

test("`bismuth backends --json` reports a real per-backend row for every entry in the catalog", async () => {
  const result = await spawnCli(["backends", "--json"]);
  expect(result.code).toBe(0);
  const reports = JSON.parse(result.out);
  expect(Array.isArray(reports)).toBe(true);
  expect(reports.length).toBeGreaterThan(0);
  for (const r of reports) {
    expect(typeof r.id).toBe("string");
    expect(typeof r.installed).toBe("boolean");
    expect(r.surfaces).toBeTruthy();
  }
}, 30_000);

test("`bismuth backends` (no --json) prints a human-readable table by default, not raw JSON", async () => {
  const result = await spawnCli(["backends"]);
  expect(result.code).toBe(0);
  expect(() => JSON.parse(result.out)).toThrow(); // the default path is formatTable(), not out()
  expect(result.out.length).toBeGreaterThan(0);
}, 30_000);

test("`bismuth backends --json --installed` only includes installed backends", async () => {
  const result = await spawnCli(["backends", "--json", "--installed"]);
  expect(result.code).toBe(0);
  const reports = JSON.parse(result.out);
  expect(reports.every((r: any) => r.installed === true)).toBe(true);
}, 30_000);

// --- `install` / `uninstall` (install.ts) — SAFETY-CONSTRAINED per the task brief ----------------
//
// Both write MACHINE-WIDE state with NO env-var seam to redirect them into a temp dir the way
// every other command group in this file is sandboxed: core/src/bismuthInstall.ts hardcodes
// BISMUTH_HOME = join(homedir(), ".bismuth") and CLAUDE_SKILLS_DIR = join(homedir(), ".claude",
// "skills") at module scope. A real `install` (with --src, or --mcp) writes there and calls the
// real `claude mcp add`; `uninstall` unconditionally rmSync()s ~/.bismuth. Per the task's hard
// constraint, neither may be run for real against this developer's machine — skipped.
//
// Mocking core/src/bismuthInstall.ts (the pattern used above for `daemon stop`/`daemon restart`
// via daemon/src/lib/platform.ts) is ALSO unsafe here, unlike that case: core/test/
// bismuthInstall.test.ts calls the SAME exported ensureBismuthInstalled/getBismuthStatus/
// uninstallBismuth functions directly (injecting a fake `io` argument, not module-mocking).
// mock.module swaps a module out process-wide for the rest of a combined `bun test` run (see the
// comment above the daemon mock), so mocking it here would silently replace those functions for
// that OTHER file's real-function assertions too. So this covers exactly what's provably safe:
// (1) dispatcher registration — index.ts's printHelp() runs before any command's own code, so
// spawning `--help` never touches disk; (2) the two invocations that are read-only BY INSPECTION
// of ensureBismuthInstalled's own source (core/src/bismuthInstall.ts:419-436): with no --src, it
// returns { action: "skipped-no-src" } immediately — before any of InstallIO's write methods
// (installFiles/linkCli/writeMarker/…) are ever called; --status takes the identical
// getBismuthStatus() read-only path. `--mcp`, a real `--src`, `--dry-run` WITH a real --src (which
// would still call getBismuthStatus() on this machine but is riskier to reason about than the
// no-src case), and `uninstall` are NOT exercised here — they write real machine state with
// nothing to sandbox into.

test("`bismuth --help` proves install/uninstall/backends are really registered in the dispatcher (not just exported from commands/*.ts)", async () => {
  const result = await spawnCli(["--help"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Install the bismuth CLI + MCP machine-wide");
  expect(result.out).toContain("Remove the machine-wide bismuth CLI symlink");
  expect(result.out).toContain("List agent backends");
});

test("`bismuth install --status` and `bismuth install --dry-run` (no --src) are read-only no-ops by construction — safe to run for real, never writes to ~/.bismuth", async () => {
  const env = { ...process.env, BISMUTH_INSTALL_SRC: undefined };

  const status = await spawnCli(["install", "--status"], env);
  expect(status.code).toBe(0);
  expect(typeof JSON.parse(status.out).installed).toBe("boolean"); // BismuthStatus shape, real read

  const dryRun = await spawnCli(["install", "--dry-run"], env);
  expect(dryRun.code).toBe(0);
  expect(JSON.parse(dryRun.out).action).toBe("skipped-no-src"); // returns before any write — no --src given
}, 20_000);
