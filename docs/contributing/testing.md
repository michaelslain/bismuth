# Testing

Bismuth's tests run on Bun's built-in runner (`bun:test`) in every workspace, and git hooks run them for you: a fast gate on commit and the full suite on push.
This page is for contributors.
It covers running and filtering tests, what the hooks enforce, how to write a test, and which guard tests fail when a change leaves something out of sync.
Browser-based checks of the UI have their own page, [Visual checks](visual-checks.md).

```bash
bun test core/test/vault.test.ts   # one file, exact path
bun test vault                     # every file whose path contains "vault"
bun run test:fast                  # everything except the slow suites, four files at a time
bun test                           # everything, slow suites included
bun run typecheck                  # tsc --noEmit in every workspace
bun run gate                       # what the pre-commit hook runs, by hand
```

## Run one test file or a subset

Pass an exact path to run one file, or a bare pattern to run every file whose relative path contains it.

```bash
bun test core/test/vault.test.ts   # exactly one file
bun test app/src/panes.test.ts
bun test bases/query               # every path containing "bases/query"
bun test -t "wikilink"             # only tests whose NAME matches the regex
bun test --watch core/test/vault.test.ts
```

Check the file count in the summary line: a pattern is a substring match on the path, so `bun test bases/query` matches `query.test.ts`, `queryBlock.test.ts` and the app's `queryGen.test.ts`, not one file.

### Why `bun test core -- <pattern>` runs too much

`bun test core -- <pattern>` does not filter.
Bun's positional arguments are OR'd substring matches on the file path, and `core` is one of them.
It matches every file under `core/test/`, so appending a pattern never narrows the run.
It can widen it: a pattern that matches a file outside `core/` adds that file to the set.
Drop the `core`/`app` argument and pass an exact path or a bare pattern instead.

`core` and `app` are not workspace selectors. `bun test core` is the conventional "most of the suite" run only because `core/` holds the most test files. Plain `bun test` from the repo root is the only command that runs every workspace.

### Tests that skip themselves

Three kinds of test skip without failing.

| Skipped when | Why | Applies to |
|---|---|---|
| `BISMUTH_FAST_TESTS=1` | The suite is slow: it spawns real agent binaries, PTYs or websockets, or runs the layout benchmark | The pre-commit gate sets it; plain `bun test` and CI leave it unset, so everything runs |
| The agent binary is not installed | A mocked-CLI test has nothing to drive | `claude`, `opencode`, `codex`, `goose`, `gemini`, `cline`, `openclaw` |
| `BISMUTH_LIVE_TESTS` is not `1` | The test spends a real account's quota | The live block in `core/test/chat.test.ts` |

A skipped test is not a pass. Read the `skip` count in the summary when you expect a suite to run.

## What do the commit and push hooks run?

Both hooks live in `.githooks/`. A fresh clone enables them with `bun run hooks:install`, which sets `core.hooksPath`.

| Hook | Runs | Scope |
|---|---|---|
| `pre-commit` | `scripts/gate.ts` | Typecheck of every workspace, then the fast tests for the workspaces your staged files touch |
| `pre-push` | `scripts/check-docs.ts --pre-push`, then `bun test` | Docs check (links, anchors, history lint, cited commands, workspace parity), then the full suite with slow suites included |

The commit gate runs these steps in order and stops at the first failure:

