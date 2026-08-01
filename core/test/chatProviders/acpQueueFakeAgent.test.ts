// core/test/chatProviders/acpQueueFakeAgent.test.ts
// Task 10 of the agent-integration-completion plan: the turn queue — what happens when a user sends
// a second (and third) message while the first turn is still in flight, offline, through the REAL,
// unmodified chatProviders/acp/driver.ts.
//
// WHY THIS FILE EXISTS. `runOrQueue` (driver.ts) exists in three chat drivers with the identical
// shape (ACP here; also codex/driver.ts and chat.ts's own Claude session) and had NO offline test on
// any of them before this task: does a message sent while `turnActive` really get queued instead of
// dispatched immediately, and does the driver drain that queue in the order the user actually sent
// the messages — not merely "does everything eventually finish" (a broken queue that runs things in
// the wrong order, or that dispatches a queued turn too early, still produces the right FRAME COUNT
// if nothing asserts on order or on wire traffic while a turn is held open).
//
// THE MECHANISM: ../support/fakeAcpAgent.ts's "queue" hold mode (`FAKE_ACP_PROMPT_HOLD=queue`, added
// by this task — see that file's header, "QUEUE-HOLD MODE"). Every `session/prompt` this fake
// receives is held open for `FAKE_ACP_QUEUE_HOLD_MS` before it settles itself on a plain internal
// timer — no permission round-trip, no external release signal needed or possible. This is
// deliberately simpler than the existing "permission" hold mode
// (acpPermissionFakeAgent.test.ts/acpAbortFakeAgent.test.ts) because a turn-queue test's own subject
// is entirely on the CLIENT side (driver.ts's `s.queue`/`runOrQueue`), not anything the agent does. A
// held turn echoes the ORIGINAL prompt text it received back in its own settling
// `agent_message_chunk`, which — together with the echo file's own recording of every
// `session/prompt` request's raw params — gives TWO independent proof channels for both submission
// order (what the driver actually put ON THE WIRE, and when) and settle order (what the driver's OWN
// frame stream reports, and in what sequence).
//
// NON-VACUOUSNESS, stated precisely (this project's recurring defect is a check that stays green even
// when the thing it claims to prove never happened — see this task's own brief):
//   - The first test asserts, WHILE the first turn is still held (well within its hold window,
//     checked against real elapsed time, not against ordering of ChatFrames alone), that the echo
//     file holds EXACTLY ONE `session/prompt` line. A driver that bypassed `runOrQueue`'s
//     `s.turnActive` gate entirely (sent BOTH prompts immediately) would show TWO lines at that same
//     checkpoint — this is the assertion that actually proves the queue is doing something, not
//     merely that two messages eventually produce two `done` frames.
//   - The second test sends a THIRD message while the first is held (two turns end up queued
//     simultaneously) and asserts the three `session/prompt` requests' own `prompt` text landed on
//     the wire in EXACT submission order (alpha, beta, gamma) — not just that three `done` frames
//     arrived. A queue that dequeues LIFO (or otherwise reorders — e.g. `Array.prototype.pop()`
//     swapped in for `.shift()` in driver.ts's `runTurn`) is indistinguishable from a correct one
//     with only ONE item ever queued (the first test, with only a second message, has nothing to
//     reorder against), which is why this second test needs three messages, not two, despite this
//     task's brief describing "two sendMessage calls" as the base scenario.
//
// SABOTAGE PERFORMED (verification only, applied to a local copy of driver.ts and reverted — never
// committed; see this task's own report for exact results):
//   1. `runOrQueue` mutated to always call `runTurn` regardless of `s.turnActive` (the queue bypassed
//      entirely) — the FIRST test's "exactly one `session/prompt` line while held" assertion failed
//      as intended (it saw two).
//   2. `runTurn`'s own queue drain mutated from `s.queue.shift()` to `s.queue.pop()` (LIFO instead of
//      FIFO) — the SECOND test's submission-order assertion failed specifically (beta/gamma swapped
//      to gamma/beta), while the first test and every count-based assertion in both tests still
//      passed — proving that mutation's failure really is about ORDER and nothing else.
//
// STUB-BINARY PATTERN: identical to every other fakeAcpAgent.ts-driven test file — write an
// executable stub named "cline" into a throwaway temp dir, prepend it onto PATH so
// core/src/claudeWhich.ts's whichBinary("cline") resolves the stub, then drive the REAL, unmodified
// chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly as production does. Zero network of any
// kind, zero CLI dependency, zero account contact.
//
// No production files were changed for this task — only the test-support fake agent gained the new
// "queue" hold mode (additive, opt-in via FAKE_ACP_PROMPT_HOLD=queue; every pre-existing consumer of
// that file leaves the var unset or set to "permission" and is byte-for-byte unaffected).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatFrame } from "../../src/chat";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");

