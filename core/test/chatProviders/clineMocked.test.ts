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
import type { ChatFrame } from "../../src/chat";

const HAS_CLINE = whichBinary("cline") !== null;
const describeOrSkip = HAS_CLINE ? describe : describe.skip;

if (!HAS_CLINE) {
  // eslint-disable-next-line no-console
  console.warn("[clineMocked.test] skipped — the `cline` CLI is not installed on this machine (nothing to drive).");
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

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = 20_000): Promise<ChatFrame> {
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

describeOrSkip("the real cline CLI's ACP mode, driven through the ACP driver — proves the account-auth wall fails SAFELY (see header)", () => {
  const savedClineDir = process.env.CLINE_DIR;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    if (savedClineDir === undefined) delete process.env.CLINE_DIR;
    else process.env.CLINE_DIR = savedClineDir;
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

      const cwd = await newTempDir("bismuth-cline-cwd-");
      const chatId = "cline-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeCollector();

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const errorFrame = await waitFor((f) => f.type === "error");
      expect(errorFrame.type).toBe("error");
      if (errorFrame.type === "error") {
        expect(errorFrame.message).toContain("Authentication required");
      }
      // Never got here: an "assistant-text"/"result" pair, which would mean either a real signed-in
      // account answered (catastrophic — this test's whole purpose is to prove that can't happen
      // with an isolated CLINE_DIR) or this finding has gone stale and needs re-verifying.
    },
    20_000,
  );
});
