// Task 4 of the offline-integration-testing plan: drive a REAL `cline` binary through Bismuth's OWN
// ACP driver (core/src/chatProviders/acp/driver.ts, via `cline --acp` — see
// chatProviders/acp/agents.ts). Skips only when the `cline` binary itself is missing.
//
// THIS IS NOT AN END-TO-END "TURN COMPLETES" TEST, and that is the point. Confirmed live (see
// backendEnv.ts's `cline` case comment for the complete write-up): cline's ACP mode gates
// `session/new` behind a REAL OAuth `authenticate` call ("Sign in
// with Cline" / "Sign in with ChatGPT Subscription" — no other methods are ever offered), which
// hangs waiting for actual interactive login and cannot be satisfied by a mock. There is no env var,
// CLI flag, or config file this task could find that lets cline's ACP mode skip this gate — unlike
// cline's OTHER, non-ACP CLI mode (`cline "<prompt>"`), whose `cline auth -p openai-compatible ...`
// subcommand this task verified live writes its config to disk with zero network access (see
// backendEnv.ts's `cline` case comment) — but that CLI mode is not the one Bismuth's production
// driver ever spawns.
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
//
// UPDATE (a LATER task, "close the cline coverage gap" — see REPORT-cline.md): the paragraph above
// is Task 4's own black-box finding, kept as written because it documents what was actually checked
// then. Reading cline 3.0.47's own SOURCE (not just probing its wire behavior) found the "no bypass
// exists" conclusion was WRONG: `session/new`'s auth check has an unconditional `CLINE_API_KEY` env
// var escape hatch that skips it WITHOUT ever calling `authenticate` — see backendEnv.ts's `cline`
// case for the full citation and the live-verified mechanism. This file's ORIGINAL test above is
// left completely unchanged (it still proves a real, valuable, distinct fact: the DEFAULT,
// no-bypass-configured behavior fails safely) — the new "real E2E" describe block below, added by
// that later task, proves the SEPARATE fact that a real cline binary can now be driven to a
// completed turn against a local mock, through this exact same unmodified driver.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";
import { shouldRunSlowTests } from "../slowGate";

/** Sum of `aimock_requests_total{...}` counter values whose `path` label is aimock's own
 *  `/v1/chat/completions` route (confirmed from aimock's own `server.js`:
 *  `const COMPLETIONS_PATH = "/v1/chat/completions"`) — the endpoint an OpenAI-compatible-shaped
 *  client (cline's "openai-compatible" provider, per backendEnv.ts's `cline` case) actually calls.
 *  Mirrors geminiMocked.test.ts's `generateContentHitCount` shape exactly, including its own
 *  finding #1: NOT "does aimock_requests_total appear anywhere" (that family also contains the
 *  mock's own `GET /metrics` self-hits), but a counter for THIS SPECIFIC PATH strictly increasing. */