// Must match ../support/fakeAcpAgent.ts's own constant — duplicated rather than imported because the
// fake is a standalone script executed as a subprocess, not a module this test links against (the
// same convention every sibling fake-agent test file already uses).
const FAKE_QUEUE_TURN_PREFIX = "fake-acp queued-turn echo: ";

/** How long the fake holds each `session/prompt` open before auto-settling — see fakeAcpAgent.ts's
 *  own QUEUE_HOLD_MS doc comment. Pinned explicitly here (rather than relying on the fake's own
 *  default) so this file's timing assumptions never silently drift if that default ever changes. */
const QUEUE_HOLD_MS = 400;

/** How long after sending the second (and third) message to wait before asserting the first turn is
 *  still held — comfortably less than QUEUE_HOLD_MS (so the check can't accidentally run after the
 *  first turn has already auto-settled) and comfortably more than a same-machine spawn→pipe→readline
 *  round trip (so "still held" is a real observation, not a coincidence of scheduling). Mirrors the
 *  ~2-orders-of-magnitude margin the permission-mode tests use for their own PARKED_OBSERVATION_MS. */
const HELD_OBSERVATION_MS = 150;

function makeStubBinDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-acp-queue-stub-"));
  const stubPath = join(dir, "cline");
  writeFileSync(stubPath, `#!/bin/bash\nexec bun run ${JSON.stringify(FAKE_AGENT_SCRIPT)} "$@"\n`);
  chmodSync(stubPath, 0o755);
  return dir;
}

interface EchoLine {
  method?: string;
  params?: unknown;
}

/** Same tolerance contract as every sibling fake-agent test file: a missing file is an empty array
 *  (polled before the fake has written anything), and a torn last line (read mid-appendFileSync) is
 *  dropped so the CURRENT poll fails and is retried, rather than throwing a spurious JSON.parse error
 *  that would fail the whole test. */
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

/** Pull the plain text out of a `session/prompt` request's own `params.prompt` — the same shape
 *  driver.ts's `runTurn` builds (`[{type:"text", text}]`). Duplicated (not imported) from
 *  fakeAcpAgent.ts's own `extractPromptText` for the same reason as every other constant/helper this
 *  file mirrors: the fake is a standalone subprocess script, not a module this test links against. */
