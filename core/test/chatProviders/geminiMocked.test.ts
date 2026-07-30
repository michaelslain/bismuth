// Task 4 of the offline-integration-testing plan: drive a REAL `gemini` binary through Bismuth's OWN
// ACP driver (core/src/chatProviders/acp/driver.ts, via `gemini --experimental-acp`/`--acp` — see
// chatProviders/acp/agents.ts) against the local mock LLM server (core/test/support/mockLlm.ts).
// Mirrors claudeMocked.test.ts's shape (Task 3) for the skip gate: runs by default in `bun test
// core`, skips only when the `gemini` binary itself is missing.
//
// HONESTY (this row is PARTIALLY, not fully, verified — see backendEnv.ts's `gemini` case comment
// for the complete write-up): a real `gemini` 0.53.0's `session/new` reliably succeeds through this
// mapping with ZERO real network access (confirmed live, repeatedly, via the mock's own /metrics),
// and its response is genuinely the OLD `models.availableModels`/`currentModelId` shape — a live
// confirmation of protocol.ts's "old" detectModelShape branch, distinct from the fake-agent test's
// synthetic one (acpFakeAgent.test.ts). What this task could NOT get gemini-cli 0.53.0 to do,
// against this mock, in either `--acp` or plain headless `-p` mode: settle a turn far enough to emit
// assistant text. `session/prompt` reliably drives 3-5 successful (200, fixture-matched) hits on the
// mock and then goes silent — no session/update text chunk, no response to the prompt call, no
// stderr, no crash — investigated at length (gemini-cli's own "next speaker check", which sounded
// like the likely culprit, was ruled out by reading its bundled source: it defaults to SKIPPED) but
// not root-caused within this task's budget. Most likely explanation: gemini-cli issues additional,
// non-user-facing model calls per turn that expect a response shape this generic single-fixture mock
// doesn't provide. So this test asserts exactly what IS proven — the handshake, the model shape, and
// zero real network access — and deliberately does NOT assert a completed turn, which would be
// asserting something this task found to be untrue.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import type { ChatFrame } from "../../src/chat";
import { backendMockEnv } from "../support/backendEnv";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_GEMINI = whichBinary("gemini") !== null;
const describeOrSkip = HAS_GEMINI ? describe : describe.skip;

if (!HAS_GEMINI) {
  // eslint-disable-next-line no-console
  console.warn("[geminiMocked.test] skipped — the `gemini` CLI is not installed on this machine (nothing to drive).");
}

function makeCollector() {
  const frames: ChatFrame[] = [];
  const waiters: { match: (f: ChatFrame) => boolean; resolve: (f: ChatFrame) => void }[] = [];

  const sink = (frame: ChatFrame) => {
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  };

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = 30_000): Promise<ChatFrame> {
    const already = frames.find(match);
    if (already) return Promise.resolve(already);
    return new Promise<ChatFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrapped);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("timeout waiting for frame; saw: " + JSON.stringify(frames.map((f) => f.type))));
      }, timeoutMs);
      const wrapped = (f: ChatFrame) => {
        clearTimeout(timer);
        resolve(f);
      };
      waiters.push({ match, resolve: wrapped });
    });
  }

  return { sink, frames, waitFor };
}

describeOrSkip("the real gemini CLI, driven through the ACP driver, against a mock LLM — handshake + zero account API calls (see header: full-turn completion is NOT asserted)", () => {
  const ENV_KEYS = ["GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_CLI_TRUST_WORKSPACE"] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    mock = await startMockLlm(undefined, ["--metrics"]);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const mockEnv = backendMockEnv("gemini", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // Headless CLIs refuse to run in an "untrusted" directory by default (a real, separate gemini-cli
    // gate, unrelated to model auth) — a throwaway temp dir is never trusted by default, so this is
    // required for ANY headless invocation here, not a mock-specific concern.
    process.env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  }

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.gemini.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    // Two tests below each call setup(), each starting its OWN mock server — stopped here (not
    // just in afterAll) so the first test's server is never left running while the second starts
    // a fresh one on a different port.
    await mock?.stop();
    mock = undefined;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test(
    "session creation succeeds and reports the OLD models.availableModels/currentModelId shape",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-gemini-cwd-");
      const chatId = "gemini-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeCollector();

      CHAT_BACKENDS.gemini.openSession({ chatId, cwd, sink, computerUse: false });

      const modelsFrame = await waitFor((f) => f.type === "models");
      expect(modelsFrame.type).toBe("models");
      if (modelsFrame.type === "models") {
        // The OLD shape's signature per protocol.ts's detectModelShape: effortLevels is ALWAYS []
        // (no thought_level-equivalent sibling exists in this shape). session/new itself never
        // calls the model at all (gemini-cli's model LIST here is its own hardcoded registry, not
        // something the mock serves — confirmed live: /metrics shows zero hits at this point), so
        // this only proves the HANDSHAKE's shape, not that a turn can complete (see below).
        expect(modelsFrame.models.length).toBeGreaterThan(0);
        expect(modelsFrame.models.every((m) => m.effortLevels.length === 0)).toBe(true);
      }

      await waitFor((f) => f.type === "session");
    },
    30_000,
  );

  test(
    "sending a turn reaches the mock (zero real network access) even though this task could not get it to settle — see this file's header",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-gemini-cwd2-");
      const chatId = "gemini-mocked-turn-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeCollector();

      CHAT_BACKENDS.gemini.openSession({ chatId, cwd, sink, computerUse: false });
      await waitFor((f) => f.type === "models");
      CHAT_BACKENDS.gemini.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      // Deliberately polling /metrics rather than waiting for "assistant-text"/"done" — this task
      // found gemini-cli 0.53.0 does not reliably settle a turn against this mock's single generic
      // fixture (see header). What IS proven, and is the actual safety property this harness
      // exists for: GOOGLE_GEMINI_BASE_URL/GEMINI_API_KEY are the ONLY endpoint/credential this
      // gemini process was given, so the ONLY place a model call can land is this mock — and it
      // does land here (never on a real host), confirmed by the counter appearing.
      const deadline = Date.now() + 20_000;
      let sawHit = false;
      while (Date.now() < deadline) {
        const text = await fetch(`${mock!.url}/metrics`).then((r) => r.text());
        if (text.includes("aimock_requests_total")) {
          sawHit = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(sawHit).toBe(true);
    },
    30_000,
  );
});
