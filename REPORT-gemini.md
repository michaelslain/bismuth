# Gemini offline coverage gap — report

Branch: `offline2/gemini` (worktree `/Users/michaelslain/Documents/dev/bismuth-o2-gemini`, based on `main` @ e586a28)

## Status: VERIFIED, full turn E2E

`gemini` moves from **Partially verified** to **Verified, full turn E2E** in `docs/contributing/testing.md`'s table. A real `gemini` 0.53.0 binary, driven through Bismuth's unmodified ACP driver, now completes a full turn against the local mock in ~1.5s (was previously not completing within any timeout this test used, though see below — it was not a true infinite hang).

## Setup

- `gemini` installed via `npm install --prefix "$SCRATCH/gemini-cli" @google/gemini-cli` (outside the repo, in the session scratchpad) — resolved version `0.53.0`, matching the version cited in the prior investigation.
- Never installed into the worktree. `git status --short` was checked before every commit; only the 5 intended source files + 1 new fixture file ever appeared.

## Root cause (evidenced, not guessed)

I instrumented the mock two ways: its `--metrics` Prometheus counter (`generateContent`-path hits) and its `GET /__aimock/journal` request log (full request bodies, including the `system` role message aimock synthesizes from Gemini's `systemInstruction` field). I then drove a raw ACP JSON-RPC handshake (`initialize` -> `session/new` -> `session/prompt`) against a real llmock instance from a small standalone script, first against the *original* single-fixture setup, to reproduce the stall with hard evidence before touching anything.

**Finding #1 — it is not a hang, it's a very slow eventual success.** Against the original fixture (`{"userMessage":"hello"}` -> plain-text `"Hello!"`), `session/prompt` settled after **90440ms** with `stopReason:"end_turn"` and the correct `"Hello!"` text — it did complete, just past the 30s timeout the old test used to wait for it, which is why it read as "never completes" / "goes silent." The mock's own metrics showed exactly 5 `generateContent` hits (all 200, all fixture-matched) before the real turn's 6th hit.

**Finding #2 — the extra call is gemini-cli's own model-routing classifier, not a next-speaker check.** Reading gemini-cli 0.53.0's bundled source (`packages/core/src/core/client.ts`'s `sendMessageStream`/`processTurn`) showed a `router.route()` call before every real turn. My first hypothesis (matching the task brief's lead) was `ClassifierStrategy` (the `flash`/`pro` picker). Reading its source showed it opens with a bail-out: `if (await config2.getNumericalRoutingEnabled() && isGemini3Model(model, config2)) return null` — deferring to a *different* strategy under exactly those conditions. The journal capture confirmed which one actually fired: the request's `system` message was verbatim *"You are a specialized Task Routing AI... assign a **Complexity Score** from 1 to 100"* with JSON schema `{complexity_reasoning, complexity_score}` — this is `NumericalClassifierStrategy`, not `ClassifierStrategy`. This gemini-cli's default model resolves through its `"auto"` alias to a Gemini-3-family model (the real turn's own journal entry: `"model":"gemini-3.5-flash"`), and `getNumericalRoutingEnabled()` defaults to `true` when no remote experiments are fetched (true here — with `gemini-api-key` auth, `getCodeAssistServer()` returns `undefined`, and gemini-cli's experiments/admin-controls/quota fetches all short-circuit on an undefined server before touching any network, real or mock) — both conditions being true is exactly what makes `ClassifierStrategy` bail and `NumericalClassifierStrategy` run instead.

`BaseLlmClient.generateJson`'s `shouldRetryOnContent` treats any response that doesn't `JSON.parse` as retryable — `retryWithBackoff` with `DEFAULT_MAX_ATTEMPTS2 = 5`, backoff `5000ms` doubling to a `30000ms` cap. Against the old plain-text-only fixture, the classifier's response never parses as JSON, so it silently burns all 5 attempts (~65-90s) before the retry loop throws, `NumericalClassifierStrategy` catches it, routing falls through to the default model, and *only then* does the real turn's own (always-fine) call run.

**Finding #3 — `checkNextSpeaker` was a dead end, corrected mid-investigation.** I initially assumed (per the task brief's lead) that `checkNextSpeaker` was a second contributor and drafted fixtures/comments accordingly. Reading `packages/core/src/core/client.ts` further found `skipNextSpeakerCheck: isAcpMode || settings.model?.skipNextSpeakerCheck` — ACP mode (the *only* mode Bismuth's driver ever uses: `--experimental-acp`/`--acp`) unconditionally forces this `true`, so `checkNextSpeaker` never runs through Bismuth's driver at all. My first "fixed" repro run (with a classifier fixture for the *wrong* classifier, `ClassifierStrategy`, plus a next-speaker fixture) still stalled at exactly the same ~90s/5-hit pattern as before — which is what sent me back to the journal to find the actual classifier being hit. Once the journal identified `NumericalClassifierStrategy` and the fixture was corrected, the turn completed in 53ms with the journal showing **exactly 2 requests total** — confirming both that the real culprit was found and that `checkNextSpeaker` genuinely never fires (no second retry storm). I removed the next-speaker fixture and every "3 calls" claim from the drafts before finalizing; nothing referencing it ships in the final diff.

## The fix

One new fixture, in a **fixture directory separate from the shared one** (`core/test/fixtures/llm-gemini/basic-turn.json`, not `core/test/fixtures/llm/basic-turn.json`) so it can never affect the claude/opencode/codex/goose mocked tests, all of which resolve `DEFAULT_FIXTURE_DIR`:

```json
{
  "fixtures": [
    {
      "match": { "systemMessage": "assign a **Complexity Score** from 1 to 100" },
      "response": { "content": { "complexity_reasoning": "mock fixture: trivial request", "complexity_score": 10 } }
    },
    {
      "match": { "userMessage": "hello" },
      "response": { "content": "Hello!" }
    }
  ]
}
```

`geminiMocked.test.ts`'s `setup()` now points `startMockLlm()` at this directory instead of the default.

Before/after, same repro script, same mock instrumentation:

| | settle time | `generateContent` hits | journal |
|---|---|---|---|
| before | 90440ms | 5 (all classifier retries) then a 6th (real turn) | not captured (added after) |
| after | 53ms | -- | exactly 2 requests, both fixture-matched on attempt 1 (classifier, then real turn) |

## Test changes

`geminiMocked.test.ts` now asserts a genuinely completed turn, matching `gooseMocked.test.ts`'s shape:
- `assistant-text` frame with `text === "Hello!"` (the fixture's sentinel — no real model would ever reply to "hello" with that exact literal string).
- `done` frame arrives.
- A `result` frame exists, precedes `done`, and has `isError === false`.
- The existing `generateContent`-path counter-delta check (`after > before`, using `/metrics`, not presence) is kept.

The handshake-only test (`session creation succeeds...`) is unchanged in substance — it was already sound (models frame, old-shape assertion, `generateContentHitCount === 0` at that point).

## Sabotage results (verification-before-completion discipline)

Each new assertion in the "full turn" test was broken once, run, confirmed to fail, then reverted:

| Assertion | Sabotage | Result |
|---|---|---|
| `expect(assistantText.text).toBe("Hello!")` | Changed expected to `"SABOTAGE-WRONG-TEXT"` | FAILED as expected: `Expected: "SABOTAGE-WRONG-TEXT" / Received: "Hello!"` |
| `expect(resultFrame.isError).toBe(false)` | Changed expected to `true` | FAILED as expected: `Expected: true / Received: false` |
| `expect(doneIdx).toBeGreaterThan(resultIdx)` | Changed to `toBeLessThan` | FAILED as expected: `Expected: < 5 / Received: 6` |
| `expect(after).toBeGreaterThan(before)` (kept assertion, re-sabotaged anyway since its underlying mechanism changed) | Changed to `toBe(before)` | FAILED as expected: `Expected: 0 / Received: 1` |

All four reverted; the file was re-run clean afterward (`2 pass, 0 fail`).

I also asked, for every assertion in the final file: *would this still pass if gemini never ran at all?* No — `describeOrSkip` gates the whole block on `whichBinary("gemini") !== null`, so a missing binary skips (never a false pass), and every retained assertion depends on the driver actually receiving real ACP JSON-RPC traffic from a real subprocess.

## Verification run

- `bun test core/test/chatProviders/geminiMocked.test.ts` (gemini on PATH via scratch install): **2 pass, 0 fail**, 3.0-3.2s.
- `bun test core` (gemini on PATH): **2012 pass, 14 skip, 0 fail**, 86.26s.
- `bun test core` (gemini NOT on PATH, default environment): **2010 pass, 16 skip, 0 fail**, 83.82s — `geminiMocked.test.ts` correctly missing-binary-skips (2 fewer passes / 2 more skips than the gemini-on-PATH run), same pattern as `codexMocked`/`clineMocked`.
- `(cd core && bunx tsc --noEmit)`: clean, exit 0.
- `ps aux` checked after every test run: no orphaned `gemini`/`llmock`/`node` processes left behind.
- `git status --short`: only the 5 intended source files + 1 new fixture file, no `node_modules`, no gemini-cli install artifacts.

## Files changed

- `core/test/fixtures/llm-gemini/basic-turn.json` (new) — the gemini-only fixture set.
- `core/test/chatProviders/geminiMocked.test.ts` — full-turn assertions, corrected header/root-cause writeup, points at the new fixture dir.
- `core/test/support/backendEnv.ts` — `gemini` case comment rewritten (VERIFIED, full root cause), header vocabulary section updated.
- `core/test/support/mockLlm.test.ts` — one test title updated for honesty (env routing + handshake + full turn all verified, not just the first two).
- `core/test/chatProviders/gooseMocked.test.ts` — one-line honesty update: it's no longer the *only* fully-verified ACP-native backend.
- `docs/contributing/testing.md` — `gemini` row upgraded to Verified/full turn E2E with the root-cause summary.

## Concerns / caveats

- The exact reason gemini-cli's default model resolves to a Gemini-3-family model via the `"auto"` alias was not traced further than "confirmed live, `model:"gemini-3.5-flash"` in the journal" — sufficient for this fix (the fixture is gated on the classifier's own distinctive prompt text, not on this mechanism), but a future gemini-cli version could plausibly change which classifier strategy engages by default. If that happens, the symptom would look identical to the original bug report (a ~90s-late-but-real completion, or an outright stall if `DEFAULT_MAX_ATTEMPTS2`/backoff constants also change), and the fix would be: capture the journal again, find the new prompt text, add/adjust the fixture.
- `NumericalClassifierStrategy`'s bypass conditions (`getNumericalRoutingEnabled()`, `isGemini3Model`) both being source-read rather than settings-file-configured by Bismuth means this fixture's necessity is itself a function of gemini-cli's *own* default configuration on the machine running the test, not something Bismuth's driver controls. Documented inline in both `backendEnv.ts` and `geminiMocked.test.ts`.
