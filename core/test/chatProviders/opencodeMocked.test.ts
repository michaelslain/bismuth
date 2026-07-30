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
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_OPENCODE = whichBinary("opencode") !== null;
const describeOrSkip = HAS_OPENCODE ? describe : describe.skip;

if (!HAS_OPENCODE) {
  // eslint-disable-next-line no-console
  console.warn("[opencodeMocked.test] skipped — the `opencode` CLI is not installed on this machine (nothing to drive).");
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
  const ENV_KEYS = ["OPENCODE_CONFIG_CONTENT", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on this
  // task: populating this AFTER an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real ANTHROPIC_*/XDG_* vars this test never touched.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
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

  async function newTempDir(prefix = "bismuth-opencode-mocked-"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    for (const pid of opencodeServePids()) pidsBefore.add(pid);
    // --latency 40: see this file's header, finding #2 — a zero-latency reply can beat opencode
    // server mode's own event-stream subscription.
    mock = await startMockLlm(undefined, ["--latency", "40"]);
    const mockEnv = backendMockEnv("opencode", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // STATE ISOLATION (code-review finding): OPENCODE_CONFIG_CONTENT overrides opencode's config,
    // not its STORED CREDENTIALS (`~/.local/share/opencode/auth.json`) — verified live that
    // XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_STATE_HOME genuinely redirect opencode's
    // storage (a real `opencode auth list` under a fresh XDG_DATA_HOME reports zero credentials,
    // vs this machine's own real Moonshot/Zen providers with the defaults). Without this, the ONLY
    // thing preventing a real billed call on a machine with prior real opencode usage is that
    // setModel("mock/mock") below runs before sendMessage — real, but call-ordering-only, with no
    // backstop if that ordering ever regresses. With this, there is no real provider to fall back
    // to even if it did: re-verified live that a turn still completes correctly against the mock
    // with all four redirected (the "auth" ChatFrame reports zero providers, "assistant-text" is
    // still the fixture's exact "Hello!").
    process.env.XDG_CONFIG_HOME = await newTempDir("bismuth-opencode-xdgconfig-");
    process.env.XDG_DATA_HOME = await newTempDir("bismuth-opencode-xdgdata-");
    process.env.XDG_CACHE_HOME = await newTempDir("bismuth-opencode-xdgcache-");
    process.env.XDG_STATE_HOME = await newTempDir("bismuth-opencode-xdgstate-");
    // RESIDUAL HAZARD, noted rather than fixed (flagged on re-review, no fix needed today): these
    // XDG vars only affect a FRESH `opencode serve` spawn. chatProviders/opencodeServer.ts's shared
    // server is PROCESS-LIFETIME (one `live` singleton reused for the rest of this core process —
    // see this file's header, finding #2, and opencodeServer.ts's own module doc comment) — if any
    // OTHER test file in the same `bun test` process ever opens an opencode chat BEFORE this file's
    // setup() runs, that earlier chat's `ensureOpencodeServer()` call would have already spawned
    // the shared server with THAT call's env (real XDG dirs, not these), and this test would then
    // be handed the SAME already-running server instead of a fresh isolated one. No such file
    // exists in this suite today (this is the only one that drives a real opencode turn), so it's
    // not live risk right now — but a future opencode test file MUST open its first chat only after
    // its own XDG redirection is in place, and should not assume it starts the shared server fresh.
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

  test(
    "a turn sent through CHAT_BACKENDS.opencode returns the fixture's exact text, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir();
      const chatId = "opencode-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector();

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
