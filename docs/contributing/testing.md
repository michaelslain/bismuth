# Testing

This document is the canonical reference for how tests work in Bismuth, covering the test runner, file conventions, the 902-test suite across `core/` and `app/`, how to run and filter tests, how to add new tests, the TypeScript type-check gate, and a tour of every key test file and the patterns they establish.

---

## Test runner

Bismuth uses **Bun's built-in test runner** (`bun:test`) for all tests — both backend (`core/`) and frontend (`app/`). There is no Jest, Vitest, or Mocha. Tests use the `bun:test` import:

```ts
import { test, expect, describe, it, beforeEach, afterEach } from "bun:test";
```

All 902 tests across 81 files run in roughly 10 seconds on a modern laptop.

---

## Running tests

### Run all tests (recommended baseline)

From the repo root:

```bash
bun test core
```

This discovers every `*.test.ts` file under `core/` **and** `app/src/` (Bun resolves both workspaces). Output:

```
bun test v1.3.9 (cf6cdbbb)

 902 pass
 0 fail
 2525 expect() calls
Ran 902 tests across 81 files. [10.24s]
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

The test runner does not run `tsc` — type errors only surface as a separate gate. To type-check the full app (which also checks `core/src/` because `app/tsconfig.json` includes it):

```bash
app/node_modules/.bin/tsc --project app/tsconfig.json --noEmit
```

`app/tsconfig.json` is configured with `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`, and `"noFallthroughCasesInSwitch": true`. Test files (`*.test.ts`) are excluded from the app type-check via `"exclude": ["src/**/*.test.ts"]` so test-only stubs do not pollute the production types.

To type-check core alone:

```bash
app/node_modules/.bin/tsc --project core/tsconfig.json --noEmit
```

Both `app/tsconfig.json` and `core/tsconfig.json` use `"noEmit": true` — they only check, never compile.

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
| `app/src/graph/` | Label selection, collision radius, agent graph, you-node tests |
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

const dir = mkdtempSync(join(tmpdir(), "oa-vault-"));
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

`daemon.test.ts` sets `OA_CLAUDEBOT_HOME` to a fresh tmp dir per test (via `makeHome(files)`) and cleans up in `afterEach`. Tests degrade-gracefully behavior with missing files, `listDevices`/`getOwner`/`setOwner` contract shapes, `setCronEnabled`/`setProcessEnabled` writes, and `daemonStatus.running` detection via `daemon.pid`.

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

- `readSettings` returns `null` when `settings.yaml` is absent
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

Source: `/Users/michaelslain/Documents/dev/bismuth/CLAUDE.md`, `/Users/michaelslain/Documents/dev/bismuth/core/test/helpers.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/vault.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/engine.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/server.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/relay.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/terminal.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/daemonViz.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/daemon.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/changeClassifier.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/agents.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/layout.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/layout-cache.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/sse.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/settings.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/asyncCache.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/schema/settingsSchema.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/schema/integration.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/bases/query.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/srs/scheduler.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/drawing/model.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/core/test/bug-fixes.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/panes.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/settings.parity.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/graph/labelSelection.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/graph/collide.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/bases/flashcardsQueue.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/editor/tableModel.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/src/calendar/EventStore.test.ts`, `/Users/michaelslain/Documents/dev/bismuth/app/package.json`, `/Users/michaelslain/Documents/dev/bismuth/core/package.json`, `/Users/michaelslain/Documents/dev/bismuth/package.json`, `/Users/michaelslain/Documents/dev/bismuth/app/tsconfig.json`, `/Users/michaelslain/Documents/dev/bismuth/core/tsconfig.json`
