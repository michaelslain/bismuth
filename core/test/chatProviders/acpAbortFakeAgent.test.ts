// core/test/chatProviders/acpAbortFakeAgent.test.ts
// Task 9 of the agent-integration-completion plan: `abortTurn` mid-turn, and a turn that never
// terminates, offline, through the real driver.
//
// WHY THIS FILE EXISTS. Clicking Stop mid-turn (`abortTurn`, chatProviders/acp/driver.ts) had no
// offline test on any of the six ACP backends it drives, and neither did a turn whose agent simply
// never replies — the two failure modes most likely to wedge a chat (a Stop click that silently
// does nothing, or a runaway turn nothing can end). Both are exercised here against the SAME fake
// agent + held-prompt mechanism acpPermissionFakeAgent.test.ts already proved out for the permission
// round-trip (../support/fakeAcpAgent.ts, FAKE_ACP_PROMPT_HOLD=permission) — reused, not
// reimplemented, exactly as that file's own header anticipates ("a future turn-queue / abort /
// resume / never-terminating-turn test needs only ... its own async runner").
//
// THE WRINKLE (why this isn't a trivial pair of tests): fakeAcpAgent.ts's
// session/cancel handler settles the held `session/prompt` directly (heldPrompts), but — BEFORE this
// task — did nothing about `runHeldPermissionPrompt`'s own OUTBOUND call
// (`await callClient("session/request_permission", ...)`), whose resolver sat in
// `pendingClientCalls` forever. A stale UI still answering that permission AFTER the turn had
// already been aborted would resume the runner and emit a stray `agent_message_chunk` on an
// already-ended turn. Fixed in fakeAcpAgent.ts (test-support only, no production file touched) two
// ways, both required together: (1) `session/cancel` now drains every outstanding
// `pendingClientCalls` entry with a synthetic `{outcome:{outcome:"cancelled"}}` reply, so a parked
// runner resumes PROMPTLY instead of depending on whether a real reply ever arrives; (2)
// `runHeldPermissionPrompt` now checks `heldPrompts.has(promptId)` right after its await resolves and
// silently returns if it's already gone — which is what actually prevents the stray emission,
// whether the resumption came from (1)'s synthetic drain or a genuinely late real reply landing
// afterward. The first test below exercises the exact "late real reply after abort" scenario the
// wrinkle describes and asserts zero new frames land because of it.
//
// ONE BEHAVIOURAL DETAIL THAT LOOKS LIKE A BUG BUT ISN'T:
// after `abortTurn`, the correct `result` frame has `isError === false` — driver.ts:593 treats a
// cancelled stopReason as a clean turn end, not a failure, mirroring opencode.ts's own `aborting`
// flag. A test asserting `isError: true` there would be WRONG, not stricter.
//
// STUB-BINARY PATTERN: same as acpFakeAgent.test.ts / acpPermissionFakeAgent.test.ts — write an
// executable stub named "cline" into a throwaway temp dir, prepend it onto PATH so
// claudeWhich.ts's whichBinary("cline") resolves the stub, then drive the REAL, unmodified
// chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly as production does. Zero network,
// zero CLI dependency, zero account contact. ADDED HERE: the stub also writes its own (post-`exec`,
// therefore stable) pid to a file before handing off to the fake agent script, because
// `CHAT_BACKENDS.cline.closeChat()` kills its subprocess internally and returns void — there is no
// other way to get a concrete pid to verify "no orphan" against, and the check must be BY PID, never
// a `pgrep -f` pattern match (which can't distinguish a process this test started from an unrelated
// one already running on the machine).
//
// No production files were changed for this task — only the test-support fake agent gained the
// drain+guard fix described above, verified inert with FAKE_ACP_PROMPT_HOLD unset (that mode's own
// pre-existing tests, acpFakeAgent.test.ts/clineAuthFakeAgent.test.ts, exercise session/cancel only
// with an empty heldPrompts/pendingClientCalls, so both new loops are no-ops there — byte-for-byte
// unchanged).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatFrame } from "../../src/chat";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { makeAcpFakeAgentStubDir, pidAlive, waitForPidFile, waitProcessesGone } from "../support/acpFakeAgentProcess";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");

