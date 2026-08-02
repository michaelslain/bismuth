// core/test/chatProviders/acpFramingFakeAgent.test.ts
// Task 13: three failure modes sharing ../support/fakeAcpAgent.ts's stdout-writing seam, driven
// through the REAL, unmodified chatProviders/acp/driver.ts against the fake agent — zero network,
// zero CLI dependency.
//
//   1. CRASH (FAKE_ACP_CRASH_AFTER=prompt): the agent process dies mid-turn, right after its own
//      first session/update, without ever responding to session/prompt. Proves driver.ts's
//      watchExit reports the turn as a single result{isError:true}+done+error{code:"exit"} triplet
//      — exactly once each — which is what its own identity guard in runTurn
//      (`sessions.get(s.id) !== s`) exists to guarantee once its own now-rejected session/prompt
//      call settles after watchExit already tore the session down.
//   2. MALFORMED (FAKE_ACP_NOISE): plain-text and near-JSON-RPC noise (valid JSON, missing
//      "jsonrpc":"2.0") interleaved with two real notifications. Proves the noise produces ZERO
//      frames, both real frames still arrive in order, and the turn still reaches `done` — a real
//      CLI's own startup banner must never kill a turn.
//   3. CHUNK BOUNDARY (FAKE_ACP_CHUNK_SPLIT): one large session/update written as raw byte
//      fragments, one of which splits INSIDE a 4-byte emoji's own UTF-8 encoding — the one boundary
//      an ASCII-only split can never exercise, and the one that distinguishes driver.ts's own
//      `TextDecoder(...).decode(chunk, {stream:true})` from a naive `decode(chunk)`. See this
//      task's report for the mutation run that confirms removing `{stream:true}` actually corrupts
//      the reassembled text (replacement characters where the emoji was) — the property that makes
//      this assertion non-vacuous, not merely "an emoji is somewhere in the output".
//
// STUB-BINARY PATTERN + PID-VERIFIED TEARDOWN: identical to every sibling fakeAcpAgent.ts-driven
// test file — stub "cline" on PATH (the simplest ACP_AGENTS entry, args ["--acp"], no fallbackArgs
// retry to account for), drive the real driver via CHAT_BACKENDS.cline, verify the fake agent's own
// pid is gone (not just "closeChat didn't throw") via ../support/acpFakeAgentProcess.ts. Zero
// network, zero real CLI dependency.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatFrame } from "../../src/chat";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { makeAcpFakeAgentStubDir, pidAlive, waitForPidFile, waitProcessesGone } from "../support/acpFakeAgentProcess";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");

// Must match ../support/fakeAcpAgent.ts's own constants — duplicated rather than imported because
// the fake is a standalone script executed as a subprocess, not a module this test links against
// (the same convention every sibling fake-agent test file already uses).
const FAKE_TURN_TEXT = "Hello from the fake ACP agent";
const NOISE_TEXT_A = "fake-acp noise-mode message A";
const NOISE_TEXT_B = "fake-acp noise-mode message B";
const NOISE_LEAK_MARKER = "NOISE-LEAK-SHOULD-NEVER-APPEAR-AS-A-FRAME";
const CHUNK_EMOJI = "\u{1F600}";
const CHUNK_PAYLOAD_TEXT = `chunk-split-payload-start-${"x".repeat(64)}-${CHUNK_EMOJI}-${"y".repeat(64)}-chunk-split-payload-end`;

