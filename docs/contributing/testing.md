# Testing

Bismuth's tests run on Bun's built-in runner (`bun:test`) in every workspace, and git hooks run them for you: the fast tests a change can reach on commit, and the slow suites too on push.
This page is for contributors.
It covers running and filtering tests, what the hooks enforce, how to write a test, and which guard tests fail when a change leaves something out of sync.
Browser-based checks of the UI have their own page, [Visual checks](visual-checks.md).

```bash
bun test core/test/vault.test.ts   # one file, exact path
bun test vault                     # every file whose path contains "vault"
bun run test:fast                  # everything except the slow suites, in parallel, then the watcher files one at a time
bun test                           # everything, slow suites included, one file at a time
bun run typecheck                  # tsc --noEmit in every workspace
bun run gate                       # what the pre-commit hook runs, by hand
bun run gate:tree                  # typecheck + fast tests for HEAD's tree: the merge check
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

These tests skip without failing.

| Skipped when | Why | Applies to |
|---|---|---|
| `BISMUTH_FAST_TESTS=1` | The suite is slow: it spawns real agent binaries, PTYs or websockets, or runs the layout benchmark | The pre-commit gate sets it; plain `bun test` and CI leave it unset, so everything runs |
| The agent binary is not installed | A mocked-CLI test has nothing to drive | `claude`, `opencode`, `codex`, `goose`, `gemini`, `cline`, `openclaw` |
| `BISMUTH_LIVE_TESTS` is not `1` | The test spends a real account's quota | The live block in `core/test/chat.test.ts` |
| `OPENCODE_CHAT_LIVE` is not `1` | The benchmark needs opencode 2 and LM Studio serving `qwen/qwen3.5-9b` at an 8192-token window, and takes minutes | `bench/opencodeChat.test.ts` |

A skipped test is not a pass. Read the `skip` count in the summary when you expect a suite to run.

## What do the commit and push hooks run?

Both hooks live in `.githooks/`. A fresh clone enables them with `bun run hooks:install`, which sets `core.hooksPath`.

| Hook | Runs | Scope |
|---|---|---|
| `pre-commit` | `scripts/gate.ts` | Typecheck of every workspace and the fast tests your change can reach, then the design-system steps |
| `pre-push` | `scripts/check-docs.ts --pre-push`, then `bun run gate:tree --full` | Docs check (links, anchors, history lint, cited commands, workspace parity), then the typecheck and every test the push can reach, slow suites included; a tree that already passed the fast tier runs only its slow suites |

The commit gate runs these steps and stops at the first failure:

1. **Typecheck** across all workspaces, whenever a code, config or stylesheet file changed. The workspaces import each other's source, so it is the step that catches a change in one breaking another's types. It runs at the same time as step 2.
2. **Fast tests** (`BISMUTH_FAST_TESTS=1`) the change can reach, in any workspace: see [Which tests does a change run?](#which-tests-does-a-change-run). Touching `package.json`, `bun.lock`, `tsconfig.base.json`, `bunfig.toml`, `scripts/` or `.githooks/` runs every test.
3. **Design-system gate and `tokenLint`** when a staged path is under `app/src/`, `design/` or `scripts/designSystem/`, or is `DESIGN.md`. See [Visual checks](visual-checks.md#how-do-the-design-system-gate-and-tokenlint-work).
4. **`bench/moduleClassCheck.ts`** when a staged path is an `app/src/**/*.css` file. It builds the app, so it is the slowest step. A change to a `.tsx` file alone does not trigger it, so run it by hand after editing class names in TSX.

The gate reads the working tree, not the staged snapshot, and selects tests from every path that differs from `HEAD`, staged or not.
When the tree the commit records has already passed, steps 1 and 2 print `already passed` and are skipped: see [Skip a tree that already passed](#skip-a-tree-that-already-passed).

Skip a gate deliberately, for example for a work-in-progress commit on a branch:

```bash
BISMUTH_SKIP_GATE=1 git commit …    # skip the commit gate (or the push test run)
git commit --no-verify              # skip every hook
```

`BISMUTH_SKIP_GATE=1 git push` skips only the test run; the docs check still runs. A push that only deletes branches skips the test run.

A failing gate prints the failing step's output and the path of a file holding the full output of every step, so the failure can be handed over by path.

## Which tests does a change run?

A gate runs every test file that can reach a changed file, in any workspace, and no other file.
A test file reaches a file it imports, directly or through other files, or replaces with `mock.module`, and a file it names by path or builds the path of from `import.meta.dir`.
A test that spawns `bun run cli/src/index.ts` reaches the whole CLI; a test that walks `app/src/` with `readdirSync` reaches every file under it, including a file you just created.

Print the selection for a set of paths:

```bash
bun run scripts/testGraph.ts cli/src/commands/calendar.ts
```

The selection widens where the dependency cannot be read from the code:

| Change | Runs |
|---|---|
| A shared root file: `package.json`, `bun.lock`, `tsconfig.base.json`, `bunfig.toml`, `scripts/`, `.githooks/` | Every test |
| A file inside a workspace that no file loads, names or reads, such as a fixture read through a computed path | Every test in that workspace |
| Anything | The always-run tests: those that read a repo file through a path the graph cannot evaluate |

A docs-only commit runs the tests that read `docs/`.
If a test reads a repo file through a path built at run time from something other than `import.meta.dir`, `__dirname` or the cwd, a change to that file selects the test only through the always-run rule; build such paths with `join(import.meta.dir, …)` so the dependency is visible.

## Skip a tree that already passed

A gate records a pass against the git tree it tested, and skips a tree that already passed.
A tree id names the exact content of every tracked file, so a pass holds in every worktree and for every commit with that tree: a branch rebased onto `main` and fast-forward merged is not tested again.

A tree has passed when it passed the whole tier, or when the tests a diff from a base tree selects passed and that base tree has passed.
A pass is recorded only when the working tree had no unstaged or untracked changes, so what ran was exactly the tree.
A full pass (slow suites included) counts as a fast pass; a record from another Bun version does not count.
Records live in `.git/bismuth-gate/passes.jsonl`; `--no-cache` ignores them for one run.

## Check a merge before it lands

`bun run gate:tree` runs the typecheck and the fast tests for `HEAD`'s tree, and records the pass.

```bash
bun run gate:tree                   # base: the upstream, else HEAD~1
bun run gate:tree --base "$M^1"     # a merge commit M, against main before the merge
bun run gate:tree --full            # slow suites too: what pre-push runs
bun run gate:tree --no-cache        # ignore and do not write pass records
```

When `HEAD`'s tree already passed, it prints `already passed` and runs nothing.
When `HEAD` is a merge commit and both parents' trees passed, it runs only the tests that both sides' diffs select, and the typecheck only when both sides changed code: a test that one side's diff alone reaches sees the same files as on the other parent, where it passed. A merge of a branch whose commits passed their own gates therefore runs the always-run tests and the tests both sides touch.
Otherwise, when the base passed, it runs only the tests the diff from the base selects; with no passed base it runs every test.
With `--full` on a clean tree that already passed the fast tier, it runs only the slow suites in the selection and no typecheck, since everything else already passed on those exact files.
The pre-commit gate (`bun run gate`) checks nothing on a merged tip with nothing staged, so a merge uses `gate:tree`.

## Wait for another test run

A gate, `bun run test:fast` and `bun run gate:tree` take a machine-wide test lock and wait while another run holds it.
Parallel suites from several checkouts make the watcher tests time out, so only one suite runs at a time; a single `bun test <file>` takes no lock.
While waiting, the gate prints `[test lock] waiting` and the holder's owner line every 30 seconds.

The lock is the directory `.claude/coord/test.lock` in the main checkout, shared by every worktree; its `owner` file names the holder and, as `at=`, when it took the lock in epoch milliseconds.
A run waiting for the lock writes `test.lock.waiting/<pid>` beside it, removed once it takes the lock or exits.
Each release appends a JSON line to `.claude/coord/test-lock-history.jsonl` with the label, the checkout, and how long the run held the lock and waited for it; tools read the holder, the waiters and that history to estimate when the lock frees up.
A lock whose holder process has exited is taken over.
A lock made by hand (`mkdir` of the directory, with no `pid=` in its owner line) is waited on until it is removed or an hour old; a session holding one runs its gates with `BISMUTH_TEST_LOCK_HELD=1`, or they wait on its own lock.

## Run the type checker

`bun test` and the production build do not run `tsc`. Type errors only show up in `bun run typecheck` and in the commit gate.

```bash
bun run typecheck
(cd core && bunx tsc --noEmit)     # one workspace
```

`bun run typecheck` runs `tsc --noEmit` from inside each of `core`, `app`, `cli`, `mcp`, `relay`, `memory` and `daemon`, in that order, and stops at the first failure. The gates run the same per-workspace checks at once. Each workspace pins its own `typescript` in its `package.json`, so one compiler version never leaks into another.

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
busy, and `bun run test:fast` runs most files four at a time beside whatever other checkouts are testing,
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
It points `BISMUTH_RUN_DIR` at a fresh temp directory (one per file under `--parallel`), so a core a test boots never registers in the real `~/.bismuth/run`, and a CLI a test spawns never sees another worker's cores.
It also points `BISMUTH_HOME` at a fresh temp directory, which replaces `~/.bismuth` for everything that resolves the machine-wide home through `bismuthHome()` (the daemon's `vaults.json`, the run registry, gcal credentials, the notifier pointer, scratch files). Under `bun test` (`NODE_ENV=test`) `bismuthHome()` throws when `BISMUTH_HOME` is unset, so run `bun test` from the repo root, where `bunfig.toml` loads the preload. The preload also makes `Bun.spawn` and `Bun.spawnSync` pass the current `process.env` to a child that gets no `env` of its own, because Bun's default is the environment the process started with and would drop every override above. `core/test/testHomeGuard.test.ts` fails when a machine-wide path resolves into the real `~/.bismuth` or a temp vault can reach the real registry.

### A test that waits on the vault watcher

A test file that waits on real file-watch events is listed in `WATCHER_TESTS` in `scripts/fastTests.ts`, so `bun run test:fast` and the gates run it alone, after the parallel phase.
macOS delivers file events late, or drops them, while other processes churn files, and parallel test workers are that churn: beside them a watcher test times out on an event that has not arrived, and alone it passes.
A watcher test file left off the list fails at random, not every run.

A test that waits on the vault watcher reads the server's `/events` stream through `openVaultEvents(base, vault)` from `core/test/support/vaultEvents.ts`, never a fixed sleep.
The watcher takes seconds to go live on a loaded machine, then reports the writes made just before it started.
`quiesce()` writes a marker file and resolves once the marker's frame arrives, by which point everything the watcher saw earlier is published; bracket an action between two `quiesce()` calls to assert that nothing else happened.
Give such a test the `WATCH_TEST_TIMEOUT_MS` timeout, so a missing frame fails with the frames that did arrive, and derive any deadline of its own from it rather than a fixed few seconds.
To let a fixture's own writes drain before a server boots, call `waitForFsQuiet(dir)` from `core/test/helpers.ts`.

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

**The opencode chat benchmark is opt-in too.** `OPENCODE_CHAT_LIVE=1 bun test bench/opencodeChat.test.ts` drives the real opencode chat driver against LM Studio on `127.0.0.1:1234` with `qwen/qwen3.5-9b` loaded at 8192 tokens, through a logging proxy.
It checks four things: a first turn that overflows the window retries on the compact prompt and leaves one user message, the agent list and an agent switch, the model list's names, groups and detected window, and thinking turned off and on.
With the variable set, a missing prerequisite fails the run instead of skipping it.

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
| `cli/test/startupImports.test.ts` | The CLI entry point statically imports a module listed in its `LOAD_ON_USE`, which then loads on every `bismuth` start; import it with `await import()` inside the command that uses it |
| `app/src/keybindingCoverage.test.ts` | A file outside the allow-list hardcodes a key literal instead of reading a `KEYBINDING_CATALOG` id |
| `app/src/cssLayering.test.ts` | A class emitted as a runtime string (`bismuth-`, `callout-`, `cm-`) is defined inside a CSS module, or `global.css`'s page-frame section gains more class rules than its pinned ceiling |
| `app/src/cssComments.test.ts` | A CSS comment contains `*/` early and swallows the next rule |
| `app/src/ui/oneButton.test.ts` | Production code renders a raw `<button>` or imports `ui/Button` directly |
| `app/src/ui/uiLint.test.ts` | The lowercase-label and icon-name lint helpers for `TextButton` and `IconButton` regress |
| `app/src/ui/barDropLevels.test.ts` | A `data-bar-drop` level is not one `barFit.ts` defines, or the toolbar hides controls by width instead of by fit |
| `core/test/guides.test.ts` | A Bases authoring page is missing for a layout, lacks its three fixed sections, or cites a missing docs page |
| `cli/test/guideCommands.test.ts` | A `bismuth …` command shown in a guide is not a real CLI command |
| `cli/test/mcpParity.test.ts` | An MCP tool has no CLI twin in `CLI_TWINS`, a twin names a missing command, or the server lists a tool other than `bismuth_cli` and the memory tools |
| `cli/test/mcpArgParity.test.ts` | A tool parameter or a twin command's flag or positional has no partner and no `ARG_EXCEPTIONS` entry, a command's `args` disagrees with what its `run` reads, or an argv mapper drops a parameter |
| `cli/test/vaultFromCwd.test.ts` | A flagless command inside a vault stops resolving that vault, `--vault` or `BISMUTH_VAULT` stops winning over the working directory, or the run registry stops matching that vault to its app |
| `core/test/agentEnvFile.test.ts` | The env file `CLAUDE_ENV_FILE` names stops putting the bismuth bin directory on `PATH`, drops the user's own env file, or `agentShellEnv` stops aiming at the vault |
| `mcp/test/serverInstructions.test.ts` | The MCP server instructions grow past their size pin or name a missing docs page |
| `core/test/agentBackends/catalogParity.test.ts` | A backend's capability flag in `catalog.ts` is true but its `CHAT_BACKENDS` entry lacks the matching verb, or the reverse |
| `core/test/noRawMkdtemp.test.ts` | A test calls `mkdtemp` instead of `tempDir` |

## What does `bun test` not cover?

- **Mounting components.** No test mounts a Solid component. Storybook stories and the [visual checks](visual-checks.md) cover rendering.
- **CodeMirror editor interactions.** Pure helpers (parsers, completers) are tested; live view state needs a real DOM.
- **Tauri APIs** (`@tauri-apps/api`, `@tauri-apps/plugin-*`). They are stubbed or skipped; only native builds exercise them.
- **The spellchecker WASM** (`harper.js`). Its store and offset helpers are tested; the binary is not loaded.
- **The sheet editor** (Univer). It loads behind a code-split boundary; the snapshot and sync helpers are tested, not the workbook.
- **Canvas output.** The graph renderer is tested headlessly with a recording 2D context; pixels need a browser check.

## How it works

`scripts/gate.ts` decides what a commit runs; `plan`, `touchesDesignSystem` and `touchesStylesheets` pin its routing in `scripts/gate.test.ts`.
`scripts/treeGate.ts` holds the steps the commit gate, the merge check and pre-push share: `planTests`, `startTypecheck` and `runChecks`.
Both strip git's repository-location variables (`sanitizeGitEnv`) from the children they spawn, so tests that run `git` against temp directories cannot write into the real repository.

`scripts/testGraph.ts` builds the dependency graph and selects tests (`buildGraph`, `selectTests`, `alwaysTests`).
Imports come from Bun's own parser and resolver (`Bun.Transpiler.scanImports`, `Bun.resolveSync`), so type-only imports, which cannot change a test's result, are not edges.
Path literals and paths built from `import.meta.dir` are read from the file with comments stripped, and `foldPath` evaluates `join`, `resolve`, templates, `+` and `new URL(…, import.meta.url)`.
`scripts/testGraph.test.ts` pins each edge kind on small in-memory repos.

`scripts/fastTests.ts` turns a selection into phases (`testPhases`): the parallel phase across `testWorkers()` processes (half the cores, capped by memory; `BISMUTH_TEST_WORKERS` overrides it), then `WATCHER_TESTS` one at a time, then, in the full tier, the files that import `core/test/slowGate.ts` one at a time.
The parallel phase passes `--timings` with the per-file durations of earlier runs (`.git/bismuth-gate/timings.json`, refreshed by `--update-timings`), so Bun starts the slowest files first.
A selection is passed as `./`-prefixed paths, because a bare path is a substring match.
`scripts/passCache.ts` reads and writes the pass records (`isGreen`, `recordPass`), and `scripts/testLock.ts` holds the test lock (`acquireTestLock`).

The CLI end-to-end suite is split across `cli/test/cli*.test.ts`, which share `cli/test/cliHarness.ts`, because Bun runs files in parallel but the tests inside one file one at a time.

`core/test/slowGate.ts` (`shouldRunSlowTests`) is opt-out: it returns false only when `BISMUTH_FAST_TESTS=1`, so a forgotten flag never drops a suite. `core/test/liveGate.ts` (`shouldRunLiveTests`) is the opt-in sibling.

`.githooks/pre-push` runs `scripts/check-docs.ts --pre-push`, which checks relative `.md` links, `page.md#heading` anchors, the history-word lint, the `bun run` scripts CLAUDE.md cites, and workspace parity, then warns when source changed without docs.
Run `bun run scripts/check-docs.ts` by hand to check a docs change.

Source: `scripts/gate.ts`, `scripts/treeGate.ts`, `scripts/testGraph.ts`, `scripts/fastTests.ts`, `scripts/passCache.ts`, `scripts/testLock.ts`, `scripts/check-docs.ts`, `cli/test/cliHarness.ts`, `.githooks/pre-commit`, `.githooks/pre-push`, `bunfig.toml`, `package.json`, `tsconfig.base.json`, `core/test/setup.ts`, `core/test/testHomeGuard.test.ts`, `core/test/spawnEnv.ts`, `core/test/helpers.ts`, `core/test/tempDirs.ts`, `core/test/slowGate.ts`, `core/test/spawnBudget.ts`, `core/test/ports.ts`, `core/test/support/vaultEvents.ts`, `core/test/upgrade/`
