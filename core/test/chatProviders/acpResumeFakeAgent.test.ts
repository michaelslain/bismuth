// core/test/chatProviders/acpResumeFakeAgent.test.ts
// Task 11: session resume, including the `session/load` -> `session/resume` fallback
// (chatProviders/acp/driver.ts's createSession, the `if (resumeId)` branch), offline, through the
// REAL, unmodified driver.
//
// WHY THIS FILE EXISTS: `resumeSession` had no offline test on any ACP backend. createSession tries
// `session/load` first and only falls back to `session/resume` when that call rejects with a
// method-not-found error (protocol.ts's `isMethodNotFoundError`). The naive way to test this — a
// fake that just accepts `session/load` — proves nothing: the driver is satisfied immediately and
// `session/resume` is never called. See ../support/fakeAcpAgent.ts's "SESSION-RESUME MODE" for the
// opt-in rejection this file depends on (inert when unset, and additive-only — verified by running
// this file's own tests plus all 7 sibling fake-agent consumers (acpAbortFakeAgent.test.ts,
// acpFakeAgent.test.ts, acpPermissionFakeAgent.test.ts, acpQueueFakeAgent.test.ts,
// clineAuthFakeAgent.test.ts, openclawMocked.test.ts, ../server.chat-ws.test.ts) together: 20 pass,
// 0 fail, 240 expect() calls).
//
// `isMethodNotFoundError` is an OR of a numeric JSON-RPC code check and a message regex. The fake's
// rejection code/message are independently overridable (FAKE_ACP_REJECT_SESSION_LOAD_CODE/
// _MESSAGE) so the "code arm" and "message arm" tests below can pin each half on its own — a fixed
// code+message pair only ever proves "at least one arm fired".
//
// NON-VACUOUSNESS: every sessionId assertion compares against `RESUME_SESSION_ID`, a literal each
// test chooses independently (never derived from chatId/cwd or from either wire response) — never
// against another wire value. Counts are exact throughout, never "at least one". The
// session/load-before-session/resume ordering check is real (flips true->false on a reversed
// sequence, verified manually) but its failure is subsumed by the count assertions under every
// production mutation tried against driver.ts (e.g. deleting the fallback's try/catch entirely
// fails `resumes.length` first, before ever reaching the ordering comparison) — no mutation was
// found that reorders the two calls while preserving both counts at 1, so the ordering check is
// not independently mutation-provable on its own; kept as defense-in-depth.
//
// STUB-BINARY PATTERN: identical to every sibling fakeAcpAgent.ts-driven test file — stub "cline" on
// PATH, drive the real chatProviders/acp/driver.ts via CHAT_BACKENDS.cline. Zero network, zero CLI
// dependency. Orphan-freedom verified BY PID via ../support/acpFakeAgentProcess.ts.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatFrame } from "../../src/chat";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { makeAcpFakeAgentStubDir, pidAlive, waitForPidFile, waitProcessesGone } from "../support/acpFakeAgentProcess";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");

// Must match ../support/fakeAcpAgent.ts's own constant — duplicated rather than imported because
// the fake is a standalone script executed as a subprocess, not a module this test links against
// (the same convention every sibling fake-agent test file already uses).
const FAKE_TURN_TEXT = "Hello from the fake ACP agent";

interface EchoLine {
  method?: string;
  params?: unknown;
}

/** Same tolerance contract as every sibling fake-agent test file: a missing file is an empty array
 *  (polled before the fake has written anything), and a torn last line (read mid-appendFileSync) is
 *  dropped so the CURRENT poll fails and is retried, rather than throwing a spurious JSON.parse
 *  error that would fail the whole test. */
function readEchoLines(path: string): EchoLine[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: EchoLine[] = [];
  for (const l of text.split("\n").map((s) => s.trim()).filter(Boolean)) {
    try {
      out.push(JSON.parse(l) as EchoLine);
    } catch {
      /* torn/partially-written line — see this function's doc comment */
    }
  }
  return out;
}

/** Pull `sessionId` out of a request's own params — the value under test in every sessionId
 *  assertion below. */
function paramsSessionId(params: unknown): string | undefined {
  const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  return typeof p.sessionId === "string" ? p.sessionId : undefined;
}

/** Pull `cwd` out of a request's own params — asserted alongside sessionId so a mutation that
 *  scrambled the whole params object (not just sessionId) is still caught. */
