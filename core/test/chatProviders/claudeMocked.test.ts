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
  // may be a real machine's real ANTHROPIC_*/CLAUDE_* vars, or undefined) — restored in afterAll so
  // this test can never leave a poisoned env behind for any other test file sharing this process.
  //
  // FINAL-REVIEW FINDING (Critical #1): the four BEDROCK/VERTEX entries were missing entirely, and
  // this is the one mocked test where that mattered — it's the only one that always runs on a
  // machine with the binary installed. chat.ts's spawnChatQuery passes a VERBATIM
  // `{...process.env}` spread to the Claude Agent SDK (see this file's header), so any of these
  // four ambient in a developer's shell reach the spawned child untouched by ANTHROPIC_BASE_URL —
  // the reviewer confirmed via `strings` on the installed claude 2.1.220 binary that it recognizes
  // CLAUDE_CODE_USE_BEDROCK/CLAUDE_CODE_USE_VERTEX/ANTHROPIC_BEDROCK_BASE_URL/
  // ANTHROPIC_VERTEX_BASE_URL, and with either switch set, ANTHROPIC_BASE_URL is INERT — the turn
  // routes to a real AWS/GCP endpoint instead of the mock. Mirrors codexMocked.test.ts's own
  // explicit `delete process.env.OPENAI_BASE_URL/OPENAI_API_KEY` guard against the same class of
  // "a real, unrelated credential this shell happens to have" risk.
  const ENV_KEYS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
    "CLAUDE_CONFIG_DIR",
  ] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on the
  // sibling Task 4 test files (fixed there, and here on re-review): populating this AFTER an await
  // that can throw leaves it empty, and afterAll's restore loop then unconditionally `delete`s
  // every ENV_KEY from the shared `bun test` process. This file is the one where that would have
  // mattered most: `claude` is the one backend installed on most machines, so this describe block
  // does NOT skip — a rejected startMockLlm() here would have wiped a developer's real
  // ANTHROPIC_API_KEY for the rest of the run, not just failed loudly and left everything alone.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix = "bismuth-claude-mocked-"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    mock = await startMockLlm(); // default fixture dir: core/test/fixtures/llm (basic-turn.json)
    // Never a real Bedrock/Vertex escape hatch for this test (see ENV_KEYS comment above) — clear
    // any that a developer's own shell might already have exported, so this test can't accidentally
    // route (and bill) through a real cloud endpoint while still looking offline.
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    delete process.env.ANTHROPIC_VERTEX_BASE_URL;
    // This is the ONE row backendEnv.ts marks VERIFIED live on a real machine (see that file's
    // header): env auth takes precedence over Claude Code's own keychain OAuth login.
    const mockEnv = backendMockEnv("claude", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // STATE ISOLATION (final-review finding): this used to be the only mocked test with no config-
    // home redirect at all (gemini redirects $HOME, goose/opencode redirect XDG_*, codex sets
    // CODEX_HOME, cline sets CLINE_DIR) — a real ~/.claude/settings.json's own `env` block (a
    // documented Claude Code settings key) could inject exactly the Bedrock/Vertex vars just
    // cleared above right back in, or any other override, and this test would never know. Fixed via
    // `CLAUDE_CONFIG_DIR` — a real env var the installed binary honors (confirmed via `strings`:
    // "Use CLAUDE_CONFIG_DIR=/tmp for ephemeral local writes") to relocate its ENTIRE `~/.claude`-
    // equivalent config/session/credentials tree. Deliberately NOT a full `$HOME` redirect (unlike
    // gemini's): `$HOME` would also move the claude BINARY's own installation discovery
    // (`~/.local/share/claude/...`, unrelated to `~/.claude` config) into the isolated dir, and
    // there is nothing there — CLAUDE_CONFIG_DIR isolates exactly the state that matters here
    // without touching where the binary itself is found. Verified live: a real turn against the
    // mock still completes correctly under this isolation (assistant-text "Hello!",
    // result.isError:false), and the isolated dir picks up genuine session/project state
    // (sessions/, projects/, .claude.json) proving it's actually in use, not a no-op.
    process.env.CLAUDE_CONFIG_DIR = await newTempDir("bismuth-claude-config-");
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
