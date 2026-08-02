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
// not a missing-account skip, and the two must never be conflated.
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
// which only applies when the caller passes no `env` at all) — confirmed directly in sdk.mjs, not
// assumed from documentation.
//
// No production files were changed for this task.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeChat, detachSink, newChatId, sendMessage } from "../../src/chat";
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
  // Separate from tempDirs (cleaned per-test in afterEach): setup() is now idempotent (see its own
  // comment) and only actually runs its body once, for the FIRST test — CLAUDE_CONFIG_DIR is set
  // ONCE and reused (unchanged) by every later test in this file. Deleting it after the FIRST test's
  // afterEach would point every SUBSEQUENT test's `claude` invocation at a directory that no longer
  // exists. Cleaned up only in afterAll, once nothing in this file can still be depending on it.
  const setupDirs: string[] = [];
  // Captured so the test body can assert this dir was ACTUALLY used (see setup()'s CLAUDE_CONFIG_DIR
  // comment and the test's own runtime-signal assertion below) — a code-review finding: the isolation
  // previously had zero runtime signal in the shipped test itself, only a one-time manual observation
  // recorded in a comment that the test couldn't report on. The whole branch exists to stop shipping
  // assertions that would pass even if the thing they prove never happened; this isolation is the fix
  // for the branch's own Critical finding, so it gets held to that standard too.
  let claudeConfigDir: string | undefined;

  async function newTempDir(prefix = "bismuth-claude-mocked-"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  /** Like newTempDir, but tracked in setupDirs (survives every afterEach, cleaned only in afterAll)
   *  — see setupDirs' own comment for why a dir created inside the now-idempotent setup() must
   *  outlive the single test that happened to trigger it. */
  async function newSetupTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    setupDirs.push(dir);
    return dir;
  }

  // IDEMPOTENT AND ALL-OR-NOTHING — this file now has more than one test, and each calls setup() at
  // its own start. `setupOnce ??= doSetup()` latches on the PROMISE, not on a side effect of the
  // first statement: a `let ran = false; if (ran) return; ran = true;`-style guard (or checking
  // `if (mock) return` before `mock` is actually assigned) would let a LATER test proceed into a
  // half-initialized environment if some await after the first one throws — for this file
  // specifically, that means running the real `claude` CLI against the developer's own `~/.claude`
  // instead of the mock. `??=` guarantees every caller gets the exact same outcome (success or
  // rejection) as whichever call actually ran doSetup(), and never re-runs it. Without the guard at
  // all, a second call reassigns `mock` (a single `let`), orphaning the FIRST mock LLM server:
  // afterAll's `mock?.stop()` only ever stops the LATEST one, and mockLlm.ts's own
  // `process.on("exit")` net does NOT save it either (see that file's header on why it's not a
  // safety net for a crash/leak inside `bun test` itself). Reproduced live: two tests without any
  // guard left one orphaned `aimock` process (PPID 1) after every run.
  let setupOnce: Promise<void> | undefined;
  function setup(): Promise<void> {
    return (setupOnce ??= doSetup());
  }

  async function doSetup(): Promise<void> {
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
    // "Use CLAUDE_CONFIG_DIR=/tmp for ephemeral local writes") to relocate its `~/.claude`-equivalent
    // config/session tree. Deliberately NOT a full `$HOME` redirect (unlike gemini's): `$HOME` would
    // also move the claude BINARY's own installation discovery (`~/.local/share/claude/...`,
    // unrelated to `~/.claude` config) into the isolated dir, and there is nothing there —
    // CLAUDE_CONFIG_DIR isolates the config/session state without touching where the binary itself
    // is found. A re-review found it does MORE than that: the keychain service-name builder appends
    // a `-<sha256(configDir)>` suffix whenever this var is set, so the developer's real OAuth
    // keychain credential becomes unreachable too, not just settings.json — a bonus this comment
    // didn't originally claim and isn't relying on (env auth already takes precedence over keychain
    // regardless, per this file's other comment above), but a real added layer.
    //
    // NOT COVERED by this redirect, so said explicitly rather than overclaimed (a second re-review
    // finding): macOS managed/MDM policy at `/Library/Application Support/ClaudeCode/
    // managed-settings.json` (and `/etc/claude-code` on Linux/WSL) is deliberately NOT relocated by
    // CLAUDE_CONFIG_DIR — it's an admin-managed policy layer, outside any per-user config dir by
    // design — and its own `env` block could in principle re-inject CLAUDE_CODE_USE_BEDROCK after
    // the deletes above. Confirmed no such file exists on this machine (not live risk here), but a
    // machine under real MDM/enterprise policy management is exactly where this test's Bedrock/
    // Vertex guard could still be silently defeated, and CLAUDE_CONFIG_DIR does nothing about it.
    claudeConfigDir = await newSetupTempDir("bismuth-claude-config-");
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await mock?.stop();
    for (const dir of setupDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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

      // RUNTIME SIGNAL for the CLAUDE_CONFIG_DIR isolation itself (code-review finding): without
      // this, the isolation above has ZERO effect on whether this test passes — it would pass
      // identically if CLAUDE_CONFIG_DIR were misspelled, silently ignored by a future claude
      // version, or never actually read. Asserting the isolated dir is non-empty after a real turn
      // proves the running claude process actually wrote session/config state INTO it, not just that
      // the env var was set on this test process.
      expect(claudeConfigDir).toBeDefined();
      if (claudeConfigDir) expect(readdirSync(claudeConfigDir).length).toBeGreaterThan(0);
    },
    60_000,
  );

  test(
    "sendMessage()'s reopen branch (reattachSessionSink) flushes a buffered turn to the NEW sink without an extra synthetic done",
    async () => {
      // Regression coverage for core/src/chat.ts's sendMessage() "existing session" branch, which
      // must call sessionSink.ts's reattachSessionSink (flush, no synthetic `done`) rather than
      // rebindSessionSink (flush, THEN push a synthetic `done` whenever no turn is active — which it
      // always is right here, since turn 1 below finishes before turn 2 is sent). Swapping the two
      // is a one-word change that no prior test in this file catches: same signature, same import.
      await setup();

      const cwd = await newTempDir();
      const chatId = newChatId();
      chatIds.push(chatId);
      const { sink: sink1, frames: frames1 } = makeChatFrameCollector(60_000);

      // Queue turn 1, then detach the sink IMMEDIATELY (synchronously, same tick) — the drain loop's
      // own model call is asynchronous (at least one microtask + real subprocess I/O away), so this
      // reliably wins the race: nothing has been emitted to sink1 yet at the moment of detach.
      await sendMessage(chatId, "hello", cwd, sink1);
      expect(detachSink(chatId, sink1)).toBe(true);

      // Give the whole first turn (assistant-text, result, done) time to complete while detached —
      // generous relative to this mock's typical <200ms local turn time (see other tests in this
      // file) — so everything it produces lands in the buffer, none of it on sink1.
      await new Promise((r) => setTimeout(r, 2000));
      expect(frames1.some((f) => f.type === "assistant-text")).toBe(false);
      expect(frames1.some((f) => f.type === "done")).toBe(false);

      // Reopen with a FRESH sink — this is sendMessage()'s "existing session" branch (chat.ts:783-onward).
      const { sink: sink2, frames: frames2, waitFor: waitFor2 } = makeChatFrameCollector(60_000);
      await sendMessage(chatId, "hello", cwd, sink2);

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
      // synthetic `done` fires SYNCHRONOUSLY inside THIS sendMessage call (turnActive is false at
      // the exact moment the reopen branch runs — turn 1 already finished), so frames2 already
      // holds 2 done frames (turn 1's real one + the spurious synthetic one) before turn 2's OWN
      // text has even been requested — done.length === 2 PASSES even under the sabotage, since the
      // wait above resolves off that already-collected count without ever waiting for turn 2 to
      // run. It's assistant-text.length that actually catches it: turn 2 never gets the chance to
      // produce its own text before this synchronous check runs.
      expect(frames2.filter((f) => f.type === "done").length).toBe(2);
      expect(frames2.filter((f) => f.type === "assistant-text").length).toBe(2);
    },
    60_000,
  );
});
