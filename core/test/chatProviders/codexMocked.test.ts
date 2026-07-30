// Task 4 of the offline-integration-testing plan: prove that a REAL `codex` binary, driven through
// Bismuth's OWN codex chat driver (core/src/chatProviders/codex/driver.ts, via the CHAT_BACKENDS
// registry chat.ts's WS layer also dispatches through), completes a turn against the local mock LLM
// server (core/test/support/mockLlm.ts) with ZERO calls against any real provider account. Mirrors
// claudeMocked.test.ts's shape (Task 3): runs by default in `bun test core`, skips only when the
// `codex` binary itself is missing — a missing-BINARY skip, never a missing-account skip.
//
// FINDING (this task): the mapping this test used to rely on (OPENAI_BASE_URL/OPENAI_API_KEY) is
// CONFIRMED WRONG for this codex version — run live, it dialed straight past those env vars to the
// REAL `wss://api.openai.com/v1/responses` (only failing with 401 because no real key was present;
// with one, this would have been a genuine billed call). See backendEnv.ts's `codex` case comment
// for the full root-cause (codex's built-in "openai" provider id cannot be overridden at all, and
// its default wire transport for that provider doesn't consult OPENAI_BASE_URL). The FIX,
// live-verified end to end through THIS driver unmodified: a `$CODEX_HOME/config.toml` declaring a
// custom (non-"openai") provider with `wire_api = "responses"` (`"chat"` is rejected outright by
// this codex version) as the DEFAULT provider/model — `backendMockEnv("codex", url, workDir)` writes
// that file into `workDir` and returns `{CODEX_HOME: workDir, ...}`.
//
// KNOWN COSMETIC QUIRK, asserted around rather than hidden: codex logs a benign "Model metadata for
// `mock` not found" item for any model under a non-built-in provider (its metadata registry doesn't
// know one it doesn't own) — chatProviders/codex/protocol.ts's translator correctly treats any
// "error"-typed item as `sawErrorFrame`, so this turn's `result` frame reports `isError:true` even
// though the assistant's actual text arrives correctly. This test asserts on the text (the thing
// that actually proves the mock served the turn), not on `result.isError`, and says so inline —
// asserting `isError:false` here would be asserting something this task found to be untrue.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import type { ChatFrame } from "../../src/chat";
import { backendMockEnv } from "../support/backendEnv";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_CODEX = whichBinary("codex") !== null;
const describeOrSkip = HAS_CODEX ? describe : describe.skip;

if (!HAS_CODEX) {
  // eslint-disable-next-line no-console
  console.warn("[codexMocked.test] skipped — the `codex` CLI is not installed on this machine (nothing to drive).");
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

describeOrSkip("the real codex CLI, driven through chatProviders/codex/driver.ts, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["CODEX_HOME", "OPENAI_BASE_URL", "OPENAI_API_KEY", "MOCK_CODEX_API_KEY"] as const;
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
    mock = await startMockLlm();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // Never OPENAI_BASE_URL/OPENAI_API_KEY for codex (see this file's header) — clear any that a
    // developer's own shell might already have set, so this test can't accidentally pass for the
    // wrong reason (codex silently using a real key it happens to find).
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    const codexHome = await newTempDir("bismuth-codex-home-");
    const mockEnv = backendMockEnv("codex", mock.url, codexHome);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await mock?.stop();
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.codex.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test(
    "a turn sent through CHAT_BACKENDS.codex returns the fixture's exact text, then terminates with done",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-codex-cwd-");
      const chatId = "codex-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeCollector();

      CHAT_BACKENDS.codex.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture — no real model replies to "hello" with the
        // literal string "Hello!" verbatim, and $CODEX_HOME/config.toml's custom provider base_url
        // is the only thing this codex process talks to for the lifetime of this test.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      // Deliberately NOT asserting result.isError here — see this file's header on the benign
      // "Model metadata not found" quirk this codex version logs for any custom provider's model.
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
    },
    60_000,
  );
});
