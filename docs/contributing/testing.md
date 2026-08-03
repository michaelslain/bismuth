# Testing

This document is the canonical reference for how tests work in Bismuth, covering the test runner, file conventions, the full suite across `core/` and `app/`, how to run and filter tests, how to add new tests, the `bun run typecheck` TypeScript gate, and a tour of every key test file and the patterns they establish.

---

## Test runner

Bismuth uses **Bun's built-in test runner** (`bun:test`) for all tests — both backend (`core/`) and frontend (`app/`). There is no Jest, Vitest, or Mocha. Tests use the `bun:test` import:

```ts
import { test, expect, describe, it, beforeEach, afterEach } from "bun:test";
```

The full suite (~2031 tests across the `core/` and `app/` workspaces) runs in roughly 80-90 seconds on a modern laptop with every mocked-CLI binary installed and reachable. (This is an ~8x increase from an earlier ~930-tests/~10s figure this file used to quote — mostly the offline-testing branch's own mocked agent-CLI integration tests below, several of which spawn a REAL CLI subprocess and wait for a real turn to complete rather than exercising pure in-process logic, which costs real wall-clock seconds per test even though it costs zero API calls/dollars. A machine missing some of those CLI binaries runs fewer tests, faster, via the missing-binary skip described below.)

---

## The commit gate (tests are required to commit)

Tests run automatically on every commit and every push. Both hooks live in `.githooks/`, which is
already this repo's `core.hooksPath`; a fresh clone enables them with:

```bash
bun run hooks:install     # git config core.hooksPath .githooks
```

| | hook | what runs | typical cost |
|---|---|---|---|
| **commit** | `.githooks/pre-commit` → `scripts/gate.ts` | typecheck (all workspaces) + **fast** tests for the workspaces your staged files touch | ~30s (one workspace), ~60s (all) |
| **push** | `.githooks/pre-push` | docs link check + the **full** suite, slow suites included | ~3min |

The split exists so the gate is one people don't route around. Two things narrow the commit gate:

1. **Slow suites are skipped** via `BISMUTH_FAST_TESTS=1` (see `core/test/slowGate.ts`) — the
   suites that spawn real agent binaries, PTYs or websockets, plus the layout benchmark. That is
   ~130s of the runtime for the parts least likely to break on an ordinary edit. **Pre-push runs
   them.** With the variable unset — plain `bun test`, and CI — everything runs, so nobody can
   lose a suite by forgetting a flag.
2. **Only affected workspaces are tested**, derived from staged paths (`affectedWorkspaces` in
   `scripts/gate.ts`, unit-tested in `scripts/gate.test.ts`). Editing `app/` does not re-run
   `daemon/`. Touching a shared root file (`package.json`, `bun.lock`, `tsconfig.base.json`,
   `bunfig.toml`, `scripts/`, `.githooks/`) widens it to everything, since those can affect
   everything. Docs-only commits skip tests entirely.

Typecheck always runs across **all** workspaces regardless of what you staged — it is ~12s and is
the only thing that catches a change in one workspace breaking another's types.

Bypassing, when you genuinely mean it (a WIP commit on a branch — not how you land on `main`):

```bash
BISMUTH_SKIP_GATE=1 git commit …    # skip just the gate
git commit --no-verify              # skip all hooks
BISMUTH_SKIP_GATE=1 git push        # skip pre-push's test run (docs check still runs)
```

Run the gate by hand any time with `bun run gate`, or the fast suite alone with `bun run test:fast`.

### Quarantined suites

One suite is **quarantined** — opted out of both gates via `shouldRunQuarantinedTests`
(`core/test/slowGate.ts`), run with `BISMUTH_RUN_QUARANTINED=1`:

- `core/test/chatProviders/opencodeMocked.test.ts` — fails ~1 run in 3, independent of machine
  load, because opencode server mode registers its per-session SSE listener but does not confirm it
  is live before issuing `session.prompt()`; a fast turn completes before the listener catches its
  deltas and no `assistant-text` frames arrive.

This is a **real user-facing bug** (an opencode chat can silently lose its streamed reply), not a
bad test, and it is unfixed — the fix belongs in `runTurnServer` (`core/src/chatProviders/opencode.ts`),
replacing the mock-side `--latency` margin with an actual synchronization point.

Quarantine is a deliberate trade, and the bar for it is high: since pre-push *blocks* on the full
suite, a test failing a third of the time does not keep anyone honest — it teaches the team to
reach for `--no-verify`, which disables the gate for everything else too. The cost is that this
area is unguarded until the bug is fixed. Add to the quarantine list only when the mechanism is
understood, written down, and tracked.

## Upgrade tests: what happens to an existing user's data on update

`core/test/upgrade/` is the suite that answers "if a user updates Bismuth, do they lose anything?"
Everything else in the repo tests a vault *this* era's code just created; these start from state an
**older** Bismuth wrote. Run them alone with `bun run test:upgrade`.

**`settingsUpgrade.test.ts`** drives the real open-path (`reconcileSettings` →
`migrateSettingsLocation`) from each of the three historical settings layouts — vault-root
`settings.yaml`, the interim `.settings/settings.yaml` directory, and today's `.settings` file —
and pins the invariants that matter across a version jump:

- the user's still-valid values survive, and their hand-written comments survive;
- keys the current schema no longer knows are **preserved, never dropped** (they may belong to a
  newer build, or a feature that is coming back) — silent data loss is the one unforgivable
  upgrade outcome;
- keys added to the schema since that version are seeded with their defaults, so nothing reads
  `undefined`;
- retired themes and fonts migrate to current-era values;
- reconcile is idempotent, and a corrupt or hostile file is left alone for the user to repair
  rather than silently replaced with defaults.

**`schemaSnapshot.test.ts`** is the tripwire for silent behavior changes. A setting's `default` is
what every user who never touched that key is running, so changing one changes behavior for the
entire installed base on upgrade — invisibly, since nothing in their vault changed. The test pins
every schema path, type, default, bound and enum member to a committed snapshot
(`core/test/fixtures/upgrade/settings-schema-snapshot.json`). It does not forbid changes; it forces
them to be deliberate and reviewable. After an intentional schema change:

```bash
bun run test:bless-schema     # regenerates the snapshot; commit the diff with your change
```

This is a real failure mode, not a hypothetical: `appearance.editorFontSize` once moved 11.5 → 13.5
and the only symptom was unrelated tests failing later.

## Running tests

### Run all tests (recommended baseline)

From the repo root:

```bash
bun test core
```

This discovers nearly every `*.test.ts` file in the repo. Not because `core` names a "workspace" —
Bun has no such concept for `bun test`'s own argument — but because `core` is a plain substring
match against every file's relative path (see "Filter by filename pattern" below for the full
mechanism), and it happens to match every file under `core/test/` (the path prefix) plus one
`app/src/` file whose own name contains it (`app/src/icons/registry-core.test.ts`) — 139 files
total, confirmed by exact count. Output (counts are illustrative and grow per commit — expect a
green `0 fail`):

