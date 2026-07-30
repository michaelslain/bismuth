// Task 4 of the offline-integration-testing plan: prove that a REAL `goose` binary, driven through
// Bismuth's OWN ACP driver (core/src/chatProviders/acp/driver.ts, via `goose acp` — see
// chatProviders/acp/agents.ts), completes a turn against the local mock LLM server
// (core/test/support/mockLlm.ts) with ZERO calls against any real provider account. Mirrors
// claudeMocked.test.ts's shape (Task 3): runs by default in `bun test core`, skips only when the
// `goose` binary itself is missing — a missing-BINARY skip, never a missing-account skip.
//
// At the time this task ran, this was the ONE ACP-native backend (of cline/gemini/goose/openclaw)
// that task could verify FULLY end to end: `goose acp`'s `session/new` succeeds immediately (no
// `authenticate` gate, unlike cline's ACP mode), and `session/prompt` streamed a real
// `agent_message_chunk` carrying the mock fixture's exact "Hello!" text, settling with
// `stopReason:"end_turn"` — a clean assistant-text frame through the driver, confirmed via the mock's
// own /metrics: exactly one `GET /v1/models` hit (session/new discovering the configured provider's
// models) and two `POST /v1/messages` hits (both 200, fixture-matched), never a real anthropic.com
// request. See backendEnv.ts's `goose` case comment for the full write-up (upgraded from GUESSED to
// VERIFIED this task). gemini later joined it (offline2/gemini branch — see geminiMocked.test.ts's
// header): goose just never needed extra fixtures for gemini-cli's own routing/next-speaker-check
// calls, since goose doesn't make them.
//
// LOCAL-STATE ISOLATION: goose persists config/session state under
// $XDG_CONFIG_HOME/$XDG_DATA_HOME/$XDG_STATE_HOME (confirmed live via `goose info`'s own path
// listing) — all three are redirected to throwaway temp dirs below so this test can never read or
// write a developer's real ~/.config/goose, independent of (and in addition to) backendMockEnv's own
// mapping, which only points goose's PROVIDER at the mock.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_GOOSE = whichBinary("goose") !== null;
const describeOrSkip = HAS_GOOSE ? describe : describe.skip;

if (!HAS_GOOSE) {
  // eslint-disable-next-line no-console
  console.warn("[gooseMocked.test] skipped — the `goose` CLI is not installed on this machine (nothing to drive).");
}

describeOrSkip("the real goose CLI, driven through the ACP driver, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["ANTHROPIC_HOST", "ANTHROPIC_API_KEY", "GOOSE_PROVIDER", "GOOSE_MODEL", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on this
  // task: populating this AFTER an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real ANTHROPIC_API_KEY/XDG_* vars this test never touched.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    mock = await startMockLlm();
    const mockEnv = backendMockEnv("goose", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // Isolation, not mocking — see this file's header.
    process.env.XDG_CONFIG_HOME = await newTempDir("bismuth-goose-xdgcfg-");
    process.env.XDG_DATA_HOME = await newTempDir("bismuth-goose-xdgdata-");
    process.env.XDG_STATE_HOME = await newTempDir("bismuth-goose-xdgstate-");
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await mock?.stop();
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.goose.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test(
    "a turn sent through CHAT_BACKENDS.goose returns the fixture's exact text, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-goose-cwd-");
      const chatId = "goose-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.goose.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture — no real model replies to "hello" with the
        // literal string "Hello!" verbatim, and ANTHROPIC_HOST is the only thing goose's configured
        // "anthropic" provider talks to for the lifetime of this test.
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
    },
    60_000,
  );
});
