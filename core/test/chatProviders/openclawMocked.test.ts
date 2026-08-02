// core/test/chatProviders/openclawMocked.test.ts
// Closes the offline-agent-backend-test-harness coverage gap for `openclaw`: drives a REAL `openclaw`
// binary, through Bismuth's OWN production ACP driver (core/src/chatProviders/acp/driver.ts, via
// `openclaw acp` — see chatProviders/acp/agents.ts), against a REAL, separately-run
// `openclaw gateway run` process, itself pointed at the local mock LLM server
// (core/test/support/mockLlm.ts) — a full end-to-end turn with ZERO calls against any real openclaw
// account and ZERO logins. Mirrors gooseMocked.test.ts's shape: runs by default in `bun test core`,
// skips only when the `openclaw` binary itself is missing — a missing-BINARY skip, never a
// missing-account skip.
//
// THE ABSOLUTE CONSTRAINT this file exists to prove is upheld: `openclaw` is a THIN BRIDGE (its own
// --help: "Run an ACP bridge backed by the Gateway") to a separate Gateway process that owns model
// routing via its own `models.providers.*` config — so covering it for real means standing up that
// Gateway too, not just pointing an env var at a mock (which is all the prior task's row proved; see
// backendEnv.ts's `openclaw` case header for the full history). core/test/support/openclawGateway.ts
// spawns that Gateway; backendEnv.ts's `openclaw` case writes the config both the Gateway and the ACP
// bridge read (isolated via OPENCLAW_CONFIG_PATH/OPENCLAW_STATE_DIR — never a real `~/.openclaw`).
//
// THREE REAL BUGS WERE FOUND AND FIXED to make this test possible at all — pre-existing production
// bugs, not test artifacts, each hit by any real user before this task, not just by this harness:
//   1. Bismuth's OLD default spawn args (`openclaw acp`, no `--session`) reliably failed the FIRST
//      session/prompt on ANY fresh Gateway — a session-key-naming collision with an unrelated
//      OpenClaw feature. Fixed with a PER-CHAT `--session agent:main:bismuth-<chatId>`
//      (`AcpAgentSpec.sessionKeyArgs` in agents.ts, consumed in driver.ts's createSession). This went
//      through TWO revisions: a first version used a FIXED constant session key, which review caught
//      as an active cross-chat content-leak vulnerability (one chat's text arriving inside another,
//      never-before-seen chat's upstream request) rather than a mere isolation nicety — see the
//      "session isolation" test below, which reproduces the leak's own precondition and proves the
//      per-chat fix actually closes it. Full root-cause writeup: agents.ts's openclaw entry.
//   2. session/new's usual non-empty `mcpServers` array is rejected outright by openclaw's ACP
//      bridge. Fixed via `AcpAgentSpec.supportsSessionMcpServers: false` (agents.ts) + driver.ts's
//      createSession consuming it.
//   3. A real `openclaw acp` process does not exit on SIGTERM alone — its own shutdown handler never
//      calls `process.exit()`, so `driver.ts`'s old `closeChat()` (a bare `proc.kill()`, never
//      awaited) left it running indefinitely after a chat closed. Reproduced live: `proc.exited` on a
//      real openclaw ACP bridge child did not resolve within 120s of a plain SIGTERM. Fixed with a
//      shared grace-then-SIGKILL escalation (driver.ts's `killWithEscalation`/
//      `KILL_ESCALATION_GRACE_MS`) at BOTH places this driver ever kills an agent process:
//      `closeChat()` and `abortTurn()`'s own grace-timeout fallback (the same bare-`kill()` bug
//      applied there too — a stuck turn-abort against openclaw would otherwise leave the chat wedged
//      against a half-dead bridge indefinitely, not just briefly) — see this file's own orphan check
//      in `afterEach` below, which is what surfaces a regression here if this escalation ever breaks.
//
// SABOTAGE NOTES (per this task's brief — every new assertion was broken once, confirmed it failed,
// then reverted): the fixture-text assertion was flipped to expect literal "hello" (lowercase, the
// PROMPT text, not the fixture's reply) — failed as expected ("Hello!" !== "hello"). The
// path-specific /metrics assertion was changed to check a path that never gets hit
// ("/v1/does-not-exist") — failed as expected (0 !== >0). The `isError` assertion was flipped to
// `.toBe(true)` — failed as expected. The session-isolation test's own leak assertion was sabotaged
// by reverting agents.ts's openclaw entry to a fixed-constant session key — failed as expected (chat
// B's request DID contain chat A's marker). The orphan check itself was sabotaged by disabling
// driver.ts's KILL_ESCALATION_GRACE_MS escalation (bug #3 above) — both tests failed as expected,
// correctly reporting the leaked `openclaw`/`openclaw-acp` pids. All reverted after confirming each
// failure.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startCaptureLlmServer, type CaptureLlmHandle } from "../support/captureLlmServer";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";
import { getFreePort, startOpenclawGateway, type OpenclawGatewayHandle } from "../support/openclawGateway";
import { pidAlive } from "../support/acpFakeAgentProcess";