```
bun test v1.3.9 (cf6cdbbb)

 930 pass
 0 fail
 2600 expect() calls
Ran 930 tests across 80+ files. [10.24s]
```

### `bun test core` vs `bun test app`

```bash
bun test core   # matches nearly the whole suite — see the substring-match mechanism above
bun test app    # the mirror image, from the other direction
```

These are NOT identical sets, and neither is scoped to a "workspace": `bun test core` matches
every file under `core/test/` plus one `app/src/` coincidental match (as above) — 139 files.
`bun test app` matches every file under `app/src/` plus one `core/test/` file that matches "app" by
coincidence (`core/test/agentBackends/sandboxWrapper.test.ts`, matching inside
"sandboxWr**app**er") — 192 files. `bun test core` is the conventional way to run "the full suite"
only because `core/` happens to hold vastly more test files today, not because it is scoped to
anything.

### Run a single file directly

Pass the file path as the argument:

```bash
bun test core/test/vault.test.ts
bun test app/src/panes.test.ts
```

### Filter by filename pattern

**`bun test core -- <pattern>` does NOT filter — it silently runs the entire suite.** Bun's own
positional arguments are OR'd substring matches against the relative file path (`bun test foo bar`
runs every file matching `foo` OR `bar`), and `core` is itself one of those arguments here. Since
every file under `core/test/` (plus the one `app/src/` coincidental match above) already has `core`
as a substring of its own path, keeping `core` in the pattern list matches the same full set no
matter what you append after it — confirmed live: `bun test core -- wikilinks` still ran all 139
files. This has already cost one agent a full-suite run it believed was scoped to one file.

To actually filter, drop the `core`/`app` argument and pass either an exact path or a bare pattern:

```bash
bun test core/test/vault.test.ts   # exact path — the only unambiguous way to run ONE file
bun test vault                     # a pattern with NO "core"/"app" argument alongside it —
                                    # matches core/test/vault.test.ts
bun test daemonViz                 # matches core/test/daemonViz.test.ts
bun test bases/query                # matches core/test/bases/query.test.ts
bun test flashcards                 # matches every flashcard-related test file
```

The pattern is a substring match against the relative file path (not the test name). Use the filename stem to isolate a single file, or a directory prefix to scope a subdirectory — just never combine it with a bare `core`/`app` argument, which defeats the filter. Verified live: `bun test bases/query` alone runs 1 file; `bun test core -- bases/query` still runs all 139.

### Watch mode

```bash
bun test core --watch
```

Reruns affected tests on file save. Useful when writing new tests interactively.

---

## TypeScript type-check gate

**Neither the test runner nor the build/test gate runs `tsc`.** `bun test` only executes test files; `bun run build:app` bundles without type-checking. Type errors are a *separate* gate you must run explicitly to catch type regressions — they will not show up in a green test run or a successful build.

The canonical command is the root `typecheck` script:

```bash
bun run typecheck
```

From `package.json` this expands to a `tsc --noEmit` pass per workspace, each run from its own directory:

```json
"typecheck": "(cd core && bunx tsc --noEmit) && (cd app && bunx tsc --noEmit) && (cd mcp && bunx tsc --noEmit) && (cd relay && bunx tsc --noEmit)"
```

Four workspaces are checked in order — `core`, `app`, `mcp`, `relay` — and the `&&` chain stops at the first failure. Each step `cd`s into the workspace so `bunx tsc` picks up that workspace's own `tsconfig.json` and its own pinned TypeScript (`app/package.json` and `relay/package.json` pin `typescript: ~5.6.2`), so a compiler version in one workspace never bleeds into another. (`cli` imports `@bismuth/core` and rides along via the `core`/`app` passes; it has no separate step.)

All four `tsconfig.json` files now carry the same strict lint flags — `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`, and `"noFallthroughCasesInSwitch": true`. In particular `core/tsconfig.json` was brought up to match the others (it previously lacked the three `noUnused*`/`noFallthrough*` flags), so an unused local or a missing `break` now fails the gate in `core/` just as it does in `app/`, `mcp/`, and `relay/`.

The `app` pass is the broadest: because `app/` imports core source directly (`../../core/src/*.ts`), `app/tsconfig.json` sets `"types": ["bun", "node"]` and the app program type-checks `core/src/` too. Test files (`*.test.ts`) are excluded from the app pass via `"exclude": ["src/**/*.test.ts"]` so test-only stubs do not pollute the production types.

To type-check a single workspace, run its step directly:

```bash
(cd core && bunx tsc --noEmit)     # core only
(cd app && bunx tsc --noEmit)      # app + core/src
(cd mcp && bunx tsc --noEmit)      # mcp only
(cd relay && bunx tsc --noEmit)    # relay plugin hooks
```

Every workspace `tsconfig.json` uses `"noEmit": true` — these passes only check, never compile.

---

## Offline agent-CLI integration tests (mock LLM, zero account API calls)

**The rule: `bun test core` never makes a real API call against anyone's account, full stop.** This
applies to two distinct kinds of test that could otherwise spend real money or consume real quota:

1. **Live model tests** (`core/test/chat.test.ts`'s `describe.skip`-by-default live block, and any
   test file gated the same way) drive Bismuth's own Claude Code integration against the REAL
   Anthropic API, using the developer's own logged-in account. These are opt-in via the
   `BISMUTH_LIVE_TESTS=1` environment variable (see `core/test/liveGate.ts`) and skip by default —
   running them costs real money/quota, so they must never run in CI or a default `bun test`.
