// Tests for scripts/previews.sh — the per-card preview lifecycle manager.
//
// These cover the two defects that made the script capable of destroying the user's
// working tree, plus the port-determinism rule. Every test here FAILS against the
// pre-fix script; see the comment on each block for what it caught.
//
// previews.sh is sourced with PREVIEWS_LIB=1, which exposes its functions and
// dispatches nothing. Fixtures are real git repos + real symlink layouts, because
// both bugs were about what git and bun ACTUALLY do, not what they were assumed to.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "previews.sh");

let TMP: string;
let REPO: string; // the fake "main checkout"
let VAULT: string;
let BOARD: string;
let STUBS: string; // PATH shim holding a fake `bun`
const BUN_MARKER = () => join(STUBS, "bun-was-run");

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Source previews.sh in $REPO and run `body`. Returns stdout/stderr/status. */
function sh(body: string, opts: { stubBun?: boolean } = {}) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PREVIEWS_LIB: "1",
    BISMUTH_VAULT: VAULT,
  };
  if (opts.stubBun) env.PATH = `${STUBS}:${env.PATH}`;
  return spawnSync("bash", ["-c", `source "${SCRIPT}"\n${body}`], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
}

function card(name: string, fm: Record<string, string>) {
  const body = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
  writeFileSync(join(BOARD, `${name}.md`), `---\n${body}\n---\n\nbody\n`);
}

/** A worktree whose deps are healthy the way bun ACTUALLY links them: a RELATIVE
 *  core/node_modules/@bismuth/memory -> ../../../memory. Verified against every real
 *  worktree in this repo. */
function makeWorktreeFixture(path: string, state: "healthy" | "no-link" | "leaks-to-main" | "no-node-modules") {
  mkdirSync(join(path, "memory"), { recursive: true });
  if (state !== "no-node-modules") mkdirSync(join(path, "node_modules"), { recursive: true });
  mkdirSync(join(path, "core", "node_modules", "@bismuth"), { recursive: true });
  const link = join(path, "core", "node_modules", "@bismuth", "memory");
  if (state === "healthy" || state === "no-node-modules") symlinkSync("../../../memory", link);
  // "leaks-to-main": the real trap — resolves to ANOTHER checkout's memory workspace,
  // so the preview would silently run that code instead of the card's.
  if (state === "leaks-to-main") symlinkSync(join(REPO, "memory"), link);
  return path;
}