describe("crash mid-turn, malformed output, and chunk-boundary framing, driven through the ACP driver against a fake agent (zero network, zero CLI dependency)", () => {
  let stubDir: string | undefined;
  let pidDir: string | undefined;
  let pidFile: string | undefined;
  const savedEnv: Record<string, string | undefined> = {};
  // Every FAKE_ACP_* var any sibling fake-agent file has ever introduced, PLUS this task's own
  // three — hermetic against a stray var leaking in from the ambient shell OR from an earlier test
  // file sharing this `bun test` process (mirrors every sibling fake-agent test file's identical
  // list).
  const ENV_KEYS = [
    "PATH",
    "FAKE_ACP_MODEL_SHAPE",
    "FAKE_ACP_AUTH_GATE",
    "FAKE_ACP_CLINE_AUTHED",
    "FAKE_ACP_PROMPT_HOLD",
    "FAKE_ACP_QUEUE_HOLD_MS",
    "FAKE_ACP_PERMISSION_OPTIONS",
    "FAKE_ACP_ECHO_FILE",
    "FAKE_ACP_REJECT_SESSION_LOAD",
    "FAKE_ACP_REJECT_SESSION_LOAD_CODE",
    "FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE",
    "FAKE_ACP_TOOL_CALL",
    "FAKE_ACP_CRASH_AFTER",
    "FAKE_ACP_NOISE",
    "FAKE_ACP_CHUNK_SPLIT",
    "FAKE_ACP_CHUNK_SPLIT_DELAY_MS",
  ] as const;
  const chatIds: string[] = [];
  // Pids this test itself caused to exist (captured via waitForPidFile IMMEDIATELY after each
  // sendMessage call, never later — a capture placed after frame waits leaves this check vacuous
  // for a test that fails before reaching that point, even though the process already exists).
  const spawnedPids: number[] = [];

  function restoreEnv(): void {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }

  beforeEach(() => {
    // Snapshot BEFORE anything that can throw (makeAcpFakeAgentStubDir) — see every sibling
    // fake-agent test file's identical ordering discipline.
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    stubDir = undefined;
    pidDir = undefined;
    pidFile = undefined;
    pidDir = mkdtempSync(join(tmpdir(), "bismuth-acp-framing-pid-"));
    pidFile = join(pidDir, "agent.pid");
    stubDir = makeAcpFakeAgentStubDir("bismuth-acp-framing-stub-", "cline", FAKE_AGENT_SCRIPT, pidFile);

    // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
    process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ""}`;
    delete process.env.FAKE_ACP_AUTH_GATE;
    delete process.env.FAKE_ACP_CLINE_AUTHED;
    delete process.env.FAKE_ACP_PROMPT_HOLD;
    delete process.env.FAKE_ACP_QUEUE_HOLD_MS;
    delete process.env.FAKE_ACP_PERMISSION_OPTIONS;
    delete process.env.FAKE_ACP_ECHO_FILE;
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD;
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE;
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE;
    delete process.env.FAKE_ACP_TOOL_CALL;
    delete process.env.FAKE_ACP_CRASH_AFTER;
    delete process.env.FAKE_ACP_NOISE;
    delete process.env.FAKE_ACP_CHUNK_SPLIT;
    delete process.env.FAKE_ACP_CHUNK_SPLIT_DELAY_MS;
    process.env.FAKE_ACP_MODEL_SHAPE = "new";
  });

  afterEach(async () => {
    // Env restore FIRST: a throw below must never skip restoration and leave a later test (in this
    // file or a later file in this same process) pointed at a stub PATH.
    restoreEnv();
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);

    // closeChat() only SENDS a signal (SIGTERM, escalating to SIGKILL after driver.ts's own grace
    // window) — it does not wait for the process to exit, and the crash test's own process is
    // ALREADY dead by the time this runs anyway (it exited on its own). Poll by OWNED pid (never a
    // `pgrep -f` pattern match) via the shared helper; do the temp-dir cleanup regardless of the
    // outcome, THEN throw if anything survived.
    const stillAlive = await waitProcessesGone(spawnedPids.splice(0));

    if (stubDir) rmSync(stubDir, { recursive: true, force: true });
    if (pidDir) rmSync(pidDir, { recursive: true, force: true });

    if (stillAlive.length > 0) {
      throw new Error(`acpFramingFakeAgent.test: fake-agent pid(s) ${stillAlive.join(", ")} still alive after closeChat — a real leak.`);
    }
  }, 15_000);

  afterAll(() => {
    // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
    // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
    restoreEnv();
  });

  test(
    "agent process crashes right after its first session/update: exactly one result{isError:true}, done, error{code:exit} — no duplicate terminal frames",
    async () => {
      process.env.FAKE_ACP_CRASH_AFTER = "prompt";

      const chatId = "acp-framing-crash-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(15_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      // Captured immediately after the send, not after any frame wait below — see this file's
      // header and ../support/acpFakeAgentProcess.ts's own header for why a late capture leaves
      // the leak check vacuous for a test that fails before reaching that point.
      const pid = await waitForPidFile(pidFile!);
      spawnedPids.push(pid);
      expect(pidAlive(pid)).toBe(true); // sanity: alive now (before the crash), so "gone after teardown" means something

      // Wait for "error" specifically (the LAST of the three terminal frames watchExit emits, per
      // this file's header) so every count/order assertion below runs against a fully-settled frame
      // stream rather than racing watchExit's own synchronous triplet mid-emission.
      await waitFor((f) => f.type === "error");

      // The update the fake sent right before crashing did arrive — proves this is a genuine
      // mid-turn crash (the driver was mid-conversation), not "the process died before anything
      // happened at all".
      const assistantTexts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text").map((f) => f.text);
      expect(assistantTexts).toContain(FAKE_TURN_TEXT);

      // Exact counts, never "at least one" — a duplicate-terminal-frame regression (the exit-watch
      // identity guard removed) must fail every one of these.
      const results = frames.filter((f): f is Extract<ChatFrame, { type: "result" }> => f.type === "result");
      const errors = frames.filter((f): f is Extract<ChatFrame, { type: "error" }> => f.type === "error");
      expect(results.length).toBe(1);
      expect(results[0].isError).toBe(true);
      // THE assertion the task brief calls out by name.
      expect(frames.filter((f) => f.type === "done").length).toBe(1);
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe("exit");

      // Order: result, then done, then error — the exact sequence driver.ts's watchExit emits them
      // in, checked by array position (not merely "all three are present somewhere").
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      const errorIdx = frames.findIndex((f) => f.type === "error");
      expect(doneIdx).toBeGreaterThan(resultIdx);
      expect(errorIdx).toBeGreaterThan(doneIdx);
    },
    20_000,
  );

  test(
    "plain-text and near-JSON-RPC noise interleaved with real session/update frames: noise yields ZERO frames, both real frames arrive in order, turn still reaches done",
    async () => {
      process.env.FAKE_ACP_NOISE = "1";

      const chatId = "acp-framing-noise-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(15_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      const pid = await waitForPidFile(pidFile!);
      spawnedPids.push(pid);
      expect(pidAlive(pid)).toBe(true);

      await waitFor((f) => f.type === "done");

      // Exactly the two real frames, in order — not "at least these two". Either an extra frame
      // leaking in from the noise, or a missing one from a parser that choked on it, fails this.
      const assistantTexts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text").map((f) => f.text);
      expect(assistantTexts).toEqual([NOISE_TEXT_A, NOISE_TEXT_B]);

      // THE noise-produced-zero-frames assertion: the marker embedded in the near-JSON-RPC noise
      // line (valid JSON, missing "jsonrpc":"2.0") must never surface anywhere in the frame stream.
      expect(frames.some((f) => JSON.stringify(f).includes(NOISE_LEAK_MARKER))).toBe(false);

      // The turn genuinely completed cleanly — a real CLI's own banner must not be mistaken for a
      // turn-ending error.
      const results = frames.filter((f): f is Extract<ChatFrame, { type: "result" }> => f.type === "result");
      expect(results.length).toBe(1);
      expect(results[0].isError).toBe(false);
      expect(frames.filter((f) => f.type === "done").length).toBe(1);
      expect(frames.some((f) => f.type === "error")).toBe(false);
    },
    20_000,
  );

  test(
    "one large session/update split into raw byte fragments, one cut INSIDE a 4-byte emoji: reassembles byte-exact, emoji intact",
    async () => {
      process.env.FAKE_ACP_CHUNK_SPLIT = "1";

      const chatId = "acp-framing-chunk-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(15_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      const pid = await waitForPidFile(pidFile!);
      spawnedPids.push(pid);
      expect(pidAlive(pid)).toBe(true);

      await waitFor((f) => f.type === "done");

      // Exactly one assistant-text frame — the byte split must not fracture one session/update
      // notification into several ChatFrames (or, on the newline byte itself being split, into a
      // hung parse that never even reaches "done" — already ruled out by the waitFor above).
      const assistantTextFrames = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text");
      expect(assistantTextFrames.length).toBe(1);

      // THE assertion this test exists for: byte-exact reassembly, emoji intact — not merely
      // "contains something emoji-shaped" (a weaker check would still pass against a mangled string
      // that happened to retain other substrings around a corrupted middle).
      expect(assistantTextFrames[0].text).toBe(CHUNK_PAYLOAD_TEXT);
      expect(assistantTextFrames[0].text.includes(CHUNK_EMOJI)).toBe(true);

      const results = frames.filter((f): f is Extract<ChatFrame, { type: "result" }> => f.type === "result");
      expect(results.length).toBe(1);
      expect(results[0].isError).toBe(false);
    },
    20_000,
  );
});