function promptText(params: unknown): string {
  const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const blocks = Array.isArray(p.prompt) ? p.prompt : [];
  const first = blocks.find((b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "text") as
    | Record<string, unknown>
    | undefined;
  return typeof first?.text === "string" ? first.text : "";
}

async function waitForCondition(check: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for: ${description}`);
}

describe("the ACP driver's turn queue: a message sent while the previous turn is in flight, against a fake agent that holds every turn open (zero network, zero CLI dependency)", () => {
  // `| undefined` with explicit resets in beforeEach, matching every sibling fake-agent test file's
  // documented shape: if a throwing call in the FIRST beforeEach fails partway, afterEach must not be
  // handed `undefined` where it expects a string (rmSync's `force:true` swallows ENOENT, not an
  // ERR_INVALID_ARG_TYPE from a wrong argument type) — a bug this harness has shipped before.
  let stubDir: string | undefined;
  let echoDir: string | undefined;
  let echoFile: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "PATH",
    "FAKE_ACP_PROMPT_HOLD",
    "FAKE_ACP_QUEUE_HOLD_MS",
    "FAKE_ACP_PERMISSION_OPTIONS",
    "FAKE_ACP_ECHO_FILE",
    "FAKE_ACP_MODEL_SHAPE",
    "FAKE_ACP_AUTH_GATE",
    "FAKE_ACP_CLINE_AUTHED",
  ] as const;
  const chatIds: string[] = [];

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
    stubDir = makeStubBinDir();
    echoDir = mkdtempSync(join(tmpdir(), "bismuth-acp-queue-echo-"));
    echoFile = join(echoDir, "echo.jsonl");

    // Prepended, not appended: must win over any real `cline` installed elsewhere on PATH.
    process.env.PATH = `${stubDir}:${savedEnv.PATH ?? ""}`;
    process.env.FAKE_ACP_ECHO_FILE = echoFile;
    process.env.FAKE_ACP_PROMPT_HOLD = "queue";
    process.env.FAKE_ACP_QUEUE_HOLD_MS = String(QUEUE_HOLD_MS);
    // Hermetic against ambient env — the same finding every sibling fake-agent test file's beforeEach
    // documents: a stray FAKE_ACP_AUTH_GATE (or a leftover permission-options var) exported in the
    // shell running `bun test` must not leak into this file's own tests.
    process.env.FAKE_ACP_MODEL_SHAPE = "new";
    delete process.env.FAKE_ACP_AUTH_GATE;
    delete process.env.FAKE_ACP_CLINE_AUTHED;
    delete process.env.FAKE_ACP_PERMISSION_OPTIONS;
  });

  afterEach(() => {
    // Env restore FIRST: a throw from the closeChat loop must never skip restoration and leave a
    // later test (in this file or a later file in this same process) pointed at a stub PATH.
    restoreEnv();
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    if (stubDir) rmSync(stubDir, { recursive: true, force: true });
    if (echoDir) rmSync(echoDir, { recursive: true, force: true });
  });

  afterAll(() => {
    // Belt-and-suspenders: a thrown assertion mid-test must never leave a LATER, unrelated test file
    // in this same `bun test` process pointed at a stub PATH or a stuck FAKE_ACP_* var.
    restoreEnv();
  });

  /**
   * Pre-create the session and wait for the handshake+session/new round trip to finish (the
   * "session" frame) before this file's own turn-QUEUE scenario begins. Without this, the very
   * first `sendMessage` call on a brand-new chat races its OWN async session creation — a real,
   * separately-documented gap in sendMessage's "new session" branch (see driver.ts's own comment on
   * it, cited by name in this task's report) — which would make a bare
   * two-`sendMessage`-calls-back-to-back test flaky for a reason that has nothing to do with the
   * queue this task is testing. Pre-creating the session and waiting for confirmation that it is
   * open (turnActive: false, sessionId assigned) makes the FIRST `sendMessage` call below take the
   * "existing session" branch, whose own path to `runOrQueue` is fully synchronous up to and
   * including `session/prompt` hitting the wire — the property this file's assertions depend on.
   */
  async function openReadySession(
    chatId: string,
    sink: (f: ChatFrame) => void,
    waitFor: (match: (f: ChatFrame) => boolean, timeoutMs?: number) => Promise<ChatFrame>,
  ): Promise<void> {
    CHAT_BACKENDS.cline.openSession({ chatId, cwd: "/tmp", sink, computerUse: false });
    await waitFor((f) => f.type === "session");
  }

  test(
    "two sendMessage calls back to back: the second is queued (not dispatched) while the first turn is in flight, and runs after it settles — in submission order, on the same ACP session",
    async () => {
      const chatId = "acp-queue-two-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(15_000);

      await openReadySession(chatId, sink, waitFor);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "first message" });
      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "second message" });

      // THE assertion this test exists for (see this file's header): while turn 1 is still
      // genuinely held, the second message must NOT have reached the wire at all — it is sitting in
      // the driver's own queue. A driver that bypassed the turnActive gate would show 2 lines here.
      await new Promise((r) => setTimeout(r, HELD_OBSERVATION_MS));
      expect(readEchoLines(echoFile).filter((l) => l.method === "session/prompt").length).toBe(1);
      expect(frames.filter((f) => f.type === "done").length).toBe(0);

      await waitForCondition(
        () => frames.filter((f) => f.type === "done").length === 2,
        QUEUE_HOLD_MS * 2 + 8_000,
        "2 done frames (both turns settled)",
      );

      const prompts = readEchoLines(echoFile).filter((l) => l.method === "session/prompt");
      expect(prompts.length).toBe(2);
      // Submission order, not mere presence — see this file's header.
      expect(prompts.map((p) => promptText(p.params))).toEqual(["first message", "second message"]);
      const sessionIds = prompts.map((p) => (p.params as { sessionId?: string } | undefined)?.sessionId);
      expect(sessionIds[0]).toBeTruthy();
      expect(sessionIds[1]).toBe(sessionIds[0]);

      // Independent second proof channel (the driver's own frame stream, not the echo file) — mirrors
      // acpPermissionFakeAgent.test.ts's identical dual-proof idiom.
      const queueTexts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text").map((f) => f.text);
      expect(queueTexts).toEqual([`${FAKE_QUEUE_TURN_PREFIX}first message`, `${FAKE_QUEUE_TURN_PREFIX}second message`]);

      expect(frames.filter((f) => f.type === "done").length).toBe(2);
      const results = frames.filter((f): f is Extract<ChatFrame, { type: "result" }> => f.type === "result");
      expect(results.length).toBe(2);
      expect(results.every((r) => r.isError === false)).toBe(true);
      expect(frames.some((f) => f.type === "error")).toBe(false);
    },
    20_000,
  );

  test(
    "three sendMessage calls while the first is in flight: the two QUEUED turns run in the order they were submitted, not reversed",
    async () => {
      const chatId = "acp-queue-three-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(20_000);

      await openReadySession(chatId, sink, waitFor);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "alpha" });
      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "beta" });
      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "gamma" });

      // Both "beta" and "gamma" are queued behind "alpha" at this instant — the two-simultaneously-
      // queued scenario a bare two-message test cannot exercise (see this file's header).
      await new Promise((r) => setTimeout(r, HELD_OBSERVATION_MS));
      expect(readEchoLines(echoFile).filter((l) => l.method === "session/prompt").length).toBe(1);

      await waitForCondition(
        () => frames.filter((f) => f.type === "done").length === 3,
        QUEUE_HOLD_MS * 3 + 10_000,
        "3 done frames",
      );

      const prompts = readEchoLines(echoFile).filter((l) => l.method === "session/prompt");
      expect(prompts.length).toBe(3);
      // THE assertion this test exists for: submission order specifically. A LIFO (or otherwise
      // reordering) queue drain still produces 3 session/prompt calls and 3 done frames — passing
      // every count-based check in this file — while getting beta/gamma backwards here.
      expect(prompts.map((p) => promptText(p.params))).toEqual(["alpha", "beta", "gamma"]);

      const queueTexts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text").map((f) => f.text);
      expect(queueTexts).toEqual([`${FAKE_QUEUE_TURN_PREFIX}alpha`, `${FAKE_QUEUE_TURN_PREFIX}beta`, `${FAKE_QUEUE_TURN_PREFIX}gamma`]);
    },
    25_000,
  );
});
