// core/test/chatProviders/acpResumeFakeAgent.test.ts
// Task 11 of the agent-integration-completion plan: session resume, including the
// `session/load` -> `session/resume` fallback (chatProviders/acp/driver.ts's createSession, the
// `if (resumeId)` branch), offline, through the REAL, unmodified driver.
//
// WHY THIS FILE EXISTS. `resumeSession` (driver.ts) had no offline test on any of the six ACP
// backends it drives. Its own createSession first tries `session/load`; only when THAT rejects
// with a JSON-RPC -32601 (method-not-found — protocol.ts's `isMethodNotFoundError`) does it fall
// back to `session/resume` — the version-skew tolerance the research report documents (some
// still-shipping SDK generations implement only one of the two verbs). Nothing offline proved that
// fallback ever actually ran.
//
// THE TRAP THIS TASK'S BRIEF NAMES: before this task, ../support/fakeAcpAgent.ts answered EVERY
// unknown verb (including `session/load`) with a cheerful `respond(id, {})`. A naive resume test
// written against that fake would see `session/load` "succeed" immediately — the driver is
// satisfied, `session/resume` never gets called, and a test asserting only "resume works" would
// pass while the `isMethodNotFoundError` branch this task exists to cover never once executed. See
// this task's report for Step 3's sabotage proving this concretely: with the fake's new rejection
// mode DISABLED (session/load accepted, matching every prior behavior), the FIRST test below fails
// specifically on its "session/resume was called" assertions, not on some unrelated symptom.
//
// THE MECHANISM: ../support/fakeAcpAgent.ts's new "SESSION-RESUME MODE" (see that file's own header
// for the full contract) — opt-in via `FAKE_ACP_REJECT_SESSION_LOAD`, decoupled from every other
// mode in that file the same way each of those is decoupled from the rest. Unset, `session/load`
// is unhandled and falls to the `default:` case's plain `{}`, byte-for-byte what every pre-existing
// consumer of that file already got (verified directly: the SECOND test below drives resumeSession
// with the var left unset and asserts `session/resume` is NEVER called — the fake accepting
// `session/load` the same way it always did).
//
// NON-VACUOUSNESS, stated precisely (this project's recurring defect is a check that stays green
// even when the thing it claims to prove never happened):
//   - Both tests assert EXACT counts (`session/load`/`session/resume`/`session/new` line counts),
//     never "at least one" — a driver that retried session/load, or fell through to session/new
//     instead of the resume path, would show up as a wrong count, not just wrong content.
//   - The FIRST test asserts session/load's line appears BEFORE session/resume's line in the raw
//     echo-file order (not merely that both exist) — proving the fallback really is a fallback, not
//     two independent, unordered attempts.
//   - Every sessionId asserted (on session/load's params, session/resume's params, the emitted
//     "session" ChatFrame, and the FOLLOW-UP session/prompt's own params) is compared against ONE
//     INDEPENDENTLY-CHOSEN literal this test itself picked before calling resumeSession
//     (`RESUME_SESSION_ID`, deliberately distinct from the chat id) — never against each other. That
//     literal is not derived from anything the driver computes, so a mutation that substituted the
//     chat id, the cwd, or any other in-scope string for the real session id at any one of those
//     four call sites is independently catchable (see this task's report for each mutation's result).
//   - The second test's "turn completes" assertion checks the actual `assistant-text` content
//     (`FAKE_TURN_TEXT`) and a `result` frame with `isError:false`, not just a `done` frame's mere
//     presence — a turn that errored out still produces `done`.
//
// SABOTAGE PERFORMED (verification only — see this task's own report for exact results):
//   1. ../support/fakeAcpAgent.ts's rejectSessionLoad forced to `false` regardless of the env var
//      (i.e. session/load is ALWAYS accepted, reproducing this file's pre-task behavior) — the
//      FIRST test's "session/resume was called exactly once" assertion must fail, or this test isn't
//      testing the fallback at all.
//   2. driver.ts's fallback catch narrowed to never re-throw (`if (!isMethodNotFoundError(e)) throw
//      e;` deleted, always falling back) — the SECOND test's "session/resume was never called"
//      assertion must fail.
//   3. driver.ts's `session/load` call params mutated to send `s.id` (the chat id) instead of
//      `resumeId` — the FIRST test's session/load sessionId assertion must fail specifically.
//   4. driver.ts's `session/resume` call params mutated the same way — the FIRST test's
//      session/resume sessionId assertion must fail specifically.
//   5. driver.ts's post-fallback `s.sessionId = resumeId;` mutated to a different in-scope string —
//      the emitted "session" frame's sessionId assertion must fail in BOTH tests.
//   6. driver.ts's `runTurn`'s `session/prompt` call mutated to send something other than
//      `s.sessionId` — the FIRST test's post-resume session/prompt sessionId assertion must fail.
//
// STUB-BINARY PATTERN: identical to every other fakeAcpAgent.ts-driven test file — write an
// executable stub named "cline" into a throwaway temp dir, prepend it onto PATH so
// core/src/claudeWhich.ts's whichBinary("cline") resolves the stub, then drive the REAL, unmodified
// chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly as production does. Zero network of any
// kind, zero CLI dependency, zero account contact. Orphan-freedom is verified BY PID (never a
// `pgrep -f` pattern match) via ../support/acpFakeAgentProcess.ts's shared helper.
//
// Only ../support/fakeAcpAgent.ts gained new behavior for this task (additive, opt-in via
// FAKE_ACP_REJECT_SESSION_LOAD, inert when unset — see that file's own header). No production file
// was changed.
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

      CHAT_BACKENDS.cline.resumeSession({ chatId, cwd, sink, computerUse: false, sessionId: RESUME_SESSION_ID });

      const sessionFrame = await waitFor((f) => f.type === "session");
      if (sessionFrame.type !== "session") throw new Error(`expected a "session" frame, got ${sessionFrame.type}`);
      // THE independently-obtained comparison for the emitted frame: against the literal THIS TEST
      // chose before calling resumeSession, never against any other wire value.
      expect(sessionFrame.sessionId).toBe(RESUME_SESSION_ID);
      expect(sessionFrame.origin).toBe("user");

      const pid = await waitForPidFile(pidFile);
      spawnedPids.push(pid);
      expect(pidAlive(pid)).toBe(true); // sanity: alive now, so "not alive after teardown" means something

      const allLines = readEchoLines(echoFile);
      const methodOrder = allLines.map((l) => l.method);

      // EXACT counts, not "at least one" — see this file's header.
      const loads = allLines.filter((l) => l.method === "session/load");
      const resumes = allLines.filter((l) => l.method === "session/resume");
      const news = allLines.filter((l) => l.method === "session/new");
      expect(loads.length).toBe(1);
      expect(resumes.length).toBe(1);
      expect(news.length).toBe(0); // resume must never take the brand-new-session path

      // THE assertion this test exists for: session/load was attempted FIRST, THEN session/resume —
      // not merely that both happened somewhere.
      const loadIdx = methodOrder.indexOf("session/load");
      const resumeIdx = methodOrder.indexOf("session/resume");
      expect(loadIdx).toBeGreaterThanOrEqual(0);
      expect(resumeIdx).toBeGreaterThan(loadIdx);

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

      CHAT_BACKENDS.cline.resumeSession({ chatId, cwd, sink, computerUse: false, sessionId: RESUME_SESSION_ID });

      const sessionFrame = await waitFor((f) => f.type === "session");
      if (sessionFrame.type !== "session") throw new Error(`expected a "session" frame, got ${sessionFrame.type}`);
      expect(sessionFrame.sessionId).toBe(RESUME_SESSION_ID);

      const pid = await waitForPidFile(pidFile);
      spawnedPids.push(pid);
      expect(pidAlive(pid)).toBe(true);

      const allLines = readEchoLines(echoFile);
      const loads = allLines.filter((l) => l.method === "session/load");
      const resumes = allLines.filter((l) => l.method === "session/resume");
      expect(loads.length).toBe(1);
      expect(paramsSessionId(loads[0].params)).toBe(RESUME_SESSION_ID);
      // THE assertion this test exists for: no rejection, no fallback — session/resume is never
      // even attempted when session/load simply succeeds.
      expect(resumes.length).toBe(0);
    },
    20_000,
  );
});