// Must match ../support/fakeAcpAgent.ts's own constants — duplicated rather than imported because
// the fake is a standalone script executed as a subprocess, not a module this test links against
// (same convention acpPermissionFakeAgent.test.ts already uses).
const FAKE_PERMISSION_REPLY_PREFIX = "fake-acp permission reply: ";

/** Narrow a collected frame to a specific kind, FAILING (not skipping) if it is anything else — see
 *  acpPermissionFakeAgent.test.ts's identical helper for why this matters more than it looks: a
 *  bare `if (f.type === "x")` guard around an assertion silently turns into a no-op the moment a
 *  refactor changes which frame lands at a given index, with a green run and no failure anywhere. */
function expectFrame<K extends ChatFrame["type"]>(f: ChatFrame | undefined, kind: K): Extract<ChatFrame, { type: K }> {
  expect(f?.type).toBe(kind);
  return f as Extract<ChatFrame, { type: K }>;
}

/** How long to sit still after the permission frame arrives before asserting the turn has NOT
 *  settled on its own — see acpPermissionFakeAgent.test.ts's identical constant. 400ms is ~2 orders
 *  of magnitude more than the fake's own settle path costs once something settles it, so a fake that
 *  answered on its own (or a driver that mis-cancels) would be caught here. */
const PARKED_OBSERVATION_MS = 400;

/** How long to wait, after triggering something that MUST NOT produce a new frame (a late permission
 *  reply post-abort), before checking the frame count. Comfortably longer than PARKED_OBSERVATION_MS
 *  because this window has to cover an actual round trip (driver writes a response -> fake's
 *  readline parses it -> would-be stray notify()), not just "nothing happened yet". */
const NO_STRAY_FRAME_OBSERVATION_MS = 500;

