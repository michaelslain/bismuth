// Task 4 of the offline-integration-testing plan: prove that a REAL `opencode` binary, driven
// through Bismuth's OWN opencode chat driver (core/src/chatProviders/opencode.ts, via the
// CHAT_BACKENDS registry chat.ts's WS layer also dispatches through), completes a turn against the
// local mock LLM server (core/test/support/mockLlm.ts) with ZERO calls against any real provider
// account. Mirrors claudeMocked.test.ts's shape (Task 3): runs by default in `bun test core`, skips
// only when the `opencode` binary itself is missing — a missing-BINARY skip, never a missing-account
// skip (see the task brief).
//
// TWO REAL DRIVER QUIRKS FOUND THIS TASK (both load-bearing for this test's shape — see
// backendEnv.ts's `opencode` case comment for the full write-up):
//
// 1. SERVER-MODE MODEL SELECTION: a fresh opencode chat's `s.model` starts unset, and Bismuth's
//    server-mode session.prompt call then omits `model` from the request entirely — the server
//    falls back to whatever model THIS MACHINE's own opencode last had active (reproduced live: on
//    the research machine, that's a real Moonshot/Zen provider from prior real usage), NOT this
//    mapping's `OPENCODE_CONFIG_CONTENT`-declared default. Verified by /metrics: a sendMessage with
//    no prior setModel() call produced a `result`/`done` pair but ZERO hits on the mock. The fix:
//    open the session, wait for the "models" frame (proving the handshake completed), THEN call
//    `setModel(chatId, "mock/mock")` BEFORE the first sendMessage — exactly what a real chat header's
//    model picker does on a fresh tab, so this isn't a test-only workaround, it's the normal flow.
//
// 2. SERVER-MODE EVENT-STREAM RACE AT ZERO LATENCY: opencode's server mode gets real-time deltas off
//    a global `GET /event` SSE subscription. A mock that replies INSTANTLY (aimock's default
//    latency: 0ms) can complete the whole exchange before that subscription is fully attached —
//    reproduced live: a turn that hit the mock twice per /metrics still produced ZERO assistant-text
//    frames. A small `--latency` value (mockLlm.ts's `extraArgs`, added this task) gives the
//    subscription time to attach first; 40ms reliably produced one clean assistant-text frame in
//    repeated live runs. This is a mock-server pacing fix, NOT a driver change — no production files
//    were touched for this task.
//
// KNOWN LOAD-SENSITIVE FLAKE (task-15, diagnosed not fixed — same class as the project's own
// documented core/test/layout.test.ts flakiness, NOT a new bug this task introduced): finding #2's
// 40ms margin is a FIXED constant, not a deterministic wait for the SSE subscription's own
// attachment — under real CPU contention that margin can still be blown through, exactly
// reproducing finding #2's own failure signature (a turn's blocking `session.prompt()` HTTP call
// still resolves normally — `result`+`done`+`title` all fire — but zero `assistant-text` frames
// ever arrive, because `runTurnServer`'s per-session listener, registered via
// `registerOpencodeServerListener` just before that same call, hadn't caught the model's deltas in
// time). Root-caused precisely this task by DIRECT experiment, not guessed:
//   - Clean slate (zero other `opencode serve` processes running, confirmed by pid check): 15/15
//     solo runs passed, and 4/4 runs launched IN PARALLEL (real CPU contention, 11-17s wall time
//     each vs ~7-10s solo) still passed.
//   - Deliberately reintroducing exactly the contamination this file's OWN afterAll leak (fixed
//     this same task — see killAndConfirmDead below) used to leave behind — two extra, otherwise-
//     idle `opencode serve` processes seeded by hand, simulating what an unfixed repeated-run
//     history accumulates — reproduced this file's FIRST test failing with the EXACT signature
//     above at 6/18 runs (33%), closely matching both a sibling task's independent measurement at
//     the untouched base commit (2/5, 40%) and this task's own earlier measurement on this branch
//     (1/4, 25%).
//   - The same signature also reproduced on a nominally clean pid slate purely from OTHER
//     concurrent processes' machine-level CPU load (unrelated sibling agents on this shared dev
//     box) — so leaked `opencode serve` processes are A cause, not the ONLY cause; any sufficiently
//     heavy contention can defeat the fixed 40ms margin.
// CONCLUSION: this file's own Step-3b leak fix (afterAll now confirms every process it kills is
// actually dead — see killAndConfirmDead's doc comment) measurably REDUCES this flake's frequency
// in normal use, because it stops repeated test runs from compounding their own contention over
// time — but it does NOT make this test fully deterministic, since ordinary machine load from
// anything else running concurrently can still trigger the identical race. A true fix needs
// production driver code (core/src/chatProviders/opencode.ts's `runTurnServer`) to positively
// confirm its per-session SSE registration is live before issuing `session.prompt()`, replacing the
// fixed-margin mock workaround with a real synchronization point — out of scope for this task (a
// shared driver code path, not a test-only change) and not attempted here. Documented rather than
// silently accepted, per this task's own standard: a known-flaky test that's honestly labelled is
// survivable; an unlabelled one poisons every future run's signal.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_OPENCODE = whichBinary("opencode") !== null;
const describeOrSkip = HAS_OPENCODE ? describe : describe.skip;