2. **Mocked agent-CLI integration tests** (`core/test/chatProviders/*Mocked.test.ts`,
   `core/test/chatProviders/acpFakeAgent.test.ts`, `core/test/chatProviders/clineAuthFakeAgent.test.ts`)
   run by default in `bun test core` (no opt-in needed) precisely because they spend nothing, and skip
   when the relevant CLI **binary** isn't installed (a portability/CI concern), never when an
   **account** isn't logged in — a missing-binary skip and a missing-account skip must never be
   conflated (see each test file's own header for why). They are NOT all the same shape, and the
   difference matters (corrected here after an earlier version of this paragraph overstated it: this
   item covers TEN files total — the seven `*Mocked.test.ts` files plus three fake-agent files,
   `acpFakeAgent.test.ts`, `clineAuthFakeAgent.test.ts` and `acpPermissionFakeAgent.test.ts`, none of
   which is a real CLI. The
   `cline` and `openclaw` gaps this paragraph used to flag were both closed, in independent tasks that
   landed around the same time — all seven `*Mocked.test.ts` files now drive a real CLI through at
   least a partially mocked path):
   - `claudeMocked`/`opencodeMocked`/`codexMocked`/`gooseMocked`/`geminiMocked`/`clineMocked`/
     `openclawMocked.test.ts` drive a REAL agent CLI binary (`claude`/`opencode`/`codex`/`goose`/
     `gemini`/`cline`/`openclaw`) through Bismuth's OWN production chat driver, pointed at a **local
     mock LLM server** instead of the real provider API — see the verification table below for exactly
     how far each one is confirmed (all seven are now full turn E2E). `clineMocked.test.ts` is two
     describe blocks, not one: an original one proving the DEFAULT (no-bypass-configured) path fails
     safely against an isolated, never-authenticated `CLINE_DIR`, plus a later "real E2E" block proving
     a full turn completes once a real, source-cited env-var bypass (`CLINE_API_KEY`) is applied — see
     the table's `cline` row. `openclawMocked.test.ts` is the heaviest of the seven: `openclaw acp` is
     a thin bridge to a separate Gateway process, so this test also spawns a REAL
     `openclaw gateway run` process (`core/test/support/openclawGateway.ts`) pointed at the mock, torn
     down in `afterEach` with an owned-pid leak check.
   - `acpFakeAgent.test.ts` drives a **fake ACP agent** (`core/test/support/fakeAcpAgent.ts`, a
     hand-rolled stub speaking the wire protocol), not a real CLI at all — see "The fake ACP agent"
     below for why a fake is the only way to cover the version-skew branch it exists for.
   - `clineAuthFakeAgent.test.ts` drives the SAME fake ACP agent, in a mode that reproduces cline's
     real ACP auth gate (cited from cline's own compiled source — see `fakeAcpAgent.ts`'s header) —
     needs no `cline` binary at all, so unlike `clineMocked.test.ts`'s real-E2E block it never skips.
     Proves Bismuth's driver both surfaces the auth-required refusal cleanly AND completes a full turn
     once the fake's gate is satisfied — coverage that did not exist anywhere in this repo before.
   - `acpPermissionFakeAgent.test.ts` drives the SAME fake ACP agent in its held-prompt mode
     (`FAKE_ACP_PROMPT_HOLD=permission`) to cover the `session/request_permission` ROUND TRIP — the
     one path where Bismuth writes bytes back INTO an agent rather than translating one-way, and the
     one whose failure mode is a turn that never completes. Also needs no CLI at all.

### The mock LLM server

`core/test/support/mockLlm.ts`'s `startMockLlm()` spawns a real local HTTP server — the `llmock`
binary from the `@copilotkit/aimock` devDependency — that answers Anthropic-, OpenAI-, and
Gemini-shaped chat-completion requests from one small JSON fixture
(`core/test/fixtures/llm/basic-turn.json`): a request whose last user message contains `"hello"`
gets back the literal text `"Hello!"`. Every mocked test points its CLI's outbound base-URL env
var(s) at this server (see `core/test/support/backendEnv.ts`'s per-backend mapping) instead of the
real provider host, then asserts the fixture's exact text arrived — text no real model would ever
reply with verbatim, which is what proves the mock (not a real API) served the turn.

`startMockLlm()` **always** resolves the exact installed `@copilotkit/aimock` binary via
`Bun.resolveSync`, anchored at its own module's directory — **never** `bunx llmock` / `npx llmock`.
An unrelated npm package also happens to be named `llmock`; a bare-name lookup can silently resolve
to it instead, with a different banner and different behavior and no error at all. If you're adding
a new mocked test, always go through `startMockLlm()` — never spawn `llmock`/`aimock` yourself.

### Per-backend verification status

Not every backend's mapping in `backendEnv.ts` is verified to the same depth — the file's own
per-case comments are the source of truth, and are updated every time a row is actually run live
(never upgraded from a guess to "verified" without doing so). As of this writing:

| Backend | Status | Notes |
|---|---|---|
| `claude` | **Verified**, full turn E2E | `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` |
| `opencode` | **Verified**, full turn E2E | Needs an explicit `setModel("mock/mock")` after session-open (a real driver quirk — server mode doesn't consult the config's default model on a session's first turn) and a small mock `--latency` (a zero-latency reply can race past opencode's own event-stream subscription) |
| `goose` | **Verified**, full turn E2E | `ANTHROPIC_HOST`/`GOOSE_PROVIDER=anthropic`, driven via `goose acp` |
| `codex` | **Verified**, full turn E2E | Needs a `$CODEX_HOME/config.toml` (a custom `model_providers.*` block, `wire_api = "responses"`) — plain `OPENAI_BASE_URL` does **not** work for this codex version, confirmed live (see `backendEnv.ts`). Known cosmetic quirk: codex logs a benign "Model metadata not found" item for any model under a non-built-in provider, which the driver's own translator (correctly, per its own contract) surfaces as `result.isError === true` even though the assistant's text arrives correctly — `codexMocked.test.ts` asserts on the text, not on `isError`, and documents this inline |
| `gemini` | **Verified**, full turn E2E | `GOOGLE_GEMINI_BASE_URL`/`GEMINI_API_KEY`, driven via `gemini --experimental-acp`. A real turn makes TWO model calls, not one: this gemini-cli's default model resolves to a Gemini-3-family model via its `"auto"` alias, which routes it through `NumericalClassifierStrategy` (a "rate this request's complexity 1-100" call with a strict `{complexity_reasoning, complexity_score}` JSON schema) BEFORE the user-facing turn — against the single generic text fixture used elsewhere, that call's response never parsed as JSON, so it silently burned all 5 retry attempts (~65-90s of exponential backoff, confirmed live: 90440ms end to end) before falling through, which is what looked like a permanent stall (it was a real ~90s completion, past the 30s test timeout, not a true hang). `checkNextSpeaker` was a separate early suspect but is confirmed unreachable: gemini-cli forces `skipNextSpeakerCheck: true` whenever ACP mode is active, which is the only mode Bismuth's driver uses. Fixed with one extra JSON-shaped fixture in `core/test/fixtures/llm-gemini/basic-turn.json` (kept separate from the shared fixture dir so no other backend's test is affected) — turn now settles in ~53ms. See `backendEnv.ts`'s `gemini` case and `geminiMocked.test.ts`'s header for the full root-cause and fix |
| `cline` | **Verified, full turn E2E** (via a discovered bypass — corrected from an earlier "not mockable" finding) | ACP mode (`cline --acp`) gates `session/new` behind `-32000 "Authentication required"` UNLESS `process.env.CLINE_API_KEY` is set — a real, unconditional escape hatch found by reading cline 3.0.47's own compiled source (never `authenticate`, never OAuth; see `backendEnv.ts`'s `cline` case for the exact source citation). Combined with `CLINE_PROVIDER=openai-compatible` (a non-OAuth provider id the auth check never validates) and a hand-written `$CLINE_DIR/data/settings/providers.json` pointing its `baseUrl` at the mock, a real cline binary completes a full turn — `clineMocked.test.ts`'s newer "real E2E" block. The ORIGINAL default-path (no bypass configured) safe-failure test is unchanged and still passes: it proves the OTHER, honest fact that with no bypass applied, `session/new` still fails safely. One honest limit remains: the real "cline"/"openai-codex" OAuth providers are still genuinely closed (this routes around the gate via a third provider id, not through OAuth). A SECOND limit listed here until 2026-08-01 — that cline's `configOptions` mis-orders a "provider" selector ahead of the true "model" selector under the same category, so `detectModelShape` picks the wrong one — **was real but is now FIXED**, and the mechanism this table used to publish for it was **wrong**. It claimed the two selectors were separable because the model selector's options carried an `.id` the provider's lacked; driving real `cline` 3.0.48, `goose` and `openclaw` against a local mock showed **both** are `{value, name}`, as is every ACP select option in every SDK generation (`SessionConfigSelectOption` is `{value, name, description?}` in 0.20.0/0.24.0/0.29.0/1.3.0 alike). So the empty model picker was never cline-specific: `detectModelShape` filtered options on a field nothing emits, and its `configOptions` branch had never returned a model from any real binary — goose was equally affected. Fixed in `protocol.ts` by reading `value` (`id` kept only as a back-compat fallback), flattening grouped options, and ranking the several `category:"model"` candidates (`pickModelOption`) rather than taking the first — note that "first non-empty wins" is *disproven* by cline's own payload, since it selects the provider and yields a populated-but-wrong picker. `models`/`modelConfigId`/`currentModelId` are all correct for cline now, and goose's `effortLevels` populate. Covered by `acpProtocol.test.ts`'s `detectModelShape` block, written from the captured payloads |
| `openclaw` | **Verified**, full turn E2E | `openclaw acp` is a thin bridge to a separate Gateway process (own `models.providers.*` config) — `openclawMocked.test.ts` spawns a REAL `openclaw gateway run` (`openclawGateway.ts`) against the mock, isolated via `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR`. THREE real, pre-existing Bismuth-side bugs were found and fixed to get here (see `chatProviders/acp/agents.ts`'s openclaw entry and `driver.ts`'s `killWithEscalation`/`KILL_ESCALATION_GRACE_MS`): (1) Bismuth's old default spawn args (`openclaw acp`, no `--session`) failed the FIRST turn on any fresh Gateway — the bridge's own default `acp:<uuid>` session name collides with an unrelated OpenClaw feature that reserves that prefix; fixed with a PER-CHAT `--session agent:main:bismuth-<chatId>` (`AcpAgentSpec.sessionKeyArgs`). A first version of this fix used a FIXED constant session key instead — review caught that as an active cross-chat content-leak (one chat's text arriving inside another's upstream request, confirmed via `openclawMocked.test.ts`'s session-isolation test), not a mere isolation nicety, so it must stay per-chat. Known follow-up, decided ACCEPTED not fixed (task-15): each distinct session key is its own on-disk openclaw transcript (~1.6KB, scales with conversation length) PLUS an entry in a shared `sessions.json` index (~20KB per session, NOT per turn — dominated by a static skills-prompt snapshot), neither ever pruned — measured live, ~21-22KB of `~/.openclaw` growth per Bismuth chat a user ever opens against openclaw, forever. Deliberately NOT pruned on `closeChat`: `agentBackends/catalog.ts` declares `resume: true` for this backend, and `server.ts`'s WS `resume` message can reach it, so deleting openclaw's own session state at chat-close would silently break a real, reachable resume path — see `agents.ts`'s openclaw entry for the full reasoning (mirrors this repo's own "never delete in-use data on a heuristic" precedent from the daemon side). (2) On a machine with Bismuth's MCP tools installed, `session/new`'s usual non-empty `mcpServers` array is REJECTED by openclaw's ACP bridge outright ("does not support per-session MCP servers"); fixed via a new `AcpAgentSpec.supportsSessionMcpServers: false` flag — consequence: openclaw chats get no Bismuth MCP tools (bismuth_cli/docs/memory). (3) A real `openclaw acp` process does not exit on SIGTERM alone (its own shutdown handler never calls `process.exit()`) — `driver.ts`'s `closeChat()` AND `abortTurn()`'s grace-timeout fallback both used to leave it running indefinitely; fixed at both call sites with a shared grace-then-SIGKILL escalation (`killWithEscalation`/`KILL_ESCALATION_GRACE_MS`), the same pattern `openclawGateway.ts`'s own process teardown already used (`mockLlm.ts`'s own teardown does NOT escalate — a bare kill+await). CONFIRMED GAP (task-15, resolving the prior "open question, not verified either way"): this escalation's SIGKILL does NOT reach the real agent behind the two `npx`-spawned ACP adapters (`claude-code-acp`/`codex-acp`) — verified directly against both real published packages, not a stub. `npx` forks a genuine child distinct from its own pid in both cases, and `proc.kill(9)` against only the wrapper leaves that real child alive, every time. Currently unfixed — see `driver.ts:153-175`'s `KILL_ESCALATION_GRACE_MS` comment for the full finding and the recommended follow-up |

The **version-skew branch** in `core/src/chatProviders/acp/protocol.ts`'s `detectModelShape` (an ACP
agent's `session/new` reporting the OLD `models.availableModels`/`currentModelId` shape vs the NEW
`configOptions` shape) cannot be covered by any single real CLI — nothing installed anywhere reports
both. `core/test/support/fakeAcpAgent.ts` is a small, hand-rolled fake ACP agent (JSON-RPC over
stdio, no network of any kind) used by `core/test/chatProviders/acpFakeAgent.test.ts` to drive both
branches from one place, following the exact "write + chmod a stub binary, prepend it onto PATH"
pattern `relay/test/wrap.test.ts` already established for testing a driver against a fake binary.

The same fake agent also has a **cline auth-gate mode** (`FAKE_ACP_AUTH_GATE=cline`, opt-in and fully
decoupled from the model-shape logic above — the three original `acpFakeAgent.test.ts` tests are
unaffected), reproducing cline's real `initialize`/`session/new` auth surface cited from its own
source (see `fakeAcpAgent.ts`'s header). `core/test/chatProviders/clineAuthFakeAgent.test.ts` drives
it two ways: gate closed (no `FAKE_ACP_CLINE_AUTHED`) proves the driver surfaces the real
`-32000`/"Authentication required" refusal as a clean `error` frame with no stray assistant-text or
result frame anywhere in the transcript; gate open (`FAKE_ACP_CLINE_AUTHED=1`, mirroring the real
`CLINE_API_KEY` bypass) proves a full turn completes — assistant-text, then `result.isError===false`,
then `done`. This needs no `cline` binary at all, so it is the coverage guaranteed to run on every
machine regardless of what's installed — `clineMocked.test.ts`'s real-E2E block is the (also real,
also verified) belt-and-suspenders version that only runs where a real `cline` happens to be present.

The fake also has a **held-prompt mode** (`FAKE_ACP_PROMPT_HOLD=permission`, opt-in and decoupled the
same way), which makes `session/prompt` NOT settle synchronously: the fake streams a `tool_call`,
calls `session/request_permission` back into the client, and withholds the prompt's JSON-RPC response
until a reply lands on its own stdin. That one capability is deliberately built as a generic
mechanism — an outbound `callClient()`, inbound response routing, and a `heldPrompts`/`settlePrompt`
registry — because four separate coverage gaps (turn queue, abort, resume, never-terminating turn)
all need the same "a turn is observably in flight" window and none of them can be written without it.
`acpPermissionFakeAgent.test.ts` uses it to prove the permission round trip through the real driver:
the `permission` ChatFrame's id (which is the agent's own outbound rpc id), the exact bytes written
back (`{outcome:{outcome:"selected", optionId}}` for allow AND deny, `{outcome:{outcome:"cancelled"}}`
when the agent offers no selectable options), and the ordering — no `result`/`done` frame exists while
the prompt is parked, all of them arrive after. Nothing can settle that prompt except a real,
correctly-addressed, parseable reply, so a wrong rpc id, a missing `pendingPermissions` entry, a
malformed outcome, or no reply at all each surface as a test timeout rather than a false pass.

### Recording a new fixture

`llmock --record` is a **deliberate, manual act that makes REAL API calls** — it proxies unmatched
requests to a real provider and saves the response as a new fixture. It is never run by `bun test`,
never wired into CI, and never triggered as a side effect of anything in this repo:

```bash
# Proxies to the real OpenAI API using your own credentials — costs real money/quota.
npx -p @copilotkit/aimock llmock --record --provider-openai https://api.openai.com \
  -f core/test/fixtures/llm/my-new-fixture.json
# ...then drive the CLI you're recording against this server as usual...
```

Only run this yourself, with your own account, when you actually need a new fixture — never assume
a fixture can be regenerated as part of routine testing.

---

## File layout and colocating tests

Every test file is a `*.test.ts` colocated with (or adjacent to) the module it tests:

| Location | Test files |
|---|---|
| `core/test/` | One `*.test.ts` per backend module in `core/src/` |
| `core/test/bases/` | Tests for `core/src/bases/` (lexer, parser, evaluate, query, etc.) |
| `core/test/srs/` | Tests for `core/src/srs/` (scheduler, cards, parser, reviewRow) |
| `core/test/drawing/` | Tests for `core/src/drawing/` (model, geometry, render2d, paper, theme, etc.) |
| `core/test/schema/` | Tests for `core/src/schema/` (settingsSchema, validate, coerce, integration, etc.) |
| `app/src/` | Frontend tests colocated with their source modules (`panes.test.ts` next to `panes.ts`) |
| `app/src/bases/` | Flashcards queue, row cache, calendar serialization tests |
| `app/src/calendar/` | EventStore, date helpers, state tests |
| `app/src/editor/` | CodeMirror extension unit tests (tableModel, wikilink, tag, autocomplete, etc.) |
| `app/src/graph/` | Label selection, collision radius, agent graph, agent layout tests |
| `app/src/export/` | Export format and renderer tests |

There is no separate `__tests__` directory. The rule is: test lives next to (or one directory above) the source it covers.

---

## The shared vault helper: `core/test/helpers.ts`

Most backend tests need a throwaway on-disk vault and memory directory. The shared helper is:

```ts
// core/test/helpers.ts
import { makeSampleVault } from "./helpers";

const { vault, memory } = await makeSampleVault();
```

`makeSampleVault()` creates isolated `mkdtempSync` directories in `$TMPDIR` and populates them with three notes (`essay.md`, `housing.md`, `internship.md`) and one memory note (`michael-profile.md` referencing `[[internship]]` and `[[essay]]`). Each call produces a fresh pair — tests that mutate files (writes, backups, settings) cannot bleed into one another.

For tests that need a custom vault, create a `mkdtempSync` directly and use `writeNote(dir, "path.md", "content")` from `core/src/files.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";

const dir = mkdtempSync(join(tmpdir(), "bismuth-vault-"));
await writeNote(dir, "note.md", "---\ntags: [book]\n---\n# Title\n\nBody");
```

---

## Key test files

### `core/test/vault.test.ts`

Tests `buildVaultGraph()` from `core/src/vault.ts`. Covers:

- Node creation: every `.md` becomes a `kind: "note"` node; `id` is the path without extension; `label` is the basename; `folder` is the top-level directory segment (or `"(root)"` for root files)
- Link edges: only created for targets that exist; wikilinks inside fenced code blocks produce no edge; duplicate links to the same target may yield multiple edges (implementation-defined); self-links are handled (check is present but behavior is not strictly asserted)
- Path-style wikilinks: `[[reading/My Note]]` resolves exactly to `reading/My Note` before falling back to basename matching
- Tag nodes: `kind: "tag"` nodes with `id: "tag:foo"` and `label: "#foo"`, deduped across notes
- Edge kinds: `"link"` for wikilinks, `"tag"` for both frontmatter and inline tags
- Malformed YAML frontmatter does not crash the graph builder

### `core/test/engine.test.ts`

Tests `buildGraph()` from `core/src/engine.ts`, which merges vault + memory and injects cross-brain `"about"` edges:

```ts
expect(g.edges).toContainEqual({
  from: "mem:michael-profile", to: "internship", kind: "about",
});
```

- Memory nodes use the `mem:` prefix (`mem:michael-profile`)
- About edges are only created for vault files that actually exist — links to missing vault notes are silently dropped
- Two disconnected clusters receive distinct `community` values (community detection is tested here)
- `communityLabel` is stamped on every node

### `core/test/server.test.ts`

Integration tests against a live `createServer({ vault, memory, port: 0 })` (port 0 = OS-assigned free port). Exercises the full HTTP surface with real `fetch()` calls. Pattern:

```ts
const server = createServer({ vault, memory, port: 0 });
const base = `http://localhost:${server.port}`;
try {
  const g = await (await fetch(`${base}/graph`)).json();
  // assertions...
} finally {
  server.stop(true);
}
```

- `GET /graph` returns merged brain graph with correct nodes and edges
- `GET /config` returns `{ vault, memory }` launch paths
- Relay ingest routes (`POST /relay/session`, `POST /relay/subagent/start`) return `400` when required fields are missing; a well-formed POST reaches the relay registry (asserted by reading `relay.ts`'s `snapshot()` directly — `GET /agent-graph`, which used to render this end-to-end, is gone along with the agents graph)
- `GET /daemon/graph` always returns `200` with a graph shape (never throws, even with no daemon home)

### `core/test/relay.test.ts`

Tests the in-process relay registry (`core/src/relay.ts`) — session/subagent bookkeeping populated by the relay plugin's hooks; it used to power the now-removed agents graph and today has no reader at all. Uses `beforeEach(() => resetRelay())` for isolation. Covers the full session/subagent lifecycle:

- `registerSession` + `snapshot` roundtrip
- Re-registering the same `sessionId` is a heartbeat: bumps `lastSeen`, preserves subagents and `cwd`
- Re-running claude in the same `terminalId` with a new `sessionId` evicts the old session and its subagents
- `endSession` removes session and its subagents
- Subagent `startSubagent`/`stopSubagent` stores `lastMessage`, sets `done: true`, records `doneAt`
- Finished subagents are pruned after the `DONE_SUBAGENT_TTL_MS` (8s) linger — both via `snapshot()`/`prune()`'s own sweep and eagerly as a side effect of a later `stopSubagent` call, so a long-lived terminal tab that never closes doesn't accumulate done subagents indefinitely
- `prune(openTabIds, now)` drops sessions whose terminal tab has closed, plus orphaned subagents

### `core/test/terminal.test.ts`

Tests `buildPtyEnv` (pure, no disk) and live PTY session creation:

```ts
const ENV_BASE = {
  base: { PATH: "/usr/bin" },
  relayUrl: "http://localhost:4321",
  terminalId: "tab-1",
  pluginDir: "/repo/relay",
  shimDir: "/repo/relay/shim",
  zdotDir: "/repo/relay/shim/zdotdir",
};
```

- `ZDOTDIR` is set to the shim zdotdir only when `realClaude` resolves; absent otherwise
- `CLAUDE_RELAY_URL` and `CLAUDE_TERMINAL_ID` are always set
- The shim is prepended to `PATH` only when `realClaude` is not null; skipped entirely otherwise
- No trailing colon when base has no `PATH`
- `undefined` values in the base env are stripped from the result
- Live PTY: `createTerminalSession` spawns a shell that echoes stdin; `resizeSession` propagates SIGWINCH; `killSession` removes the session from the registry

### `core/test/daemonViz.test.ts`

Tests `nodeVisualState()` from `core/src/daemonViz.ts`, the pure encoder for daemon node visual tokens:

| State | `fill` | `border` | `opacity` |
|---|---|---|---|
| disabled (any) | `"base"` | `"none"` | `0.15` |
| enabled, not running | `"bg"` | `"palette"` | `1` |
| running | `"palette"` | `"none"` | `1` |

`lastResult` and `lastFiredMs` are ignored — they no longer drive the encoding. The `now` parameter is optional and unused in the current implementation.

### `core/test/daemonGraph.test.ts` and `core/test/daemon.test.ts`

`daemon.test.ts` sets `BISMUTH_DAEMON_DIR` to a fresh tmp dir per test (via `makeHome(files)`) and cleans up in `afterEach`. Tests degrade-gracefully behavior with missing files, `listDevices`/`getOwner`/`setOwner` contract shapes, `setCronEnabled`/`setProcessEnabled` writes, and `daemonStatus.running` detection via `daemon.pid`.

### `core/test/changeClassifier.test.ts`

Tests `extractFingerprint` / `diffFingerprints` / `createChangeTracker`. Key behaviors:

- Fingerprint is order-independent for links and tags (sorted before comparison)
- A pure body edit (no link/tag/icon change) produces `{ graph: false, tree: false }`
- Adding a wikilink produces `{ graph: true, tree: false }`
- Adding a tag produces `{ graph: true, tree: false }`
- Changing the icon produces `{ graph: false, tree: true }`
- Tags/links inside fenced code blocks are stripped from fingerprints

### `core/test/layout.test.ts`

Tests `computeLayout` and `pivotMDS`:

- Every node gets a finite `[x, y, z]` position
- 2D mode (`dimensions: 2`) forces `z = 0` for all nodes
- Community-tagged clusters separate far better under community-aware forces than without them (see "community-aware clustering" tests). The topology-only version of this assertion (two well-connected clusters joined by a bridge, no `community` field) was **removed** under the LinLog + degree-repulsion default — it no longer reliably holds (see the `REMOVED (Task 5)` comment in the test file for the measured ratios); this is the same known limitation documented for the ` ```graph ` embedded block (`docs/editor/graph-block.md`) and applies to the daemon graph too.

### `core/test/layout-cache.test.ts`

Tests `graphSig` (cache key):

- Stable for identical graphs
- Order-independent for nodes and edges
- Busts when an edge is retargeted — same node set, same edge count, but different connectivity must change the key

### `core/test/sse.test.ts`

Tests `createSseRegistry` and `formatEvent`:

- `formatEvent({ version: 7 })` → `"data: {\"version\":7}\n\n"`
- `subscribe`/`publish` delivers formatted frames to all controllers
- `unsubscribe` stops further deliveries
- A broken controller (throws on `enqueue`) is auto-removed; other subscribers continue receiving

### `core/test/settings.test.ts`

Tests `readSettings`, `getVaultSchema`, and the schema suggestion/validation pipeline. Key:

- `readSettings` returns `null` when `.settings` is absent
- Returns `{ raw, data }` when present
- Tolerates malformed YAML (returns `data: {}`)
- `getVaultSchema` parses the `properties:` section into a type registry

### `core/test/schema/settingsSchema.test.ts`

Structural tests asserting the exact top-level sections of `SETTINGS_SCHEMA` (currently: `appearance`, `attachments`, `calendar`, `daemon`, `dailyNotes`, `editor`, `folderIcons`, `graph`, `keybindings`, `properties`, `server`, `srs`, `templates`, `terminal`, `toolbar`, `ui`, `vault`). **Adding a new top-level section requires updating the hardcoded list in this test.**

### `core/test/bases/query.test.ts`

Tests `runView()` with real `Row[]` data:

```ts
const base: BaseConfig = {
  formulas: { ppu: "(price / age).toFixed(2)" },
  views: [{ type: "table", name: "V", filters: 'status != "done"', order: [...], sort: [...], summaries: { "note.price": "Sum" } }],
};
```

Covers filter application, formula evaluation, sort direction, global + view filter composition with AND, and row grouping.

### `core/test/srs/scheduler.test.ts`

Tests the SM-2 implementation in `core/src/srs/scheduler.ts`:

- New card + "good" → `interval: 1`, `ease: 250`, `due: +1 day`
- New card + "easy" → `interval: 4`, `ease: 270`
- Reviewing "easy" bumps ease and applies `easyBonus`
- Reviewing "hard" halves interval and drops ease (floor 130); interval floored to 1
- `formatScheduling` / `parseScheduling` round-trip: `"<!--SR:!2026-06-01,4,270-->"`
- Interval clamped to `MAX_INTERVAL` (36525 days)

### `core/test/drawing/model.test.ts`

Tests `emptyDoc`, `roundDoc`, `serializeDoc`/`parseDoc`:

- `emptyDoc()` has `v: 1`, `kind: "drawing"`, one page, no strokes
- `roundDoc` rounds x/y to integers and clamps pressure to 0–255
- `serializeDoc`/`parseDoc` round-trip identity
- `parseDoc` throws `/not a drawing/i` for non-drawing JSON

### `app/src/panes.test.ts`

Tests the pure pane-tree model (`panes.ts`). All functions are pure over immutable trees. Key assertions:

- `makeTab("a.md")` returns `{ root: Leaf, focusId }` focused on the single leaf
- `splitLeaf(root, id, "row")` replaces the leaf with a `Split` whose two children both carry the original content; the new leaf gets a fresh `id`
- `closeLeaf` on the last remaining leaf returns `null`; on an interior leaf collapses the parent split into the surviving sibling

### `app/src/settings.parity.test.ts`

A drift guard that enforces two invariants across the entire settings schema:

1. Every settable leaf (scalar, non-`properties`) must have a materialized default in the `DEFAULTS` object in `app/src/settings.ts`
2. Every settable leaf must carry a non-empty `doc` string (so Ctrl-Space can explain it)

This test **fails immediately** when a new setting is added to `settingsSchema.ts` without a corresponding default in `DEFAULTS` or a `doc` field — it is the first line of defense against schema drift.

### `app/src/graph/labelSelection.test.ts`

Tests the pure label-ladder math the ASCII knowledge-graph renderer (`AsciiGraphRenderer.ts`) draws on:

- `computeAlwaysOnSet` (top-N nodes by undirected edge degree, union'd with the active file): empty graph → empty set, active file always included if present, degree ties broken lexicographically by `id`, `hubCount` clamped to total node count, edge endpoints as either bare ids or `{ id }` objects
- `fileLabelBudget`/`fileLabelAlpha`/`clusterLabelAlpha`: zero at/below the zoom-ladder reveal threshold, monotonically growing past it, file/cluster alpha sum to exactly 1 (a true crossfade)
- `clusterLabelText`: upper-casing, word-boundary truncation at a character cap (never mid-word, never an ellipsis), determinism
- `eyebrowWidthCells`, `levelBoundaries`, and the rest of the N-level cluster-name ladder math

(`graph/collide.ts` and its test were deleted along with the old `CanvasGraphRenderer.ts` — the per-node collision-radius helpers they covered had no equivalent need in the character-grid renderer.)

### `app/src/bases/flashcardsQueue.test.ts`

Tests `buildQueue` (pure review-queue builder) for the flashcard SRS system:

- Non-bidirectional: one `"fwd"` entry per row
- Bidirectional cram: `"fwd"` then `"rev"` per row, using `due` and `dueBack` fields respectively
- Due-date filter is per-direction: a card can be due in `"rev"` but not `"fwd"`
- A new card (no scheduling columns) is due in both directions when bidirectional

### `app/src/editor/tableModel.test.ts`

Tests the GFM pipe-table parser/serializer:

- `parseTableRow` strips outer rails, trims cells, unescapes `\|`
- `serializeTable` re-escapes literal pipes
- `parseAlign` maps separator patterns (`---`, `:--`, `--:`, `:-:`) to alignment names

### `app/src/calendar/EventStore.test.ts`

Tests `EventStore` with `MemoryBackend` (no disk). Covers non-recurring and recurring event expansion, `deleteOccurrence`, `editSeries`, and `editFollowing` semantics.

---

## Adding a new test

### Core module test

1. Create `core/test/<module>.test.ts` (or a subdirectory file for `bases/`, `srs/`, `drawing/`, `schema/`)
2. Import from `bun:test` and the module under test using a relative path from `core/test/` to `core/src/`
3. Use `makeSampleVault()` from `./helpers` for tests that need a vault on disk; use `mkdtempSync` directly for custom vaults

```ts
// core/test/mymodule.test.ts
import { test, expect } from "bun:test";
import { myFunction } from "../src/mymodule";

test("does the right thing", () => {
  expect(myFunction("input")).toBe("expected");
});
```

4. Run with `bun test core/test/mymodule.test.ts` (or `bun test mymodule` — never `bun test core -- mymodule`, which does not filter)

### Frontend module test

1. Create `app/src/<path>/<module>.test.ts` colocated with the source
2. Import from `bun:test` — the Bun runner discovers all `*.test.ts` files automatically
3. Frontend tests must avoid DOM APIs unavailable in Bun (no `document`, `window`, `ResizeObserver`, etc.). Pure logic — parsers, state machines, pure functions — tests well. Tests that require a real browser cannot be run with Bun.

```ts
// app/src/myutil.test.ts
import { test, expect } from "bun:test";
import { myUtil } from "./myutil";

test("returns the expected value", () => {
  expect(myUtil(42)).toBe(84);
});
```

4. Run with `bun test app/src/myutil.test.ts` (or `bun test myutil` — never `bun test core -- myutil`, which does not filter)

### Server endpoint test

Follow the `core/test/server.test.ts` pattern:

```ts
import { createServer } from "../src/server";
import { makeSampleVault } from "./helpers";

test("GET /my-route returns correct shape", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/my-route`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.nodes)).toBe(true);
  } finally {
    server.stop(true);
  }
});
```

Always call `server.stop(true)` in a `finally` block to avoid port leaks between tests.

### Adding a new top-level settings section

After adding a section to `core/src/schema/settingsSchema.ts`:

1. Update the hardcoded key list in `core/test/schema/settingsSchema.test.ts` — this test asserts the exact set of top-level keys
2. Add the matching field to the `Settings` interface in `app/src/settings.ts` and to `DEFAULTS`
3. `app/src/settings.parity.test.ts` will catch any missing leaf defaults or `doc` strings automatically

---

## What is not tested with Bun

- **Knowledge graph rendering** (`graph/AsciiGraphRenderer.ts`) IS tested despite drawing to a `<canvas>`: `AsciiGraphRenderer.test.ts` runs it headlessly under happy-dom (which has no real canvas) by installing a RECORDING 2D context that captures every `fillText`/`stroke`/font assignment for assertions — 119 tests covering rasterization, hit-testing, drag-to-orbit vs. click, and the zoom-is-resolution law. The renderer this replaced, a WebGL/Three.js-based one (`graph/WebGLRenderer.ts`) and, later, a dot-and-line Canvas2D one (`graph/CanvasGraphRenderer.ts`), are both deleted — neither exists to test
- **CodeMirror editor view interactions**: some extensions are tested for their pure logic (parsers, completers), but live editor state mutations require a real DOM
- **Tauri APIs** (`@tauri-apps/api`, `@tauri-apps/plugin-*`): mocked out or skipped in tests; only native-app builds exercise them
- **Spellchecker WASM** (`harper.js`): the store and offset helpers are tested, but the WASM binary is not loaded in Bun
- **Spreadsheet (Univer)**: dynamically imported behind a code-split boundary; the snapshot/sync helpers are tested, not the full workbook

---

Source: `CLAUDE.md`, `core/src/settings.ts`, `core/test/helpers.ts`, `core/test/vault.test.ts`, `core/test/engine.test.ts`, `core/test/server.test.ts`, `core/test/relay.test.ts`, `core/test/terminal.test.ts`, `core/test/daemonViz.test.ts`, `core/test/daemon.test.ts`, `core/test/changeClassifier.test.ts`, `core/test/layout.test.ts`, `core/test/layout-cache.test.ts`, `core/test/sse.test.ts`, `core/test/settings.test.ts`, `core/test/asyncCache.test.ts`, `core/test/schema/settingsSchema.test.ts`, `core/test/schema/integration.test.ts`, `core/test/bases/query.test.ts`, `core/test/srs/scheduler.test.ts`, `core/test/drawing/model.test.ts`, `core/test/bug-fixes.test.ts`, `app/src/panes.test.ts`, `app/src/settings.parity.test.ts`, `app/src/graph/labelSelection.test.ts`, `app/src/graph/AsciiGraphRenderer.test.ts`, `app/src/bases/flashcardsQueue.test.ts`, `app/src/editor/tableModel.test.ts`, `app/src/calendar/EventStore.test.ts`, `app/package.json`, `core/package.json`, `package.json`, `app/tsconfig.json`, `core/tsconfig.json`, `mcp/tsconfig.json`, `relay/tsconfig.json`, `relay/package.json`, `core/test/liveGate.ts`, `core/test/support/mockLlm.ts`, `core/test/support/backendEnv.ts`, `core/test/support/fakeAcpAgent.ts`, `core/test/support/openclawGateway.ts`, `core/test/chatProviders/claudeMocked.test.ts`, `core/test/chatProviders/opencodeMocked.test.ts`, `core/test/chatProviders/codexMocked.test.ts`, `core/test/chatProviders/gooseMocked.test.ts`, `core/test/chatProviders/geminiMocked.test.ts`, `core/test/chatProviders/clineMocked.test.ts`, `core/test/chatProviders/openclawMocked.test.ts`, `core/test/chatProviders/acpFakeAgent.test.ts`, `core/test/chatProviders/clineAuthFakeAgent.test.ts`, `core/src/chatProviders/acp/agents.ts`, `relay/test/wrap.test.ts`