interface EchoLine {
  /** Absent on the original inbound-request line kind; see fakeAcpAgent.ts's echo helpers. */
  dir?: "out-request" | "in-response";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/** Same tolerance contract as the sibling fake-agent test files: a missing file is an empty array
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

async function waitForCondition(check: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for: ${description}`);
}

// pidAlive/waitForPidFile/the stub-dir-with-pid-file writer all moved to
// ../support/acpFakeAgentProcess.ts (task-10's review: this exact trio was written here first, then
// found NOT to have propagated to a newer sibling fake-agent test file — extracted so every
// fakeAcpAgent.ts-driven test file, including the three still to come in later waves, shares one copy
// instead of re-deriving it). Byte-for-byte identical behavior: same `ps -p` check, same pid-file poll
// shape/timeout, same stub script body.

describe("abortTurn and a never-settling turn, driven through the ACP driver against a fake agent that holds the turn open (zero network, zero CLI dependency)", () => {
  // `| undefined` with explicit resets in beforeEach, matching the sibling fake-agent test files'
  // documented shape: if a throwing call in the FIRST beforeEach fails partway, afterEach must not
  // be handed `undefined` where it expects a string (rmSync's `force:true` swallows ENOENT, not an
  // ERR_INVALID_ARG_TYPE from a wrong argument type) — a bug this harness has shipped before.
  let stubDir: string | undefined;
  let echoDir: string | undefined;
  let pidDir: string | undefined;
  let echoFile: string;
  let pidFile: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "PATH",
    "FAKE_ACP_PROMPT_HOLD",
    "FAKE_ACP_PERMISSION_OPTIONS",
    "FAKE_ACP_ECHO_FILE",
    "FAKE_ACP_MODEL_SHAPE",
    "FAKE_ACP_AUTH_GATE",
    "FAKE_ACP_CLINE_AUTHED",
  ] as const;
  const chatIds: string[] = [];
  // Pids this test itself caused to exist (via waitForPidFile, called once driveToParkedPermission
  // confirms the process is up), verified gone in afterEach — every process this test starts must be
  // killed, and its death verified by pid.
  const spawnedPids: number[] = [];

  function restoreEnv(): void {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }

  beforeEach(() => {
    // Snapshot env BEFORE anything that can throw (mkdtempSync/writeFileSync/chmodSync below) — see
    // acpPermissionFakeAgent.test.ts's identical ordering discipline.
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    stubDir = undefined;
    echoDir = undefined;
    pidDir = undefined;
    pidDir = mkdtempSync(join(tmpdir(), "bismuth-acp-abort-pid-"));
    pidFile = join(pidDir, "agent.pid");
    stubDir = makeAcpFakeAgentStubDir("bismuth-acp-abort-stub-", "cline", FAKE_AGENT_SCRIPT, pidFile);
    echoDir = mkdtempSync(join(tmpdir(), "bismuth-acp-abort-echo-"));
    echoFile = join(echoDir, "echo.jsonl");

    // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
    process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ""}`;
    process.env.FAKE_ACP_ECHO_FILE = echoFile;
    process.env.FAKE_ACP_PROMPT_HOLD = "permission";
    // Hermetic against ambient env — the same finding acpPermissionFakeAgent.test.ts's beforeEach
    // documents: a stray FAKE_ACP_AUTH_GATE exported in the shell running `bun test` would gate
    // session/new and turn every test here into an auth-refusal test instead.
    process.env.FAKE_ACP_MODEL_SHAPE = "new";
    delete process.env.FAKE_ACP_AUTH_GATE;
    delete process.env.FAKE_ACP_CLINE_AUTHED;
    delete process.env.FAKE_ACP_PERMISSION_OPTIONS;
  });

  afterEach(async () => {
    // Env restore FIRST: a throw below must never skip restoration and leave a later test (in this
    // file or a later file in this same process) pointed at a stub PATH.
    restoreEnv();
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);

    // Every process this test started must be killed, verified with `ps` by an OWNED pid, never a
    // `pgrep -f` pattern match. closeChat()'s own kill is
    // SIGTERM-then-SIGKILL-after-KILL_ESCALATION_GRACE_MS (3000ms, driver.ts) fire-and-forget, so a
    // single immediate `ps` here would race that escalation — bounded poll instead (now the shared
    // ../support/acpFakeAgentProcess.ts helper, same 5s default timeout this loop used inline before).
    const stillAlive = await waitProcessesGone(spawnedPids.splice(0));

    if (stubDir) rmSync(stubDir, { recursive: true, force: true });
    if (echoDir) rmSync(echoDir, { recursive: true, force: true });
    if (pidDir) rmSync(pidDir, { recursive: true, force: true });

    if (stillAlive.length > 0) {
      throw new Error(`acpAbortFakeAgent.test: fake-agent pid(s) ${stillAlive.join(", ")} still alive 5s after closeChat — a real leak.`);
    }
  }, 15_000);

  afterAll(() => {
    // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
    // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
    restoreEnv();
  });

  /**
   * Everything up to and including "the turn is parked on a permission prompt, provably has not
   * settled, and this test knows the fake agent process's own pid". Mirrors
   * acpPermissionFakeAgent.test.ts's identical-purpose helper (duplicated, not imported — these are
   * standalone test files, not a shared module).
   */
  async function driveToParkedPermission(chatId: string): Promise<{
    permissionId: string;
    permissionIdx: number;
    frames: ChatFrame[];
    waitFor: ReturnType<typeof makeChatFrameCollector>["waitFor"];
    pid: number;
  }> {
    chatIds.push(chatId);
    const { sink, frames, waitFor } = makeChatFrameCollector(12_000);

    CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

    const permission = expectFrame(await waitFor((f) => f.type === "permission"), "permission");

    // Exactly one, not "at least one": this turn contains exactly one tool call, so a second
    // permission frame would mean the driver re-emitted a parked request.
    expect(frames.filter((f) => f.type === "permission").length).toBe(1);
    expect(permission.id).toMatch(/^\d+$/); // the fake's outbound rpc id, stringified by driver.ts

    // The turn must still be IN FLIGHT, asserted against elapsed time, not arrival order alone.
    await new Promise((r) => setTimeout(r, PARKED_OBSERVATION_MS));
    expect(frames.filter((f) => f.type === "result").length).toBe(0);
    expect(frames.filter((f) => f.type === "done").length).toBe(0);

    // The fake asked with the id the driver reported — correlation running in both directions.
    const asks = readEchoLines(echoFile).filter((l) => l.dir === "out-request" && l.method === "session/request_permission");
    expect(asks.length).toBe(1);
    expect(String(asks[0].id)).toBe(permission.id);

    const pid = await waitForPidFile(pidFile);
    spawnedPids.push(pid);
    expect(pidAlive(pid)).toBe(true); // sanity: the process this test will later verify is dead is alive NOW

    return { permissionId: permission.id, permissionIdx: frames.indexOf(permission), frames, waitFor, pid };
  }

