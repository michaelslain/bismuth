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
// A REAL BUG WAS FOUND AND FIXED to make this test possible at all (see agents.ts's openclaw entry
// for the full root-cause writeup): Bismuth's OLD default spawn args (`openclaw acp`, no `--session`)
// reliably failed the FIRST session/prompt on ANY fresh Gateway — a genuine, pre-existing production
// bug independent of mocking, not a test artifact. Fixed by adding `--session agent:main:bismuth` to
// agents.ts's openclaw entry (sidesteps a session-key-naming collision with an unrelated OpenClaw
// feature). KNOWN LIMITATION of that fix, not solved here: this session key is static per-backend
// (not per-chat), so concurrent Bismuth chats through openclaw currently share one Gateway session —
// see agents.ts's own comment for the follow-up this would need.
//
// SABOTAGE NOTES (per this task's brief — every new assertion was broken once, confirmed it failed,
// then reverted): the fixture-text assertion was flipped to expect literal "hello" (lowercase, the
// PROMPT text, not the fixture's reply) — failed as expected ("Hello!" !== "hello"). The path-specific
// /metrics assertion was changed to check a path that never gets hit ("/v1/does-not-exist") — failed
// as expected (0 !== >0). The `isError` assertion was flipped to `.toBe(true)` — failed as expected
// (driver reports isError:false for a real successful turn). All three reverted after confirming the
// failure; see this file's own git history / the task report for the exact diffs sabotaged.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
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
    // not a shared port arg, is the actual synchronization mechanism.
    gateway = await startOpenclawGateway(process.env);
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.openclaw.closeChat(id);
    // Stop the Gateway (a real, separately-run process — see this file's header) and the mock BEFORE
    // removing temp dirs, so neither is left mid-shutdown trying to read a config/log path that no
    // longer exists.
    await gateway?.stop();
    gateway = undefined;
    await mock?.stop();
    mock = undefined;
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    // Per this task's brief: "Kill every process you start... verify with ps that nothing
    // survives" — belt-and-suspenders beyond openclawGateway.ts's own stop()/mockLlm.ts's own
    // stop() resolving cleanly. A stray match here means a LEAK, not a false negative — both
    // stop() calls above already awaited full process exit.
    const leftover = Bun.spawnSync(["pgrep", "-f", "openclaw-gateway|aimock/dist/cli.js"]);
    if (leftover.stdout.toString().trim()) {
      throw new Error(
        "openclawMocked.test: a process matching openclaw-gateway or aimock's cli.js is STILL RUNNING " +
          "after this test's own stop() calls resolved — a real orphan, not expected. PIDs:\n" +
          leftover.stdout.toString(),
      );
    }
  });

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
});
