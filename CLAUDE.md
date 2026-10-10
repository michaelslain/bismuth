# CLAUDE.md

Bismuth is a local-first knowledge vault (an Obsidian-like app): markdown notes on disk, a live
knowledge graph, Bases (queries rendered as views), tasks, flashcards, calendar, drawing, sheets,
in-app terminals and AI chat. This file holds the commands, the rules that fail silently, the traps,
and where to read more. Detail lives in `docs/` (start at `docs/README.md`), which the MCP server
also serves to agents.

## Workspaces

A Bun-workspaces monorepo. `docs/overview/architecture.md` owns how they fit together.

| workspace | what it is |
|---|---|
| `core` | backend server: vault, graph, Bases, tasks, settings, HTTP/SSE/WS routes |
| `app` | Tauri + Solid + TypeScript frontend; desktop and iPad (in-process backend on mobile) |
| `cli` | the `bismuth` binary; file commands run headless, `app` commands drive a running window |
| `mcp` | stdio MCP server: docs tools, `bismuth_cli`, daemon-gated memory tools |
| `relay` | hooks-only Claude Code plugin reporting app-terminal sessions to core |
| `memory` | `@bismuth/memory`, the pure 3rd-brain memory graph; every entry point takes an explicit dir |
| `daemon` | `@bismuth/daemon`, one machine process running every enabled vault's brain (launchd/systemd) |

`core` has no package entry point: `app`, `cli` and `daemon` import it by relative path
(`../../core/src/…`). Add a dependency with `cd <workspace> && bun add <pkg>`.

## Commands

```bash
bun install                     # repo root, all workspaces
cd app && bun run dev:browser   # core on :4321 + Vite on :1420, on a generated .dev-vault/
cd app && bun run dev:app       # the same + the Tauri window, in one process group
cd app && bun run storybook     # :6006, the visual-verification surface
bun run typecheck               # tsc per workspace
bun test core                   # one workspace; pass an exact file path for one file
bun run gate                    # what pre-commit runs: typecheck + fast tests for touched workspaces
bun run visual                  # visual invariants over the stories your diff affects
cd app && bun run build         # Vite production build; `bun run tauri build` for the native app
```

Build-from-source, env vars and running two instances: `docs/overview/install.md`. Tests and
gates: `docs/contributing/testing.md`; Storybook and every `bench/` tool with its flags:
`docs/contributing/visual-checks.md`.

## Rules that fail silently

- **Tests are required to commit.** `.githooks/pre-commit` runs `scripts/gate.ts`; pre-push runs
  `scripts/check-docs.ts` and the full suite. Never bypass with `BISMUTH_SKIP_GATE`. A fresh clone
  runs `bun run hooks:install`.
- **`bun test core -- <pattern>` does not filter**: Bun's positional args are OR'd path substrings
  and `core` already matches everything. Pass the file path.
- **`BISMUTH_FAST_TESTS=1` skips slow suites**; plain `bun test` and CI run everything.
- **TypeScript is split**: `core`/`cli`/`mcp`/`memory`/`daemon` pin 7.0.2, `app`/`relay` pin ~5.6.2.
- **`SKIP` and `UNSAFE` from a `bench/` tool are not passes.** `bun run verify` needs `--port`;
  in a worktree, the default 6006 measures the main checkout's Storybook.
- **A story id comes from `meta.title`, not the file path**; a hand-built id renders a red
  "Couldn't find story" panel, not an error. List ids with `curl -s :6006/index.json`.
- **`app/.storybook/preview.ts` already projects the real theme tokens and installs a fake
  transport.** Never re-solve either per story or hardcode a stand-in token.

## Frontend house rules (`app/`)

They override framework habits, and most violations compile, render and pass tests.

- **This is Solid, not React.** Type components as `Component<Props>` from `solid-js`. Never
  destructure props: `({ color }) => …` reads the value once and never updates. Read `props.color`
  at use; copy `ui/Text.tsx`.
- **One component per file**, PascalCase filename matching the export; logic modules camelCase.
- **Every component has a colocated `<Component>.module.css` with exactly one importer.** A second
  importer means a missing component: extract it and compose it, never copy the stylesheet.
  `app/src/global.css` is the only other stylesheet: tokens, reset, classes written into
  runtime-generated HTML. No CSS `@import` (it hoists and flips precedence).
- **Module classes are hashed at build time**: a call site holding a literal class string compiles
  and matches nothing. Never `closest('.class')` or `classList` against a class name; the child
  claims its event with `stopPropagation` (which does not stop `onPointerDown`/`onDblClick`).
