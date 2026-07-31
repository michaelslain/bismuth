# Testing

This document is the canonical reference for how tests work in Bismuth, covering the test runner, file conventions, the full suite across `core/` and `app/`, how to run and filter tests, how to add new tests, the `bun run typecheck` TypeScript gate, and a tour of every key test file and the patterns they establish.

---

## Test runner

Bismuth uses **Bun's built-in test runner** (`bun:test`) for all tests — both backend (`core/`) and frontend (`app/`). There is no Jest, Vitest, or Mocha. Tests use the `bun:test` import:

```ts
import { test, expect, describe, it, beforeEach, afterEach } from "bun:test";
```

The full suite (~2027 tests across the `core/` and `app/` workspaces) runs in roughly 80-90 seconds on a modern laptop with every mocked-CLI binary installed and reachable. (This is an ~8x increase from an earlier ~930-tests/~10s figure this file used to quote — mostly the offline-testing branch's own mocked agent-CLI integration tests below, several of which spawn a REAL CLI subprocess and wait for a real turn to complete rather than exercising pure in-process logic, which costs real wall-clock seconds per test even though it costs zero API calls/dollars. A machine missing some of those CLI binaries runs fewer tests, faster, via the missing-binary skip described below.)

---

## Running tests

### Run all tests (recommended baseline)

From the repo root:

```bash
bun test core
```

This discovers every `*.test.ts` file under `core/` **and** `app/src/` (Bun resolves both workspaces). Output (counts are illustrative and grow per commit — expect a green `0 fail`):

```
bun test v1.3.9 (cf6cdbbb)

 930 pass
 0 fail
 2600 expect() calls
Ran 930 tests across 80+ files. [10.24s]
```

### Run a single workspace or directory

```bash
bun test core         # everything under core/ + app/src/ via workspace resolution
bun test app          # same (both commands discover all *.test.ts)
```

### Run a single file directly

Pass the file path as the argument:

```bash
bun test core/test/vault.test.ts
bun test app/src/panes.test.ts
```

### Filter by filename pattern

The `--` separator passes a pattern to Bun which matches against the file path:

```bash
bun test core -- vault         # matches core/test/vault.test.ts
bun test core -- wikilinks     # matches core/test/wikilinks.test.ts
bun test core -- daemonViz     # matches core/test/daemonViz.test.ts
bun test core -- bases/query   # matches core/test/bases/query.test.ts
bun test core -- flashcards    # matches all flashcard-related test files
```

The pattern is a substring match against the relative file path (not the test name). Use the filename stem to isolate a single file, or a directory prefix to scope a subdirectory.

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
   `core/test/chatProviders/acpFakeAgent.test.ts`) run by default in `bun test core` (no opt-in
   needed) precisely because they spend nothing, and skip when the relevant CLI **binary** isn't
   installed (a portability/CI concern), never when an **account** isn't logged in — a
   missing-binary skip and a missing-account skip must never be conflated (see each test file's own
   header for why). They are NOT all the same shape, and the difference matters (corrected here after
   an earlier version of this paragraph overstated it: this item covers EIGHT files total — the seven
   `*Mocked.test.ts` files plus `acpFakeAgent.test.ts` — the `openclaw` gap this paragraph used to
   flag was closed by an offline-testing task that added `openclawMocked.test.ts`, the seventh
   `*Mocked.test.ts` file):
   - `claudeMocked`/`opencodeMocked`/`codexMocked`/`gooseMocked`/`geminiMocked`/`openclawMocked.test.ts`
     drive a REAL agent CLI binary (`claude`/`opencode`/`codex`/`goose`/`gemini`/`openclaw`) through
     Bismuth's OWN production chat driver, pointed at a **local mock LLM server** instead of the real
     provider API — see the verification table below for exactly how far each one is confirmed (full
     turn E2E vs. handshake-only). `openclawMocked.test.ts` is the heaviest of the six: `openclaw acp`
     is a thin bridge to a separate Gateway process, so this test also spawns a REAL
     `openclaw gateway run` process (`core/test/support/openclawGateway.ts`) pointed at the mock,
     torn down in `afterEach` with a `ps`-based leak check.
   - `clineMocked.test.ts` drives the REAL `cline` binary too, but starts **no mock at all** — cline's
     ACP mode has no mockable path (see the table), so this test instead proves that failure mode is
     SAFE: an isolated, never-authenticated `CLINE_DIR` produces a clean error, never a hang or a
     silent real-account fallback.
   - `acpFakeAgent.test.ts` drives a **fake ACP agent** (`core/test/support/fakeAcpAgent.ts`, a
     hand-rolled stub speaking the wire protocol), not a real CLI at all — see "The fake ACP agent"
     below for why a fake is the only way to cover the version-skew branch it exists for.

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
| `gemini` | **Partially verified** | Handshake + old-shape model list + zero real network access confirmed live; a full turn's assistant text could not be made to arrive against the generic mock fixture within a reasonable time (see `geminiMocked.test.ts`'s header for the investigation) |
| `cline` | **Not mockable for the mode Bismuth ships** | ACP mode (`cline --acp`) gates `session/new` behind a real OAuth `authenticate` call with no mockable path; `clineMocked.test.ts` instead verifies this fails SAFELY (a clean error, never a hang or a silent real-account fallback) against an isolated `CLINE_DIR` |
| `openclaw` | **Verified**, full turn E2E | `openclaw acp` is a thin bridge to a separate Gateway process (own `models.providers.*` config) — `openclawMocked.test.ts` spawns a REAL `openclaw gateway run` (`openclawGateway.ts`) against the mock, isolated via `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR`. THREE real, pre-existing Bismuth-side bugs were found and fixed to get here (see `chatProviders/acp/agents.ts`'s openclaw entry and `driver.ts`'s `killWithEscalation`/`KILL_ESCALATION_GRACE_MS`): (1) Bismuth's old default spawn args (`openclaw acp`, no `--session`) failed the FIRST turn on any fresh Gateway — the bridge's own default `acp:<uuid>` session name collides with an unrelated OpenClaw feature that reserves that prefix; fixed with a PER-CHAT `--session agent:main:bismuth-<chatId>` (`AcpAgentSpec.sessionKeyArgs`). A first version of this fix used a FIXED constant session key instead — review caught that as an active cross-chat content-leak (one chat's text arriving inside another's upstream request, confirmed via `openclawMocked.test.ts`'s session-isolation test), not a mere isolation nicety, so it must stay per-chat. Known follow-up, not fixed: each distinct session key is its own on-disk openclaw transcript that's never pruned, so a real user's `~/.openclaw` grows one session file per Bismuth chat they ever open — the accepted cost of closing the leak, not a free fix. (2) On a machine with Bismuth's MCP tools installed, `session/new`'s usual non-empty `mcpServers` array is REJECTED by openclaw's ACP bridge outright ("does not support per-session MCP servers"); fixed via a new `AcpAgentSpec.supportsSessionMcpServers: false` flag — consequence: openclaw chats get no Bismuth MCP tools (bismuth_cli/docs/memory). (3) A real `openclaw acp` process does not exit on SIGTERM alone (its own shutdown handler never calls `process.exit()`) — `driver.ts`'s `closeChat()` AND `abortTurn()`'s grace-timeout fallback both used to leave it running indefinitely; fixed at both call sites with a shared grace-then-SIGKILL escalation (`killWithEscalation`/`KILL_ESCALATION_GRACE_MS`), the same pattern `openclawGateway.ts`'s own process teardown already used (`mockLlm.ts`'s own teardown does NOT escalate — a bare kill+await). Open question, not verified either way: whether this escalation's SIGKILL actually reaches the real agent behind the two `npx`-spawned ACP adapters (`claude-code-acp`/`codex-acp`) or only kills the `npx` wrapper — neither was spawned during this task |