const HAS_OPENCLAW = whichBinary("openclaw") !== null;
const describeOrSkip = HAS_OPENCLAW ? describe : describe.skip;

if (!HAS_OPENCLAW) {
  // eslint-disable-next-line no-console
  console.warn("[openclawMocked.test] skipped — the `openclaw` CLI is not installed on this machine (nothing to drive).");
}

/** Sum of `aimock_requests_total{...}` counter values whose `path` label is exactly
 *  "/v1/chat/completions" — openclaw's own OpenAI-compatible model call (its `models.providers.mock`
 *  config sets `api: "openai-completions"`; confirmed live via a raw ACP handshake before this test
 *  existed). Deliberately a PATH-SPECIFIC counter, not "does aimock_requests_total appear at all" —
 *  that family also contains the mock's own `GET /metrics` self-hits, which would make a
 *  presence-only check pass even if openclaw never made a model call (see geminiMocked.test.ts's own
 *  header, finding #1, for the exact failure mode this avoids: a check that would still pass if the
 *  thing it claims to prove never happened). */
function chatCompletionsHitCount(metricsText: string): number {
  let total = 0;
  for (const line of metricsText.split("\n")) {
    if (!line.startsWith("aimock_requests_total{") || !line.includes('path="/v1/chat/completions"')) continue;
    const m = line.match(/}\s+([0-9.]+)\s*$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

// `pidAlive` (imported above from ../support/acpFakeAgentProcess.ts) is the SHARED, OWNED `ps -p`
// point check this file used to duplicate inline (task-F: consolidating every
// fakeAcpAgent.ts-adjacent orphan check onto one module). It is used below as an IMMEDIATE,
// non-polling check for `gatewayPid`/`mockPid` — deliberately NOT run through the shared module's
// `waitProcessesGone` bounded poll, because both pids are only read AFTER `gateway.stop()`/
// `mock.stop()` have already awaited `proc.exited` for them: a grace period here would let a
// process that dies a beat too late (e.g. 1.5s after `stop()` resolved) pass silently, weakening a
// check this task's own review round found had been softened exactly that way once already.
// `waitProcessesGone`'s tolerance is legitimate ONLY where death is not already confirmed by an
// awaited `proc.exited` — that is the ACP bridge case below, which needs a different mechanism
// entirely (see TOPOLOGY NOTE).
//
// TOPOLOGY NOTE, precisely (per this task's brief: "if openclaw's process topology does not fit the
// helper's shape... say so explicitly and handle it" — and per review: state exactly which shapes
// are covered and which are not, rather than a comment that reads as covering more than it does).
// This file has THREE distinct leak shapes, each requiring a DIFFERENT check:
//   1. Gateway launcher / mock — KNOWN pid, already-confirmed-dead-by-await. Covered by the
//      immediate `pidAlive()` checks below.
//   2. The ACP bridge, BOTH-ALIVE shape (`openclaw` + `openclaw-acp`, still children of THIS test
//      process because `closeChat()`'s kill is fire-and-forget and nothing has reaped them yet).
//      Covered by `collectDescendantPids(process.pid)` below, which walks this whole test process's
//      descendant tree and filters by name — CONFIRMED covering this shape live: raising
//      `driver.ts`'s `KILL_ESCALATION_GRACE_MS` to 60s (reverted after) reproduced both tests
//      failing here, reporting real surviving `openclaw`/`openclaw-acp` pids.
//   3. The Gateway's own hidden grandchild in the LAUNCHER-ALREADY-EXITED shape (openclawGateway.ts's
//      own header: "`openclaw gateway run` is NOT a single process — it's a short-lived `openclaw`
//      launcher... that itself spawns/execs a longer-lived `openclaw-gateway` process"). This is
//      NOT covered by `collectDescendantPids(process.pid)`: `await gateway?.stop()` runs BEFORE that
//      scan and only resolves once the LAUNCHER's own `proc.exited` fires, so if the grandchild ever
//      separates from an already-reaped launcher, it has ALREADY been reparented to PID 1 by the
//      time the scan runs — `pgrep -P` rooted at `process.pid` structurally cannot find a process
//      that is no longer its descendant. An earlier version of this comment claimed the scan
//      covered this shape; a reviewer disproved that with an orphan probe (launcher exits →
//      grandchild reparents to PID 1 → a `process.pid`-rooted walk returns nothing) and it was
//      wrong. This shape is exactly what the historical leak (an `openclaw`/`openclaw-gateway` pair
//      alive 14 hours later, the gateway holding a listening socket) could be, IF the launcher had
//      already been reaped by then — indistinguishable from "both still alive" (shape 2, which IS
//      covered) from the outside, but requiring a different check.
// Shape 3's REALISTIC sub-case — a surviving Gateway grandchild that is STILL LISTENING — is now
// covered: `waitPortFree` below re-binds the exact ephemeral port this Gateway was configured to
// listen on (the same probe-by-binding technique `getFreePort()` itself uses). Confirmed live: a
// dummy listener bound on that port after the real `gateway.stop()` resolved made both tests fail,
// reporting the exact port.
//
// PRECISELY WHAT THIS PROVES, AND WHAT IT STILL DOES NOT (a second review round caught this file's
// FIRST version of this note overclaiming again, one level deeper — the port check was described as
// covering "shape 3" outright, when it only covers the listening sub-case): `waitPortFree` proves
// "no listener is bound to this port." It does NOT prove "no orphaned process exists." A grandchild
// that closes its own listening socket but stays alive, reparented to PID 1, reads `isPortBound ===
// false` (nothing is bound, so the probe binds cleanly) AND is invisible to `collectDescendantPids`
// (no longer this process's descendant) — that specific shape is uncovered by every mechanism in
// this file, and this comment does not claim otherwise. The surviving-and-still-LISTENING case is
// the realistic one in practice (the whole reason the historical leak was ever noticed at all was
// `lsof` finding a listening socket — see this file's F1 header) and closing it is genuinely
// valuable; it is not the same claim as closing every possible orphan shape, and this comment says
// so explicitly rather than leaving that gap implicit.
//
// A separate, narrower race: `getFreePort()` binds then immediately releases the port before handing
// it to the Gateway, and `waitPortFree` re-binds it again at teardown, tens of seconds later — an
// UNRELATED process (e.g. a different concurrently-running test file's own ephemeral server) could
// coincidentally acquire that exact port number in either gap and produce a false positive ("still
// bound" reported for a reason that has nothing to do with this test's own Gateway). Judged not
// worth defending against here: the collision requires an exact match against the OS's ephemeral
// port range (tens of thousands of candidates) within a narrow window, this check only runs twice
// per suite run (once per test in this file), and the only real mitigation (identifying WHO holds
// the port via `lsof`+`ps` and cross-referencing its name) adds real complexity and its own
// platform-portability fragility for a residual risk this small. If this check is ever seen to fail
// spuriously, that is the first hypothesis to rule out before assuming a genuine leak.
function collectDescendantPids(rootPid: number): number[] {
  const out: number[] = [];
  const frontier = [rootPid];
  while (frontier.length) {
    const pid = frontier.pop()!;
    const r = Bun.spawnSync(["pgrep", "-P", String(pid)]);
    const children = r.stdout
      .toString()
      .trim()
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (const c of children) {
      out.push(c);
      frontier.push(c);
    }
  }
  return out;
}

/** `pid, comm` from a live `ps -p` lookup, or a "(already gone)" placeholder for a pid that's since
 *  exited (a normal outcome mid-poll, not an error — see the bounded poll below). */
function describePid(pid: number): string {
  const r = Bun.spawnSync(["ps", "-p", String(pid), "-o", "pid=,comm="]);
  const out = r.stdout.toString().trim();
  return out || `${pid} (already gone)`;
}

/** True if `port` is still BOUND by anyone on 127.0.0.1 — checked by attempting to bind an ephemeral
 *  listener there ourselves, the exact same probe-by-binding technique openclawGateway.ts's own
 *  `getFreePort()` uses. Deliberately NOT pid- or process-tree-based: this is ORPHANED-LISTENER
 *  detection, not orphan-PROCESS detection (see the TOPOLOGY NOTE above's own "PRECISELY WHAT THIS
 *  PROVES" paragraph) — it catches a Gateway grandchild that outlives an already-reaped launcher
 *  WHILE STILL LISTENING (a reparented orphan is no longer a descendant of this test process at
 *  all, so no pid/tree scan rooted here can ever see it, but a bound socket is directly observable
 *  regardless of ancestry). It does NOT catch an orphan that has already closed its listening
 *  socket but is still alive — that process is invisible to this check too, `false` here says
 *  "nothing is bound," not "nothing survived." */
function isPortBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(true)); // EADDRINUSE (or similar) — something still holds it
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(false)); // bound cleanly ourselves — nothing else was listening
    });
  });
}

