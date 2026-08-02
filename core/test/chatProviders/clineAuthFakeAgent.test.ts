// core/test/chatProviders/clineAuthFakeAgent.test.ts
// Closes the last piece of cline's offline test-coverage gap. clineMocked.test.ts already proves
// ONE thing against a REAL cline binary (skipped if not installed): an isolated, never-authenticated
// CLINE_DIR makes session/new fail SAFELY. That is a fact about cline's OWN behavior, and (per that
// file's own header) is NOT an end-to-end test of Bismuth's driver against a completed turn — nothing
// in this repo, before this task, proved the ACP driver (core/src/chatProviders/acp/driver.ts) can
// carry a full cline-shaped conversation to completion, because the real binary's auth wall makes
// that impossible to reach without a real account (see backendEnv.ts's `cline` case for the one
// narrow exception this task found and used separately, in clineMocked.test.ts's new real-E2E block).
//
// THIS FILE tests BISMUTH'S DRIVER, not cline itself, against a FAKE agent
// (core/test/support/fakeAcpAgent.ts's "CLINE AUTH-GATE MODE") that reproduces cline 3.0.47's real
// ACP auth surface — cited from its own compiled binary, see fakeAcpAgent.ts's header for the exact
// source strings matched (authMethods array, the -32000 refusal, the CLINE_API_KEY bypass). Needs no
// `cline` binary installed and no network of any kind — runs unconditionally in `bun test core`,
// exactly like acpFakeAgent.test.ts.
//
// TWO THINGS PROVEN HERE THAT DID NOT EXIST BEFORE THIS TASK:
//   1. Refusal path: with the fake's gate CLOSED (no FAKE_ACP_CLINE_AUTHED), driver.ts must surface
//      cline's real -32000/"Authentication required: Call authenticate before creating a session" as
//      a clean `error` ChatFrame — never a hang, never a silent success, and (the actual safety
//      assertion, not just "the first frame we waited for was an error") never any assistant-text or
//      result frame anywhere in the whole transcript. Mirrors clineMocked.test.ts's own real-binary
//      assertion shape exactly, but reproducible with zero dependency on a cline install.
//   2. Completion path: with the fake's gate OPEN (FAKE_ACP_CLINE_AUTHED=1, mirroring the real
//      CLINE_API_KEY bypass this task found — see fakeAcpAgent.ts's header), a full turn completes:
//      the fixture's distinctive sentinel arrives as assistant-text, then a `result` frame with
//      isError:false, then `done` — and no `error` frame ever appears.
//
// STUB-BINARY PATTERN: identical to acpFakeAgent.test.ts (which cites relay/test/wrap.test.ts as the
// original precedent) — write an executable stub named "cline" into a throwaway temp dir, prepend
// that dir onto PATH so claudeWhich.ts's whichBinary("cline") resolves the stub, then drive the REAL,
// unmodified chatProviders/acp/driver.ts via CHAT_BACKENDS.cline exactly as production does. Runs in
// its OWN temp PATH dir, independent of acpFakeAgent.test.ts's — the two files never interact.
//
// No production files were changed for this task's tests (fakeAcpAgent.ts is test support, not
// production — see its own header).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");
const FAKE_TURN_TEXT = "Hello from the fake ACP agent"; // must match fakeAcpAgent.ts's own constant
const CLINE_AUTH_MESSAGE = "Authentication required: Call authenticate before creating a session"; // cited verbatim in fakeAcpAgent.ts's header

function makeStubBinDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-cline-authgate-stub-"));
  const stubPath = join(dir, "cline");
  writeFileSync(stubPath, `#!/bin/bash\nexec bun run ${JSON.stringify(FAKE_AGENT_SCRIPT)} "$@"\n`);
  chmodSync(stubPath, 0o755);
  return dir;
}