1. **Typecheck** across all workspaces, whatever you staged. It is the only step that catches a change in one workspace breaking another's types.
2. **Fast tests** (`BISMUTH_FAST_TESTS=1`, four files at a time, as `bun run test:fast` runs them) for the affected workspaces only. Editing `app/` does not re-run `daemon/`. Touching `package.json`, `bun.lock`, `tsconfig.base.json`, `bunfig.toml`, `scripts/` or `.githooks/` widens the run to every workspace.
3. **Design-system gate and `tokenLint`** when a staged path is under `app/src/`, `design/` or `scripts/designSystem/`, or is `DESIGN.md`. See [Visual checks](visual-checks.md#how-do-the-design-system-gate-and-tokenlint-work).
4. **`bench/moduleClassCheck.ts`** when a staged path is an `app/src/**/*.css` file. It builds the app, so it is the slowest step. A change to a `.tsx` file alone does not trigger it, so run it by hand after editing class names in TSX.

A commit that stages only docs, or other files outside the workspaces, skips the gate. The gate reads the working tree, not the staged snapshot.

Skip a gate deliberately, for example for a work-in-progress commit on a branch:

```bash
BISMUTH_SKIP_GATE=1 git commit …    # skip the commit gate (or the push test run)
git commit --no-verify              # skip every hook
```

`BISMUTH_SKIP_GATE=1 git push` skips only the full test run; the docs check still runs. A push that only deletes branches skips the test run.

## Run the type checker

`bun test` and the production build do not run `tsc`. Type errors only show up in `bun run typecheck` and in the commit gate.

```bash
bun run typecheck
(cd core && bunx tsc --noEmit)     # one workspace
```

`bun run typecheck` runs `tsc --noEmit` from inside each of `core`, `app`, `cli`, `mcp`, `relay`, `memory` and `daemon`, in that order, and stops at the first failure. Each workspace pins its own `typescript` in its `package.json`, so one compiler version never leaks into another.

Every workspace `tsconfig.json` extends `tsconfig.base.json`, which sets `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, bundler module resolution and `noEmit`.
The `app` program also checks the `core/src/` files it imports, and it excludes `*.test.ts` so test stubs do not pollute production types.
Because `app` excludes tests, a compile-time assertion has to live in a normal `src` module to be evaluated; `app/src/keybindingsCoverage.ts` is an example.

## Where do tests live?

A test sits next to the module it covers, or one directory above it. There is no `__tests__` directory.

| Location | Covers |
|---|---|
| `core/test/` | Backend modules in `core/src/`, with subdirectories mirroring `core/src/` (`bases/`, `srs/`, `drawing/`, `schema/`, `gcal/`, `theme/`, `chatProviders/`) |
| `core/src/` | A few colocated tests: `routes/routeTable.test.ts`, the `statusBar*` modules, `assetFetch`, `bismuthHome` |
| `core/test/upgrade/` | What an update does to an existing user's data |
| `core/test/support/` | Mock LLM server, fake ACP agent and other harness code |
| `app/src/**` | Frontend tests colocated with their module (`panes.test.ts` beside `panes.ts`) |
| `cli/test/`, `mcp/test/`, `daemon/test/`, `memory/test/`, `relay/test/` | One directory per workspace |
| `scripts/`, `bench/` | The gate, the docs check and the pure halves of bench tools |

## Write a test

### A backend module

1. Create `core/test/<module>.test.ts`, or a file in the matching subdirectory.
2. Import from `bun:test` and from the module under test by relative path.
3. Allocate directories with `tempDir(prefix)`, or use `makeSampleVault()`.

```ts
// core/test/mymodule.test.ts
import { test, expect } from 'bun:test'
import { myFunction } from '../src/mymodule'

test('does the right thing', () => {
    expect(myFunction('input')).toBe('expected')
})
```

Run it with `bun test core/test/mymodule.test.ts`.

### A frontend module

Create `app/src/<path>/<module>.test.ts` beside the source. Keep the logic under test in a plain `.ts` module with no framework imports. Pure parsers, state machines and models test well. No test file mounts a Solid component; verify components through their Storybook stories instead.

A test that needs a DOM can install `happy-dom` explicitly with `new GlobalWindow()`, as `app/src/graph/AsciiGraphRenderer.test.ts` does.

### An HTTP endpoint

Start the real server on a free port with `createServer({ vault, memory, port: 0 })` and call it with `fetch`. Always stop it in a `finally` block, or the port leaks between tests.

```ts
import { createServer } from '../src/server'
import { makeSampleVault } from './helpers'

test('GET /my-route returns the right shape', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const res = await fetch(`http://localhost:${server.port}/my-route`)
        expect(res.status).toBe(200)
    } finally {
        server.stop(true)
    }
})
```

### A test that starts a process or a server

A test file whose tests start a process (the CLI, a shell, a fake agent binary, `git`) or a worker
calls `useSpawnBudget()` once after its imports. Process start-up slows down when the machine is
busy, and `bun run test:fast` runs four files at a time beside whatever other checkouts are testing,
so Bun's 5-second default fails such a test on the clock while the behaviour it checks is fine. The
budget raises that file's default to 30 seconds; a test that really hangs still fails.

A test never binds a fixed port. Pass `port: 0` to `Bun.serve` or `createServer` and read
`server.port`; use `freePort()` for a port handed to a subprocess (`core/src/server.ts --port`) or
one that must have no listener. Two suites running at once otherwise take the same port, and a
readiness probe can reach the other suite's server.

```ts
import { useSpawnBudget } from '../../core/test/spawnBudget'
import { freePort } from '../../core/test/ports'

useSpawnBudget()

const port = freePort()
```

### A new settings section

After adding a top-level section to `core/src/schema/settingsSchema.ts`:

1. Add the section name to the hardcoded key list in `core/test/schema/settingsSchema.test.ts`.
2. Add the matching field to the `Settings` interface in `app/src/settings.ts`. `DEFAULTS` derives from the schema.
3. Run `bun run test:bless-schema` and commit the snapshot diff, as [Upgrade tests](#what-do-the-upgrade-tests-protect) explains.
4. `app/src/settings.parity.test.ts` then fails on any leaf that lacks a default or a `doc` string.

### Import a Solid component without breaking the test

If a test imports a module that pulls in a `.tsx` Solid component, even indirectly, `bun test` can fail with `Cannot find module 'react/jsx-dev-runtime'` instead of running.
Bun resolves the JSX runtime from the working directory: it reads `app/tsconfig.json` (`jsxImportSource: "solid-js"`) when run inside `app/` and falls back to React when run from the repo root.
The gate runs from the repo root, so the failure appears there.

The fix is to keep the code under test in a module with no `.tsx` imports.
`app/src/pickResult.ts` is separate from `appWindow.ts` for this reason, and `app/src/ui/toastStore.ts` holds the toast state so modules can import it without importing `ui/ToastHost.tsx`.
Import from `ui/toastStore`, not `ui/ToastHost`, in any module you want to unit test.
Do not turn a production import into a lazy `await import(...)` only to dodge the problem.

### Make module-level side effects testable

A module that opens a connection or starts a timer at import time cannot be imported by a test: Bun has no `EventSource`, and a leaked timer outlives its test.
Export a `start(deps?)` function that performs the side effects and returns a disposer, and call it once from the app boot.
`app/src/serverVersion.ts` does this: `start()` accepts the `EventSource` factory, the version fetch and the timer functions, so `app/src/serverVersionStart.test.ts` drives the whole chain with fakes.

## Test helpers

`core/test/helpers.ts` provides two builders.

- `makeSampleVault()` returns `{ vault, memory }`: three notes (`essay.md`, `housing.md`, `internship.md`) and one memory note (`michael-profile.md`) in fresh temp directories. Each call is isolated, so tests that write cannot affect each other.
- `makeVault(files, prefix?)` builds a vault from a `{ relativePath: content }` map.

`core/test/spawnBudget.ts` exports `useSpawnBudget()` and `core/test/ports.ts` exports `freePort()`,
for tests that start processes or servers ([A test that starts a process or a server](#a-test-that-starts-a-process-or-a-server)).

Allocate every temporary directory with `tempDir(prefix)` from `core/test/tempDirs.ts`, never a raw `mkdtempSync`.
`tempDir` records the path, and the root `bunfig.toml` preloads `core/test/setup.ts`, which removes every recorded directory after the run.
`core/test/noRawMkdtemp.test.ts` fails if a test file in `core`, `relay`, `memory` or `mcp` calls `mkdtemp` directly.
Use `registerTempDir(dir)` for a directory a subsystem creates itself.

The preload also points `BISMUTH_LAYOUT_CACHE_DIR` at a temp directory, so the suite never writes to the real layout cache under `~/.bismuth`.

## What do the upgrade tests protect?

`core/test/upgrade/` answers one question: if a user updates Bismuth, do they lose anything? Every other test starts from a vault the current code just created; these start from state an older build wrote. Run them alone with `bun run test:upgrade`.

- **`settingsUpgrade.test.ts`** moves each historical settings layout (a vault-root `settings.yaml`, a `.settings/settings.yaml` directory, the current `.settings` file) through the open path.
  It asserts that valid values and hand-written comments survive, that keys the schema does not know are kept rather than dropped, that keys added later read as their defaults without being written, and that reconcile is idempotent.
  A corrupt file is left alone for the user to repair.
- **`schemaSnapshot.test.ts`** pins every schema path, type, default, bound and enum member to `core/test/fixtures/upgrade/settings-schema-snapshot.json`.
  A setting's default is what every user who never touched the key is running, so changing it changes behaviour for the whole installed base.
  The test does not forbid the change; it forces it into the diff.
  After an intentional schema change, regenerate the snapshot and commit it with your change:

  ```bash
  bun run test:bless-schema
  ```

- **`taskSyntaxUpgrade.test.ts`** checks that task lines written with emoji signifiers migrate through `taskMigrate` with every field intact, that an impossible date is flagged and stays visible, and that migration is idempotent.

## How do the offline agent tests work?

The default `bun test` never calls a real model API or spends anyone's quota. Two mechanisms provide that.

**Live tests are opt-in.** The live block in `core/test/chat.test.ts` drives the real `claude` binary against the real API. It runs only when `BISMUTH_LIVE_TESTS=1` and the binary exists (`core/test/liveGate.ts`).

**Mocked-CLI tests run by default.** Each `core/test/chatProviders/<backend>Mocked.test.ts` (`claude`, `opencode`, `codex`, `goose`, `gemini`, `cline`, `openclaw`) drives a real agent binary through Bismuth's production chat driver, with the binary's base URL pointed at a local mock LLM server.
The test asserts that the fixture's exact reply text arrives, which no real model would produce verbatim.
A mocked test skips when its binary is missing or when `BISMUTH_FAST_TESTS=1` is set.
It never skips because an account is not logged in.

Start the mock server only through `startMockLlm()` in `core/test/support/mockLlm.ts`.
It runs the `llmock` binary from the `@copilotkit/aimock` dev dependency and answers Anthropic-, OpenAI- and Gemini-shaped requests from JSON fixtures (`core/test/fixtures/llm/`).
It resolves that binary by its installed path.
Never use `bunx llmock` or `npx llmock`: an unrelated npm package has the same name, and a bare-name lookup can silently start it.
Per-backend environment wiring (base-URL variables, config files) lives in `backendMockEnv()` in `core/test/support/backendEnv.ts`, and each case's comments say how far it was verified.

A **fake ACP agent** (`core/test/support/fakeAcpAgent.ts`) covers behaviour no single installed CLI can show: both model shapes of `session/new`, an authentication gate, a held prompt with a permission round trip, session-load rejection, tool calls, crashes, noisy output and split chunks.
Each is an opt-in mode selected by an environment variable (`FAKE_ACP_MODEL_SHAPE`, `FAKE_ACP_AUTH_GATE`, `FAKE_ACP_PROMPT_HOLD`, `FAKE_ACP_REJECT_SESSION_LOAD`, `FAKE_ACP_TOOL_CALL`, `FAKE_ACP_CRASH_AFTER`, `FAKE_ACP_NOISE`, `FAKE_ACP_CHUNK_SPLIT`).
With none set, the fake behaves as a plain agent.
The `acp*FakeAgent.test.ts` and `clineAuthFakeAgent.test.ts` files write the fake as a stub binary on `PATH`, so they need no real CLI.

Recording a new fixture with `llmock --record` makes real API calls with your own credentials. Run it by hand only, and never from a test or CI.

## Which guard tests fail when a change is incomplete?

Several tests exist to fail when two things that must agree drift apart. If one of these goes red after your change, you skipped a step.

| Test | Fails when |
|---|---|
| `core/src/routes/routeTable.test.ts` | The set of `METHOD /path` routes `createServer` serves differs from the expected list |
| `app/src/settings.parity.test.ts` | A settable schema leaf has no default in the frontend store, or no `doc` string |
| `core/test/schema/settingsSchema.test.ts` | The top-level section list, or the keybinding id set, differs from the schema |
| `core/test/upgrade/schemaSnapshot.test.ts` | Any schema default, type, bound or enum changed without re-blessing |
| `app/src/tokenRegistry.test.ts` | A `:root` token in `global.css` is not registered in `DESIGN_TOKENS`, or the registry and the projection disagree |
| `core/test/theme/tokensDoc.test.ts` | `docs/settings/tokens.md` differs from the token registry |
| `app/src/keybindingCoverage.test.ts` | A file outside the allow-list hardcodes a key literal instead of reading a `KEYBINDING_CATALOG` id |
| `app/src/cssLayering.test.ts` | A class emitted as a runtime string (`bismuth-`, `callout-`, `cm-`) is defined inside a CSS module, or `global.css`'s page-frame section gains more class rules than its pinned ceiling |
| `app/src/cssComments.test.ts` | A CSS comment contains `*/` early and swallows the next rule |
| `app/src/ui/oneButton.test.ts` | Production code renders a raw `<button>` or imports `ui/Button` directly |
| `app/src/ui/uiLint.test.ts` | The lowercase-label and icon-name lint helpers for `TextButton` and `IconButton` regress |
| `app/src/ui/barDropLevels.test.ts` | A `data-bar-drop` tag on a view-bar control is not in the collapse ladder |
| `core/test/guides.test.ts` | A Bases authoring page is missing for a view kind, lacks its three fixed sections, or cites a missing docs page |
| `cli/test/guideCommands.test.ts` | A `bismuth …` command shown in a guide is not a real CLI command |
| `cli/test/mcpParity.test.ts` | An MCP tool has no CLI twin in `CLI_TWINS`, or a twin names a missing command |
| `mcp/test/serverInstructions.test.ts` | The MCP server instructions grow past their size pin or name a missing docs page |
| `core/test/agentBackends/catalogParity.test.ts` | A backend's capability flag in `catalog.ts` is true but its `CHAT_BACKENDS` entry lacks the matching verb, or the reverse |
| `core/test/noRawMkdtemp.test.ts` | A test calls `mkdtemp` instead of `tempDir` |

## What does `bun test` not cover?

- **Mounting components.** No test mounts a Solid component. Storybook stories and the [visual checks](visual-checks.md) cover rendering.
- **CodeMirror editor interactions.** Pure helpers (parsers, completers) are tested; live view state needs a real DOM.
- **Tauri APIs** (`@tauri-apps/api`, `@tauri-apps/plugin-*`). They are stubbed or skipped; only native builds exercise them.
- **The spellchecker WASM** (`harper.js`). Its store and offset helpers are tested; the binary is not loaded.
- **The spreadsheet** (Univer). It loads behind a code-split boundary; the snapshot and sync helpers are tested, not the workbook.
- **Canvas output.** The graph renderer is tested headlessly with a recording 2D context; pixels need a browser check.

## How it works

`scripts/gate.ts` decides what a commit runs.
Three exported pure functions pin its routing and are unit-tested in `scripts/gate.test.ts`: `affectedWorkspaces` maps staged paths to workspaces, `touchesDesignSystem` and `touchesStylesheets` pick the design-system and `moduleClassCheck` steps, and `plan` combines them.
The gate passes `<workspace>/` with a trailing slash to `bun test`, because a bare `cli` would also match `core/test/chatProviders/clineMocked.test.ts`.
It strips git's repository-location variables (`sanitizeGitEnv`) from the children it spawns, so tests that run `git` against temp directories cannot write into the real repository.

`core/test/slowGate.ts` (`shouldRunSlowTests`) is opt-out: it returns false only when `BISMUTH_FAST_TESTS=1`, so a forgotten flag never drops a suite. `core/test/liveGate.ts` (`shouldRunLiveTests`) is the opt-in sibling.

`.githooks/pre-push` runs `scripts/check-docs.ts --pre-push`, which checks relative `.md` links, `page.md#heading` anchors, the history-word lint, the `bun run` scripts CLAUDE.md cites, and workspace parity, then warns when source changed without docs.
Run `bun run scripts/check-docs.ts` by hand to check a docs change.

Source: `scripts/gate.ts`, `scripts/check-docs.ts`, `.githooks/pre-commit`, `.githooks/pre-push`, `bunfig.toml`, `package.json`, `tsconfig.base.json`, `core/test/setup.ts`, `core/test/helpers.ts`, `core/test/tempDirs.ts`, `core/test/slowGate.ts`, `core/test/spawnBudget.ts`, `core/test/ports.ts`, `core/test/upgrade/`