function paramsCwd(params: unknown): string | undefined {
  const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  return typeof p.cwd === "string" ? p.cwd : undefined;
}

describe("resumeSession's session/load -> session/resume fallback, driven through the ACP driver against a fake agent (zero network, zero CLI dependency)", () => {
  // `| undefined` with explicit resets in beforeEach, matching every sibling fake-agent test file's
  // documented shape: if a throwing call in the FIRST beforeEach fails partway, afterEach must not be
  // handed `undefined` where it expects a string (rmSync's `force:true` swallows ENOENT, not an
  // ERR_INVALID_ARG_TYPE from a wrong argument type) — a bug this harness has shipped before.
  let stubDir: string | undefined;
  let echoDir: string | undefined;
  let pidDir: string | undefined;
  let echoFile: string;
  let pidFile: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "PATH",
    "FAKE_ACP_REJECT_SESSION_LOAD",
    "FAKE_ACP_REJECT_SESSION_LOAD_CODE",
    "FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE",
    "FAKE_ACP_PROMPT_HOLD",
    "FAKE_ACP_QUEUE_HOLD_MS",
    "FAKE_ACP_PERMISSION_OPTIONS",
    "FAKE_ACP_ECHO_FILE",
    "FAKE_ACP_MODEL_SHAPE",
    "FAKE_ACP_AUTH_GATE",
    "FAKE_ACP_CLINE_AUTHED",
  ] as const;
  const chatIds: string[] = [];
  // Pids this test itself caused to exist (captured via waitForPidFile once a session is confirmed
  // open), verified gone in afterEach — see ../support/acpFakeAgentProcess.ts's header for why a
  // synchronous afterEach that only calls closeChat() is not sufficient on its own.
  const spawnedPids: number[] = [];

  function restoreEnv(): void {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }

  beforeEach(() => {
    // Snapshot env BEFORE anything that can throw — see every sibling fake-agent test file's
    // identical ordering discipline (a first-beforeEach throw must never leave a later test's PATH
    // stripped by afterEach's restore).
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    stubDir = undefined;
    echoDir = undefined;
    pidDir = undefined;
    pidDir = mkdtempSync(join(tmpdir(), "bismuth-acp-resume-pid-"));
    pidFile = join(pidDir, "agent.pid");
    stubDir = makeAcpFakeAgentStubDir("bismuth-acp-resume-stub-", "cline", FAKE_AGENT_SCRIPT, pidFile);
    echoDir = mkdtempSync(join(tmpdir(), "bismuth-acp-resume-echo-"));
    echoFile = join(echoDir, "echo.jsonl");

    // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
    process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ""}`;
    process.env.FAKE_ACP_ECHO_FILE = echoFile;
    // Hermetic against ambient env — the same finding every sibling fake-agent test file's beforeEach
    // documents: a stray FAKE_ACP_AUTH_GATE (or a leftover prompt-hold var) exported in the shell
    // running `bun test` must not leak into this file's own tests.
    process.env.FAKE_ACP_MODEL_SHAPE = "new";
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD;
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE;
    delete process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE;
    delete process.env.FAKE_ACP_AUTH_GATE;
    delete process.env.FAKE_ACP_CLINE_AUTHED;
    delete process.env.FAKE_ACP_PROMPT_HOLD;
    delete process.env.FAKE_ACP_QUEUE_HOLD_MS;
    delete process.env.FAKE_ACP_PERMISSION_OPTIONS;
  });

  afterEach(async () => {
    // Env restore FIRST: a throw below must never skip restoration and leave a later test (in this
    // file or a later file in this same process) pointed at a stub PATH.
    restoreEnv();
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);

    // closeChat() only SENDS a signal (SIGTERM, escalating to SIGKILL after driver.ts's
    // KILL_ESCALATION_GRACE_MS if ignored) — it does not wait for the process to exit. Poll by OWNED
    // pid (never a `pgrep -f` pattern match) via the shared helper, do the temp-dir cleanup regardless
    // of the outcome, THEN throw if anything survived — see acpFakeAgentProcess.ts's own header.
    const stillAlive = await waitProcessesGone(spawnedPids.splice(0));

    if (stubDir) rmSync(stubDir, { recursive: true, force: true });
    if (echoDir) rmSync(echoDir, { recursive: true, force: true });
    if (pidDir) rmSync(pidDir, { recursive: true, force: true });

    if (stillAlive.length > 0) {
      throw new Error(`acpResumeFakeAgent.test: fake-agent pid(s) ${stillAlive.join(", ")} still alive after closeChat — a real leak.`);
    }
  }, 15_000);

  afterAll(() => {
    // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
    // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
    restoreEnv();
  });

  /** Call resumeSession, wait for the emitted "session" frame, capture the fake's own pid (for
   *  teardown verification), and return the frame's sessionId. Shared by every test below — each
   *  only differs in which FAKE_ACP_REJECT_SESSION_LOAD* env vars it sets beforehand. */
  async function openResumedSession(
    chatId: string,
    resumeSessionId: string,
    cwd: string,
    waitFor: (match: (f: ChatFrame) => boolean, timeoutMs?: number) => Promise<ChatFrame>,
    sink: (f: ChatFrame) => void,
  ): Promise<string> {
    CHAT_BACKENDS.cline.resumeSession({ chatId, cwd, sink, computerUse: false, sessionId: resumeSessionId });
    const sessionFrame = await waitFor((f) => f.type === "session");
    if (sessionFrame.type !== "session") throw new Error(`expected a "session" frame, got ${sessionFrame.type}`);

    const pid = await waitForPidFile(pidFile);
    spawnedPids.push(pid);
    expect(pidAlive(pid)).toBe(true); // sanity: alive now, so "not alive after teardown" means something

    return sessionFrame.sessionId;
  }

  test(
    "session/load rejected with -32601: the driver falls back to session/resume, both carrying the caller's session id, and the next turn completes on it",
    async () => {
      process.env.FAKE_ACP_REJECT_SESSION_LOAD = "1";

      const chatId = "acp-resume-fallback-" + Date.now();
      chatIds.push(chatId);
      // Deliberately distinct from chatId AND from cwd — an independently-chosen literal, not
      // derived from anything the driver computes, so every comparison below is against a fixed
      // expected value rather than against another driver-produced string (see this file's header).
      const RESUME_SESSION_ID = "fake-resume-sid-8f3c1a";
      const cwd = "/tmp";
      const { sink, frames, waitFor } = makeChatFrameCollector(20_000);

      const gotSessionId = await openResumedSession(chatId, RESUME_SESSION_ID, cwd, waitFor, sink);
      // THE independently-obtained comparison for the emitted frame: against the literal THIS TEST
      // chose before calling resumeSession, never against any other wire value.
      expect(gotSessionId).toBe(RESUME_SESSION_ID);

      const allLines = readEchoLines(echoFile);
      const methodOrder = allLines.map((l) => l.method);

      // EXACT counts, not "at least one" — see this file's header.
      const loads = allLines.filter((l) => l.method === "session/load");
      const resumes = allLines.filter((l) => l.method === "session/resume");
      const news = allLines.filter((l) => l.method === "session/new");
      expect(loads.length).toBe(1);
      expect(resumes.length).toBe(1);
      expect(news.length).toBe(0); // resume must never take the brand-new-session path

      // session/load attempted FIRST, THEN session/resume — real, but see this file's header on why
      // its failure mode is subsumed by the counts above under every mutation found so far.
      expect(methodOrder.indexOf("session/resume")).toBeGreaterThan(methodOrder.indexOf("session/load"));

      // Both wire calls carry the SAME caller-provided session id — compared against the
      // independently-chosen literal, never against each other.
      expect(paramsSessionId(loads[0].params)).toBe(RESUME_SESSION_ID);
      expect(paramsSessionId(resumes[0].params)).toBe(RESUME_SESSION_ID);
      expect(paramsCwd(loads[0].params)).toBe(cwd);
      expect(paramsCwd(resumes[0].params)).toBe(cwd);

      // The resumed session must actually be usable: the next turn completes normally.
      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd, sink, computerUse: false, text: "resumed hello" });
      await waitFor((f) => f.type === "done");

      const assistantTexts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text").map((f) => f.text);
      expect(assistantTexts).toEqual([FAKE_TURN_TEXT]);
      const results = frames.filter((f): f is Extract<ChatFrame, { type: "result" }> => f.type === "result");
      expect(results.length).toBe(1);
      expect(results[0].isError).toBe(false);
      expect(frames.some((f) => f.type === "error")).toBe(false);

      // The post-resume turn's own session/prompt carried the SAME resumed session id — proving the
      // fallback didn't just satisfy the handshake once and then lose track of which session
      // subsequent turns belong to.
      const prompts = readEchoLines(echoFile).filter((l) => l.method === "session/prompt");
      expect(prompts.length).toBe(1);
      expect(paramsSessionId(prompts[0].params)).toBe(RESUME_SESSION_ID);
    },
    25_000,
  );

  test(
    "session/load accepted (FAKE_ACP_REJECT_SESSION_LOAD unset — the fake's default, unchanged): the driver never attempts session/resume at all",
    async () => {
      // Deliberately NOT set — proves the inertness claim behaviourally (not just "the pre-existing
      // tests still pass"): with this fake's new mode left off, session/load succeeds immediately
      // and driver.ts's own try/catch never reaches its isMethodNotFoundError branch.
      expect(process.env.FAKE_ACP_REJECT_SESSION_LOAD).toBeUndefined();

      const chatId = "acp-resume-direct-" + Date.now();
      chatIds.push(chatId);
      const RESUME_SESSION_ID = "fake-resume-sid-2b77e0";
      const cwd = "/tmp";
      const { sink, waitFor } = makeChatFrameCollector(20_000);

      const gotSessionId = await openResumedSession(chatId, RESUME_SESSION_ID, cwd, waitFor, sink);
      expect(gotSessionId).toBe(RESUME_SESSION_ID);

      const loads = readEchoLines(echoFile).filter((l) => l.method === "session/load");
      const resumes = readEchoLines(echoFile).filter((l) => l.method === "session/resume");
      expect(loads.length).toBe(1);
      expect(paramsSessionId(loads[0].params)).toBe(RESUME_SESSION_ID);
      // THE assertion this test exists for: no rejection, no fallback — session/resume is never
      // even attempted when session/load simply succeeds.
      expect(resumes.length).toBe(0);
    },
    20_000,
  );

  test(
    "pins the CODE arm of isMethodNotFoundError: the correct -32601 code with a NON-matching message still triggers the fallback",
    async () => {
      // A message that does not contain "method not found" / "unknown method" / "no such method"
      // (protocol.ts's own regex, case-insensitive) — if the fallback still fires, it can only be
      // because the numeric-code check on its own is doing the work, not the message regex.
      process.env.FAKE_ACP_REJECT_SESSION_LOAD = "1";
      process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE = "-32601";
      process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE = "zzz this text carries none of the fallback trigger keywords zzz";

      const chatId = "acp-resume-code-arm-" + Date.now();
      chatIds.push(chatId);
      const RESUME_SESSION_ID = "fake-resume-sid-code-arm-91a4";
      const cwd = "/tmp";
      const { sink, waitFor } = makeChatFrameCollector(20_000);

      const gotSessionId = await openResumedSession(chatId, RESUME_SESSION_ID, cwd, waitFor, sink);
      expect(gotSessionId).toBe(RESUME_SESSION_ID);

      const allLines = readEchoLines(echoFile);
      expect(allLines.filter((l) => l.method === "session/load").length).toBe(1);
      // THE assertion this test exists for: the fallback fired despite a non-matching message.
      expect(allLines.filter((l) => l.method === "session/resume").length).toBe(1);
    },
    20_000,
  );

  test(
    "pins the MESSAGE arm of isMethodNotFoundError: a non-matching code with a message that DOES match still triggers the fallback",
    async () => {
      // A code that is not -32601 — if the fallback still fires, it can only be because the message
      // regex on its own is doing the work, not the numeric-code check.
      process.env.FAKE_ACP_REJECT_SESSION_LOAD = "1";
      process.env.FAKE_ACP_REJECT_SESSION_LOAD_CODE = "-32000";
      process.env.FAKE_ACP_REJECT_SESSION_LOAD_MESSAGE = "Method not found: session/load";

      const chatId = "acp-resume-message-arm-" + Date.now();
      chatIds.push(chatId);
      const RESUME_SESSION_ID = "fake-resume-sid-message-arm-2c6d";
      const cwd = "/tmp";
      const { sink, waitFor } = makeChatFrameCollector(20_000);

      const gotSessionId = await openResumedSession(chatId, RESUME_SESSION_ID, cwd, waitFor, sink);
      expect(gotSessionId).toBe(RESUME_SESSION_ID);

      const allLines = readEchoLines(echoFile);
      expect(allLines.filter((l) => l.method === "session/load").length).toBe(1);
      // THE assertion this test exists for: the fallback fired despite a non-matching (wrong) code.
      expect(allLines.filter((l) => l.method === "session/resume").length).toBe(1);
    },
    20_000,
  );
});