- **Element hooks**: `data-<name>` is a runtime hook; `data-testid` is test-only. No third form.
- **Everything is a component, even text.** Use `ui/` primitives (`Text`, `Heading`, `Label`,
  `Badge`, `Field`, …); if none fits, add the primitive.
- **One button family**: `TextButton`, `IconButton`, `IconTextButton`, `SegmentedToggle`,
  `ChipToggle`. Never a raw `<button>` or `ui/Button` directly (`ui/oneButton.test.ts`).
- **Variants are props; accept an optional `className`** merged onto the root.
- **`ViewBar` is the one view header** (graph, bases, calendar, flashcards, chat), with six named
  slots: `identity` `locus` `facet` lead, `readouts` `config` `actions` trail. A Bases view kind
  returns `ViewBarSlots` instead of stacking its own bar. Collapse is opted into with
  `data-bar-drop` or `<BarLabel long short drop>` (`ui/barDropLevels.test.ts`).
- **Pure logic lives in plain `.ts` modules** with no framework imports.
- **Every component added or changed gets a story.** The design-system gate checks components,
  stories and tokens against `DESIGN.md`; exceptions are a `design-system-ignore <check-id>: <reason>`
  comment.
- **Colour comes from tokens**: `core/src/theme/tokens.ts` + the registry
  `core/src/theme/designTokens.ts`. A new token is a `global.css` `:root` line, a `DESIGN_TOKENS`
  entry and a row in `docs/settings/tokens.md` (a test pins the rows).
- **Formatting**: no semicolons, single quotes, 4-space indent, `x => x`.
- **Agent working artifacts** (plans, ledgers, reports) go in `.claude/`, never the source tree.

## Backend conventions (`core/`)

- **Errors are `AppError`** (`core/src/error.ts`): `mutatingHandler` maps its code to a status; a
  plain `Error` becomes a 500.
- **Rendered vault HTML goes through `app/src/sanitizeHtml.ts`** before `innerHTML`, built with
  `htmlEscape.ts`.
- **Edit frontmatter with `mutateFrontmatter`** (`frontmatter.ts`), which keeps comments, key order
  and flow arrays.
- **A new graph source uses `buildGraphFromNotes`** (`graphBuilder.ts`); a directory walk uses
  `walkDir`, which skips dot-entries unless `allowDot` opts them in.
- **A mutation marks the paths it writes** (`core/src/selfWriteMarks.ts`) so the watcher drops its
  own echo.
- **An agent guide is a docs page plus one line in `mcp/src/instructions.ts`** naming when to read
  it. Every MCP tool has a CLI twin (`mcp/src/cliTwins.ts`, `cli/test/mcpParity.test.ts`).

## Traps

- **`dev:app` must not be started by `tauri.conf.json`'s `beforeDevCommand`**: that re-runs
  `dev:browser` and collides a second core + Vite pair on :4321/:1420.
- **`PORT=` does nothing.** `core/src/server.ts` takes `--port` and otherwise uses 4321; a second
  `dev:browser` dies with `EADDRINUSE`. Two instances: `docs/overview/install.md`.
- **Dev needs one owner token for both halves** (`app/scripts/dev.ts` mints it). Without it, content
  routes 403 or silently filter once a vault marks anything `chat-only`/`hidden`.
- **Settings are schema-first and sparse.** `core/src/schema/settingsSchema.ts` is the source of
  truth; `app/src/settings.ts` mirrors it (`settings.parity.test.ts`); an absent key is its default.
  There is no settings GUI: `.settings` opens in the editor like a note.
- **Commands and keybindings are pure data in `core/` plus a binding in `app/`**:
  `COMMAND_CATALOG` + `bindCommands`; `KEYBINDING_CATALOG` + `matchesKeybinding`. No key literal in
  an app command path (`keybindingCoverage.test.ts`).
- **A base has ONE flat view** (`view: <kind>`, keys top-level) and two on-disk forms: a
  `<name>.base.jsonl` file (line 1 the config object, one row per line; what new bases use) or a
  `type: base` md file. The format is sniffed from content (`core/src/bases/baseFile.ts`), so
  text-in/text-out code dispatches; anything that lists, routes or names files must handle
  `.base.jsonl` (`isBasePath`, `pickRefPath`). Config edits go through `setBaseConfigKey`, never
  `setFrontmatterKey`. Obsidian's `.base` is a different format. `parseBaseFile` silently turns an
  invalid `view:` into `table`, so `bismuth base validate` reads the raw config.
