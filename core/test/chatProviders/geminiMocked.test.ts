// Task 4 of the offline-integration-testing plan: drive a REAL `gemini` binary through Bismuth's OWN
// ACP driver (core/src/chatProviders/acp/driver.ts, via `gemini --experimental-acp`/`--acp` — see
// chatProviders/acp/agents.ts) against the local mock LLM server (core/test/support/mockLlm.ts).
// Mirrors claudeMocked.test.ts's shape (Task 3) for the skip gate: runs by default in `bun test
// core`, skips only when the `gemini` binary itself is missing.
//
// HONESTY (this row is PARTIALLY, not fully, verified — see backendEnv.ts's `gemini` case comment
// for the complete write-up): a real `gemini` 0.53.0's `session/new` reliably succeeds through this
// mapping with ZERO real network access, and its response is genuinely the OLD
// `models.availableModels`/`currentModelId` shape — a live confirmation of protocol.ts's "old"
// detectModelShape branch, distinct from the fake-agent test's synthetic one
// (acpFakeAgent.test.ts). What this task could NOT get gemini-cli 0.53.0 to do, against this mock,
// in either `--acp` or plain headless `-p` mode: settle a turn far enough to emit assistant text.
// `session/prompt` reliably drives 2-5 successful (200, fixture-matched) hits on the mock's
// `generateContent` endpoint and then goes silent — no session/update text chunk, no response to
// the prompt call, no stderr, no crash — investigated at length (gemini-cli's own "next speaker
// check", which sounded like the likely culprit, was ruled out by reading its bundled source: it
// defaults to SKIPPED) but not root-caused within this task's budget. Most likely explanation:
// gemini-cli issues additional, non-user-facing model calls per turn that expect a response shape
// this generic single-fixture mock doesn't provide. So this test asserts exactly what IS proven —
// the handshake, the model shape, and that a turn genuinely reaches the mock — and deliberately
// does NOT assert a completed turn, which would be asserting something this task found to be
// untrue.
//
// TWO CODE-REVIEW FINDINGS FIXED THIS PASS (both on THIS file specifically):
//
// 1. CRITICAL — the "zero real network access" check used to be `metricsText.includes
//    ("aimock_requests_total")`. aimock's own Prometheus exporter counts its OWN `GET /metrics`
//    hits, so that string appears on the SECOND poll of any test that polls /metrics at all,
//    REGARDLESS of whether gemini ever dialled the mock (reproduced: the identical loop with no CLI
//    spawned and no model call at all still flips `sawHit` true). Fixed: `generateContentHitCount`
//    below parses the counter family for lines whose `path` label contains "generateContent"
//    specifically (gemini-cli's own endpoint, confirmed live: `POST /v1beta/models/{model}:
//    generateContent`) and sums their trailing numeric value — snapshotted immediately after
//    `openSession` (before `sendMessage`, confirmed live to be 0/absent at that point — session/new
//    never calls the model) and required to strictly increase afterward. This is the only assertion
//    in this file (or, checked, in this task's other mocked tests — see the report) that used
//    /metrics as its PASS/FAIL signal rather than as a comment describing manual verification during
//    development; the other tests (opencode/codex/goose) all assert on the fixture's literal
//    "Hello!" text arriving through the driver instead, which cannot be satisfied by a self-hit.
//
// 2. IMPORTANT — no config/state isolation, on the one backend whose OWN row documents a real-account
//    bypass risk: backendEnv.ts's `gemini` case states a persisted `security.auth.selectedType` in
//    the user's own `~/.gemini/settings.json` is checked BEFORE GOOGLE_GEMINI_BASE_URL/
//    GEMINI_API_KEY and could silently defeat this mapping on a machine with a prior real gemini
//    login. Reproduced directly: on a machine with NO `~/.gemini/settings.json` at all, even the
//    right env vars fail with "Invalid auth method selected" (gemini-cli's own
//    `validateAuthMethod` reads `settings.merged.security.auth.selectedType`, not the env var,
//    for a plain non-interactive run) — meaning a REAL prior login's OWN persisted selectedType is
//    exactly the kind of thing that would otherwise get silently consulted instead. Fixed: `HOME` is
//    redirected to a throwaway temp dir (gemini-cli resolves its own `~/.gemini` via
//    `node:os`'s `homedir()`, which respects `$HOME` — confirmed by reading its bundled source) with
//    a minimal seeded `.gemini/settings.json` selecting `"gemini-api-key"` — enough to satisfy
//    `validateAuthMethod` without ever touching (or benefiting from) a developer's real gemini
//    state. Re-verified live end to end through CHAT_BACKENDS.gemini with this isolation in place:
//    session/new + the models-frame/old-shape assertions below, and a real `generateContent` hit
//    after sendMessage, both still hold.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_GEMINI = whichBinary("gemini") !== null;
const describeOrSkip = HAS_GEMINI ? describe : describe.skip;

if (!HAS_GEMINI) {
  // eslint-disable-next-line no-console
  console.warn("[geminiMocked.test] skipped — the `gemini` CLI is not installed on this machine (nothing to drive).");
}

/** Sum of `aimock_requests_total{...}` counter values whose `path` label mentions
 *  "generateContent" — gemini-cli's own model-call endpoint (`POST /v1beta/models/{model}:
 *  generateContent`), confirmed live. Deliberately NOT "does the string aimock_requests_total
 *  appear anywhere" (see this file's header, finding #1) — that family also contains the mock's own
 *  `GET /metrics` self-hits, which would make any poll-based check vacuously true after the second
 *  poll regardless of whether the CLI under test ever made a model call. */
