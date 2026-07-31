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
// with the mock's own /metrics showing exactly 5 hits on `:generateContent` — the classifier's own
// non-streaming endpoint) before NumericalClassifierStrategy catches the exhausted-retries error,
// returns null, and routing falls through to the default model — and ONLY THEN does the real turn's
// own request run, on a DIFFERENT path (`:streamGenerateContent`, streamed) that the classifier's
// retries never touched. This is NOT a true hang, the turn genuinely completes, just ~90s after it
// starts, past the 30s timeout the earlier version of this file's turn test used. That exactly explains the symptom the prior
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
// no second ~65-90s retry storm after the classifier's, and exactly 2 total requests once fixed (one
// on `:generateContent`, the classifier; one on `:streamGenerateContent`, the turn — see hitCount's
// own doc comment for why these are counted as two distinct endpoints, not one).
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
// `--journal-max` — before the fix: session/prompt settles after 90440ms, 5 hits on `:generateContent`
// (the classifier retrying) before the "Hello!" chunk arrives. After the fix: settles after 53ms,
// exactly 2 requests total per the journal — one `:generateContent` (classifier, matched first
// attempt), one `:streamGenerateContent` (the real turn) — and the driver emits a real
// `assistant-text` frame carrying the fixture's exact "Hello!" before `result`/`done`.
//
// FIXTURE ORDER IS LOAD-BEARING (undocumented in the JSON itself — JSON has no comments — so noted
// here): the two fixtures in basic-turn.json are NOT disjoint on `userMessage`.
// NumericalClassifierStrategy ships the last several turns of conversation history as context in
// its OWN request, which — for this test's single-turn "hello" conversation — means the classifier's
// request ALSO satisfies `match.userMessage: "hello"` (confirmed directly: the ORIGINAL pre-fix repro,
// with only the generic "hello" fixture present, got real `status="200"` fixture-matched responses on
// every one of the classifier's 5 retries, not a 404 — proof the classifier's own request already
// matched that fixture even before the classifier-specific one existed). The classifier fixture wins
// only because aimock's `matchFixtureDiagnostic`/`selectByTurnIndex` (core/node_modules/@copilotkit/
// aimock/dist/router.js) breaks a tie between same-priority (no `turnIndex`) candidates by FIRST
// occurrence in the fixtures array — i.e., file order. Reordering basic-turn.json so the generic
// "hello" fixture comes first would reintroduce the full ~90s retry storm — NOT silently: the
// classifier would get "Hello!" back (not valid JSON) on every attempt, so this file's 60s
// `waitFor((f) => f.type === "assistant-text")` would time out and fail loudly well before the storm
// even finishes, and separately, `hitCount(afterText, ":generateContent")` would read 5, not the
// exact 1 this file asserts. Noted here because BOTH failure paths depend on this ordering being
// preserved, and neither the JSON file nor aimock's own matcher can express or enforce it.
//
// SABOTAGE (verification-before-completion discipline): each new assertion below was deliberately
// broken once during development to confirm it actually fails when the thing it claims stops being
// true.
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

