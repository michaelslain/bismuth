// Task 4 of the offline-integration-testing plan: drive a REAL `cline` binary through Bismuth's OWN
// ACP driver (core/src/chatProviders/acp/driver.ts, via `cline --acp` — see
// chatProviders/acp/agents.ts). Skips only when the `cline` binary itself is missing.
//
// THIS IS NOT AN END-TO-END "TURN COMPLETES" TEST, and that is the point. Per the task brief's
// finding #1 (confirmed live this task — see backendEnv.ts's `cline` case comment for the complete
// write-up): cline's ACP mode gates `session/new` behind a REAL OAuth `authenticate` call ("Sign in
// with Cline" / "Sign in with ChatGPT Subscription" — no other methods are ever offered), which
// hangs waiting for actual interactive login and cannot be satisfied by a mock. There is no env var,
// CLI flag, or config file this task could find that lets cline's ACP mode skip this gate — unlike
// cline's OTHER, non-ACP CLI mode (`cline "<prompt>"`), which this task separately verified CAN be
// pointed at a mock via `cline auth -p openai-compatible ...` (see the report), but which is not the
// mode Bismuth's production driver ever spawns.
//
// So the SAFE, HONEST, and actually valuable thing to verify is the failure path: with `CLINE_DIR`
// pointed at a guaranteed-empty, never-authenticated temp directory (isolating this run from
// whatever real ~/.cline state a developer's own machine might have — the driver reads
// process.env.PATH-augmented `cline` and process.env verbatim, so this is the one thing standing
// between "safe" and "silently uses a real signed-in account"), Bismuth's real driver.ts must
// surface a clean `error` ChatFrame — never hang, never crash the test process, and (because
// `authenticate` is never called here — driver.ts's handshake never calls it) never a real network
// request of any kind. This is exactly the "zero account API calls, even under a real integration
// test" property the whole task exists to prove, applied to the one backend where the honest answer
// is "cannot be mocked, and here is the proof it fails SAFELY rather than falling through."
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { makeChatFrameCollector } from "../support/chatFrameCollector";

const HAS_CLINE = whichBinary("cline") !== null;
const describeOrSkip = HAS_CLINE ? describe : describe.skip;

if (!HAS_CLINE) {
  // eslint-disable-next-line no-console
  console.warn("[clineMocked.test] skipped — the `cline` CLI is not installed on this machine (nothing to drive).");
}

describeOrSkip("the real cline CLI's ACP mode, driven through the ACP driver — proves the account-auth wall fails SAFELY (see header)", () => {
  // ENV_KEYS: CLINE_DIR isolates cline's OWN persisted auth (the actual gate this test proves), but
  // this test starts NO mock at all — a code-review finding on this task points out that if a FUTURE
  // cline version ever drops the ACP `authenticate` gate and starts consulting ambient provider keys
  // the way its other (non-ACP) mode's `openai-compatible` provider does, a developer's real
  // OPENAI_API_KEY/ANTHROPIC_API_KEY sitting in their shell would be the one thing standing between
  // "safe" and "a real account call slips through unnoticed". Cleared defensively here even though
  // nothing in this task's own investigation found cline's ACP mode reading either today.
  const ENV_KEYS = ["CLINE_DIR", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  test(
    "an isolated, never-authenticated CLINE_DIR makes session/new fail with a clean auth-required error, never a hang or a real account fallback",
    async () => {
      // Isolates this run from any real ~/.cline a developer's own machine might have — the ONE
      // thing standing between "safe" and "silently drives whatever account is signed in there".
      process.env.CLINE_DIR = await newTempDir("bismuth-cline-isolated-");
      // Defensive (see ENV_KEYS comment above) — this test starts no mock, so these must never be
      // ambiently available to the spawned `cline` process.
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const cwd = await newTempDir("bismuth-cline-cwd-");
      const chatId = "cline-mocked-" + Date.now();
      chatIds.push(chatId);
      const { frames, sink, waitFor } = makeChatFrameCollector(20_000);

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const errorFrame = await waitFor((f) => f.type === "error");
      expect(errorFrame.type).toBe("error");
      if (errorFrame.type === "error") {
        expect(errorFrame.message).toContain("Authentication required");
      }

      // The actual safety assertion (a code-review finding on this task: `waitFor` above resolves
      // on the FIRST "error" frame and ignores everything before it, so on its own it would still
      // pass even if a real signed-in account had already answered with real text before this error
      // — e.g. a stray success frame followed by an unrelated later error). Every frame this chat
      // ever emitted is in `frames` by now (createSession's error path is a dead end — nothing else
      // fires afterward), so this checks the WHOLE transcript, not just the one frame waited for.
      expect(frames.some((f) => f.type === "assistant-text")).toBe(false);
      expect(frames.some((f) => f.type === "result")).toBe(false);
    },
    20_000,
  );
});