  test(
    "abortTurn mid-permission-hold: the turn settles cleanly (isError:false, not an error), session/cancel actually went out, and a stale late reply produces zero further frames",
    async () => {
      const chatId = "acp-abort-" + Date.now();
      const { permissionId, permissionIdx, frames, waitFor } = await driveToParkedPermission(chatId);

      CHAT_BACKENDS.cline.abortTurn(chatId);

      await waitFor((f) => f.type === "done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      // Ordering AND counts, not mere presence: exactly one result, exactly one done, both strictly
      // after the permission frame, result before done.
      expect(resultIdx).toBeGreaterThan(permissionIdx);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      expect(frames.filter((f) => f.type === "result").length).toBe(1);
      expect(frames.filter((f) => f.type === "done").length).toBe(1);
      expect(frames.filter((f) => f.type === "error").length).toBe(0);

      // THE ONE DETAIL THAT LOOKS LIKE A BUG BUT ISN'T: a cancel is a clean turn
      // end, not a failure — driver.ts:593 only flags isError for stopReason "refusal".
      expect(expectFrame(frames[resultIdx], "result").isError).toBe(false);

      // The driver actually sent session/cancel (not just internally flipped a flag) — exactly one,
      // not "at least one": a second would mean abortTurn (or something else) double-cancelled.
      const cancels = readEchoLines(echoFile).filter((l) => l.method === "session/cancel");
      expect(cancels.length).toBe(1);

      // THE WRINKLE THIS TASK FIXES: a stale UI still answering the permission prompt AFTER the turn
      // already ended must not resurrect a stray frame (see this file's header). Capture the count
      // BEFORE triggering it, so what catches a regression is a COUNT compare, never "did a done
      // frame appear" (frames never disappear from this collector, so presence alone would pass
      // trivially).
      const framesBeforeLateReply = frames.length;
      const respond = CHAT_BACKENDS.cline.respondPermission;
      expect(typeof respond).toBe("function");
      respond!(chatId, permissionId, "allow");

      // Prove the late reply GENUINELY happened — not vacuously skipped because the driver had
      // already forgotten this permission id — by watching the echo file for the driver's own
      // response landing on the fake's stdin. Without this, "no new frames" could pass for the
      // wrong reason (nothing was ever sent) rather than the right one (something was sent and
      // correctly produced nothing further).
      await waitForCondition(
        () => readEchoLines(echoFile).some((l) => l.dir === "in-response" && String(l.id) === permissionId),
        5_000,
        `a JSON-RPC response echoed for the late permission reply, id ${permissionId}`,
      );
      const lateReplies = readEchoLines(echoFile).filter((l) => l.dir === "in-response" && String(l.id) === permissionId);
      expect(lateReplies.length).toBe(1);
      // The driver really did resolve it as a selection (respondPermission wrote a real outcome),
      // not e.g. silently refusing to write anything — pins that the scenario under test is the real
      // "stale UI answers late" case, not some other no-op.
      expect(lateReplies[0].error).toBeUndefined();

      // Give the fake's drained-and-guarded runner every chance to (wrongly) emit something.
      await new Promise((r) => setTimeout(r, NO_STRAY_FRAME_OBSERVATION_MS));
      expect(frames.length).toBe(framesBeforeLateReply);
      expect(frames.some((f) => f.type === "assistant-text" && f.text.startsWith(FAKE_PERMISSION_REPLY_PREFIX))).toBe(false);
    },
    20_000,
  );

  test(
    "a session/prompt that never settles leaves the chat turnActive indefinitely; closeChat still tears the fake agent process down, with no orphan left behind",
    async () => {
      const chatId = "acp-never-terminate-" + Date.now();
      // Held open and NEVER answered (no respondPermission, no abortTurn) — nothing else in this
      // process can settle it. See fakeAcpAgent.ts's own header for why this makes the assertions
      // below non-vacuous: a wrong rpc id, a missing pendingPermissions entry, or simply nothing at
      // all all produce the exact same observable result from in here, so only a genuine, correct
      // settle could ever produce a result/done frame.
      const { permissionIdx, frames, pid } = await driveToParkedPermission(chatId);

      // Still nothing, well past driveToParkedPermission's own PARKED_OBSERVATION_MS wait.
      expect(frames.filter((f) => f.type === "result").length).toBe(0);
      expect(frames.filter((f) => f.type === "done").length).toBe(0);
      expect(frames.filter((f) => f.type === "permission").length).toBe(1);
      expect(permissionIdx).toBeGreaterThanOrEqual(0);

      // turnActive, proven through the one PUBLIC surface that reveals it without reaching into
      // driver.ts's private session state: rebindSessionSink's synthetic `done`
      // (chatProviders/sessionSink.ts, unit-tested in sessionSink.test.ts's own "rebind mid-turn
      // (turnActive: true) does NOT append a synthetic done" case). `rebindSessionSink` pushes that
      // synthetic `done` SYNCHRONOUSLY, inside the same call, whenever `!turnActive` — so rebinding
      // to a fresh, otherwise-untouched probe sink and checking it IMMEDIATELY (no await) is a
      // point-in-time proof: an empty probe means turnActive was true at this exact instant, not
      // "probably still true". (This intentionally re-points the session's sink away from `frames` —
      // fine here, since nothing further is asserted against `frames` after this point.)
      const probe = makeChatFrameCollector(1_000);
      expect(CHAT_BACKENDS.cline.rebindSink(chatId, probe.sink)).toBe(true);
      expect(probe.frames.length).toBe(0);

      // Confirm the pid recorded earlier really does still name a live process right before
      // closeChat — otherwise "not alive after closeChat" could pass for the wrong reason (it was
      // already dead beforehand).
      expect(pidAlive(pid)).toBe(true);

      CHAT_BACKENDS.cline.closeChat(chatId);
      chatIds.splice(chatIds.indexOf(chatId), 1); // already closed here; afterEach must not double-close

      // Bounded poll (comfortably past driver.ts's KILL_ESCALATION_GRACE_MS=3000ms
      // SIGTERM-then-SIGKILL escalation) for the exact pid — never a `pgrep -f` pattern — to exit.
      await waitForCondition(() => !pidAlive(pid), 5_000, `pid ${pid} (the fake agent process) to exit after closeChat`);
      expect(pidAlive(pid)).toBe(false);
      spawnedPids.splice(spawnedPids.indexOf(pid), 1); // already verified dead here; afterEach's own check is now a no-op for this pid
    },
    20_000,
  );
});