/** Sum of `aimock_requests_total{...}` counter values whose `path` label CONTAINS `pathSuffix` —
 *  callers pass one of the two exact, mutually-exclusive suffixes below. Deliberately NOT "does the
 *  string aimock_requests_total appear anywhere" — that family also contains the mock's own
 *  `GET /metrics` self-hits, which would make any poll-based check vacuously true after the second
 *  poll regardless of whether the CLI under test ever made a model call.
 *
 *  CODE-REVIEW FINDING, fixed here: an earlier version of this file used a single filter,
 *  `line.includes("generateContent")` (lowercase `g`), meant to catch every model call. gemini-cli
 *  actually speaks to TWO DISTINCT endpoints — confirmed live via a real turn's /metrics output:
 *  `POST /v1beta/models/{model}:generateContent` (NumericalClassifierStrategy's non-streaming
 *  routing call) and `POST /v1beta/models/{model}:streamGenerateContent` (the user-facing turn
 *  itself, capital `G` in `streamGenerateContent` — a DIFFERENT substring than lowercase
 *  `generateContent`, so the old filter silently never matched it). The old `after > before`
 *  assertion below was therefore only ever counting the classifier's own hit, never the turn's —
 *  correct in that a real gemini process must have made a real call, but strictly weaker than its
 *  own comment claimed ("reflects the routing classifier, then the main turn"). Fixed by requiring
 *  the CALLER to name the exact endpoint it means (`:generateContent` for the classifier,
 *  `:streamGenerateContent` for the turn — leading colons so neither suffix is a substring of the
 *  other's path), and asserting an EXACT count (not `>`) for each below — see this file's SABOTAGE
 *  section and the git history for the concrete measurement (1 classifier hit, 1 turn hit; `> `
 *  alone would still pass at 5-classifier-retries-and-counting, silently 25x slower, if a future
 *  gemini-cli release trims its retry backoff under this test's 60s wait). */
function hitCount(metricsText: string, pathSuffix: ":generateContent" | ":streamGenerateContent"): number {
  let total = 0;
  for (const line of metricsText.split("\n")) {
    if (!line.startsWith("aimock_requests_total{") || !line.includes(pathSuffix)) continue;
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
        // something the mock serves — confirmed live: both endpoints are at 0 hits at this point).
        expect(modelsFrame.models.length).toBeGreaterThan(0);
        expect(modelsFrame.models.every((m) => m.effortLevels.length === 0)).toBe(true);
      }

      await waitFor((f) => f.type === "session");

      const metricsAfterHandshake = await fetch(`${mock!.url}/metrics`).then((r) => r.text());
      expect(hitCount(metricsAfterHandshake, ":generateContent")).toBe(0);
      expect(hitCount(metricsAfterHandshake, ":streamGenerateContent")).toBe(0);
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

      const beforeText = await fetch(`${mock!.url}/metrics`).then((r) => r.text());
      // Sanity: nothing hit EITHER model endpoint before this turn (see hitCount's own doc comment
      // for why these are two distinct paths, not one).
      expect(hitCount(beforeText, ":generateContent")).toBe(0);
      expect(hitCount(beforeText, ":streamGenerateContent")).toBe(0);

      CHAT_BACKENDS.gemini.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      // The actual proof this is a COMPLETED turn, not just "reached the mock": the fixture's exact
      // sentinel text arrives as a real assistant-text ChatFrame through the unmodified driver. This
      // text alone is not proof of zero real network access (a real model could plausibly also reply
      // "Hello!" to "hello") — that proof is the combination below: GOOGLE_GEMINI_BASE_URL/
      // GEMINI_API_KEY="mock" are the only endpoint/credential this process was ever given, $HOME is
      // redirected to an isolated temp dir (setup(), above), and the mock's own /metrics is what
      // confirms the hit count this test asserts on later.
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

      // Not presence (aimock's own /metrics self-hits would make a presence check vacuously true
      // even with zero model calls) and NOT a loose `>` delta either (code-review finding: `>`
      // alone passes just as well at "1 classifier hit" as at "5 classifier retries and the storm
      // is back" — see hitCount's own doc comment). EXACT counts on the two distinct paths a real
      // turn touches: one classifier attempt (matched on the FIRST try — the fixture is why this
      // isn't 5) on `:generateContent`, then the turn itself on `:streamGenerateContent`. A future
      // gemini-cli release trimming DEFAULT_MAX_ATTEMPTS2/its backoff constants so a 5-retry storm
      // lands under this test's 60s wait would fail this pair of assertions loudly
      // (`:generateContent` !== 1) rather than pass silently.
      const afterText = await fetch(`${mock!.url}/metrics`).then((r) => r.text());
      expect(hitCount(afterText, ":generateContent")).toBe(1);
      expect(hitCount(afterText, ":streamGenerateContent")).toBe(1);
    },
    90_000,
  );
});