describe("Bismuth's ACP driver against a fake agent reproducing cline's REAL auth gate (zero network, zero cline binary needed)", () => {
  let stubDir: string;
  let savedPath: string | undefined;
  let savedAuthGate: string | undefined;
  let savedAuthed: string | undefined;
  let savedModelShape: string | undefined;
  const chatIds: string[] = [];

  beforeEach(() => {
    // Snapshot env BEFORE anything that can throw (mkdtempSync/writeFileSync/chmodSync in
    // makeStubBinDir) — same ordering discipline acpFakeAgent.test.ts's own beforeEach documents, so
    // a first-test throw here can never leave a later test's PATH/env corrupted by an `undefined`
    // "saved" value that afterEach would then wrongly `delete` instead of restore.
    savedPath = process.env.PATH;
    savedAuthGate = process.env.FAKE_ACP_AUTH_GATE;
    savedAuthed = process.env.FAKE_ACP_CLINE_AUTHED;
    savedModelShape = process.env.FAKE_ACP_MODEL_SHAPE;
    stubDir = makeStubBinDir();
    process.env.PATH = `${stubDir}:${savedPath ?? ""}`;
    process.env.FAKE_ACP_AUTH_GATE = "cline";
    // Hermetic against ambient env (a code-review finding on this task): the gate-CLOSED test's
    // whole meaning depends on this being unset, but only `savedAuthed` was snapshotted here, never
    // actively cleared — so a stray FAKE_ACP_CLINE_AUTHED already exported in the shell running `bun
    // test` (or leaked from a prior test, however unlikely given the restores above) would silently
    // flip the "closed" test into a second copy of the "open" one. Reproduced live: with this line
    // absent, `FAKE_ACP_CLINE_AUTHED=1 bun test clineAuthFakeAgent.test.ts` fails the gate-CLOSED
    // test on a timeout (it fails SAFE, which doubles as independent confirmation the assertion
    // isn't vacuous — but the test's own hermeticity still needs this fix). The gate-OPEN test below
    // sets this explicitly itself, so this default only ever matters for the CLOSED test.
    delete process.env.FAKE_ACP_CLINE_AUTHED;
  });

  afterEach(async () => {
    // Env restore FIRST (a code-review finding on this task): a throw from the closeChat loop below
    // must never skip restoration and leave a LATER test in this file pointed at a stub PATH/gate —
    // restoring env before anything that can itself throw closes that gap without needing a
    // try/finally. closeChat doesn't need the stub PATH to already be gone (it only tears down a
    // process handle recorded earlier), so this reordering changes nothing about what's torn down.
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedAuthGate === undefined) delete process.env.FAKE_ACP_AUTH_GATE;
    else process.env.FAKE_ACP_AUTH_GATE = savedAuthGate;
    if (savedAuthed === undefined) delete process.env.FAKE_ACP_CLINE_AUTHED;
    else process.env.FAKE_ACP_CLINE_AUTHED = savedAuthed;
    if (savedModelShape === undefined) delete process.env.FAKE_ACP_MODEL_SHAPE;
    else process.env.FAKE_ACP_MODEL_SHAPE = savedModelShape;
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    rmSync(stubDir, { recursive: true, force: true });
  });

  afterAll(() => {
    // Belt-and-suspenders: afterEach already restores these, but a thrown assertion mid-test must
    // never leave a LATER, unrelated test file in this same `bun test` process pointed at a stub
    // PATH or a stuck FAKE_ACP_* var. A code-review finding on this task: the previous version of
    // this hook only ever SET a saved value back when it was originally defined — in the (default,
    // every-clean-environment) case where a var started unset, a mid-test throw here left it stuck
    // at whatever this file's OWN beforeEach had set, not restored to absent. Reproduced live: with
    // this bug in place, exporting FAKE_ACP_AUTH_GATE=cline and running acpFakeAgent.test.ts gave 0
    // pass / 3 fail. Fixed to `delete` (not just leave alone) exactly like afterEach does above.
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedAuthGate === undefined) delete process.env.FAKE_ACP_AUTH_GATE;
    else process.env.FAKE_ACP_AUTH_GATE = savedAuthGate;
    if (savedAuthed === undefined) delete process.env.FAKE_ACP_CLINE_AUTHED;
    else process.env.FAKE_ACP_CLINE_AUTHED = savedAuthed;
    if (savedModelShape === undefined) delete process.env.FAKE_ACP_MODEL_SHAPE;
    else process.env.FAKE_ACP_MODEL_SHAPE = savedModelShape;
  });

  test(
    "gate CLOSED: the real -32000 auth-required refusal surfaces as a clean error ChatFrame, never a hang, never any assistant-text or result frame",
    async () => {
      // FAKE_ACP_CLINE_AUTHED left unset — the fake's session/new refuses exactly like real cline.
      const chatId = "cline-authgate-closed-" + Date.now();
      chatIds.push(chatId);
      const { frames, sink, waitFor } = makeChatFrameCollector(12_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      const errorFrame = await waitFor((f) => f.type === "error");
      expect(errorFrame.type).toBe("error");
      if (errorFrame.type === "error") {
        expect(errorFrame.code).toBe("error");
        expect(errorFrame.message).toContain(CLINE_AUTH_MESSAGE);
      }

      // The actual safety assertion (mirrors clineMocked.test.ts's own real-binary test): `waitFor`
      // above resolves on the FIRST "error" frame and ignores everything before it, so on its own it
      // would still pass even if a stray success frame had arrived first. createSession's error path
      // is a dead end — nothing else fires afterward —
      // so `frames` holds the WHOLE transcript by now, not just the one frame waited for.
      expect(frames.some((f) => f.type === "assistant-text")).toBe(false);
      expect(frames.some((f) => f.type === "result")).toBe(false);
      expect(frames.some((f) => f.type === "models")).toBe(false);
    },
    15_000,
  );

  test(
    "gate OPEN (FAKE_ACP_CLINE_AUTHED=1, mirroring the real CLINE_API_KEY bypass): a full turn completes — the fixture sentinel arrives as assistant-text, then result.isError===false, then done, and no error frame ever appears",
    async () => {
      process.env.FAKE_ACP_CLINE_AUTHED = "1";
      const chatId = "cline-authgate-open-" + Date.now();
      chatIds.push(chatId);
      const { frames, sink, waitFor } = makeChatFrameCollector(12_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      // Proves session/new actually succeeded through the gate (not just "some turn happened") —
      // real cline's own authMethods (this file's fake reproduces them verbatim) still arrive in
      // `initialize` regardless of gate state; the SESSION frame only ever fires after a successful
      // session/new, so its presence is itself part of the "gate opened" proof.
      const sessionFrame = await waitFor((f) => f.type === "session");
      if (sessionFrame.type === "session") expect(sessionFrame.sessionId).toStartWith("fake-session-");

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      if (assistantText.type === "assistant-text") expect(assistantText.text).toBe(FAKE_TURN_TEXT);

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      if (frames[resultIdx].type === "result") expect(frames[resultIdx].isError).toBe(false);

      // Never confused with the refusal path from the sibling test above.
      expect(frames.some((f) => f.type === "error")).toBe(false);
    },
    15_000,
  );
});
