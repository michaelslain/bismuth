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
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_CODEX = whichBinary("codex") !== null;
const describeOrSkip = HAS_CODEX ? describe : describe.skip;

if (!HAS_CODEX) {
  // eslint-disable-next-line no-console
  console.warn("[codexMocked.test] skipped — the `codex` CLI is not installed on this machine (nothing to drive).");
}

describeOrSkip("the real codex CLI, driven through chatProviders/codex/driver.ts, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["CODEX_HOME", "OPENAI_BASE_URL", "OPENAI_API_KEY", "MOCK_CODEX_API_KEY"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on this
  // task: populating this AFTER an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real OPENAI_API_KEY this test never touched.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];
  // Separate from tempDirs (cleaned per-test in afterEach): setup() is now idempotent (see its own
  // comment) and only actually runs its body once, for the FIRST test — CODEX_HOME (and the
  // config.toml backendMockEnv writes into it) is set up ONCE and reused by every later test in this
  // file. Deleting it after the FIRST test's afterEach would point every SUBSEQUENT test's `codex`
  // invocation at a directory whose config.toml no longer exists. Cleaned up only in afterAll.
  const setupDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  /** Like newTempDir, but tracked in setupDirs (survives every afterEach, cleaned only in afterAll)
   *  — see setupDirs' own comment. */
  async function newSetupTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    setupDirs.push(dir);
    return dir;
  }

  // IDEMPOTENT AND ALL-OR-NOTHING — this file now has more than one test, and each calls setup() at
  // its own start. `setupOnce ??= doSetup()` latches on the PROMISE, not on a side effect of the
  // first statement: an `if (mock) return` guard checked before `mock` is actually assigned would
  // let a LATER test proceed into a half-initialized environment if some await after the first one
  // throws. `??=` guarantees every caller gets the exact same outcome (success or rejection) as
  // whichever call actually ran doSetup(), and never re-runs it. Without the guard at all, a second
  // call reassigns `mock` (a single `let`), orphaning the FIRST mock LLM server: afterAll's
  // `mock?.stop()` only ever stops the LATEST one. Reproduced live in the sibling
  // claudeMocked.test.ts/opencodeMocked.test.ts: an orphaned `aimock` process (PPID 1) after every
  // run without this guard.
  let setupOnce: Promise<void> | undefined;
  function setup(): Promise<void> {
    return (setupOnce ??= doSetup());
  }

  async function doSetup(): Promise<void> {
    mock = await startMockLlm();
    // Never OPENAI_BASE_URL/OPENAI_API_KEY for codex (see this file's header) — clear any that a
    // developer's own shell might already have set, so this test can't accidentally pass for the
    // wrong reason (codex silently using a real key it happens to find).
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    const codexHome = await newSetupTempDir("bismuth-codex-home-");
    const mockEnv = backendMockEnv("codex", mock.url, codexHome);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
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
      const { sink, frames, waitFor } = makeChatFrameCollector();

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

  test(
    "sendMessage()'s reopen branch (reattachSessionSink) flushes a buffered turn to the NEW sink without an extra synthetic done",
    async () => {
      // Regression coverage for core/src/chatProviders/codex/driver.ts's sendMessage() "existing
      // session" branch, which must call sessionSink.ts's reattachSessionSink (flush, no synthetic
      // `done`) rather than rebindSessionSink (flush, THEN push a synthetic `done` whenever no turn
      // is active — which it always is right here, since turn 1 finishes before turn 2 is sent).
      // Swapping the two is a one-word change no prior test in this file catches.
      await setup();

      const cwd = await newTempDir("bismuth-codex-cwd-");
      const chatId = "codex-mocked-reopen-" + Date.now();
      chatIds.push(chatId);
      const { sink: sink1, frames: frames1 } = makeChatFrameCollector();

      // createSession() registers the session into the driver's Map SYNCHRONOUSLY (before any
      // subprocess I/O), so detaching immediately after this call is safe — no pre-creation wait
      // needed here (unlike the ACP driver, whose openSession/sendMessage register asynchronously).
      CHAT_BACKENDS.codex.sendMessage({ chatId, cwd, sink: sink1, computerUse: false, text: "hello" });
      expect(CHAT_BACKENDS.codex.detachSink(chatId, sink1)).toBe(true);

      // Give the whole first turn (assistant-text, result, done) time to complete while detached.
      await new Promise((r) => setTimeout(r, 3000));
      expect(frames1.some((f) => f.type === "assistant-text")).toBe(false);
      expect(frames1.some((f) => f.type === "done")).toBe(false);

      // Reopen with a FRESH sink — the driver's sendMessage() "existing session" branch.
      const { sink: sink2, frames: frames2, waitFor: waitFor2 } = makeChatFrameCollector();
      CHAT_BACKENDS.codex.sendMessage({ chatId, cwd, sink: sink2, computerUse: false, text: "hello" });

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