function chatCompletionsHitCount(metricsText: string): number {
  let total = 0;
  for (const line of metricsText.split("\n")) {
    if (!line.startsWith("aimock_requests_total{") || !line.includes("chat/completions")) continue;
    const m = line.match(/}\s+([0-9.]+)\s*$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

const HAS_CLINE = whichBinary("cline") !== null;
// Also gated on the slow-suite opt-out: this spawns a REAL agent binary (see slowGate.ts).
const describeOrSkip = HAS_CLINE && shouldRunSlowTests(process.env) ? describe : describe.skip;

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

// --------------------------------------------------------------------------------------------
// REAL E2E, added by the "close the cline coverage gap" task (see this file's header UPDATE note
// and backendEnv.ts's `cline` case for the full citation). Drives the SAME real `cline` binary
// through the SAME unmodified `CHAT_BACKENDS.cline` production driver as the block above, but via
// the `CLINE_API_KEY`-bypass mapping `backendMockEnv("cline", ...)` now returns — a real,
// live-verified escape hatch found by reading cline 3.0.47's own compiled source, NOT an OAuth
// flow and NOT a real account credential of any kind (see the case comment for exactly why this is
// safe: it substitutes a THIRD, non-OAuth provider id the auth check never actually validates,
// pointed only at 127.0.0.1). Skips under the SAME `HAS_CLINE` gate as the block above.
// --------------------------------------------------------------------------------------------
describeOrSkip("the real cline CLI's ACP mode, driven through the ACP driver, against a local mock LLM — a full turn completes end to end (see this file's header UPDATE note)", () => {
  // ENV_KEYS: unlike the SAFE-FAILURE block above (which never lets cline build a model client at
  // all — session/new fails before that's ever reached), THIS block deliberately opens the gate, and
  // a real cline session DOES build a provider client and make an outbound HTTP call. Routing is
  // correct today via CLINE_PROVIDER=openai-compatible + a hand-written providers.json baseUrl on
  // 127.0.0.1 — but that file is written against cline 3.0.47's OWN schema; a future cline version
  // that stops reading it falls back to some default provider, and a developer's own ambient
  // OPENAI_API_KEY/ANTHROPIC_API_KEY sitting in their shell is then the ONLY thing left standing
  // between "safe" and "a real account call slips through unnoticed" — a code-review finding on this
  // task, correcting an earlier version of this block that cleared neither (the sibling block above
  // already established this exact defense at its own ENV_KEYS/lines clearing them; this block must
  // not be weaker than the one that opens the gate on purpose).
  const ENV_KEYS = ["CLINE_DIR", "CLINE_PROVIDER", "CLINE_API_KEY", "CLINE_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const chatIds: string[] = [];
  const tempDirs: string[] = [];
  let mock: MockLlmHandle | undefined;

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.cline.closeChat(id);
    if (mock) {
      await mock.stop();
      mock = undefined;
    }
    // Orphan-safety net (found live during this task): the real cline binary's `--acp` mode spawns
    // a DETACHED `--cline-hub-daemon` grandchild on startup that outlives `driver.ts`'s
    // `proc.kill()` — that call only reaches the immediate `cline --acp` child, and the hub daemon
    // has already detached from it by the time a slow/timed-out test tears down. Reproduced live:
    // a deliberately-broken mock (unroutable baseUrl) left exactly this process running after the
    // test's own 25s timeout killed the parent. `pkill -f <cwd>` targets it precisely — each test
    // run gets a FRESH mkdtemp'd cwd passed on the hub daemon's own `--cwd` argv, so this can never
    // match an unrelated process, including a hub daemon from a DIFFERENT concurrent test run.
    // Best-effort: pkill exits non-zero when nothing matched (the common, healthy case), which must
    // never fail this hook.
    for (const dir of tempDirs) {
      if (!dir.includes("bismuth-cline-real-e2e-cwd-")) continue;
      try {
        Bun.spawnSync(["pkill", "-f", dir]);
      } catch {
        /* best-effort orphan cleanup only */
      }
    }
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
    "a real cline binary, pointed at a local mock via the CLINE_API_KEY bypass, completes a full turn: the mock fixture's exact text arrives, its /v1/chat/completions counter increases, then result.isError===false",
    async () => {
      mock = await startMockLlm(undefined, ["--metrics"]);
      // Defensive (see the ENV_KEYS comment above): must never be ambiently available to the
      // spawned `cline` process, since a real cline session (unlike the sibling block's) actually
      // builds a provider client and dials out.
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const workDir = await newTempDir("bismuth-cline-real-e2e-");
      const env = backendMockEnv("cline", mock.url, workDir);
      for (const [k, v] of Object.entries(env)) process.env[k] = v;

      const cwd = await newTempDir("bismuth-cline-real-e2e-cwd-");
      const chatId = "cline-real-e2e-" + Date.now();
      chatIds.push(chatId);
      const { frames, sink, waitFor } = makeChatFrameCollector(25_000);

      const before = chatCompletionsHitCount(await fetch(`${mock.url}/metrics`).then((r) => r.text()));
      expect(before).toBe(0); // sanity: nothing hit the model endpoint before this turn

      CHAT_BACKENDS.cline.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      // session/new actually succeeded through the auth gate (never called `authenticate`) — the
      // session frame only ever fires after that.
      const sessionFrame = await waitFor((f) => f.type === "session");
      expect(sessionFrame.type).toBe("session");

      // The core proof this task exists to add: the mock fixture's EXACT text (core/test/fixtures/
      // llm/basic-turn.json's "Hello!") arriving through the driver. A code-review finding on this
      // task: "Hello!" alone is a real model's plausible (if unlikely) reply to "hello" — unlike the
      // fake agent's own deliberately distinctive sentinel, so this file additionally asserts the
      // mock's OWN /v1/chat/completions counter (below), which cannot be satisfied by any host but
      // this one, as the load-bearing "zero real network access" proof.
      const assistantText = await waitFor((f) => f.type === "assistant-text");
      if (assistantText.type === "assistant-text") expect(assistantText.text).toBe("Hello!");

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");
      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      if (frames[resultIdx].type === "result") expect(frames[resultIdx].isError).toBe(false);

      // The load-bearing zero-real-network-access proof (see the comment above): a real model host
      // could also have replied "Hello!", but only THIS mock's own counter for its own path can
      // increase — confirms the outbound HTTP call this cline session made landed here, not on any
      // real vendor endpoint.
      const after = chatCompletionsHitCount(await fetch(`${mock.url}/metrics`).then((r) => r.text()));
      expect(after).toBeGreaterThan(before);

      // Never confused with the OTHER block's safe-refusal path.
      expect(frames.some((f) => f.type === "error")).toBe(false);
    },
    25_000,
  );
});