- **Tasks parse only bracketed fields** (`[due 2026-09-14]`, `[high]`, `[every week]`).
- **Flashcards collect only notes tagged `flashcards`**; perfect syntax in an untagged note yields
  nothing.
- **A ` ```draw ` fence's mode is its info string** (` ```draw ` attached, ` ```draw block `
  standalone); never infer it from a blank line. Anything that renders a note must tell a draw fence
  from an ordinary one.
- **A `.draw` file is JSON Lines** (header line, then one line per inked page). Read and write it only
  through `parseDoc`/`serializeDoc` (`core/src/drawing/model.ts`); a raw `JSON.parse` breaks.
- **Google sync state is keyed by base path** (`~/.bismuth/gcal/sync.json`). Anything that moves or
  renames a base goes through `moveEntrySynced` (`core/src/gcal/moveSynced.ts`), never bare
  `moveEntry`, or the next sync duplicates every event. Tests set `BISMUTH_GCAL_DIR` to a temp dir.
- **A binary's tags live in its companion note `<file>.<ext>.md`**, created on first edit.
- **The daemon session's MCP wiring is explicit** (`buildQueryOptions()`, `settingSources: []`);
  `inheritUserMcp` adds user scope only, because the session's cwd is the vault. `chat.ts` differs
  on purpose; do not unify them.
- **Backup's `.git/info/exclude` is an allow-list and its line order is load-bearing**
  (`docs/overview/storage.md`).
- **Mobile runs core in-process**: nothing may statically import Bun or `node:fs` on that path; go
  through `core/src/fileAccess.ts` and `app/src/api.ts`'s `Transport`.
- **`GraphView` pauses rendering while `document.visibilityState === "hidden"`**, so a background
  tab samples a blank canvas; `bench/` drives its own Chrome for this reason.
- **Source comments citing `bismuth-design/ascii/…`** name files readable only via
  `git show debe3b3a^:design/ascii/<path>`; the live design system is `DESIGN.md` + `app/src/ui/`.

## Where to read before changing something

| to work on | read |
|---|---|
| anything, first time | `docs/README.md`, then `docs/overview/architecture.md` |
| where to add an endpoint, setting, command, keybinding, view kind, token, pane type | `docs/contributing/codebase-map.md` ("Where do I add things?") |
| tests and gates | `docs/contributing/testing.md` |
| Storybook and `bench/` visual checks | `docs/contributing/visual-checks.md` |
| HTTP routes | `docs/api/http-reference.md` |
| CLI commands | `docs/cli/reference.md` (MCP↔CLI parity: `docs/mcp/overview.md`) |
| file watch, caches, SSE | `docs/overview/data-flow.md` |
| Bases | `docs/bases/overview.md`; agents writing a base: `docs/bases/authoring.md` |
| tasks / flashcards / calendar | `docs/tasks/syntax.md`, `docs/flashcards/srs.md`, `docs/calendar/overview.md` |
| settings, themes, tokens, keybindings | `docs/settings/overview.md` and its siblings |
| graph and renderer | `docs/graph/overview.md` |
| editor, ink | `docs/editor/markdown.md`, `docs/editor/ink.md` |
| chat backends | `docs/chat/overview.md`, `docs/chat/backends.md` |
| daemon | `docs/daemon/overview.md` |
| memory injection, the session-start brain, the vault map, the dream | `docs/daemon/communication.md`, `docs/vault/map.md`, `docs/daemon/memory.md` |
| feedback page, `bismuth feedback`, the hosted relay in `services/feedback/` | `docs/overview/feedback.md` |
| visibility (what agents may read) | `docs/vault/visibility.md` |
| vault semantic search, embeddings switch | `docs/vault/semantic-search.md` |
| mobile | `docs/mobile/overview.md` |
| on-disk layout | `docs/overview/storage.md` |

## Docs

`docs/` is the code-anchored reference for people, engineers and agents. Pages follow one skeleton:
what the thing is and an example first, user-facing sections, then `## How it works` with the
source files, then one `Source:` line. Write present tense about what IS: the docs gate
(`scripts/check-docs.ts`) fails on history narration ("no longer", "was removed", "legacy", issue
numbers, commit hashes) outside `docs/overview/migrating.md`, on broken links and on broken
`#anchor` links. Resync docs with code using `/update-docs`.
