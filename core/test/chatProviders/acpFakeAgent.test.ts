// core/test/chatProviders/acpFakeAgent.test.ts
// Task 4 of the offline-integration-testing plan: drive core/src/chatProviders/acp/driver.ts against
// a FAKE ACP agent (core/test/support/fakeAcpAgent.ts) rather than a real CLI, specifically to cover
// the model-shape version-skew branch (./protocol.ts's detectModelShape) that NO single real ACP
// agent installed on any one machine can exercise both sides of: an agent's `session/new` response
// either reports the OLD `models.availableModels`/`currentModelId` shape (still-shipping
// 0.14.1-pinned adapters, and cline's own bundled dispatch) or the NEW `configOptions` shape (SDKs
// ~0.20+) — never both from the same binary. This test controls which shape comes back via the fake
// agent's FAKE_ACP_MODEL_SHAPE env var, proving the driver's branch logic against BOTH, in one file,
// with zero dependency on any ACP CLI being installed and zero network access at all (the fake agent
// never makes an HTTP call of any kind — there is no model API on the other end of it, mock or
// real).
//
// STUB-BINARY PATTERN: mirrors relay/test/wrap.test.ts exactly (cited in this task's brief as the
// precedent) — write an executable stub file NAMED like a real ACP agent binary ("cline", chosen
// because agents.ts's cline entry has the simplest args list, `["--acp"]`, no fallbackArgs retry to
// account for) into a throwaway temp dir, PREPEND that dir onto PATH so core/src/claudeWhich.ts's
// whichBinary("cline") resolves the stub instead of any real `cline` this machine might have
// installed elsewhere on PATH, then drive the REAL, unmodified chatProviders/acp/driver.ts (via
// CHAT_BACKENDS.cline from ../../src/chatProviders/backends — the same registry chat.ts's WS layer
// dispatches through) exactly as production does. The stub's OWN body just execs
// fakeAcpAgent.ts — the JSON-RPC protocol logic lives there, not in this file.
//
// No production files were changed for this task.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";

const FAKE_AGENT_SCRIPT = join(import.meta.dir, "..", "support", "fakeAcpAgent.ts");
const FAKE_TURN_TEXT = "Hello from the fake ACP agent"; // must match fakeAcpAgent.ts's own constant

function makeStubBinDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-acp-fake-stub-"));
  const stubPath = join(dir, "cline");
  // A thin bash shim, same shape as relay/test/wrap.test.ts's own stub bodies — execs the real
  // logic in fakeAcpAgent.ts rather than duplicating the JSON-RPC handling inline here.
  writeFileSync(stubPath, `#!/bin/bash\nexec bun run ${JSON.stringify(FAKE_AGENT_SCRIPT)} "$@"\n`);
  chmodSync(stubPath, 0o755);
  return dir;
}

/** One `{method, params}` line per inbound JSON-RPC request the fake agent received, in arrival
 *  order — see fakeAcpAgent.ts's `echo()`. Tolerant of the file not existing yet (an empty array,
 *  not a throw) since a test may poll this before the fake agent has written its first line, AND
 *  of a torn read (this is polled from inside waitForCondition's `check()` while the fake agent may
 *  be mid-`appendFileSync` on the last line) — a line that doesn't parse yet is dropped rather than
 *  thrown, so a read racing a write fails the CURRENT poll (retried 50ms later, once the write has
 *  landed) instead of failing the whole test on a spurious JSON.parse error. */
