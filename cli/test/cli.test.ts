import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSampleVault } from "../../core/test/helpers";
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
  // Run-registry single match.
  writeRunRecord({ port: 4399, vault: "/v/one", pid: 1 });
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
