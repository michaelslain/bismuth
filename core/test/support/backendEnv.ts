// core/test/support/backendEnv.ts
// Per-backend env-var mapping that points a real agent CLI at a local mock LLM server
// (core/test/support/mockLlm.ts) instead of a real provider API — the other half of the
// zero-real-API-calls test harness Tasks 3/4 build integration tests on top of.
//
// HONESTY, per the task brief: every row below is labeled with exactly what was actually
// established for it, using this vocabulary (final-review finding: an earlier version of this
// comment claimed the vocabulary was "VERIFIED or GUESSED" — no row below has said GUESSED since
// Task 4; every row that started as a guess was either upgraded to one of the labels below with a
// real live run, or explicitly left as-is with the word "guess" used only to describe that PAST
// state, never a current one):
//   - VERIFIED: actually run — a real installed binary, driven either directly (a raw shell
//     invocation) or through Bismuth's own production driver (`core/src/chatProviders/**`), against
//     a real `startMockLlm()` (or, where the backend's mechanism is file-based, a hand-written
//     config pointed at one) — with the mock's own request log/metrics inspected to confirm the hit
//     landed on the mock and NOT a real provider host, end to end, turn completing.
//   - FIXED: a row that was previously wrong (verified live to fail — see the codex/cline case
//     comments for what "wrong" meant concretely in each) and has since been corrected and then
//     VERIFIED by the definition above.
//   - PARTIALLY VERIFIED: some of the row's mapping was confirmed live, but not the full "a turn
//     completes end to end" bar above. NO row currently uses this label — it had two wearers, and
//     both were upgraded off it in independent tasks that landed around the same time: gemini wore
//     "driver-verified" (the real production driver, real handshake, real zero-real-network-access
//     confirmation — everything EXCEPT a completed turn) until the offline2/gemini branch found the
//     actual root cause (an additional non-user-facing `generateJson` call per turn that needs its
//     OWN JSON-shaped fixture — see that case's own comment) and fixed it rather than accepting it as
//     a permanent limitation. openclaw wore "config mechanism only" (only the two env vars that
//     redirect its config/state location were confirmed live; the actual model-ROUTING mechanism
//     through its Gateway architecture was never executed at all) until the offline-testing openclaw
//     task stood up a real, separately-run `openclaw gateway run` process against the mock (see
//     core/test/support/openclawGateway.ts) and closed that gap too. Both are VERIFIED below now.
//     The label stays documented here (same reasoning as "Throws" below) in case a future backend
//     genuinely lands in this partial state.
//   - Throws: no env-var (or file-based) mapping exists that actually works for how Bismuth spawns
//     that backend. NO row currently uses this label (cline used to be the one exception — see its
//     case comment for how a LATER task found a real, source-cited bypass and corrected it to
//     VERIFIED; the label stays documented here in case a future backend genuinely has no path in).
// Two miscitations were already caught in this repo's recent work (see catalog.ts's history) —
// presenting an unverified mapping as fact is the exact failure mode that produces a THIRD, so this
// file is disciplined about which label is which and updates this file's OWN vocabulary comment
// whenever a row's label changes, rather than letting the two drift apart.
//
// A backend not in the switch throws rather than silently returning `{}` — a caller asking this
// module to mock a backend it doesn't know about is a bug in the CALLER (a typo'd backend id, or
// a new backend added to core/src/agentBackends/catalog.ts that this file hasn't caught up to
// yet), not a "just don't mock anything" situation; the whole point of this harness is that a
// misconfigured mock must fail loud, never silently fall through to a real API. A KNOWN backend
// whose only "mapping" would be env vars that DON'T ACTUALLY WORK for how Bismuth spawns it would
// also throw, with a message explaining exactly why and what (if anything) DOES work — never a row
// that "looks" complete but silently falls through to a real API the moment someone trusts it. (No
// row currently needs this — see the "Throws" label above.)
//
// `workDir`: three backends' REAL working mechanism is a FILE Bismuth's driver reads at spawn time
// (Codex's `$CODEX_HOME/config.toml`, OpenClaw's `$OPENCLAW_CONFIG_PATH`, cline's
// `$CLINE_DIR/data/settings/providers.json`), not a value any env var carries directly — this file
// writes that config INTO `workDir` (a caller-owned temp directory, never touched by any other test)
// and returns only the env vars that point at it. Every other backend ignores this parameter
// entirely; it defaults to undefined so every pre-Task-4 call site (`backendMockEnv(id, mockUrl)`,
// no third argument) is completely unaffected.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function backendMockEnv(backendId: string, mockUrl: string, workDir?: string, openclawGatewayPort?: number): Record<string, string> {
  switch (backendId) {
    // --------------------------------------------------------------------------------------
    // VERIFIED live end-to-end (Task 3, re-confirmed this task): env auth takes precedence over
    // Claude Code's own keychain OAuth login, which is why this works at all despite Claude Code
    // defaulting to OAuth. ANTHROPIC_AUTH_TOKEN is what actually satisfies Claude Code's own
    // auth check; ANTHROPIC_API_KEY is set alongside it because some code paths/SDKs consult
    // that name instead — harmless to set both.
    // --------------------------------------------------------------------------------------
    case "claude":
      return {
        ANTHROPIC_BASE_URL: mockUrl,
        ANTHROPIC_AUTH_TOKEN: "mock",
        ANTHROPIC_API_KEY: "mock",
      };

    // --------------------------------------------------------------------------------------
    // FIXED this task — the OLD row (`OPENAI_BASE_URL`/`OPENAI_API_KEY`) was GUESSED and is
    // CONFIRMED WRONG: run live against a real `@openai/codex` 0.146.0 (`codex exec --json
    // --sandbox workspace-write --cd <dir> --skip-git-repo-check --config approval_policy="never"`
    // — Bismuth's OWN argv, chatProviders/codex/driver.ts's buildCodexExecArgs, with no --model/
    // --config override since a fresh session's `s.model`/`s.effort` start unset), it dialed
    // straight past OPENAI_BASE_URL to the REAL `wss://api.openai.com/v1/responses` (a genuine
    // network attempt — it only failed with 401 because no real key was set; on a machine WITH a
    // real key this would have been a real, billed account call). Root cause, confirmed two ways:
    //   1. codex's built-in "openai" provider id is HARD-REJECTED from override: `-c
    //      model_providers.openai.base_url=...` errors "Built-in providers cannot be overridden."
    //      (this codex version enforces the constraint the config.toml docs only warn about).
    //   2. codex's newer wire transport for the "openai" provider is a WebSocket
    //      (`wss://.../v1/responses`, falling back to HTTPS) that does not consult
    //      OPENAI_BASE_URL at all for that provider id — regardless of what an older GitHub
    //      maintainer comment (cited in the row this replaces) said about an earlier codex era.
    // The REAL, WORKING, LIVE-VERIFIED mechanism: a custom (non-"openai") `[model_providers.mock]`
    // block in `$CODEX_HOME/config.toml`, with `wire_api = "responses"` (`"chat"` is REJECTED
    // outright in this codex version: "no longer supported... set wire_api = \"responses\"") and
    // `model_provider`/`model` defaults pointing at it — confirmed to need NO `--model`/`--config`
    // CLI override at all, because Bismuth's own codex driver never passes either on a session's
    // first turn. `CODEX_HOME` (an env var, confirmed via `-p/--profile`'s own help text
    // referencing `$CODEX_HOME/<name>.config.toml`) isolates this from the developer's real
    // `~/.codex` entirely. `env_key` names an arbitrary env var this function also sets — codex
    // insists on SOME key being present for a configured provider even though the mock never
    // checks it. Verified live for BOTH a raw `codex exec` invocation AND through
    // CHAT_BACKENDS.codex.sendMessage (chatProviders/codex/driver.ts, unmodified) — a real
    // "assistant-text":"Hello!" frame arrived, with the mock's own /metrics showing exactly one
    // hit on POST /v1/responses.
    //
    // KNOWN COSMETIC QUIRK (also live-verified, not a real failure): codex logs a benign
    // `item.completed` of type "error" reading "Model metadata for `mock` not found. Defaulting to
    // fallback metadata..." for ANY model under a custom (non-built-in) provider — codex's model
    // metadata registry is keyed by (provider, model) and has no entry for one it doesn't own.
    // chatProviders/codex/protocol.ts's translator (correctly, by its own contract) treats any
    // "error"-typed item as `sawErrorFrame`, so the turn's final `result` frame reports
    // `isError:true` even though the assistant's actual text came back correctly — codexMocked.test.ts
    // asserts on the text, not on `result.isError`, and documents this finding inline.
    // --------------------------------------------------------------------------------------
    case "codex": {
      if (!workDir) {
        throw new Error(
          'backendMockEnv: "codex" requires a third `workDir` argument — its real mock mechanism is a ' +
            "$CODEX_HOME/config.toml file, not a bare env var (see this file's `codex` case comment for the " +
            "full, live-verified finding). Pass a throwaway temp directory this call may write into.",
        );
      }
      const envKey = "MOCK_CODEX_API_KEY";
      writeFileSync(
        join(workDir, "config.toml"),
        [
          'model_provider = "mock"',
          'model = "mock"',
          "",
          "[model_providers.mock]",
          'name = "Mock"',
          `base_url = "${mockUrl}/v1"`,
          'wire_api = "responses"',
          `env_key = "${envKey}"`,
          "",
        ].join("\n"),
      );
      return { CODEX_HOME: workDir, [envKey]: "mock" };
    }

    // --------------------------------------------------------------------------------------
    // VERIFIED live end-to-end (Task 4) — this env mapping was already correct (the OLD "GUESSED"
    // row's composition of two independently-documented opencode.ai mechanisms held up), but a
    // real DRIVER QUIRK was found and must be called out so a caller doesn't get a false negative:
    // this config's `model: "mock/mock"` top-level default IS honored by opencode's OWN CLI
    // (`opencode run "hello"`, no --model flag) but is NOT consulted by Bismuth's SERVER-mode
    // session (chatProviders/opencodeServer.ts's `opencode serve` + `@opencode-ai/sdk`'s
    // session.prompt) when a chat's `s.model` is still unset (a session's first turn, before any
    // setModel call) — that session instead falls back to whatever model this MACHINE's own
    // opencode last had active (on the research machine: a real Moonshot/Zen provider from prior
    // real usage — see opencodeMocked.test.ts's header for the live reproduction). The fix a
    // caller needs, NOT expressed as an env var because it isn't one: call
    // `CHAT_BACKENDS.opencode.setModel(chatId, "mock/mock")` once the session is open (after the
    // "models" frame arrives) and BEFORE the first sendMessage — exactly what
    // opencodeMocked.test.ts does. Confirmed via /metrics: zero hits on the mock until setModel is
    // called; the very next turn hits it correctly.
    //
    // SEPARATE, ALSO LIVE-VERIFIED FINDING: SERVER mode's real-time event subscription can miss an
    // entire turn's text if the mock replies with zero artificial latency — reproduced directly
    // (a turn that hit the mock twice per /metrics still produced ZERO assistant-text frames at
    // latency 0, and a clean single frame at latency 40ms) — see mockLlm.ts's `extraArgs` doc
    // comment and opencodeMocked.test.ts for the full account and the fix (a small `--latency`
    // value on the mock server, not a driver change).
    // --------------------------------------------------------------------------------------
    case "opencode":
      return {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            mock: {
              npm: "@ai-sdk/openai-compatible",
              name: "Mock",
              options: { baseURL: `${mockUrl}/v1` },
              models: { mock: { name: "Mock" } },
            },
          },
          model: "mock/mock",
        }),
      };

    // --------------------------------------------------------------------------------------
    // VERIFIED live end-to-end (offline2/gemini branch — upgraded from Task 4's PARTIALLY VERIFIED,
    // whose text is preserved in git history rather than here). Everything below IS confirmed live:
    //   - Through BOTH a raw ACP JSON-RPC handshake AND Bismuth's own CHAT_BACKENDS.gemini.sendMessage
    //     (chatProviders/acp/driver.ts, unmodified): this mapping correctly redirects a real `gemini`
    //     0.53.0's outbound calls to the mock — zero real network access. `initialize` -> `session/new`
    //     succeeds with NO prior `authenticate` call (the API-key env var alone satisfies it; driver.ts
    //     never calls `authenticate` at all, which matters because cline's ACP mode, below, does
    //     require it and hangs without real OAuth). `session/new`'s response is genuinely the OLD
    //     `models.availableModels`/`currentModelId` shape — a real, live confirmation of protocol.ts's
    //     "old" branch that the fake-agent test (acpFakeAgent.test.ts) otherwise only proves
    //     synthetically.
    //   - A FULL TURN completing: root cause of the earlier stall, found by reading gemini-cli 0.53.0's
    //     own bundled source (installed OUTSIDE this repo to a scratch dir, per this task's brief) and
    //     confirmed live via a raw-JSON-RPC repro against a real llmock instance with `--metrics` and its
    //     `GET /__aimock/journal` request log. A real turn makes TWO model calls, not one, on TWO
    //     DIFFERENT endpoints: `POST /v1beta/models/{model}:generateContent` (non-streaming) and
    //     `POST /v1beta/models/{model}:streamGenerateContent` (streamed) — confirmed live and important
    //     to keep straight, since a naive substring filter on "generateContent" (lowercase g) silently
    //     misses the streamed one (capital G in `streamGenerateContent`); see geminiMocked.test.ts's
    //     `hitCount` for where this bit a first version of that file's own /metrics assertion. The
    //     FIRST call, on `:generateContent`, is NOT the `flash`/`pro` `ClassifierStrategy` a naive read
    //     of the routing code suggests (that one bails out with zero network calls the moment its own precondition is
    //     met — see below), it is `NumericalClassifierStrategy.route` (packages/core/src/routing/
    //     strategies/numericalClassifierStrategy.ts): confirmed via the journal's own captured request
    //     body, whose system message is verbatim "You are a specialized Task Routing AI... assign a
    //     **Complexity Score** from 1 to 100" and whose JSON schema is `{complexity_reasoning,
    //     complexity_score}` — NOT `{reasoning, model_choice}`. Why THIS strategy and not the other: this
    //     gemini-cli's own default model resolves through the `"auto"` alias to a Gemini-3-family model
    //     (its real turn's own journal entry shows `"model":"gemini-3.5-flash"` — DEFAULT_GEMINI_3_5_
    //     FLASH_MODEL in packages/core/src/config/models.ts), and `getNumericalRoutingEnabled()` defaults
    //     to `true` when no remote experiments are fetched (true here — see the selectedType bullet
    //     below for why no Code-Assist-Server call happens at all with `gemini-api-key` auth); with BOTH
    //     of those true, `ClassifierStrategy.route`'s own FIRST check (`if (await config2.
    //     getNumericalRoutingEnabled() && isGemini3Model(model, config2)) return null`) intentionally
    //     defers to `NumericalClassifierStrategy` instead, which then makes the actual call.
    //     `BaseLlmClient.generateJson`'s `shouldRetryOnContent` treats any response that doesn't
    //     `JSON.parse` as a retryable failure — `retryWithBackoff` with `DEFAULT_MAX_ATTEMPTS2 = 5`
    //     attempts, backoff starting at 5000ms and doubling to a 30000ms cap (packages/core/src/
    //     utils/retry.ts's `DEFAULT_RETRY_OPTIONS`). Against the old single generic fixture
    //     (`{"userMessage":"hello"}` -> plain-text `"Hello!"`), the classifier call's response never
    //     parses as JSON, so it silently burns all 5 attempts (~65-90s of pure exponential backoff,
    //     confirmed live: 90440ms end to end in the raw-JSON-RPC repro, with the mock's own /metrics
    //     showing exactly 5 attempts on `:generateContent` — the classifier's own path, never the
    //     turn's — before the retry loop finally throws, NumericalClassifierStrategy catches it and
    //     falls through to the default model, and ONLY THEN does the real turn's own (always-fine)
    //     call run — on the DIFFERENT `:streamGenerateContent` path — which is EXACTLY the "3-5
    //     successful (200, fixture-matched) hits and then goes silent... waited up to 90s" symptom the
    //     earlier investigation reported: not a true hang, but a real turn that DOES eventually
    //     complete, just ~90s after it starts — past the 30s timeout the earlier version of
    //     geminiMocked.test.ts's turn test used, which is why it read as "never completes".
    //     `checkNextSpeaker` (packages/core/src/utils/nextSpeakerChecker.ts), the OTHER model-calling
    //     utility this file used to suspect, is confirmed NOT reachable at all through Bismuth's driver:
    //     gemini-cli's own `skipNextSpeakerCheck` config resolves as `isAcpMode || settings.model?.
    //     skipNextSpeakerCheck` — ACP mode (exactly the mode `--experimental-acp`/`--acp` puts
    //     gemini-cli into, which is all Bismuth's driver ever uses) unconditionally forces it `true`, so
    //     `checkNextSpeaker` never runs, confirmed both by this exact line of bundled source AND by the
    //     repro's own timeline showing no second retry storm after the classifier's, and by the journal
    //     showing exactly 2 requests total for a completed turn once fixed — one on `:generateContent`
    //     (the classifier), one on `:streamGenerateContent` (the turn), never a third anywhere.
    //     THE FIX (in `core/test/fixtures/llm-gemini/basic-turn.json`, a fixture directory SEPARATE
    //     from the shared `core/test/fixtures/llm/` so it can never affect another backend's mocked
    //     test): one fixture ahead of the "hello" one, `match.systemMessage` gated on a substring of
    //     NumericalClassifierStrategy's own system prompt ("assign a **Complexity Score** from 1 to
    //     100"), returning valid JSON matching ITS schema (`{complexity_reasoning, complexity_score}`)
    //     — so `generateJson` succeeds on the FIRST attempt and the retry storm never starts. Confirmed
    //     live, same repro, same fixture directory: session/prompt now settles in 53ms (not 90440ms),
    //     the journal shows exactly 2 requests total — one `:generateContent`, one
    //     `:streamGenerateContent`, both fixture-matched on attempt 1 — and the driver emits a real
    //     `assistant-text` frame carrying the fixture's exact "Hello!" before `result`/`done`. See
    //     geminiMocked.test.ts's header (fixture contents, fixture-order dependency) and its own
    //     `hitCount` helper (the exact-count assertions on both endpoints, and the code-review finding
    //     about why a loose substring filter on "generateContent" alone silently missed the streamed
    //     endpoint) for the full account.
    //   - GOOGLE_GEMINI_BASE_URL, read directly from google-gemini/gemini-cli's source
    //     (packages/core/src/core/contentGenerator.ts, and packages/cli/src/acp/
    //     acpSessionManager.ts — the ACP path Bismuth actually drives); must be loopback or HTTPS
    //     (satisfied, our mock always binds 127.0.0.1).
    //   - THE selectedType HAZARD, AND WHERE ITS FIX ACTUALLY LIVES: a persisted
    //     `security.auth.selectedType` in the user's real `~/.gemini/settings.json` is checked BEFORE
    //     these env vars (confirmed live: even a BLANK `$HOME` fails a different way — gemini-cli's own
    //     `validateAuthMethod` reads that persisted setting, not the env var, for a non-interactive
    //     run) and could silently defeat this mapping on a machine with a prior real gemini login. This
    //     function does NOT close that hole itself — it only returns the two env vars above. The
    //     mitigation lives in the CALLER: geminiMocked.test.ts's `setup()` redirects `$HOME` to a
    //     throwaway temp dir with a minimal pre-seeded `.gemini/settings.json`
    //     (`{"security":{"auth":{"selectedType":"gemini-api-key"}}}`) before ever touching this
    //     mapping. Any OTHER caller of `backendMockEnv("gemini", ...)` inherits the hole and must do
    //     the same — this function's return value alone is not safe to trust for gemini on a machine
    //     with prior real usage. Also confirmed live this task: with `gemini-api-key` auth,
    //     `getCodeAssistServer` returns `undefined` (that class is OAuth-Code-Assist-only), so
    //     gemini-cli's separate experiments/admin-controls/quota fetches — which all short-circuit on
    //     an undefined server before touching the network — never reach ANY endpoint, real or mock,
    //     for this auth type. One less thing to isolate, not a hazard.
    // --------------------------------------------------------------------------------------
    case "gemini":
      return {
        GOOGLE_GEMINI_BASE_URL: mockUrl,
        GEMINI_API_KEY: "mock",
      };

    // --------------------------------------------------------------------------------------
    // FIXED again, this later task ("close the cline coverage gap" — see REPORT-cline.md), CORRECTING
    // Task 4's own "no bypass exists" conclusion directly below (kept, struck through by this note
    // rather than deleted, because it documents what was actually checked and why the earlier
    // conclusion looked reasonable at the time): Task 4 read cline's ACP surface from the OUTSIDE
    // (black-box JSON-RPC probing) and correctly found `authenticate` hangs on real OAuth. This task
    // read the SOURCE — cline 3.0.47's own compiled binary (`npm install cline@3.0.47`, `strings`'d
    // `bin/.cline`, the same technique agents.ts's header already used) — and found the auth check
    // ITSELF has an unconditional escape hatch never involving `authenticate` at all:
    //
    //   async newSession(z){if(!this.authResult&&!process.env.CLINE_API_KEY){if(this.authResult=
    //   this.tryRestoreAuth(),!this.authResult)throw $.authRequired(void 0,"Call authenticate before
    //   creating a session")}let G=A(),J="act",Q=process.env.CLINE_PROVIDER??
    //   this.authResult?.providerId??"cline",Y=process.env.CLINE_MODEL??
    //   "anthropic/claude-sonnet-4.6";...}
    //
    // `process.env.CLINE_API_KEY` (any non-empty string) unconditionally skips the throw — no
    // `authenticate` call, no OAuth, no network of any kind. `CLINE_PROVIDER`/`CLINE_MODEL` are read
    // the SAME way, unchecked against cline's own OAuth-only provider allowlist (`var
    // B=[{id:"cline",...},{id:"openai-codex",...}]`, used elsewhere to validate `session/set_
    // config_option`'s `provider` case but NOT consulted here) — so a THIRD, non-OAuth provider id
    // (`"openai-compatible"`, the same one cline's own `auth` subcommand configures for its OTHER,
    // non-ACP CLI mode) can be substituted freely. `buildConfig()` (called once a turn actually
    // starts) reads the literal model-client apiKey the SAME way: `Y=process.env.CLINE_API_KEY??
    // this.authResult?.apiKey??""` — so the one bypass var does double duty as both the gate key AND
    // the credential handed to whatever provider client gets built.
    //
    // The remaining piece — the "openai-compatible" provider's baseUrl — is NOT itself an env var;
    // it is read from `$CLINE_DIR/data/settings/providers.json`, the same file cline's own `cline
    // auth -p openai-compatible -k <key> -b <url> -m <model>` subcommand persists (Task 4 already
    // found this subcommand VERIFIED LIVE to write to disk with zero network access — this task
    // reuses that fact but writes the file directly rather than shelling out, mirroring how the
    // `codex`/`openclaw` cases below already write their own config files straight into `workDir`).
    // Live-verified END TO END this task: a real cline 3.0.47 binary, driven through
    // `CHAT_BACKENDS.cline` (chatProviders/acp/driver.ts, completely unmodified) with exactly this
    // mapping, completed a full ACP turn — `session/new` succeeded with zero prior `authenticate`
    // call, `session/prompt` returned the mock fixture's exact "Hello!" text (a real model would
    // never reply with that verbatim), and the turn settled with `result.isError:false`. See
    // clineMocked.test.ts's "real E2E" block for the assertions.
    //
    // TWO HONEST LIMITS, so this row is not overclaimed:
    //   1. This does NOT make cline's real "cline"/"openai-codex" OAuth-backed providers reachable —
    //      those still require a genuine interactive sign-in and remain closed, exactly as Task 4
    //      found. This mapping routes around the gate entirely via a THIRD provider id the gate
    //      never actually validates — a design gap in cline's OWN auth check, not a way through it.
    //   2. FIXED 2026-08-01 — kept here because the earlier text was WRONG about the mechanism, and
    //      the correction is the whole reason the fix exists. cline's real `session/new` response
    //      carries BOTH the old `models.availableModels` shape AND a `configOptions` array whose
    //      FIRST category:"model" entry is a "provider" selector, with the actual per-model selector
    //      further down under the SAME category.
    //
    //      What the earlier version of this comment claimed: the two were "distinguishable by whether
    //      their options carry an `id`" — provider options `{value, name}`, model options `{id,
    //      name}`. **That is false.** Driving real `cline` 3.0.48, `goose` and `openclaw` against a
    //      local mock and capturing `session/new` verbatim showed BOTH cline selectors' options are
    //      `{value, name}`, as is every select option from every agent — `SessionConfigSelectOption`
    //      is `{value, name, description?}` in @agentclientprotocol/sdk 0.20.0/0.24.0/0.29.0/1.3.0
    //      alike, and there is no generation in which a select OPTION carries `id`. Full capture
    //      (cline 3.0.48 `session/new`, verbatim): the "provider" selector's
    //      `options:[{value:"cline",name:"Cline Usage-Billing"},{value:"openai-codex",name:"OpenAI
    //      ChatGPT Subscription"}]`; the "model" selector's `options:[{value:"gpt-4o",name:"gpt-4o"}]`
    //      — both `{value, name}`, neither carries `id`.
    //
    //      So the empty-picker bug was NEVER cline-specific. `detectModelShape` filtered options on
    //      `o.id`, a field nothing emits, so its `configOptions` branch had never returned a model
    //      from ANY real binary — goose (new-shape-only, no `models` field at all) was equally
    //      affected, and would have stayed broken by a cline-targeted fix. Two consequences, both
    //      confirmed live, both now fixed:
    //        a. The model list came back empty for every new-shape agent — and driver.ts's
    //           `if (s.modelShape.models.length) emit(...)` means NO `models` ChatFrame was emitted
    //           at all in that case, not an empty one. Fixed by reading `value` (with `id` kept only
    //           as a back-compat fallback). This is no longer true of any ACP backend.
    //        b. `modelConfigId` was set from the mis-picked "provider" selector's own `id` —
    //           poisoned, not just the list — so driver.ts's `setModel` would have written a model id
    //           into cline's PROVIDER option. Fixed by protocol.ts's `pickModelOption`, which ranks
    //           the several category:"model" candidates instead of taking the first; note that
    //           "first non-empty wins" is DISPROVEN by this very payload (it selects the provider,
    //           giving a populated-but-wrong picker, which is worse than the empty one).
    //      Still a genuine quirk of cline's OWN ACP implementation (its model and provider config
    //      options share one category, and `category` alone cannot separate them). Still NOT asserted
    //      on by clineMocked.test.ts either way — that block's job is the auth-gate/turn path, and
    //      the disambiguation is covered directly, from this captured payload, in
    //      acpProtocol.test.ts's `detectModelShape` block.
    // --------------------------------------------------------------------------------------
    case "cline": {
      if (!workDir) {
        throw new Error(
          'backendMockEnv: "cline" requires a third `workDir` argument — its real mock mechanism is a ' +
            "$CLINE_DIR/data/settings/providers.json file, not a bare env var alone (see this file's `cline` " +
            "case comment for the full, live-verified finding). Pass a throwaway temp directory this call may " +
            "write into; the caller must also set CLINE_DIR to this same directory (this function does not set " +
            "process.env itself, matching every other case here).",
        );
      }
      const settingsDir = join(workDir, "data", "settings");
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, "providers.json"),
        JSON.stringify(
          {
            version: 1,
            lastUsedProvider: "openai-compatible",
            providers: {
              "openai-compatible": {
                settings: { provider: "openai-compatible", apiKey: "mock", model: "mock-model", baseUrl: `${mockUrl}/v1` },
                updatedAt: new Date().toISOString(),
                tokenSource: "manual",
              },
            },
          },
          null,
          2,
        ),
      );
      return {
        CLINE_DIR: workDir,
        CLINE_PROVIDER: "openai-compatible",
        CLINE_API_KEY: "mock",
        CLINE_MODEL: "mock-model",
      };
    }

    // --------------------------------------------------------------------------------------
    // VERIFIED live end-to-end (Task 4, upgraded from GUESSED) — the original source-reading
    // (goose's Rust source: env vars checked before the YAML config/OS keyring) held up completely
    // under a real run. `goose acp`, driven through BOTH a raw ACP JSON-RPC handshake and
    // Bismuth's own CHAT_BACKENDS.goose.sendMessage (chatProviders/acp/driver.ts, unmodified),
    // produced a full turn: `session/new` succeeds immediately (one `GET /v1/models` hit on the
    // mock), `session/prompt` streams a real `agent_message_chunk` with the mock fixture's exact
    // "Hello!" text (two `POST /v1/messages` hits on the mock, both 200/fixture-matched), and
    // settles with `stopReason:"end_turn"` — through the driver, this landed as a clean
    // `assistant-text` frame followed by `result:{isError:false}` then `done`. Zero real network
    // access, confirmed via the mock's own /metrics (only the two paths above, never a real
    // anthropic.com hit).
    //
    // NOT part of this mapping (a local-STATE-isolation concern, not a MOCK-pointing one, so kept
    // out of this function's return value): goose persists local config/session state under
    // `$XDG_CONFIG_HOME`/`$XDG_DATA_HOME`/`$XDG_STATE_HOME` (confirmed live via `goose info`'s own
    // path listing) — a caller that cares about never touching a developer's real
    // `~/.config/goose` should set those three, independently of this mapping (gooseMocked.test.ts
    // does exactly that).
    // --------------------------------------------------------------------------------------
    case "goose":
      return {
        ANTHROPIC_HOST: mockUrl,
        ANTHROPIC_API_KEY: "mock",
        GOOSE_PROVIDER: "anthropic",
        GOOSE_MODEL: "claude-haiku-4-5",
      };

    // --------------------------------------------------------------------------------------
    // VERIFIED live end-to-end (offline-testing openclaw task, upgraded from the prior task's
    // "config mechanism only" PARTIALLY VERIFIED row). The prior row's boundary — config redirection
    // confirmed, model routing never executed — is now fully closed:
    //   - The config SHAPE below is not guessed: every field is read directly from the installed
    //     package's OWN TypeScript declarations (`~/`openclaw`'s
    //     `dist/plugin-sdk/src/config/types.models.d.ts`'s `ModelProviderConfig`/`ModelApi` —
    //     `MODEL_APIS` literally includes `"openai-completions"` — and `types.agent-defaults.d.ts`'s
    //     `AgentModelListConfig`), cross-checked against `openclaw config validate` accepting the
    //     file live and `docs/gateway/local-models.md`'s own worked examples (same
    //     `models.providers.<id>.{baseUrl,apiKey,api,models}` / `agents.defaults.model.primary`
    //     shape, there pointed at LM Studio/vLLM instead of this mock).
    //   - `openclaw acp` ("Run an ACP bridge backed by the Gateway") does NOT auto-start a Gateway —
    //     confirmed by reading `dist/acp-cli-BQ740PFm.js`'s `serveAcpGateway`: it only ever CONNECTS
    //     (as a WebSocket client) to `gateway.remote.url`/`OPENCLAW_GATEWAY_URL`/a local-loopback
    //     default, and fails if nothing answers. core/test/support/openclawGateway.ts stands up a
    //     REAL `openclaw gateway run` process (a genuine, if heavier, second child process — this
    //     backend's own architecture, not a workaround) pointed at the SAME config this function
    //     writes, so both processes agree on the port.
    //   - A full turn was confirmed live through BOTH a raw ACP JSON-RPC handshake AND
    //     `CHAT_BACKENDS.openclaw.sendMessage` (chatProviders/acp/driver.ts, unmodified): `initialize`
    //     -> `session/new` -> `session/prompt` streamed a real `agent_message_chunk` carrying the mock
    //     fixture's exact "Hello!" text, settling with `stopReason:"end_turn"` — through the driver, a
    //     clean `assistant-text` frame then `result:{isError:false}` then `done`. The mock's own
    //     `/metrics` (path-specific `POST /v1/chat/completions` counter, not merely the metrics
    //     family's presence — see geminiMocked.test.ts's own finding on why that distinction matters)
    //     confirmed exactly one hit, never a real provider host.
    //   - REQUIRED, non-obvious config beyond model routing, each confirmed live and needed for the
    //     turn to complete AT ALL (not cosmetic): `gateway.mode:"local"` + an explicit `gateway.port`
    //     (both processes must agree — openclaw rejects `--port 0`, "Too small: expected number to be
    //     >0", so the caller picks a free port itself, see openclawGateway.ts's getFreePort);
    //     `gateway.auth.mode:"none"` (skips token/password setup for an isolated test loopback);
    //     `agents.defaults.workspace` + `agents.defaults.skipBootstrap:true` (the embedded agent
    //     runtime requires a workspace dir at all per `docs/concepts/agent.md`, "OpenClaw uses a
    //     single agent workspace directory... as the agent's ONLY working directory"; skipBootstrap
    //     avoids BOOTSTRAP.md/AGENTS.md template seeding a throwaway test workspace doesn't need);
    //     `canvasHost.enabled:false` + `browser.enabled:false` (both auto-start their own
    //     HTTP/CDP listeners on gateway boot otherwise — confirmed live via a second/third port
    //     appearing in the startup log with neither set — pure test hygiene, no bearing on model
    //     routing); `update.checkOnStart:false` (a bare config makes gateway startup perform a real
    //     OUTBOUND update-check HTTP request — confirmed live, "[gateway] update available (latest):
    //     v2026.7.1-2..." — not an account call, but still real unwanted egress this suppresses).
    //   - THE ONE GENUINE BUG FOUND ALONG THE WAY, now fixed at its actual source
    //     (chatProviders/acp/agents.ts's openclaw entry, not here): `openclaw acp` with NO
    //     `--session` — i.e. Bismuth's OLD default spawn args — reliably fails the FIRST
    //     `session/prompt` on any fresh Gateway with `ACP_SESSION_INIT_FAILED`, because the bridge's
    //     own default session-key naming (`acp:<uuid>`) collides with an unrelated OpenClaw feature
    //     that reserves that exact prefix. See agents.ts's openclaw entry for the full root-cause
    //     writeup and citations — irrelevant to this file's OWN job (env/config mapping), but
    //     necessary context for why this row could not reach VERIFIED without that fix landing too.
    // --------------------------------------------------------------------------------------
    case "openclaw": {
      if (!workDir) {
        throw new Error(
          'backendMockEnv: "openclaw" requires a third `workDir` argument — it needs a config file, not just env ' +
            "vars (see this file's `openclaw` case comment). Pass a throwaway temp directory this call may write into.",
        );
      }
      if (!openclawGatewayPort) {
        throw new Error(
          'backendMockEnv: "openclaw" requires a fourth `openclawGatewayPort` argument — the ACP bridge and a ' +
            "separately-run `openclaw gateway run` (core/test/support/openclawGateway.ts) must agree on a port via " +
            "this written config (see this file's `openclaw` case comment). Pass a free port, e.g. from " +
            "openclawGateway.ts's getFreePort().",
        );
      }
      const stateDir = join(workDir, "state");
      const workspaceDir = join(workDir, "workspace");
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(workspaceDir, { recursive: true });
      writeFileSync(
        join(workDir, "openclaw.json5"),
        JSON.stringify(
          {
            gateway: { mode: "local", port: openclawGatewayPort, bind: "loopback", auth: { mode: "none" } },
            canvasHost: { enabled: false },
            browser: { enabled: false },
            update: { checkOnStart: false, auto: { enabled: false } },
            logging: { file: join(stateDir, "openclaw.log"), level: "info", consoleLevel: "info" },
            agents: {
              defaults: {
                workspace: workspaceDir,
                skipBootstrap: true,
                model: { primary: "mock/mock" },
                models: { "mock/mock": { alias: "Mock" } },
              },
            },
            models: {
              mode: "merge",
              providers: {
                mock: {
                  baseUrl: `${mockUrl}/v1`,
                  apiKey: "mock",
                  api: "openai-completions",
                  models: [{ id: "mock", name: "Mock", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 }],
                },
              },
            },
          },
          null,
          2,
        ),
      );
      return { OPENCLAW_CONFIG_PATH: join(workDir, "openclaw.json5"), OPENCLAW_STATE_DIR: stateDir };
    }

    default:
      throw new Error(`backendMockEnv: no mock-env mapping for backend id "${backendId}"`);
  }
}
