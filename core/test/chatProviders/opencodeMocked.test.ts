// Task 4 of the offline-integration-testing plan: prove that a REAL `opencode` binary, driven
// through Bismuth's OWN opencode chat driver (core/src/chatProviders/opencode.ts, via the
// CHAT_BACKENDS registry chat.ts's WS layer also dispatches through), completes a turn against the
// local mock LLM server (core/test/support/mockLlm.ts) with ZERO calls against any real provider
// account. Mirrors claudeMocked.test.ts's shape (Task 3): runs by default in `bun test core`, skips
// only when the `opencode` binary itself is missing — a missing-BINARY skip, never a missing-account
// skip (see the task brief).
//
// TWO REAL DRIVER QUIRKS FOUND THIS TASK (both load-bearing for this test's shape — see
// backendEnv.ts's `opencode` case comment for the full write-up):
//
// 1. SERVER-MODE MODEL SELECTION: a fresh opencode chat's `s.model` starts unset, and Bismuth's
//    server-mode session.prompt call then omits `model` from the request entirely — the server
//    falls back to whatever model THIS MACHINE's own opencode last had active (reproduced live: on
//    the research machine, that's a real Moonshot/Zen provider from prior real usage), NOT this
//    mapping's `OPENCODE_CONFIG_CONTENT`-declared default. Verified by /metrics: a sendMessage with
//    no prior setModel() call produced a `result`/`done` pair but ZERO hits on the mock. The fix:
//    open the session, wait for the "models" frame (proving the handshake completed), THEN call
//    `setModel(chatId, "mock/mock")` BEFORE the first sendMessage — exactly what a real chat header's
//    model picker does on a fresh tab, so this isn't a test-only workaround, it's the normal flow.
//
// 2. SERVER-MODE EVENT-STREAM RACE AT ZERO LATENCY: opencode's server mode gets real-time deltas off
//    a global `GET /event` SSE subscription. A mock that replies INSTANTLY (aimock's default
//    latency: 0ms) can complete the whole exchange before that subscription is fully attached —
//    reproduced live: a turn that hit the mock twice per /metrics still produced ZERO assistant-text
//    frames. A small `--latency` value (mockLlm.ts's `extraArgs`, added this task) gives the
//    subscription time to attach first; 40ms reliably produced one clean assistant-text frame in
//    repeated live runs. This is a mock-server pacing fix, NOT a driver change — no production files
//    were touched for this task.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import type { ChatFrame } from "../../src/chat";
import { backendMockEnv } from "../support/backendEnv";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_OPENCODE = whichBinary("opencode") !== null;
const describeOrSkip = HAS_OPENCODE ? describe : describe.skip;

if (!HAS_OPENCODE) {
  // eslint-disable-next-line no-console
  console.warn("[opencodeMocked.test] skipped — the `opencode` CLI is not installed on this machine (nothing to drive).");
}

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

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = 30_000): Promise<ChatFrame> {
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

/** The exact argv chatProviders/opencodeServer.ts's spawnAndWaitForBanner uses for the ONE shared
 *  `opencode serve` process — matched here only to find PIDs this test itself causes to exist, never
 *  to identify opencode processes in general. */
const OPENCODE_SERVE_PATTERN = "opencode serve --port 0 --hostname 127.0.0.1";

/** PIDs of any already-running shared opencode server, matched by the exact argv above. Best
 *  effort: `pgrep` missing/erroring yields [] rather than throwing. */
function opencodeServePids(): string[] {
  try {
    const r = Bun.spawnSync(["pgrep", "-f", OPENCODE_SERVE_PATTERN]);
    if (r.exitCode !== 0) return [];
    return r.stdout
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

describeOrSkip("the real opencode CLI, driven through chatProviders/opencode.ts, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["OPENCODE_CONFIG_CONTENT"] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];
  // FINDING (this task): chatProviders/opencode.ts spawns ONE shared, process-lifetime `opencode
  // serve` (chatProviders/opencodeServer.ts) the first time any opencode chat opens — by design,
  // meant to outlive individual chats and be torn down only by opencodeServer.ts's own
  // `process.on("exit", shutdownAll)` when the HOST core process exits. Reproduced live: that "exit"
  // handler (and, separately, mockLlm.ts's own identical safety-net pattern) DEMONSTRABLY NEVER
  // FIRES when a `bun test` run completes normally (confirmed with a standalone
  // process.on("exit")-writes-a-file probe run under `bun test` vs plain `bun run` — the plain
  // script's handler fires every time, the `bun test` one never does). Every OTHER mocked test in
  // this suite is unaffected because its own driver's spawned child is killed directly by
  // closeChat()/mock.stop() — this is the one backend whose shared server persists past a single
  // chat's lifecycle by design. Rather than change opencodeServer.ts's shutdown story (a real
  // production behavior this task didn't otherwise need to touch), this test snapshots the shared
  // server's PID before/after itself and force-kills anything NEW in afterAll — a test-only safety
  // net, matched by the shared server's own exact, distinctive argv (never a general "kill anything
  // named opencode" sweep that could disrupt an unrelated opencode process on a developer's machine).
  const pidsBefore = new Set<string>();

  async function setup(): Promise<void> {
    for (const pid of opencodeServePids()) pidsBefore.add(pid);
    // --latency 40: see this file's header, finding #2 — a zero-latency reply can beat opencode
    // server mode's own event-stream subscription.
    mock = await startMockLlm(undefined, ["--latency", "40"]);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const mockEnv = backendMockEnv("opencode", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await mock?.stop();
    for (const pid of opencodeServePids()) {
      if (pidsBefore.has(pid)) continue; // pre-existing — not this test's to kill
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.opencode.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function newTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bismuth-opencode-mocked-"));
    tempDirs.push(dir);
    return dir;
  }

  test(
    "a turn sent through CHAT_BACKENDS.opencode returns the fixture's exact text, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir();
      const chatId = "opencode-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeCollector();

      CHAT_BACKENDS.opencode.openSession({ chatId, cwd, sink, computerUse: false });
      // Finding #1 (this file's header): a fresh session must pick the mock's model EXPLICITLY —
      // opencode server mode does not consult OPENCODE_CONFIG_CONTENT's default `model` field for a
      // session's first turn. Waiting for "models" proves the handshake (initialize + session
      // create) actually completed before we touch setModel.
      await waitFor((f) => f.type === "models");
      CHAT_BACKENDS.opencode.setModel(chatId, "mock/mock");

      CHAT_BACKENDS.opencode.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture (core/test/fixtures/llm/basic-turn.json) — no
        // real model replies to "hello" with the literal string "Hello!" verbatim, and the mock is
        // the only thing OPENCODE_CONFIG_CONTENT's custom provider baseURL points at.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") {
        expect(resultFrame.isError).toBe(false);
        expect(resultFrame.costUsd).toBe(0); // the mock's fixture reports zero cost
      }
    },
    60_000,
  );
});
