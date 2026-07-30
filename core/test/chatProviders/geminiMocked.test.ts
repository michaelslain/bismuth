// Task 4 of the offline-integration-testing plan: drive a REAL `gemini` binary through Bismuth's OWN
// ACP driver (core/src/chatProviders/acp/driver.ts, via `gemini --experimental-acp`/`--acp` — see
// chatProviders/acp/agents.ts) against the local mock LLM server (core/test/support/mockLlm.ts).
// Mirrors claudeMocked.test.ts's shape (Task 3) for the skip gate: runs by default in `bun test
// core`, skips only when the `gemini` binary itself is missing.
//
// UPDATE (offline2/gemini branch): this row is now VERIFIED, full turn E2E — the "coverage gap" this
// branch was created to close. Root cause of the earlier stall (see backendEnv.ts's `gemini` case
// comment for the full write-up, this is the summary): a real `gemini` 0.53.0 issues ONE non-user-
// facing model call per turn beyond the one everyone expected, and it is NOT the `flash`/`pro`
// `ClassifierStrategy` a first read of the routing code suggests — that one bails out with zero
// network calls the moment its own precondition is met. Captured directly from a real llmock
// instance's `GET /__aimock/journal` request log (not guessed): it is `NumericalClassifierStrategy.
// route` (packages/core/src/routing/strategies/numericalClassifierStrategy.ts), whose system prompt
// verbatim is "You are a specialized Task Routing AI... assign a **Complexity Score** from 1 to 100"
// and whose JSON schema is `{complexity_reasoning, complexity_score}`. Why THIS strategy: this
// gemini-cli's actual default model resolves through the `"auto"` alias to a Gemini-3-family model
// (the real turn's own journal entry: `"model":"gemini-3.5-flash"`), and `getNumericalRoutingEnabled()`
// defaults to `true` when no remote experiments are fetched (true here, with `gemini-api-key` auth —
// see backendEnv.ts's selectedType bullet) — with both conditions true, `ClassifierStrategy.route`'s
// own first line (`if (numericalRoutingEnabled && isGemini3Model(model)) return null`) intentionally
// defers to `NumericalClassifierStrategy` instead. `BaseLlmClient.generateJson`'s
// `shouldRetryOnContent` treats any response that doesn't `JSON.parse` as a `retryWithBackoff`-
// eligible failure — DEFAULT_MAX_ATTEMPTS2 = 5 attempts, backoff starting at 5000ms and doubling to a
// 30000ms cap. Against this suite's original single generic fixture (`{"userMessage":"hello"}` ->
// plain-text `"Hello!"`), the classifier's response never parses as JSON, so it silently burns through
// all 5 attempts (~65-90s of pure backoff, confirmed live: 90440ms end to end in a raw-JSON-RPC repro,
// with the mock's own /metrics showing exactly 5 generateContent hits before the real turn's 6th)
// before giving up (NumericalClassifierStrategy catches the exhausted-retries error, returns null,
// routing falls through to the default model) and ONLY THEN does the real turn's own call run — this
// is NOT a true hang, the turn genuinely completes, just ~90s after it starts, past the 30s timeout
// the earlier version of this file's turn test used. That exactly explains the symptom the prior
// investigation observed: "3-5 successful (200, fixture-matched) hits on the mock and then goes
// silent... waited up to 90s" (that 90s WAS the classifier's own retry storm running to completion).
//
// `checkNextSpeaker` (packages/core/src/utils/nextSpeakerChecker.ts), the OTHER model-calling utility
// this task initially suspected, is confirmed NOT reachable through Bismuth's driver at all:
// gemini-cli's own `skipNextSpeakerCheck` resolves as `isAcpMode || settings.model?.
// skipNextSpeakerCheck` — ACP mode (exactly the mode `--experimental-acp`/`--acp` puts gemini-cli
// into, which is all Bismuth's driver ever uses) unconditionally forces it `true`, so
// `checkNextSpeaker` never runs. Confirmed two ways: (a) reading gemini-cli 0.53.0's bundled source
// directly (installed to a scratch dir OUTSIDE this repo, per this task's brief — `npm install
// --prefix <scratch>/gemini-cli @google/gemini-cli`), and (b) the live repro's own timeline/journal:
// no second ~65-90s retry storm after the classifier's, and exactly 2 total requests once fixed.
//
// THE FIX: `core/test/fixtures/llm-gemini/basic-turn.json` — a fixture directory SEPARATE from the
// shared `core/test/fixtures/llm/` (deliberately: the new fixture is gated on system-prompt text
// unique to gemini-cli's internal classifier prompt, so keeping it out of the shared directory means
// zero risk of ever affecting the claude/opencode/codex/goose mocked tests, which all resolve
// DEFAULT_FIXTURE_DIR) — adds one fixture ahead of the existing "hello" one:
// `match.systemMessage: "assign a **Complexity Score** from 1 to 100"` (a substring unique to
// NumericalClassifierStrategy's system prompt, confirmed via the journal capture above) -> valid JSON
// `{"complexity_reasoning": "...", "complexity_score": 10}`, satisfying `generateJson` on the FIRST
// attempt — no retry storm, turn completes in about a second instead of ~90.
//
// Confirmed via a raw ACP JSON-RPC repro driving a real llmock instance with `--metrics` and
// `--journal-max` — before the fix: session/prompt settles after 90440ms, 5 generateContent hits
// before the "Hello!" chunk arrives. After the fix: settles after 53ms, exactly 2 generateContent
// requests total per the journal (both fixture-matched on the first attempt: the classifier, then the
// real turn), and the driver emits a real `assistant-text` frame carrying the fixture's exact
// "Hello!" before `result`/`done`. See this task's report for the full transcript.
//
// SABOTAGE (verification-before-completion discipline): each new assertion below was deliberately
// broken once during development to confirm it actually fails when the thing it claims stops being
// true — see this task's report for the concrete before/after per assertion.
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

