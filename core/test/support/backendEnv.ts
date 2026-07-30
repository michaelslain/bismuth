// core/test/support/backendEnv.ts
// Per-backend env-var mapping that points a real agent CLI at a local mock LLM server
// (core/test/support/mockLlm.ts) instead of a real provider API — the other half of the
// zero-real-API-calls test harness Tasks 3/4 build integration tests on top of.
//
// HONESTY, per the task brief: only the `claude` row below was verified LIVE, end-to-end, on a
// real machine (`ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=mock ANTHROPIC_API_KEY=mock claude -p
// "hello" --model claude-haiku-4-5` returned the mock fixture's text). Every other row is GUESSED:
// researched against that CLI's own documentation/source (never this codebase's speculation),
// but NEVER run against a real installed binary + the mock server, because two miscitations were
// already caught in this repo's recent work and presenting an unverified mapping as fact is the
// exact failure mode that produces a THIRD. Each case below says which it is and cites what the
// guess rests on. Do not upgrade a "guessed" comment to "verified" without actually running that
// CLI live against startMockLlm() and recording the result, the same way the claude row was
// earned.
//
// A backend not in the switch throws rather than silently returning `{}` — a caller asking this
// module to mock a backend it doesn't know about is a bug in the CALLER (a typo'd backend id, or
// a new backend added to core/src/agentBackends/catalog.ts that this file hasn't caught up to
// yet), not a "just don't mock anything" situation; the whole point of this harness is that a
// misconfigured mock must fail loud, never silently fall through to a real API.
export function backendMockEnv(backendId: string, mockUrl: string): Record<string, string> {
  switch (backendId) {
    // --------------------------------------------------------------------------------------
    // VERIFIED live on this machine (see this file's header): env auth takes precedence over
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
    // GUESSED. Not run live (codex isn't installed on the machine this was researched on).
    // Backed by two independent sources, not just one CLI's marketing docs:
    //   - developers.openai.com/codex's own "Advanced Configuration" page: the SUPPORTED way to
    //     permanently redirect the built-in `openai` provider is `openai_base_url` in
    //     ~/.codex/config.toml — a real `[model_providers.<id>]` block can NOT override the
    //     built-in "openai" provider id (the docs explicitly warn "you can't override built-in
    //     provider IDs").
    //   - A Codex maintainer (etraut-openai) on openai/codex#11698 confirmed directly: "you can
    //     use the OPENAI_BASE_URL environment variable if the URL is the only parameter you want
    //     to override" — i.e. the env var IS a real, maintainer-confirmed escape hatch, distinct
    //     from (and simpler than) the config.toml route.
    // Caveat found in the same docs: an explicit `--profile` or `model_provider` setting in a
    // config file takes precedence OVER this env var — irrelevant for a fresh/no-config test
    // environment, but would silently defeat this mapping on a machine with prior codex config.
    // --------------------------------------------------------------------------------------
    case "codex":
      return {
        OPENAI_BASE_URL: mockUrl,
        OPENAI_API_KEY: "mock",
      };

    // --------------------------------------------------------------------------------------
    // GUESSED. Not run live. opencode.ai's own /docs/config/ page documents OPENCODE_CONFIG_CONTENT
    // as a real env var carrying an entire INLINE JSON config at the HIGHEST precedence tier
    // ("Runtime Config" — above the project/global config files, no file needed at all), and
    // opencode.ai's own /docs/providers/ page documents the custom-provider shape needed to point
    // an OpenAI-compatible endpoint at a custom baseURL (`@ai-sdk/openai-compatible` +
    // `options.baseURL`). This mapping composes those two documented, independently-confirmed
    // mechanisms; the COMPOSITION itself (does opencode's model-selection actually accept
    // "mock/mock" for a provider registered this way) was never exercised against a real binary.
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
    // GUESSED, but the strongest-confidence guess in this file: read directly out of
    // google-gemini/gemini-cli's CURRENT source (via `gh api`, not a blog post) rather than
    // inferred from search results, which turned up several stale/abandoned env var names
    // (GEMINI_BASEURL, GEMINI_API_BASE_URL) from old PRs that never shipped. The name actually
    // live in packages/core/src/core/contentGenerator.ts AND documented in
    // docs/reference/configuration.md is GOOGLE_GEMINI_BASE_URL. Notably it is ALSO read in
    // packages/cli/src/acp/acpSessionManager.ts — the ACP session path, which is the actual mode
    // Bismuth drives gemini in (`gemini --experimental-acp`, see agentBackends/catalog.ts's GEMINI
    // descriptor) — so this isn't just confirmed for the plain-CLI path Bismuth doesn't use.
    // Still never run live: gemini isn't installed on the research machine.
    // Documented caveats worth preserving:
    //   - the URL must be HTTPS unless it targets localhost/127.0.0.1/[::1] (our mock always
    //     binds 127.0.0.1, so this is satisfied) — a stray non-loopback mock URL would be
    //     rejected outright rather than silently ignored, which matches this harness's own
    //     "fail loud, never silently hit a real API" property.
    //   - a persisted `security.auth.selectedType` in the user's own gemini settings is checked
    //     BEFORE this env var in acpSessionManager.ts — a machine with a prior real gemini login
    //     could silently defeat this mapping; out of scope for this task (Task 3/4's problem if
    //     it bites).
    // --------------------------------------------------------------------------------------
    case "gemini":
      return {
        GOOGLE_GEMINI_BASE_URL: mockUrl,
        GEMINI_API_KEY: "mock",
      };

    // --------------------------------------------------------------------------------------
    // GUESSED, and the WEAKEST-confidence row here — flagged explicitly rather than dressed up to
    // look as solid as the others. Cline's own documented mechanism for a custom base URL is the
    // `cline auth -p <provider> -k <key> -b <baseUrl> -m <model>` CLI SUBCOMMAND, which persists
    // to a config file under CLINE_DIR — NOT a plain environment variable read per-invocation.
    // No authoritative source (official docs, or cline/cline's own source — a GitHub code search
    // for ANTHROPIC_BASE_URL/OPENAI_BASE_URL in that repo came back empty) confirms these two
    // names are read directly from the environment at all. They are included anyway (mirroring
    // the "OpenAI Compatible" provider type cline's own GUI names for exactly this use case) so
    // this function has SOMETHING to return for every backend in core/src/agentBackends/
    // catalog.ts's BACKEND_IDS, but Task 3/4 should expect this row to need `cline auth -b
    // <mockUrl>` as setup instead of (or in addition to) these env vars, and should upgrade this
    // comment with a real finding the moment that's tried live.
    // --------------------------------------------------------------------------------------
    case "cline":
      return {
        OPENAI_BASE_URL: mockUrl,
        OPENAI_API_KEY: "mock",
      };

    // --------------------------------------------------------------------------------------
    // GUESSED, but source-verified: read directly from block/goose's (now aaif-goose/goose's)
    // current Rust source, not inferred.
    //   - crates/goose/src/config/base.rs: BOTH Config::get_param and Config::get_secret check
    //     `env::var(key.to_uppercase())` FIRST, before the YAML config file or OS keyring — so
    //     ANTHROPIC_HOST/ANTHROPIC_API_KEY genuinely are plain per-process env var overrides, not
    //     merely config-file keys that happen to share a name.
    //   - crates/goose/src/providers/formats/anthropic.rs: confirms the provider id string goose
    //     registers this under is literally "anthropic" (ANTHROPIC_PROVIDER_NAME).
    //   - documentation/docs/guides/config-files.md, goose's own official docs: "GOOSE_PROVIDER
    //     and GOOSE_MODEL are still supported as environment variables and override the config
    //     file for that process" — the mechanism that makes goose actually pick the anthropic
    //     provider above rather than whatever a prior `goose configure` run persisted.
    // GOOSE_MODEL's value is a placeholder Task 3/4 may want to override — goose doesn't validate
    // it against a known-model list before use, but was never run live to confirm that.
    // --------------------------------------------------------------------------------------
    case "goose":
      return {
        ANTHROPIC_HOST: mockUrl,
        ANTHROPIC_API_KEY: "mock",
        GOOSE_PROVIDER: "anthropic",
        GOOSE_MODEL: "claude-haiku-4-5",
      };

    default:
      throw new Error(`backendMockEnv: no mock-env mapping for backend id "${backendId}"`);
  }
}