/** Bounded poll (short — socket release can lag a beat behind process death at the OS level, unlike
 *  pid death, which is why this gets its own small grace period rather than the gatewayPid/mockPid
 *  checks' immediate style) for `port` to become free. Returns the pids/description-free "is it
 *  STILL bound" outcome after `timeoutMs`, so the caller can throw with detail. */
async function waitPortFree(port: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stillBound = await isPortBound(port);
  while (stillBound && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    stillBound = await isPortBound(port);
  }
  return stillBound;
}

describeOrSkip("the real openclaw CLI, driven through the ACP driver, against a real Gateway against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm/getFreePort/startOpenclawGateway)
  // — populating this after an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real OPENCLAW_CONFIG_PATH/OPENCLAW_STATE_DIR if they happened to have one set (the
  // same env-save-ordering class of bug this whole harness has fixed three times before — see
  // gooseMocked.test.ts/geminiMocked.test.ts's identical comments).
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  let capture: CaptureLlmHandle | undefined;
  let gateway: OpenclawGatewayHandle | undefined;
  // The exact ephemeral port `setup()`/`setupCapture()` picked for THIS test's own Gateway,
  // assigned ONLY once startOpenclawGateway has confirmed it's actually listening there (see
  // setup()'s own comment on why the assignment is anchored there, not at getFreePort() time) — see
  // `isPortBound`/`waitPortFree`'s doc comments for what afterEach's re-check of it does and does
  // not prove (orphaned-LISTENER detection, not orphan-process detection).
  let gatewayPort: number | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    // --metrics: aimock only exposes GET /metrics with this flag (confirmed live — omitting it
    // yields a plain 404 on /metrics, which is exactly why this file's path-specific hit-count
    // assertion below needs it, matching geminiMocked.test.ts's own setup).
    mock = await startMockLlm(undefined, ["--metrics"]);
    const workDir = await newTempDir("bismuth-openclaw-workdir-");
    const port = await getFreePort();
    const mockEnv = backendMockEnv("openclaw", mock.url, workDir, port);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // The Gateway and the ACP bridge (spawned later by CHAT_BACKENDS.openclaw, via
    // chatProviders/acp/driver.ts's claudeSpawnEnv(process.env, "chat")) must both read the SAME
    // config — passing process.env here (already carrying the two OPENCLAW_* vars just set above)
    // is what guarantees that; see openclawGateway.ts's own header for why a shared config file,
    // not a shared port arg, is the actual synchronization mechanism. `port` is also passed directly
    // so startOpenclawGateway can verify its OWN readiness banner reports that same port (see
    // openclawGateway.ts's LISTEN_BANNER_RE doc comment for why the comparison matters).
    gateway = await startOpenclawGateway(process.env, port);
    // Assigned only once startOpenclawGateway has RESOLVED (review round 2 finding): its own
    // readiness protocol confirms a real banner was observed on stdout AND that banner's own port
    // matched `port` before it resolves — so this is the earliest point at which "the Gateway is
    // actually bound to `port`" is a demonstrated fact, not an assumption. Assigning it any earlier
    // (e.g. right after getFreePort()) would leave `gatewayPort` set even if startOpenclawGateway
    // then THREW (a bad config, the binary missing, a startup timeout) — and afterEach's
    // `waitPortFree` check would then pass VACUOUSLY: "free" because nothing was ever bound there,
    // not because a real Gateway was torn down cleanly. A check that cannot fail because the thing
    // it inspects never existed proves nothing; anchoring the assignment on a confirmed-successful
    // start closes that.
    gatewayPort = port;
  }

  /** Setup variant for the session-isolation test below: same Gateway isolation, but the LLM
   *  backend is the request-capturing server (captureLlmServer.ts), not aimock — aimock has no way
   *  to expose a captured request's full body for inspection, only hit counts (see
   *  captureLlmServer.ts's own header for why a second, purpose-built server exists for this one
   *  test rather than reusing `mock`). Assigns to the SAME shared `gateway`/`capture` slots afterEach
   *  already tears down, so this test gets the same orphan-safety net as the one above. */
  async function setupCapture(replyText: string): Promise<void> {
    capture = startCaptureLlmServer(replyText);
    const workDir = await newTempDir("bismuth-openclaw-iso-workdir-");
    const port = await getFreePort();
    const mockEnv = backendMockEnv("openclaw", capture.url, workDir, port);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    gateway = await startOpenclawGateway(process.env, port);
    // See setup()'s identical comment: assigned only after startOpenclawGateway confirms a real
    // banner was observed on this exact port, so a failed start can never make waitPortFree pass
    // vacuously.
    gatewayPort = port;
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.openclaw.closeChat(id);
    // Stop the Gateway (a real, separately-run process — see this file's header) and the mock/capture
    // server BEFORE removing temp dirs, so neither is left mid-shutdown trying to read a config/log
    // path that no longer exists.
    await gateway?.stop();
    const gatewayPid = gateway?.pid;
    const port = gatewayPort;
    gateway = undefined;
    gatewayPort = undefined;
    await mock?.stop();
    const mockPid = mock?.pid;
    mock = undefined;
    capture?.stop();
    capture = undefined;
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    // Per this task's brief: "Kill every process you start... verify with ps that nothing
    // survives" — OWNED checks only, never a machine-wide `pgrep -f` (see pidAlive's/
    // collectDescendantPids's own doc comments for why that matters, not just style). Every check
    // below runs AFTER all cleanup above, so a failing check can never skip it.
    //
    // Gateway + mock: both already resolved via a stop() that AWAITS proc.exited internally
    // (openclawGateway.ts's stopProcess / mockLlm.ts's stopProcess) — so an IMMEDIATE, non-polling
    // check is correct here, not merely convenient: `stop()` having resolved IS the claim that the
    // process already exited, so any grace period here would let a process that dies a beat late
    // pass silently (review round 1 found exactly this: a prior version of this diff had softened
    // this to a 2s-tolerant poll without saying so — reverted; see this file's TOPOLOGY NOTE above
    // for where a poll's tolerance actually is legitimate).
    if (gatewayPid !== undefined && pidAlive(gatewayPid)) {
      throw new Error(`openclawMocked.test: gateway pid ${gatewayPid} still alive after gateway.stop() resolved — a real leak.`);
    }
    if (mockPid !== undefined && pidAlive(mockPid)) {
      throw new Error(`openclawMocked.test: mock pid ${mockPid} still alive after mock.stop() resolved — a real leak.`);
    }
    // Gateway grandchild, LAUNCHER-ALREADY-EXITED orphan shape (TOPOLOGY NOTE shape 3): the launcher
    // pid check above only proves the LAUNCHER is gone — it says nothing about a grandchild that
    // separated and outlived it, already reparented to PID 1 by now. Re-bind the Gateway's own
    // ephemeral port directly instead of walking any process tree. ORPHANED-LISTENER detection only
    // (see isPortBound's own doc comment) — an orphan that already released this port but stayed
    // alive is not caught by this check either.
    if (port !== undefined && (await waitPortFree(port))) {
      throw new Error(
        `openclawMocked.test: port ${port} (this test's own Gateway port) is still bound after gateway.stop() ` +
          `resolved — an orphaned listener (possibly the Gateway's own hidden grandchild, reparented and ` +
          `therefore invisible to any pid/process-tree scan rooted at this test process) is still holding it.`,
      );
    }
    // ACP bridge: CHAT_BACKENDS.openclaw.closeChat() (chatProviders/acp/driver.ts) returns
    // synchronously — its own SIGTERM-then-SIGKILL escalation (killWithEscalation,
    // KILL_ESCALATION_GRACE_MS) runs fire-and-forget in the background, so unlike the two checks
    // above, an immediate single-shot check here would race that escalation actually landing. Bounded
    // poll (5s — comfortably past KILL_ESCALATION_GRACE_MS's own 3s) of this test PROCESS's own
    // descendant tree, scoped so it can never match an unrelated developer-started openclaw process
    // (see collectDescendantPids's doc comment). This is the BOTH-ALIVE shape (TOPOLOGY NOTE shape
    // 2) — the ACP bridge is still a live child of this test process the whole time it's alive, so a
    // process-tree walk rooted here genuinely covers it (confirmed live — see the TOPOLOGY NOTE).
    //
    // Filters on "openclaw" only, deliberately NOT "aimock" too (an earlier version of this filter
    // said `/openclaw|aimock/i`, implying it covered the mock as defense-in-depth — it never did:
    // `mockLlm.ts` spawns aimock via `Bun.spawn(["node", bin, ...])`, so its `comm` is the plain
    // string "node", which that pattern can never match). The mock IS still fully covered — by the
    // exact `pidAlive(mockPid)` check above, not this scan — so nothing is actually left unguarded;
    // only the CLAIM in the old error message overstated what this specific check covers.
    const deadline = Date.now() + 5000;
    let remaining: number[] = [];
    while (Date.now() < deadline) {
      remaining = collectDescendantPids(process.pid).filter((pid) => /openclaw/i.test(describePid(pid)));
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (remaining.length > 0) {
      throw new Error(
        `openclawMocked.test: ${remaining.length} openclaw-related descendant process(es) of this test ` +
          `still running 5s after teardown (the ACP bridge's own SIGTERM-then-SIGKILL escalation, ` +
          `driver.ts's KILL_ESCALATION_GRACE_MS, should have reaped these within ~3s): ${remaining.map(describePid).join(", ")}`,
      );
    }
  }, 15_000); // Bun's default hook timeout (5000ms) is shorter than the bounded poll above can
  // legitimately take on its own (up to 5s) on top of gateway.stop()'s own up-to-5s grace-then-
  // SIGKILL window — an explicit, generous timeout here so a slow-but-successful teardown reports as
  // a pass, not a hook-timeout failure that looks like a hang.

  test(
    "a turn sent through CHAT_BACKENDS.openclaw returns the fixture's exact text, then terminates with result + done, proven by a path-specific mock hit",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-openclaw-cwd-");
      const chatId = "openclaw-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(45_000);

      const before = chatCompletionsHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(before).toBe(0); // sanity: nothing hit the model endpoint before this turn

      CHAT_BACKENDS.openclaw.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture — no real model replies to "hello" with the
        // literal string "Hello!" verbatim, and the mock is the ONLY baseUrl this openclaw
        // Gateway's "mock" provider was ever configured with.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") expect(resultFrame.isError).toBe(false);

      // The process-level proof this task's brief specifically demands: a PATH-SPECIFIC counter
      // delta (never the mere presence of a metric name — see this file's chatCompletionsHitCount
      // doc comment for the exact failure mode avoided) confirming the request actually landed on
      // the mock, not merely that the driver reported success.
      const after = chatCompletionsHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(after).toBeGreaterThan(before);
    },
    60_000,
  );

  test(
    "session isolation: a brand-new second chat's upstream request carries NO content from a completed first chat (closes the cross-chat leak a fixed session key would reopen)",
    async () => {
      // Reproduces the exact scenario review caught against a first (reverted) version of this fix,
      // which used a FIXED constant `--session` value for every chat: chat A completes, then a
      // BRAND-NEW chat B (different chatId, different cwd, never seen before) sends its first-ever
      // upstream request — and with a shared session key, that request carried chat A's own text
      // inside it. This test proves the per-chat `agent:main:bismuth-<chatId>` fix
      // (agents.ts's `sessionKeyArgs`) keeps that from happening, using distinctive per-chat markers
      // no real conversation would ever produce, so a match can only mean actual cross-chat bleed —
      // not a coincidental substring.
      const MARKER_A = "ZEBRA-ALPHA-marker";
      const MARKER_B = "QUOKKA-BETA-marker";
      await setupCapture("Hello!");

      const cwdA = await newTempDir("bismuth-openclaw-iso-cwd-a-");
      const chatA = "openclaw-iso-a-" + Date.now();
      chatIds.push(chatA);
      const collectorA = makeChatFrameCollector(45_000);

      CHAT_BACKENDS.openclaw.sendMessage({ chatId: chatA, cwd: cwdA, sink: collectorA.sink, computerUse: false, text: MARKER_A });
      await collectorA.waitFor((f) => f.type === "assistant-text");
      await collectorA.waitFor((f) => f.type === "done");
      // Chat A is done with its own turn but deliberately left OPEN here (not closeChat'd yet) —
      // the leak review reproduced is about a SEQUENTIAL new chat while the Gateway's own on-disk
      // session state persists, not about concurrent access; closing A first would only prove
      // isolation-after-close, a narrower and less realistic claim than what actually matters (the
      // normal "open a new chat later" case). afterEach still closes/tears down both regardless.

      expect(
        capture!.captured.length,
        "exactly one upstream request expected for chat A's own turn so far (before chat B sends anything) — a count " +
          "other than 1 here means openclaw itself made an unexpected number of upstream calls for a single turn " +
          "(e.g. a retry, or more than one model round-trip), which this test cannot distinguish from a real " +
          "regression and is worth investigating on its own, independent of what this test is actually checking for",
      ).toBe(1);
      expect(JSON.stringify(capture!.captured[0])).toContain(MARKER_A);
      expect(JSON.stringify(capture!.captured[0])).not.toContain(MARKER_B);

      const cwdB = await newTempDir("bismuth-openclaw-iso-cwd-b-");
      const chatB = "openclaw-iso-b-" + Date.now();
      chatIds.push(chatB);
      const collectorB = makeChatFrameCollector(45_000);

      CHAT_BACKENDS.openclaw.sendMessage({ chatId: chatB, cwd: cwdB, sink: collectorB.sink, computerUse: false, text: MARKER_B });
      await collectorB.waitFor((f) => f.type === "assistant-text");
      await collectorB.waitFor((f) => f.type === "done");

      expect(
        capture!.captured.length,
        "exactly two upstream requests expected total (chat A's + chat B's own) — a count other than 2 here means " +
          "either chat A or chat B's turn made an unexpected number of upstream calls (see the identical note on " +
          "the count==1 check above); this test's own leak assertions below only make sense once this holds",
      ).toBe(2);
      const chatBRequest = JSON.stringify(capture!.captured[1]);
      // The actual leak assertion: chat B's own marker must be present (it's B's own turn)...
      expect(chatBRequest).toContain(MARKER_B);
      // ...and chat A's marker must be ABSENT — this is the one that failed against the fixed
      // session key this test was written to catch (chat A's text arrived inside chat B's first-ever
      // request when both resolved to the same Gateway session).
      expect(chatBRequest).not.toContain(MARKER_A);
    },
    60_000,
  );
});
