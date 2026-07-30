// Task 3 of the offline-integration-testing plan: prove that a REAL `claude` binary, driven
// through Bismuth's OWN chat driver (core/src/chat.ts's sendMessage — the exact function the
// in-app visual chat calls), completes a turn against the local mock LLM server (core/test/
// support/mockLlm.ts) with ZERO calls against the user's real Anthropic account.
//
// This is deliberately NOT a "live" test (core/test/liveGate.ts) — it must run by default in
// `bun test core`, because unlike chat.test.ts's live describe block (which spends real API
// quota against the user's own account and is opt-in via BISMUTH_LIVE_TESTS), this test's whole
// point is that no account and no quota are ever touched. It only needs to skip when the
// `claude` binary itself isn't installed (CI may not have it) — that is a missing-binary skip,
// not a missing-account skip, and the two must never be conflated (see the task brief).
//
// FINDING (Step 2 of the brief): core/src/chat.ts's spawnChatQuery does NOT build its subprocess
// env via claudeSpawnEnv() (core/src/claudeWhich.ts) — that helper is used by the OTHER chat
// drivers (opencode/acp/codex, see chatProviders/spawnChannel.test.ts), but the Claude driver in
// chat.ts passes `env: { ...process.env, BISMUTH_AGENT_CHANNEL: "chat" }` straight to the SDK's
// query() options (chat.ts ~line 1073) — a plain spread of THIS PROCESS's OWN process.env, taken
// at the moment spawnChatQuery runs (i.e. synchronously inside the sendMessage() call below), not
// cached at module load. So no source change was needed to thread the mock env through: setting
// process.env.ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY on THIS test process
// before calling sendMessage() is sufficient — spawnChatQuery's snapshot picks them up and the
// Claude Agent SDK forwards an explicit `options.env` to the spawned child VERBATIM (verified by
// reading node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs: an explicit `env` option is used
// as the child's env as-is, not re-merged with the SDK's own default `{...process.env}` fallback,
// which only applies when the caller passes no `env` at all). This was verified empirically by
// running this exact test, not assumed — see the report for the full account of what was checked.
//
// No production files were changed for this task.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeChat, newChatId, sendMessage } from "../../src/chat";
import { whichClaude } from "../../src/claudeWhich";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_CLAUDE = whichClaude() !== null;
const describeOrSkip = HAS_CLAUDE ? describe : describe.skip;

if (!HAS_CLAUDE) {
  // eslint-disable-next-line no-console
  console.warn("[claudeMocked.test] skipped — the `claude` CLI is not installed on this machine (nothing to drive).");
}

describeOrSkip("the real claude CLI, driven through chat.ts's sendMessage, against a mock LLM (zero account API calls)", () => {
  // Env vars this test overrides for the duration of the suite, and their ORIGINAL values (which
  // may be a real machine's real ANTHROPIC_* vars, or undefined) — restored in afterAll so this
  // test can never leave a poisoned env behind for any other test file sharing this process.
  const ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function setup(): Promise<void> {
    mock = await startMockLlm(); // default fixture dir: core/test/fixtures/llm (basic-turn.json)
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // This is the ONE row backendEnv.ts marks VERIFIED live on a real machine (see that file's
    // header): env auth takes precedence over Claude Code's own keychain OAuth login.
    const mockEnv = backendMockEnv("claude", mock.url);
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
    for (const id of chatIds.splice(0)) closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function newTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bismuth-claude-mocked-"));
    tempDirs.push(dir);
    return dir;
  }

  test(
    "a turn sent through sendMessage() returns the fixture's exact text in an assistant-text frame, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir(); // never the real vault — a throwaway temp dir
      const chatId = newChatId();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(60_000);

      // "hello" is the fixture's exact match key (core/test/fixtures/llm/basic-turn.json). chat.ts
      // sends a bare-string user turn (makeUserMessage: no images → plain string), so this is the
      // exact text the mock's userMessage substring-match sees as the last user message.
      await sendMessage(chatId, "hello", cwd, sink);

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // The load-bearing assertion for "no real API call happened": this exact sentinel string
        // can ONLY have come from the local fixture (core/test/fixtures/llm/basic-turn.json's
        // {"response":{"content":"Hello!"}}) — no real model replies to "hello" with the literal,
        // unpunctuated-elsewhere string "Hello!" verbatim, and the mock is the only thing on the
        // other end of ANTHROPIC_BASE_URL for the lifetime of this test.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      // The turn must terminate with `result` BEFORE `done` (chat.ts always emits result then done
      // — see the ChatFrame union's own doc comments on "result"/"done").
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") {
        expect(resultFrame.isError).toBe(false);
      }
    },
    60_000,
  );
});
