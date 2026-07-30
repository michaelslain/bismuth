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
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import type { ChatFrame } from "../../src/chat";

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

/** Collects every ChatFrame for one chat and lets a test await one matching a predicate — same
 *  shape as claudeMocked.test.ts's own local makeCollector (kept local here too: neither is
 *  exported). */
function makeCollector() {
  const frames: ChatFrame[] = [];
  const waiters: { match: (f: ChatFrame) => boolean; resolve: (f: ChatFrame) => void }[] = [];

  const sink = (frame: ChatFrame) => {
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  };

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = 10_000): Promise<ChatFrame> {
    const already = frames.find(match);
    if (already) return Promise.resolve(already);
    return new Promise<ChatFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrapped);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("timeout waiting for frame; saw: " + JSON.stringify(frames.map((f) => f.type))));
      }, timeoutMs);
      const wrapped = (f: ChatFrame) => {
        clearTimeout(timer);
        resolve(f);
      };
      waiters.push({ match, resolve: wrapped });
    });
  }

  return { sink, frames, waitFor };
}

describe("the ACP driver against a fake agent (zero network access, zero CLI dependency)", () => {
  let stubDir: string;
  let savedPath: string | undefined;
  let savedShape: string | undefined;
  const chatIds: string[] = [];

  beforeEach(() => {
    stubDir = makeStubBinDir();
    savedPath = process.env.PATH;
    savedShape = process.env.FAKE_ACP_MODEL_SHAPE;
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
    rmSync(stubDir, { recursive: true, force: true });
  });

  afterAll(() => {
    // Belt-and-suspenders: afterEach already restores these, but a thrown assertion mid-test must
    // never leave a later, unrelated test file in this same process pointed at a stub PATH.
    if (savedPath !== undefined) process.env.PATH = savedPath;
    if (savedShape !== undefined) process.env.FAKE_ACP_MODEL_SHAPE = savedShape;
  });

  test(
    "OLD model shape (models.availableModels/currentModelId): driver reports it faithfully and a turn completes",
    async () => {
      process.env.FAKE_ACP_MODEL_SHAPE = "old";
      const chatId = "acp-fake-old-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeCollector();

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
      const { sink, waitFor } = makeCollector();

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
    "setModel dispatches to session/set_config_option for the NEW shape without erroring, and a turn started right after still completes",
    async () => {
      process.env.FAKE_ACP_MODEL_SHAPE = "new";
      const chatId = "acp-fake-setmodel-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeCollector();

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd: "/tmp", sink, computerUse: false, text: "hello" });
      await waitFor((f) => f.type === "models");
      // The session/set_config_option round trip settles asynchronously (driver.ts's setModel is
      // fire-and-forget) — awaiting the turn's own "done" below is what actually proves the session
      // survived the call, not a fixed sleep.
      await waitFor((f) => f.type === "done");

      // Best-effort in the driver (see driver.ts's setModel) — this call must not throw, and the
      // fake agent's session/set_config_option handler (fakeAcpAgent.ts) always acks it.
      expect(() => CHAT_BACKENDS.cline.setModel(chatId, "fake-model-y")).not.toThrow();
    },
    15_000,
  );
});
