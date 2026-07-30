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
//      grace-then-SIGKILL escalation (driver.ts's `CLOSE_KILL_GRACE_MS`) — see this file's own orphan
//      check in `afterEach` below, which is what surfaces a regression here if this escalation ever
//      breaks.
//
// SABOTAGE NOTES (per this task's brief — every new assertion was broken once, confirmed it failed,
// then reverted): the fixture-text assertion was flipped to expect literal "hello" (lowercase, the
// PROMPT text, not the fixture's reply) — failed as expected ("Hello!" !== "hello"). The
// path-specific /metrics assertion was changed to check a path that never gets hit
// ("/v1/does-not-exist") — failed as expected (0 !== >0). The `isError` assertion was flipped to
// `.toBe(true)` — failed as expected. The session-isolation test's own leak assertion was sabotaged
// by reverting agents.ts's openclaw entry to a fixed-constant session key — failed as expected (chat
// B's request DID contain chat A's marker). The orphan check itself was sabotaged by disabling
// driver.ts's CLOSE_KILL_GRACE_MS escalation (bug #3 above) — both tests failed as expected, correctly
// reporting the leaked `openclaw`/`openclaw-acp` pids. All reverted after confirming each failure.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startCaptureLlmServer, type CaptureLlmHandle } from "../support/captureLlmServer";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";
import { getFreePort, startOpenclawGateway, type OpenclawGatewayHandle } from "../support/openclawGateway";

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

/** True if `pid` still names a live process — an OWNED point check (never a machine-wide `pgrep -f`
 *  pattern match, which could hit an unrelated `openclaw gateway run` a developer started themselves
 *  — the product's own normal deployment, it ships a `service` installer). Used below on pids this
 *  test itself received back from starting a process, after that process's own stop()/exit already
 *  resolved — so a `true` here means a genuine leak, not a race with an in-flight shutdown. */
function pidAlive(pid: number): boolean {
  return Bun.spawnSync(["ps", "-p", String(pid)]).exitCode === 0;
}

/** All PIDs descending from `rootPid` (children, grandchildren, ...) via `pgrep -P`. Used only for
 *  the ACP bridge subprocess below, which — unlike the Gateway (openclawGateway.ts's `stop()`) and
 *  the mock (mockLlm.ts's `stop()`), both of which AWAIT `proc.exited` — this test cannot get a pid
 *  for directly: `CHAT_BACKENDS.openclaw.closeChat()` calls `proc.kill()` internally
 *  (chatProviders/acp/driver.ts's closeChat) and returns void, without exposing the killed process
 *  or awaiting its exit. Scoping the search to `process.pid`'s OWN descendant tree (not a
 *  machine-wide name pattern) means this can never match an unrelated process a developer started
 *  outside this test — only something THIS test process itself, directly or indirectly, spawned. */
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
    gateway = undefined;
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
    // collectDescendantPids's own doc comments for why that matters, not just style).
    //
    // Gateway + mock: both already resolved via a stop() that AWAITS proc.exited internally
    // (openclawGateway.ts's stopProcess / mockLlm.ts's stopProcess) — so a direct `ps -p` here is a
    // simple confirmation, not a race.
    if (gatewayPid !== undefined && pidAlive(gatewayPid)) {
      throw new Error(`openclawMocked.test: gateway pid ${gatewayPid} still alive after gateway.stop() resolved — a real leak.`);
    }
    if (mockPid !== undefined && pidAlive(mockPid)) {
      throw new Error(`openclawMocked.test: mock pid ${mockPid} still alive after mock.stop() resolved — a real leak.`);
    }
    // ACP bridge: CHAT_BACKENDS.openclaw.closeChat() calls proc.kill() internally
    // (chatProviders/acp/driver.ts's closeChat) but does NOT await proc.exited — so unlike the two
    // checks above, an immediate single-shot check here would race the kill signal actually landing.
    // Bounded poll (5s) of this test PROCESS's own descendant tree, scoped so it can never match an
    // unrelated developer-started openclaw process (see collectDescendantPids's doc comment).
    const deadline = Date.now() + 5000;
    let remaining: number[] = [];
    while (Date.now() < deadline) {
      remaining = collectDescendantPids(process.pid).filter((pid) => /openclaw|aimock/i.test(describePid(pid)));
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (remaining.length > 0) {
      throw new Error(
        `openclawMocked.test: ${remaining.length} openclaw/aimock-related descendant process(es) of this test ` +
          `still running 5s after teardown: ${remaining.map(describePid).join(", ")}`,
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

      expect(capture!.captured.length).toBe(1); // sanity: exactly chat A's own request so far
      expect(JSON.stringify(capture!.captured[0])).toContain(MARKER_A);
      expect(JSON.stringify(capture!.captured[0])).not.toContain(MARKER_B);

      const cwdB = await newTempDir("bismuth-openclaw-iso-cwd-b-");
      const chatB = "openclaw-iso-b-" + Date.now();
      chatIds.push(chatB);
      const collectorB = makeChatFrameCollector(45_000);

      CHAT_BACKENDS.openclaw.sendMessage({ chatId: chatB, cwd: cwdB, sink: collectorB.sink, computerUse: false, text: MARKER_B });
      await collectorB.waitFor((f) => f.type === "assistant-text");
      await collectorB.waitFor((f) => f.type === "done");

      expect(capture!.captured.length).toBe(2); // sanity: chat B's own request landed too
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