if (!HAS_OPENCODE) {
  // eslint-disable-next-line no-console
  console.warn("[opencodeMocked.test] skipped — the `opencode` CLI is not installed on this machine (nothing to drive).");
}

/** The exact argv chatProviders/opencodeServer.ts's spawnAndWaitForBanner uses for the ONE shared
 *  `opencode serve` process — matched here only to find PIDs this test itself causes to exist, never
 *  to identify opencode processes in general. */
const OPENCODE_SERVE_PATTERN = "opencode serve --port 0 --hostname 127.0.0.1";

/** PIDs of any already-running shared opencode server, matched by the exact argv above. Best
 *  effort: `pgrep` missing/erroring yields [] rather than throwing. */
function opencodeServePids(): string[] {
  try {
    const r = Bun.spawnSync(["pgrep", "-f", OPENCODE_SERVE_PATTERN]);
    if (r.exitCode !== 0) return [];
    return r.stdout
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** True iff `pid`'s PARENT is THIS process (`process.pid`) — a final-review minor: the shared
 *  server's argv match (`OPENCODE_SERVE_PATTERN`) alone isn't enough to say "safe to SIGTERM",
 *  because a user's OWN running Bismuth app could independently start an `opencode serve` with the
 *  exact same argv (opencodeServer.ts's spawn args are fixed, not test-specific) while this test
 *  happens to be running. A server this test itself caused to exist is always a DIRECT child of
 *  this `bun test` process (chatProviders/opencode.ts's `ensureOpencodeServer` calls `Bun.spawn`
 *  synchronously within it, no double-fork) — the app's own instance never is. Best effort: any
 *  `ps` hiccup yields false (never kill on an inconclusive check). */
function isChildOfThisProcess(pid: string): boolean {
  try {
    const r = Bun.spawnSync(["ps", "-o", "ppid=", "-p", pid]);
    if (r.exitCode !== 0) return false;
    return r.stdout.toString().trim() === String(process.pid);
  } catch {
    return false;
  }
}

/** True iff a process with this pid currently exists, checked by pid — NEVER by re-running
 *  `pgrep -f` (see this file's OPENCODE_SERVE_PATTERN comment for why: a pattern-based check can't
 *  distinguish this test's own leftover from an unrelated process, but a plain existence check on a
 *  pid we already decided to kill has nothing to confuse it with). `kill(pid, 0)` sends no signal —
 *  it only probes whether the pid exists and whether we have permission to signal it. `ESRCH` means
 *  gone; `EPERM` means it exists but isn't ours to signal (treated as "still alive", never silently
 *  assumed dead). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** THE FIX for the leak this file used to have: SIGTERM, poll for exit on a bounded budget, then
 *  escalate to SIGKILL — the same grace-then-escalate shape core/src/chatProviders/acp/driver.ts's
 *  `killWithEscalation` already uses in production, adapted to a bare OS pid (this test only ever
 *  discovers the shared `opencode serve` server's pid externally via `pgrep`, see
 *  opencodeServePids() above, so there is no `Bun.spawn` handle / `proc.exited` promise to await —
 *  polling pidAlive() is the pid-based equivalent).
 *
 *  The irony worth keeping: `isChildOfThisProcess` above was added by an earlier review specifically
 *  to stop this test from SIGTERMing the user's OWN running Bismuth server (a real hazard — the
 *  shared server's argv is not test-specific). That guard is correct and stays untouched. What was
 *  missing was the OTHER half: once this test decides a pid is safe to kill, it never confirmed the
 *  kill actually landed. The old code fired `process.kill(pid, "SIGTERM")` and returned immediately;
 *  `bun test` then exited, the still-alive child reparented to launchd, and survived whenever it
 *  hadn't finished handling the signal yet — measured live, before this fix: 0 `opencode serve`
 *  processes before a run, 1 after, every time, accumulating across runs. A cleanup that checks WHO
 *  it may kill but never WHETHER the kill worked is the same class of bug as an assertion that
 *  reports success without observing anything — this function (and the assertion in afterAll below
 *  that calls it) is the fix for both halves at once: wait for the kill, then prove it.
 *
 *  THEORETICAL PID-REUSE WINDOW, noted rather than fixed (code-review finding): this function holds
 *  a bare OS pid across its own up-to-~4s poll (graceMs + the SIGKILL follow-up), and the OS is free
 *  to recycle that exact pid to an unrelated process once the ORIGINAL one has actually exited —
 *  `pidAlive(pid)` (and the final SIGKILL itself) cannot distinguish "still our target" from "a new,
 *  unrelated process that happens to reuse the same number" in that window. Same exposure the
 *  pre-fix code already had (it also addressed a pid, not a process handle, across its own — much
 *  longer, unbounded — window before this fix existed), and no worse than `isChildOfThisProcess`'s
 *  own already-accepted "best effort, not airtight" stance a few lines up. Not fixed here: closing it
 *  for real would need a `pidfd`-style handle (not available from a bare `pgrep`-discovered pid on
 *  this platform) rather than anything achievable with `process.kill`. */
async function killAndConfirmDead(pid: number, graceMs = 3000, pollMs = 50): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true; // already gone before we even signaled it
  }
  const termDeadline = Date.now() + graceMs;
  while (Date.now() < termDeadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (!pidAlive(pid)) return true;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true; // exited between the last poll and this call
  }
  const killDeadline = Date.now() + 1000;
  while (Date.now() < killDeadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return !pidAlive(pid);
}

describeOrSkip("the real opencode CLI, driven through chatProviders/opencode.ts, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["OPENCODE_CONFIG_CONTENT", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on this
  // task: populating this AFTER an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real ANTHROPIC_*/XDG_* vars this test never touched.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  // Persists across the whole file (unlike chatIds, which afterEach splices empty every test) — set
  // true the moment ANY test actually opens a real opencode chat. afterAll's assertion below uses
  // this to catch the OTHER half of the leak class this file fixes: not just "a pid we decided to
  // kill didn't die" (the `survivors` check), but "the kill-selection loop found NOTHING to kill at
  // all" — which would leave `survivors` at `[]` and the test green even though a real leak exists,
  // e.g. if `pidsBefore` wrongly contained this file's own server (reproduced historically — see
  // `pidsBefore`'s own doc comment) or `isChildOfThisProcess` incorrectly returned false for a
  // legitimate target. If a chat was opened, a shared `opencode serve` MUST exist by construction
  // (chatProviders/opencodeServer.ts's `ensureOpencodeServer`), so finding zero pids to kill is
  // itself a bug, not a benign no-op.
  let anyChatOpened = false;
  const tempDirs: string[] = [];
  // Separate from tempDirs (cleaned per-test in afterEach): the shared, process-lifetime `opencode
  // serve` singleton (see the FINDING below) only reads XDG_*_HOME at the moment IT spawns — setup()
  // is idempotent (see its own comment) and this file now has more than one test, so these dirs are
  // created exactly once, by the FIRST test, and the ALREADY-RUNNING shared server keeps using them
  // for as long as it lives, which is this whole bun:test process (see the FINDING below — its own
  // exit handler never fires under `bun test`). Deleting them after the FIRST test's afterEach (as
  // tempDirs' per-test afterEach would) 404s the server's own storage: reproduced live, a SECOND
  // test's session.create() fails with `{code:"spawn", message:"The opencode server could not start
  // a session."}` once rm -rf'd out from under a server still expecting them to exist. Cleaned up
  // only in afterAll, once nothing in this file can still be depending on the shared server.
  const xdgDirs: string[] = [];
  // FINDING (this task): chatProviders/opencode.ts spawns ONE shared, process-lifetime `opencode
  // serve` (chatProviders/opencodeServer.ts) the first time any opencode chat opens — by design,
  // meant to outlive individual chats and be torn down only by opencodeServer.ts's own
  // `process.on("exit", shutdownAll)` when the HOST core process exits. Reproduced live: that "exit"
  // handler (and, separately, mockLlm.ts's own identical safety-net pattern) DEMONSTRABLY NEVER
  // FIRES when a `bun test` run completes normally (confirmed with a standalone
  // process.on("exit")-writes-a-file probe run under `bun test` vs plain `bun run` — the plain
  // script's handler fires every time, the `bun test` one never does). Every OTHER mocked test in
  // this suite is unaffected because its own driver's spawned child is killed directly by
  // closeChat()/mock.stop() — this is the one backend whose shared server persists past a single
  // chat's lifecycle by design. Rather than change opencodeServer.ts's shutdown story (a real
  // production behavior this task didn't otherwise need to touch), this test snapshots the shared
  // server's PID before/after itself and force-kills anything NEW in afterAll — a test-only safety
  // net, matched by the shared server's own exact, distinctive argv (never a general "kill anything
  // named opencode" sweep that could disrupt an unrelated opencode process on a developer's machine).
  // Snapshotted ONCE here, at describe-collection time (NOT inside setup()) — this file now has more
  // than one test, and setup() runs per-test. A snapshot taken inside setup() would, on the SECOND
  // test's call, record the shared server THIS FILE'S OWN FIRST TEST just spawned as "pre-existing",
  // so afterAll's `if (pidsBefore.has(pid)) continue` would skip killing it. Reproduced live: with
  // the snapshot inside setup(), every run leaked one `opencode serve` (PPID 1).
  const pidsBefore = new Set<string>();
  for (const pid of opencodeServePids()) pidsBefore.add(pid);

  async function newTempDir(prefix = "bismuth-opencode-mocked-"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  /** Like newTempDir, but tracked in xdgDirs (survives every afterEach, cleaned only in afterAll) —
   *  see xdgDirs' own comment for why an XDG_*_HOME dir must outlive the single test that created it. */
  async function newXdgTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    xdgDirs.push(dir);
    return dir;
  }

  // IDEMPOTENT AND ALL-OR-NOTHING — this file now has more than one test, and each calls setup() at
  // its own start. `setupOnce ??= doSetup()` latches on the PROMISE, not on a side effect of the
  // first statement: an `if (mock) return` guard checked before `mock` is actually assigned would
  // let a LATER test proceed into a half-initialized environment (e.g. the mock server up but the
  // XDG redirection below not yet applied) if some await after the first one throws. `??=`
  // guarantees every caller gets the exact same outcome (success or rejection) as whichever call
  // actually ran doSetup(), and never re-runs it. Without the guard at all, a second call reassigns
  // `mock` (a single `let`), orphaning the FIRST mock LLM server (afterAll's `mock?.stop()` only
  // ever stops the LATEST one) — reproduced live as one leaked `aimock` process (PPID 1) per run. It
  // also means every XDG dir below is now genuinely created only once, matching the shared
  // opencode-serve singleton's own actual lifetime (see xdgDirs' comment) rather than being
  // recreated-and-ignored on every later call.
  let setupOnce: Promise<void> | undefined;
  function setup(): Promise<void> {
    return (setupOnce ??= doSetup());
  }

  async function doSetup(): Promise<void> {
    // --latency 40: see this file's header, finding #2 — a zero-latency reply can beat opencode
    // server mode's own event-stream subscription.
    mock = await startMockLlm(undefined, ["--latency", "40"]);
    const mockEnv = backendMockEnv("opencode", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // STATE ISOLATION (code-review finding): OPENCODE_CONFIG_CONTENT overrides opencode's config,
    // not its STORED CREDENTIALS (`~/.local/share/opencode/auth.json`) — verified live that
    // XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_STATE_HOME genuinely redirect opencode's
    // storage (a real `opencode auth list` under a fresh XDG_DATA_HOME reports zero credentials,
    // vs this machine's own real Moonshot/Zen providers with the defaults). Without this, the ONLY
    // thing preventing a real billed call on a machine with prior real opencode usage is that
    // setModel("mock/mock") below runs before sendMessage — real, but call-ordering-only, with no
    // backstop if that ordering ever regresses. With this, there is no real provider to fall back
    // to even if it did: re-verified live that a turn still completes correctly against the mock
    // with all four redirected (the "auth" ChatFrame reports zero providers, "assistant-text" is
    // still the fixture's exact "Hello!").
    process.env.XDG_CONFIG_HOME = await newXdgTempDir("bismuth-opencode-xdgconfig-");
    process.env.XDG_DATA_HOME = await newXdgTempDir("bismuth-opencode-xdgdata-");
    process.env.XDG_CACHE_HOME = await newXdgTempDir("bismuth-opencode-xdgcache-");
    process.env.XDG_STATE_HOME = await newXdgTempDir("bismuth-opencode-xdgstate-");
    // RESIDUAL HAZARD, noted rather than fixed (flagged on re-review, no fix needed today): these
    // XDG vars only affect a FRESH `opencode serve` spawn. chatProviders/opencodeServer.ts's shared
    // server is PROCESS-LIFETIME (one `live` singleton reused for the rest of this core process —
    // see this file's header, finding #2, and opencodeServer.ts's own module doc comment) — if any
    // OTHER test file in the same `bun test` process ever opens an opencode chat BEFORE this file's
    // (idempotent, so effectively single) setup() call runs, that earlier chat's
    // `ensureOpencodeServer()` call would have already spawned the shared server with THAT call's
    // env (real XDG dirs, not these), and this test would then be handed the SAME already-running
    // server instead of a fresh isolated one. No such file exists in this suite today (this is the
    // only one that drives a real opencode turn), so it's not live risk right now — but a future
    // opencode test file MUST open its first chat only after its own XDG redirection is in place,
    // and should not assume it starts the shared server fresh.
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await mock?.stop();
    // Decide WHICH pids are this test's to kill using the exact same two guards as before
    // (pre-existing check + isChildOfThisProcess) — that decision logic is untouched. What's new is
    // AWAITING each kill and recording whether it actually died — see killAndConfirmDead's own doc
    // comment for why the old fire-and-forget SIGTERM was the actual bug, not this guard.
    const survivors: string[] = [];
    // Count of pids this loop actually SELECTED and confirmed dead — separate from `survivors`
    // (which pids were selected but failed to die). A code-review finding: `expect(survivors).
    // toEqual([])` alone only guards the half of the leak that was fixed (a selected pid not
    // dying), not the half that recurred historically (the loop selecting NOTHING at all, e.g.
    // `pidsBefore` wrongly containing this file's own server — see its own doc comment for exactly
    // that bug) — in that failure mode `survivors` stays `[]` and looks like success while the real
    // server leaks untouched. `killedCount` plus `anyChatOpened` below closes that gap.
    let killedCount = 0;
    for (const pid of opencodeServePids()) {
      if (pidsBefore.has(pid)) continue; // pre-existing — not this test's to kill
      // Final-review minor: argv-matching alone could SIGTERM the user's OWN running Bismuth app if
      // its opencode server happened to start during this test's window — require the PID to
      // actually be a child of THIS process before killing it (see isChildOfThisProcess's doc
      // comment).
      if (!isChildOfThisProcess(pid)) continue;
      const dead = await killAndConfirmDead(Number(pid));
      if (dead) killedCount++;
      else survivors.push(pid);
    }
    // Cleaned up LAST, after the shared server (if this file's tests started it) has been signaled
    // to die above — see xdgDirs' own comment for why these can't be removed any earlier.
    for (const dir of xdgDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    // THE ASSERTION half of the fix, run last (after cleanup above, so a failure here never skips
    // the temp-dir cleanup) — fail loudly if any pid this file decided to kill is still alive after
    // SIGTERM+SIGKILL. Silence here would be exactly the bug this whole fix exists to close: a
    // cleanup that decides what to kill but never confirms the kill worked.
    expect(survivors).toEqual([]);
    // THE OTHER HALF of the fix (code-review finding): if any test in this file actually opened a
    // real opencode chat, a shared `opencode serve` process MUST have come into existence by
    // construction (chatProviders/opencodeServer.ts's `ensureOpencodeServer`) — so the
    // kill-selection loop above finding NOTHING to kill (killedCount === 0) is itself a bug, not a
    // benign no-op, whether caused by `pidsBefore` wrongly swallowing this file's own server or
    // `isChildOfThisProcess` incorrectly rejecting a legitimate target. This assertion is what
    // makes a loop that silently selects nothing fail loudly instead of reporting a false green.
    if (anyChatOpened) expect(killedCount).toBeGreaterThanOrEqual(1);
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.opencode.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test(
    "a turn sent through CHAT_BACKENDS.opencode returns the fixture's exact text, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir();
      const chatId = "opencode-mocked-" + Date.now();
      chatIds.push(chatId);
      anyChatOpened = true;
      const { sink, frames, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.opencode.openSession({ chatId, cwd, sink, computerUse: false });
      // Finding #1 (this file's header): a fresh session must pick the mock's model EXPLICITLY —
      // opencode server mode does not consult OPENCODE_CONFIG_CONTENT's default `model` field for a
      // session's first turn. Waiting for "models" proves the handshake (initialize + session
      // create) actually completed before we touch setModel.
      await waitFor((f) => f.type === "models");
      CHAT_BACKENDS.opencode.setModel(chatId, "mock/mock");

      CHAT_BACKENDS.opencode.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture (core/test/fixtures/llm/basic-turn.json) — no
        // real model replies to "hello" with the literal string "Hello!" verbatim, and the mock is
        // the only thing OPENCODE_CONFIG_CONTENT's custom provider baseURL points at.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") {
        expect(resultFrame.isError).toBe(false);
        expect(resultFrame.costUsd).toBe(0); // the mock's fixture reports zero cost
      }
    },
    60_000,
  );

  test(
    "sendMessage()'s reopen branch (reattachSessionSink) flushes a buffered turn to the NEW sink without an extra synthetic done",
    async () => {
      // Regression coverage for core/src/chatProviders/opencode.ts's sendMessage() "existing
      // session" branch, which must call sessionSink.ts's reattachSessionSink (flush, no synthetic
      // `done`) rather than rebindSessionSink (flush, THEN push a synthetic `done` whenever no turn
      // is active — which it always is right here, since turn 1 finishes before turn 2 is sent).
      // Swapping the two is a one-word change no prior test in this file catches.
      await setup();

      const cwd = await newTempDir();
      const chatId = "opencode-mocked-reopen-" + Date.now();
      chatIds.push(chatId);
      anyChatOpened = true;
      const { sink: sink1, frames: frames1, waitFor: waitFor1 } = makeChatFrameCollector();

      CHAT_BACKENDS.opencode.openSession({ chatId, cwd, sink: sink1, computerUse: false });
      await waitFor1((f) => f.type === "models");
      CHAT_BACKENDS.opencode.setModel(chatId, "mock/mock");

      // Queue turn 1, then detach IMMEDIATELY (synchronously, same tick) — sendMessage() here is
      // fire-and-forget (not async), and the mock's own --latency 40 (see setup()) guarantees the
      // reply can't land before this synchronous detach call runs.
      CHAT_BACKENDS.opencode.sendMessage({ chatId, cwd, sink: sink1, computerUse: false, text: "hello" });
      expect(CHAT_BACKENDS.opencode.detachSink(chatId, sink1)).toBe(true);

      // Give the whole first turn (assistant-text, result, done) time to complete while detached.
      await new Promise((r) => setTimeout(r, 3000));
      expect(frames1.some((f) => f.type === "assistant-text")).toBe(false);
      expect(frames1.some((f) => f.type === "done")).toBe(false);

      // Reopen with a FRESH sink — opencode.ts's sendMessage() "existing session" branch.
      const { sink: sink2, frames: frames2, waitFor: waitFor2 } = makeChatFrameCollector(60_000);
      CHAT_BACKENDS.opencode.sendMessage({ chatId, cwd, sink: sink2, computerUse: false, text: "hello" });

      // Wait for the FULL picture to settle — 2 done frames total (turn 1's buffered done, then
      // turn 2's own done) — BEFORE checking anything about order. Checking order right after the
      // first assistant-text (before turn 1's own result/done have necessarily landed yet) is a race;
      // waiting for both dones first makes every ordering check below run against a stable array.
      await waitFor2((_f) => frames2.filter((x) => x.type === "done").length >= 2, 60_000);

      // Turn 1's buffered tail must have arrived on sink2 (the flush) — assistant-text then done, in
      // order — as the FIRST content, ahead of turn 2's own.
      const firstAssistantIdx = frames2.findIndex((f) => f.type === "assistant-text");
      expect(firstAssistantIdx).toBeGreaterThanOrEqual(0);
      const firstAssistant = frames2[firstAssistantIdx];
      if (firstAssistant.type === "assistant-text") expect(firstAssistant.text).toBe("Hello!");
      const firstDoneIdx = frames2.findIndex((f) => f.type === "done");
      expect(firstDoneIdx).toBeGreaterThan(firstAssistantIdx);

      // THE discriminating assertion. Under the reattach→rebind sabotage, rebindSessionSink's
      // synthetic `done` fires SYNCHRONOUSLY inside sendMessage's "existing session" branch
      // whenever turnActive is false at that moment — true both for the FIRST sendMessage call
      // above (the session already exists via openSession, caught by the earlier
      // frames1.some(done) assertion) and for THIS reopen call (turn 1 already finished), so
      // frames2 already holds 2 done frames before turn 2's OWN text has even been requested —
      // done.length === 2 PASSES even under the sabotage, since the wait above resolves off that
      // already-collected count without ever waiting for turn 2 to run. It's assistant-text.length
      // that actually catches it here.
      expect(frames2.filter((f) => f.type === "done").length).toBe(2);
      expect(frames2.filter((f) => f.type === "assistant-text").length).toBe(2);
    },
    60_000,
  );
});