function generateContentHitCount(metricsText: string): number {
  let total = 0;
  for (const line of metricsText.split("\n")) {
    if (!line.startsWith("aimock_requests_total{") || !line.includes("generateContent")) continue;
    const m = line.match(/}\s+([0-9.]+)\s*$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

describeOrSkip("the real gemini CLI, driven through the ACP driver, against a mock LLM — handshake + zero account API calls (see header: full-turn completion is NOT asserted)", () => {
  const ENV_KEYS = [
    "GOOGLE_GEMINI_BASE_URL",
    "GEMINI_API_KEY",
    "GEMINI_CLI_TRUST_WORKSPACE",
    "HOME",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — populating this after an
  // await that can throw leaves it empty, and the restore loop below then unconditionally `delete`s
  // every ENV_KEY from the shared `bun test` process, including a developer's real $HOME.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  let mock: MockLlmHandle | undefined;
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    mock = await startMockLlm(undefined, ["--metrics"]);
    // Belt-only (final-review minor, matching codex's/cline's own defensive clears): the pinned
    // $HOME + seeded selectedType below should dominate regardless, but a real Vertex/service-account
    // escape hatch ambient in a developer's shell is exactly the class of risk closed for claude
    // (CLAUDE_CODE_USE_BEDROCK/VERTEX) — clear the Google-side equivalents too rather than assume
    // they can't matter.
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const mockEnv = backendMockEnv("gemini", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // Headless CLIs refuse to run in an "untrusted" directory by default (a real, separate gemini-cli
    // gate, unrelated to model auth) — a throwaway temp dir is never trusted by default, so this is
    // required for ANY headless invocation here, not a mock-specific concern.
    process.env.GEMINI_CLI_TRUST_WORKSPACE = "true";
    // STATE ISOLATION (this file's header, finding #2): redirect $HOME so gemini-cli's own
    // ~/.gemini/settings.json can never be a developer's real one, and pre-seed just enough of it
    // (the auth method selection) to satisfy validateAuthMethod without any real credentials.
    const fakeHome = await newTempDir("bismuth-gemini-fakehome-");
    await mkdir(join(fakeHome, ".gemini"), { recursive: true });
    await writeFile(join(fakeHome, ".gemini", "settings.json"), JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }));
    process.env.HOME = fakeHome;
  }

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.gemini.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    // Two tests below each call setup(), each starting its OWN mock server — stopped here (not
    // just in afterAll) so the first test's server is never left running while the second starts
    // a fresh one on a different port.
    await mock?.stop();
    mock = undefined;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test(
    "session creation succeeds and reports the OLD models.availableModels/currentModelId shape",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-gemini-cwd-");
      const chatId = "gemini-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.gemini.openSession({ chatId, cwd, sink, computerUse: false });

      const modelsFrame = await waitFor((f) => f.type === "models");
      expect(modelsFrame.type).toBe("models");
      if (modelsFrame.type === "models") {
        // The OLD shape's signature per protocol.ts's detectModelShape: effortLevels is ALWAYS []
        // (no thought_level-equivalent sibling exists in this shape). session/new itself never
        // calls the model at all (gemini-cli's model LIST here is its own hardcoded registry, not
        // something the mock serves — confirmed live: generateContentHitCount is 0 at this point),
        // so this only proves the HANDSHAKE's shape, not that a turn can complete (see below).
        expect(modelsFrame.models.length).toBeGreaterThan(0);
        expect(modelsFrame.models.every((m) => m.effortLevels.length === 0)).toBe(true);
      }

      await waitFor((f) => f.type === "session");

      const metricsAfterHandshake = generateContentHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(metricsAfterHandshake).toBe(0);
    },
    30_000,
  );

  test(
    "sending a turn reaches the mock's generateContent endpoint (zero real network access) even though this task could not get it to settle — see this file's header",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-gemini-cwd2-");
      const chatId = "gemini-mocked-turn-" + Date.now();
      chatIds.push(chatId);
      const { sink, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.gemini.openSession({ chatId, cwd, sink, computerUse: false });
      await waitFor((f) => f.type === "models");

      const before = generateContentHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(before).toBe(0); // sanity: nothing hit the model endpoint before this turn

      CHAT_BACKENDS.gemini.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      // Deliberately polling /metrics rather than waiting for "assistant-text"/"done" — this task
      // found gemini-cli 0.53.0 does not reliably settle a turn against this mock's single generic
      // fixture (see header). What IS proven, and is the actual safety property this harness
      // exists for: GOOGLE_GEMINI_BASE_URL/GEMINI_API_KEY are the ONLY endpoint/credential this
      // gemini process was given (and $HOME is isolated — finding #2), so the ONLY place a model
      // call can land is this mock's generateContent endpoint — and it does land there (never on a
      // real host), proven by the counter for THAT SPECIFIC PATH increasing (not merely "the metrics
      // family exists", which self-hits would satisfy trivially — see finding #1).
      const deadline = Date.now() + 20_000;
      let sawModelHit = false;
      while (Date.now() < deadline) {
        const after = generateContentHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
        if (after > before) {
          sawModelHit = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(sawModelHit).toBe(true);
    },
    30_000,
  );
});