The **version-skew branch** in `core/src/chatProviders/acp/protocol.ts`'s `detectModelShape` (an ACP
agent's `session/new` reporting the OLD `models.availableModels`/`currentModelId` shape vs the NEW
`configOptions` shape) cannot be covered by any single real CLI — nothing installed anywhere reports
both. `core/test/support/fakeAcpAgent.ts` is a small, hand-rolled fake ACP agent (JSON-RPC over
stdio, no network of any kind) used by `core/test/chatProviders/acpFakeAgent.test.ts` to drive both
branches from one place, following the exact "write + chmod a stub binary, prepend it onto PATH"
pattern `relay/test/wrap.test.ts` already established for testing a driver against a fake binary.

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
- `GET /agent-graph` returns `{ nodes: [], edges: [] }` shape
- Relay ingest routes (`POST /relay/session`, `POST /relay/subagent/start`) return `400` when required fields are missing
- `GET /daemon/graph` always returns `200` with a graph shape (never throws, even with no daemon home)

### `core/test/relay.test.ts`

Tests the in-process relay registry (`core/src/relay.ts`) that powers the agents graph. Uses `beforeEach(() => resetRelay())` for isolation. Covers the full session/subagent lifecycle:

- `registerSession` + `snapshot` roundtrip
- Re-registering the same `sessionId` is a heartbeat: bumps `lastSeen`, preserves subagents and `cwd`
- Re-running claude in the same `terminalId` with a new `sessionId` evicts the old session and its subagents
- `endSession` removes session and its subagents
- Subagent `startSubagent`/`stopSubagent` stores `lastMessage`, sets `done: true`, records `doneAt`
- Finished subagents are pruned after a 60-second TTL (`snapshot(now + 61_000)` drops them)
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