/** This test's OWN fixture directory (see header) — deliberately not core/test/support/mockLlm.ts's
 *  DEFAULT_FIXTURE_DIR, so the classifier fixture in it (core/test/fixtures/llm-gemini/basic-turn.json)
 *  can never affect any other backend's mocked test. */
const GEMINI_FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "llm-gemini");

/** Sum of `aimock_requests_total{...}` counter values whose `path` label mentions
 *  "generateContent" — gemini-cli's own model-call endpoint (`POST /v1beta/models/{model}:
 *  generateContent`), confirmed live. Deliberately NOT "does the string aimock_requests_total
 *  appear anywhere" — that family also contains the mock's own `GET /metrics` self-hits, which would
 *  make any poll-based check vacuously true after the second poll regardless of whether the CLI
 *  under test ever made a model call. Kept from the pre-fix version of this file: still the only
 *  assertion in this suite that uses /metrics as a PASS/FAIL signal, now paired with (not replaced
 *  by) the frame-based assertions below that prove a full turn actually completed. */
function generateContentHitCount(metricsText: string): number {
  let total = 0;
  for (const line of metricsText.split("\n")) {
    if (!line.startsWith("aimock_requests_total{") || !line.includes("generateContent")) continue;
    const m = line.match(/}\s+([0-9.]+)\s*$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

describeOrSkip("the real gemini CLI, driven through the ACP driver, against a mock LLM — full turn E2E (zero account API calls)", () => {
  const ENV_KEYS = [
    "GOOGLE_GEMINI_BASE_URL",
    "GEMINI_API_KEY",
    "GEMINI_CLI_TRUST_WORKSPACE",
    "HOME",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — populating this after an await
  // that can throw leaves it empty, and the restore loop below then unconditionally `delete`s every
  // ENV_KEY from the shared `bun test` process, including a developer's real $HOME.
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
    mock = await startMockLlm(GEMINI_FIXTURE_DIR, ["--metrics"]);
    // Belt-only (matching codex's/cline's own defensive clears): the pinned $HOME + seeded
    // selectedType below should dominate regardless, but a real Vertex/service-account escape hatch
    // ambient in a developer's shell is exactly the class of risk closed for claude
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
    // STATE ISOLATION: redirect $HOME so gemini-cli's own ~/.gemini/settings.json can never be a
    // developer's real one, and pre-seed just enough of it (the auth method selection) to satisfy
    // validateAuthMethod without any real credentials. Also confirmed live (this task, reading
    // gemini-cli's own refreshAuth): with "gemini-api-key" auth, gemini-cli's Code-Assist-Server-only
    // experiments/admin-controls/quota fetches never fire AT ALL (getCodeAssistServer returns
    // undefined for this auth type, and every one of those calls short-circuits on an undefined
    // server before touching the network) — so there is no OTHER real endpoint this process could
    // reach even before $HOME isolation is considered.
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
        // something the mock serves — confirmed live: generateContentHitCount is 0 at this point).
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
    "a turn sent through CHAT_BACKENDS.gemini returns the fixture's exact text, then terminates with result + done — a full turn, completed",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-gemini-cwd2-");
      const chatId = "gemini-mocked-turn-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.gemini.openSession({ chatId, cwd, sink, computerUse: false });
      await waitFor((f) => f.type === "models");

      const before = generateContentHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(before).toBe(0); // sanity: nothing hit the model endpoint before this turn

      CHAT_BACKENDS.gemini.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      // The actual proof this is a COMPLETED turn, not just "reached the mock": the fixture's exact
      // sentinel text arrives as a real assistant-text ChatFrame through the unmodified driver — no
      // real model replies to "hello" with the literal string "Hello!" verbatim, and
      // GOOGLE_GEMINI_BASE_URL is the only endpoint this gemini process was ever given.
      const assistantText = await waitFor((f) => f.type === "assistant-text", 60_000);
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done", 60_000);
      expect(done.type).toBe("done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") expect(resultFrame.isError).toBe(false);

      // Kept from the pre-fix version of this file: the counter DELTA (not presence — aimock's own
      // /metrics self-hits would make a presence check vacuously true even with zero model calls) for
      // the specific generateContent path, strictly increasing once the turn has run. With the fix
      // above this reflects TWO real hits per turn (the routing classifier, then the main turn) —
      // completing in a couple of seconds, rather than the pre-fix retry storm's 5 hits from the
      // classifier alone (~90s) before the main turn's own hit even had a chance to run.
      const after = generateContentHitCount(await fetch(`${mock!.url}/metrics`).then((r) => r.text()));
      expect(after).toBeGreaterThan(before);
    },
    90_000,
  );
});