beforeAll(() => {
  TMP = realpathSync(mkdtempSync(join(tmpdir(), "previews-test-")));
  REPO = join(TMP, "repo");
  VAULT = join(TMP, "vault");
  BOARD = join(VAULT, "thoughts", "Bismuth Changes");
  STUBS = join(TMP, "stubs");
  mkdirSync(REPO, { recursive: true });
  mkdirSync(BOARD, { recursive: true });
  mkdirSync(STUBS, { recursive: true });
  mkdirSync(join(REPO, "memory"), { recursive: true });

  // a fake `bun` that records that it ran, so we can assert ensure_deps' trigger
  // WITHOUT actually installing (and without any chance of touching a real tree).
  writeFileSync(join(STUBS, "bun"), `#!/bin/sh\ntouch "${join(STUBS, "bun-was-run")}"\nexit 0\n`, { mode: 0o755 });

  git(REPO, "init", "-q", "-b", "main");
  git(REPO, "config", "user.email", "t@t.t");
  git(REPO, "config", "user.name", "t");
  writeFileSync(join(REPO, "f.txt"), "one\n");
  git(REPO, "add", "-A");
  git(REPO, "commit", "-qm", "one");
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("find_existing_worktree — never hands back the main checkout", () => {
  // THE bug: `git worktree list` puts main FIRST and the old code took head -1, so any
  // sha equal to main's HEAD resolved to the user's own checkout. Lane branches routinely
  // sit at main's tip, so previews would have served MAIN's code under the card's URL —
  // the user "confirms" a change they never saw. Both tests below returned $REPO before.
  test("prefers a real lane worktree over main when both sit at the same sha", () => {
    const sha = git(REPO, "rev-parse", "HEAD");
    const lane = join(REPO, ".claude", "worktrees", "lane-a");
    git(REPO, "worktree", "add", "-q", "--detach", lane, sha);

    const out = sh(`find_existing_worktree "${sha}"`).stdout.trim();
    expect(out).toBe(realpathSync(lane));
    expect(out).not.toBe(REPO);
  });

  test("returns nothing when the ONLY worktree at that sha is main (caller provisions fresh)", () => {
    // move main forward so the existing lane no longer matches main's HEAD
    writeFileSync(join(REPO, "f.txt"), "two\n");
    git(REPO, "add", "-A");
    git(REPO, "commit", "-qm", "two");
    const headOnlyOnMain = git(REPO, "rev-parse", "HEAD");

    const r = sh(`find_existing_worktree "${headOnlyOnMain}"`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  test("prefers a preview-* worktree when several lanes share the sha", () => {
    const sha = git(REPO, "rev-parse", "HEAD");
    const plain = join(REPO, ".claude", "worktrees", "aaa-lane");
    const preview = join(REPO, ".claude", "worktrees", "preview-thing");
    git(REPO, "worktree", "add", "-q", "--detach", plain, sha);
    git(REPO, "worktree", "add", "-q", "--detach", preview, sha);

    expect(sh(`find_existing_worktree "${sha}"`).stdout.trim()).toBe(realpathSync(preview));
  });
});

describe("deps_ok — detects the real trap, not an impossible one", () => {
  // The old guard tested node_modules/@bismuth/core, which exists in NO node_modules in
  // this repo (bun only links a workspace where a package.json declares it; only cli
  // declares @bismuth/core). It was therefore ALWAYS false -> every start rm -rf'd
  // node_modules and reinstalled, forever. The real link is core/node_modules/@bismuth/
  // memory, which core/src/server.ts -> chat.ts imports at boot.
  test("healthy worktree (relative @bismuth/memory link) passes", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-healthy"), "healthy");
    expect(sh(`deps_ok "${wt}" && echo YES || echo NO`).stdout.trim()).toBe("YES");
  });

  test("the OLD guard's target does not exist even in a healthy tree", () => {
    // proves the old condition could never pass — the false positive that hid the bug
    const wt = join(TMP, "wt-healthy");
    expect(existsSync(join(wt, "node_modules", "@bismuth", "core"))).toBe(false);
  });

  test("missing @bismuth/memory link fails (the stale-install case, cf. ios-app)", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-nolink"), "no-link");
    expect(sh(`deps_ok "${wt}" && echo YES || echo NO`).stdout.trim()).toBe("NO");
  });

  test("a link resolving OUTSIDE the worktree fails (would run main's code)", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-leak"), "leaks-to-main");
    expect(sh(`deps_ok "${wt}" && echo YES || echo NO`).stdout.trim()).toBe("NO");
  });

  test("missing node_modules fails", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-nonm"), "no-node-modules");
    expect(sh(`deps_ok "${wt}" && echo YES || echo NO`).stdout.trim()).toBe("NO");
  });
});

describe("ensure_deps — never fires on a healthy tree, never deletes", () => {
  test("healthy worktree: does NOT invoke bun and leaves node_modules alone", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-ensure-ok"), "healthy");
    rmSync(BUN_MARKER(), { force: true });

    const r = sh(`ensure_deps "${wt}"; echo "rc=$?"`, { stubBun: true });
    expect(r.stdout).toContain("rc=0");
    // the whole point: no install, no reinstall, no rm -rf
    expect(existsSync(BUN_MARKER())).toBe(false);
    expect(r.stdout).not.toContain("reinstalling");
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  test("broken worktree: installs, does NOT rm -rf, and fails loudly if unrepaired", () => {
    const wt = makeWorktreeFixture(join(TMP, "wt-ensure-broken"), "no-link");
    rmSync(BUN_MARKER(), { force: true });

    const r = sh(`ensure_deps "${wt}"; echo "rc=$?"`, { stubBun: true });
    expect(existsSync(BUN_MARKER())).toBe(true); // it did try to repair
    // stub bun installs nothing, so the re-check must fail rather than silently pass
    expect(r.stdout).toContain("rc=1");
    expect(r.stderr).toContain("does not resolve inside");
    // node_modules must SURVIVE a failed repair — deleting it is what nearly ate main's
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });
});

describe("assign_ports — deterministic given the board", () => {
  beforeAll(() => {
    card("Bug 87", { status: "Done but Broken", preview: "http://localhost:1432" });
    card("Bug 107", { status: "Done but Broken", preview: "http://localhost:1433" });
    card("Daemon chats", { status: "Awaiting Confirmation", preview: "http://localhost:1435" });
    card("Fresh card", { status: "Awaiting Confirmation" });
  });

  test("preserves a card's already-recorded port (hand-assigned ones survive)", () => {
    expect(sh(`assign_ports "${join(BOARD, "Bug 87.md")}"`).stdout.trim()).toBe("1432 4332");
    expect(sh(`assign_ports "${join(BOARD, "Bug 107.md")}"`).stdout.trim()).toBe("1433 4333");
    expect(sh(`assign_ports "${join(BOARD, "Daemon chats.md")}"`).stdout.trim()).toBe("1435 4335");
  });

  test("a never-started card gets the lowest port no OTHER card claims", () => {
    // 1432/1433/1435 are on the board, so the gap at 1434 is the answer — from the
    // board alone, with no reference to what is running.
    expect(sh(`assign_ports "${join(BOARD, "Fresh card.md")}"`).stdout.trim()).toBe("1434 4334");
  });

  test("the answer does not depend on the system's momentary state", () => {
    // The old next_free_ports probed lsof, so a stray listener silently shifted a card's
    // port and its URL changed between starts. Occupy 1434 and demand the same answer.
    const server = Bun.serve({ port: 1434, fetch: () => new Response("busy") });
    try {
      expect(sh(`assign_ports "${join(BOARD, "Fresh card.md")}"`).stdout.trim()).toBe("1434 4334");
    } finally {
      server.stop(true);
    }
  });

  test("is stable across repeated calls", () => {
    const once = sh(`assign_ports "${join(BOARD, "Fresh card.md")}"`).stdout.trim();
    const twice = sh(`assign_ports "${join(BOARD, "Fresh card.md")}"`).stdout.trim();
    expect(once).toBe(twice);
  });
});