### `core/test/agents.test.ts`

Tests `buildAgentGraph()` from `core/src/agents.ts`:

- Empty snapshot → empty graph
- A live terminal session (tab present in the open-tab set) becomes a root agent node with `kind: "agent"` and a `cwd`-derived label (basename of the working directory)
- A session whose `terminalId` is not in the open-tab set is dropped at read time
- Subagents attach with a `"message"` edge: `{ from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" }`
- Stale (idle >10 minutes) sessions get `state: "idle"` vs active `state: "awake"`

### `core/test/layout.test.ts`

Tests `computeLayout` and `pivotMDS`:

- Every node gets a finite `[x, y, z]` position
- 2D mode (`dimensions: 2`) forces `z = 0` for all nodes
- Two well-connected clusters separated by a bridge end up with distinct spatial centroids (spatial separation test)

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

Tests the pure `computeAlwaysOnSet` (top-N nodes by edge degree) and `selectVisibleLabels` (grid-capped visible label set):

- Empty graph → empty set
- Active file is always included if present in the node list
- Degree ties broken lexicographically by `id`
- `hubCount` clamped to total node count
- Supports d3-resolved edge objects (where `source`/`target` become node objects after d3 ticks)
- Labels below the pixel threshold are dropped unless `forced: true`
- Grid-cap keeps the highest `renderedPx` in a contested cell; forced labels bypass this

### `app/src/graph/collide.test.ts`

Tests `drawnNodeRadius` and `nodeCollideRadius`. Verifies the Three.js `sizeAttenuation` formula (`diameter = size * tan(fov/2)`) and the floor-vs-drawn-radius clamping logic.

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

4. Run with `bun test core -- mymodule`

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

4. Run with `bun test core -- myutil`

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

- **WebGL / Three.js rendering** (`graph/WebGLRenderer.ts`, `graph/LabelLayer.ts`): requires a GPU context; not tested
- **CodeMirror editor view interactions**: some extensions are tested for their pure logic (parsers, completers), but live editor state mutations require a real DOM
- **Tauri APIs** (`@tauri-apps/api`, `@tauri-apps/plugin-*`): mocked out or skipped in tests; only native-app builds exercise them
- **Spellchecker WASM** (`harper.js`): the store and offset helpers are tested, but the WASM binary is not loaded in Bun
- **Spreadsheet (Univer)**: dynamically imported behind a code-split boundary; the snapshot/sync helpers are tested, not the full workbook

---

Source: `CLAUDE.md`, `core/src/settings.ts`, `core/test/helpers.ts`, `core/test/vault.test.ts`, `core/test/engine.test.ts`, `core/test/server.test.ts`, `core/test/relay.test.ts`, `core/test/terminal.test.ts`, `core/test/daemonViz.test.ts`, `core/test/daemon.test.ts`, `core/test/changeClassifier.test.ts`, `core/test/agents.test.ts`, `core/test/layout.test.ts`, `core/test/layout-cache.test.ts`, `core/test/sse.test.ts`, `core/test/settings.test.ts`, `core/test/asyncCache.test.ts`, `core/test/schema/settingsSchema.test.ts`, `core/test/schema/integration.test.ts`, `core/test/bases/query.test.ts`, `core/test/srs/scheduler.test.ts`, `core/test/drawing/model.test.ts`, `core/test/bug-fixes.test.ts`, `app/src/panes.test.ts`, `app/src/settings.parity.test.ts`, `app/src/graph/labelSelection.test.ts`, `app/src/graph/collide.test.ts`, `app/src/bases/flashcardsQueue.test.ts`, `app/src/editor/tableModel.test.ts`, `app/src/calendar/EventStore.test.ts`, `app/package.json`, `core/package.json`, `package.json`, `app/tsconfig.json`, `core/tsconfig.json`, `mcp/tsconfig.json`, `relay/tsconfig.json`, `relay/package.json`, `core/test/liveGate.ts`, `core/test/support/mockLlm.ts`, `core/test/support/backendEnv.ts`, `core/test/support/fakeAcpAgent.ts`, `core/test/support/openclawGateway.ts`, `core/test/chatProviders/claudeMocked.test.ts`, `core/test/chatProviders/opencodeMocked.test.ts`, `core/test/chatProviders/codexMocked.test.ts`, `core/test/chatProviders/gooseMocked.test.ts`, `core/test/chatProviders/geminiMocked.test.ts`, `core/test/chatProviders/clineMocked.test.ts`, `core/test/chatProviders/openclawMocked.test.ts`, `core/test/chatProviders/acpFakeAgent.test.ts`, `core/src/chatProviders/acp/agents.ts`, `relay/test/wrap.test.ts`