function readEchoLines(path: string): { method: string; params: unknown }[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: { method: string; params: unknown }[] = [];
  for (const l of text.split("\n").map((s) => s.trim()).filter(Boolean)) {
    try {
      out.push(JSON.parse(l) as { method: string; params: unknown });
    } catch {
      /* a torn/partially-written line — see this function's doc comment */
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

describe("the ACP driver against a fake agent (zero network access, zero CLI dependency)", () => {
  let stubDir: string;
  let savedPath: string | undefined;
  let savedShape: string | undefined;
  let savedEchoFile: string | undefined;
  // Set only by the setModel test (below), which is the one test that needs an echo file — cleaned
  // up here unconditionally (a code-review finding: it was previously created with mkdtempSync and
  // never removed, leaving a `bismuth-acp-fake-echo-*` dir in $TMPDIR after every run).
  let echoDir: string | undefined;
  const chatIds: string[] = [];

  beforeEach(() => {
    stubDir = makeStubBinDir();
    savedPath = process.env.PATH;
    savedShape = process.env.FAKE_ACP_MODEL_SHAPE;
    savedEchoFile = process.env.FAKE_ACP_ECHO_FILE;
    echoDir = undefined;
    // Prepended, not appended: must win over any real `cline` this machine happens to have
    // installed elsewhere on PATH (this task installed one temporarily under .offline-cli-tools/ —
    // see the task report).
    process.env.PATH = `${stubDir}:${savedPath ?? ""}`;
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedShape === undefined) delete process.env.FAKE_ACP_MODEL_SHAPE;
    else process.env.FAKE_ACP_MODEL_SHAPE = savedShape;
    if (savedEchoFile === undefined) delete process.env.FAKE_ACP_ECHO_FILE;
    else process.env.FAKE_ACP_ECHO_FILE = savedEchoFile;
    rmSync(stubDir, { recursive: true, force: true });
    if (echoDir) rmSync(echoDir, { recursive: true, force: true });
  });

  afterAll(() => {
    // Belt-and-suspenders: afterEach already restores these, but a thrown assertion mid-test must
    // never leave a later, unrelated test file in this same process pointed at a stub PATH.
    if (savedPath !== undefined) process.env.PATH = savedPath;
    if (savedShape !== undefined) process.env.FAKE_ACP_MODEL_SHAPE = savedShape;
    if (savedEchoFile !== undefined) process.env.FAKE_ACP_ECHO_FILE = savedEchoFile;
  });

  test(
    "OLD model shape (models.availableModels/currentModelId): driver reports it faithfully and a turn completes",
    async () => {
      process.env.FAKE_ACP_MODEL_SHAPE = "old";
      const chatId = "acp-fake-old-" + Date.now();
      chatIds.push(chatId);
      // Below the test's own 15_000ms Bun timeout (below, third arg to `test(...)`) — a code-review
      // finding: these matched exactly, so on a hang the collector's own diagnostic rejection
      // ("timeout waiting for frame; saw: [...]") could never fire before Bun's generic timeout cut
      // it off first, losing the frame-type trace that's the whole point of that message.
      const { sink, frames, waitFor } = makeChatFrameCollector(12_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      const modelsFrame = await waitFor((f) => f.type === "models");
      expect(modelsFrame.type).toBe("models");
      if (modelsFrame.type === "models") {
        expect(modelsFrame.models.map((m) => m.value).sort()).toEqual(["fake-model-a", "fake-model-b"]);
        // Old-shape signature per protocol.ts's detectModelShape: description comes from the
        // availableModels entry's own `description` field, and effortLevels is ALWAYS [] (the old
        // shape carries no thought_level-equivalent sibling at all).
        const a = modelsFrame.models.find((m) => m.value === "fake-model-a")!;
        expect(a.description).toBe("old-shape model a");
        expect(a.effortLevels).toEqual([]);
      }

      const sessionFrame = await waitFor((f) => f.type === "session");
      expect(sessionFrame.type).toBe("session");
      if (sessionFrame.type === "session") expect(sessionFrame.sessionId).toStartWith("fake-session-old-");

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      if (assistantText.type === "assistant-text") expect(assistantText.text).toBe(FAKE_TURN_TEXT);

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      if (frames[resultIdx].type === "result") expect(frames[resultIdx].isError).toBe(false);
    },
    15_000,
  );

  test(
    "NEW model shape (configOptions, category \"model\" + sibling \"thought_level\"): driver reports it faithfully, effortLevels populated, and a turn completes",
    async () => {
      process.env.FAKE_ACP_MODEL_SHAPE = "new";
      const chatId = "acp-fake-new-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeChatFrameCollector(12_000); // below the 15_000ms Bun timeout below — see the OLD-shape test's identical comment

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });

      const modelsFrame = await waitFor((f) => f.type === "models");
      expect(modelsFrame.type).toBe("models");
      if (modelsFrame.type === "models") {
        expect(modelsFrame.models.map((m) => m.value).sort()).toEqual(["fake-model-x", "fake-model-y"]);
        // New-shape signature: description is always "" (protocol.ts never populates it from
        // configOptions — there is no per-model description field in that shape), and effortLevels
        // rides the SIBLING "thought_level" configOptions entry's own option names, applied to
        // EVERY model entry alike (ACP has no per-model effort granularity — see protocol.ts's
        // detectModelShape doc comment).
        const x = modelsFrame.models.find((m) => m.value === "fake-model-x")!;
        expect(x.description).toBe("");
        expect(x.effortLevels).toEqual(["Low", "High"]);
        const y = modelsFrame.models.find((m) => m.value === "fake-model-y")!;
        expect(y.effortLevels).toEqual(["Low", "High"]);
      }

      const sessionFrame = await waitFor((f) => f.type === "session");
      if (sessionFrame.type === "session") expect(sessionFrame.sessionId).toStartWith("fake-session-new-");

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      if (assistantText.type === "assistant-text") expect(assistantText.text).toBe(FAKE_TURN_TEXT);

      await waitFor((f) => f.type === "done");
    },
    15_000,
  );

  test(
    "setModel dispatches the NEW shape's session/set_config_option with the new value on the wire, and a turn started right after still completes",
    async () => {
      // Code-review finding on this task's first pass: the old version of this test never observed
      // WHICH wire method setModel actually sent (driver.ts's setModel is fire-and-forget with a
      // swallowed `.catch()`, so `expect(...).not.toThrow()` could not fail for any input, including
      // a typo'd chatId), and it called setModel LAST, so its title's "a turn started right after
      // still completes" claim was untested. Fixed: FAKE_ACP_ECHO_FILE makes the fake agent record
      // every inbound {method, params} to a file this test reads directly (see fakeAcpAgent.ts's
      // `echo()`), and a SECOND real turn is sent and awaited after setModel.
      process.env.FAKE_ACP_MODEL_SHAPE = "new";
      echoDir = mkdtempSync(join(tmpdir(), "bismuth-acp-fake-echo-"));
      const echoFile = join(echoDir, "echo.jsonl");
      process.env.FAKE_ACP_ECHO_FILE = echoFile;

      const chatId = "acp-fake-setmodel-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector(15_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });
      await waitFor((f) => f.type === "models");
      await waitFor((f) => f.type === "done"); // first turn settled

      const doneCountBeforeSecondTurn = frames.filter((f) => f.type === "done").length;

      CHAT_BACKENDS.cline.setModel(chatId, "fake-model-y");

      // The actual dispatch assertion: wait for the fake agent to have logged a
      // session/set_config_option call carrying the new value — not just "setModel didn't throw"
      // (which proves nothing; see the finding above), but that the RIGHT wire method fired with
      // the RIGHT payload.
      await waitForCondition(
        () => readEchoLines(echoFile).some((l) => l.method === "session/set_config_option" && (l.params as { value?: string })?.value === "fake-model-y"),
        5_000,
        'a session/set_config_option echo line with value:"fake-model-y"',
      );
      const setModelCalls = readEchoLines(echoFile).filter((l) => l.method === "session/set_config_option");
      expect(setModelCalls.length).toBeGreaterThanOrEqual(1);
      expect((setModelCalls[0].params as { configId?: string }).configId).toBe("model-config");
      // And NOT the old shape's method — proves the driver's shape-branch actually picked the NEW
      // dispatch target for a NEW-shape session, not just "some" method.
      expect(readEchoLines(echoFile).some((l) => l.method === "session/set_model")).toBe(false);

      // The second clause of this test's title: a turn started right after setModel must still
      // complete. Waiting for a NEW "done" (by count, not by predicate-match) — makeChatFrameCollector's
      // waitFor would otherwise resolve immediately off the FIRST turn's already-collected "done"
      // frame, proving nothing about this second turn.
      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello again" });
      await waitForCondition(() => frames.filter((f) => f.type === "done").length > doneCountBeforeSecondTurn, 10_000, "a second \"done\" frame after setModel");
    },
    20_000,
  );
});
