# MCP server (Claude Code integration)

`mcp/` is Bismuth's stdio [MCP](https://modelcontextprotocol.io) server. It gives a Claude Code session focused access to the documentation and the `bismuth` CLI, without loading a large tool catalog into every session.

## How it loads — two paths

### Development repository

The server rides the [relay plugin](../terminal/overview.md). An app terminal's PTY runs a bare `claude` as `claude --plugin-dir <relay>`, and `relay/.mcp.json` declares the server. Claude Code starts it for that session when the plugin loads; plugin-provided MCP servers are trusted, so no flags or prompts are involved.

```json
{ "mcpServers": { "bismuth": { "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../mcp/src/server.ts"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is the loaded relay plugin dir (`relay/`), so `../mcp/src/server.ts` resolves to this workspace.

### Bundled app

The packaged app uses a machine-wide installation instead; its bundled relay is hooks-only and does not use `relay/.mcp.json`. On launch, the core sidecar runs the version-gated installer in `core/src/bismuthInstall.ts`. It copies the compiled `bismuth` and `bismuth-mcp` binaries and the `docs/` tree to `~/.bismuth/`, symlinks the CLI onto `PATH` (`/usr/local/bin`, then `~/.local/bin`), and registers the server in the user's global Claude config with `claude mcp add -s user bismuth …`, passing `BISMUTH_DOCS_DIR` and `BISMUTH_CLI`.

That makes the CLI and MCP server available to every interactive Claude session on the machine, not just Bismuth tabs. Installation is idempotent: `~/.bismuth/.version` stores a content hash of the binaries, so the installer runs again only when the bundled tools change. Use `bismuth install`, `bismuth install --status`, `bismuth uninstall`, or the in-app "Install Bismuth CLI + MCP…" command to manage it.

### Daemon sessions

The [daemon](../daemon/overview.md) is a launchd/systemd process, not an interactive Claude session, so it does not inherit the `-s user` registration by default. `buildQueryOptions` in `daemon/src/daemon/session.ts` configures the SDK's `mcpServers` explicitly for each call: `{ bismuth: { command: <~/.bismuth/bin/bismuth-mcp>, env: { BISMUTH_VAULT, BISMUTH_MEMORY_DIR, BISMUTH_DOCS_DIR, BISMUTH_CLI } } }`. Its default `settingSources: []` prevents ambient human configuration from entering an unattended session.

`settings.daemon.inheritUserMcp` is off by default. When enabled, a vault's crons use `settingSources: ['user']`, adding this machine's `~/.claude.json` MCP servers and `~/.claude/settings.json` plugins alongside the configured Bismuth server. It deliberately never enables `project` or `local`: a daemon session runs with the vault as `cwd`, and those scopes could load a vault-provided `.mcp.json` unattended under `bypassPermissions`. `--mcp-config` remains additive, while the programmatic `bismuth` entry wins a name collision with an unstamped `~/.claude.json` entry so `BISMUTH_VAULT` and the two `BISMUTH_*_CHANNEL` stamps remain intact.

`daemon/src/lib/bismuthPaths.ts` provides an `existsSync`-gated absolute binary path for launchd's minimal `PATH`, and the server receives `BISMUTH_VAULT` directly so `bismuth_cli` targets the correct vault regardless of `cwd`. If the installed tools are absent, the daemon runs without MCP rather than falling back to the SDK's permissive inherit-everything default: `settingSources` remains `[]` or `['user']`. See [daemon/overview.md](../daemon/overview.md).

The compiled binary reads `BISMUTH_DOCS_DIR` for the docs (`mcp/src/server.ts`) and `BISMUTH_CLI` for the `bismuth_cli` tool's binary (`mcp/src/cli.ts`); in the dev repo both fall back to the source tree.

## Tools (token-frugal by design)

The server in `mcp/src/server.ts` uses the low-level `@modelcontextprotocol/sdk` `Server` and `StdioServerTransport` with raw JSON Schema, not zod. Before a client calls a tool, it receives `SERVER_INSTRUCTIONS` from `mcp/src/instructions.ts`; `mcp/src/serverInstructions.test.ts` keeps that text under 160 words. The instructions do two jobs. First, they are the **guide triggers** (see [Guides](#guides) below): every time an agent creates, edits or debugs a base it is told to read `bases/authoring.md` first, and a vault conversion is pointed at its guide. Second, they prevent a common tagging mistake: an image or PDF uses the hidden companion note `<file>.<ext>.md`, set with `bismuth prop set <file.pdf> tags '[...]'`. Do not create a separate `<name>.md` solely to embed a binary and hold its tags. See [`vault/frontmatter.md`](../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs) for the complete companion-note model.

It registers **six always-on tools** (plus, when the daemon is enabled for the vault, three daemon-gated memory tools + eleven daemon-management tools — see below). The always-on count is deliberately fixed: broad capabilities (e.g. app control) route through `bismuth_cli`/`bismuth_cli_help` rather than adding always-listed schemas, because this MCP is machine-wide and every extra always-listed tool costs context in every session on the machine. The daemon-gated tools sidestep that tax entirely by only appearing inside a daemon-enabled session. Docs (guides included) are served as **pointers + snippets, not full bodies**, so a session spends tokens only on the one page it actually needs:

| Tool | Args | Returns |
|---|---|---|
| `bismuth_docs_list` | — | every doc page `{path, title}` (the index — start here) |
| `bismuth_docs_search` | `query`, `limit?` | ranked `{path, heading, snippet}` — **snippets only**, cheap |
| `bismuth_docs_read` | `path`, `section?` | one doc page, or a single `##` section, on demand |
| `bismuth_doctor` | `fix?`, `safeOnly?`, `only?`, `section?`, `vault?` | checks this machine (and a vault) for leftovers from older builds, version skew and pending migrations; `fix: true` repairs. Bridges `bismuth doctor --json` and returns the full report — reference: [cli/reference.md](../cli/reference.md#doctor-commands-commandsdoctorts) |
| `bismuth_cli` | `args: string[]` | runs the `bismuth` CLI (e.g. `["task","list","--vault","…"]`) → stdout/stderr/exit |
| `bismuth_cli_help` | `group?` | the CLI reference (all commands, or one group) |

`SERVER_INSTRUCTIONS` ends with one pointer to it: if Bismuth misbehaves after an update (missing CLI, stale MCP, daemon not running), run `bismuth_doctor` first.

Typical flow: `docs_search` → read only the top hit with `docs_read`; act with `bismuth_cli`. For a guide: `docs_read` the page the server instructions name.

Every vault feature rides `bismuth_cli` the same way — notes, search, tasks, bases/rows, flashcards, settings, and **calendar management** (discover calendar bases, event CRUD incl. recurrence/RRULE and per-occurrence overrides, categories/colors — the `calendar` group; see `cli/reference.md` § Calendar commands). No per-feature MCP tools exist by design.

## Parity

The MCP and the CLI are two doors onto one capability set. Every MCP tool has a CLI command that does the same thing, and every CLI command is reachable from MCP through `bismuth_cli`. The first half is a table, `CLI_TWINS` in `mcp/src/cliTwins.ts`; `cli/test/mcpParity.test.ts` pins both halves, so a tool added to `server.ts` without a twin fails a test instead of shipping a capability only one surface has. `bismuth_cli` and `bismuth_cli_help` are the only entries with no twin: they ARE the CLI.

| Tool | CLI twin |
|---|---|
| `bismuth_docs_list` / `bismuth_docs_search` / `bismuth_docs_read` | `docs list` / `docs search` / `docs read` |
| `bismuth_doctor` | `doctor` |
| `remember` / `recall` / `forget` | `memory remember` / `memory recall` / `memory forget` |
| `daemon_status` / `daemon_devices` / `daemon_owner` / `daemon_list` | `daemon status` / `daemon devices` / `daemon owner` / `daemon graph` |
| `cron_run` / `cron_toggle` / `process_toggle` / `daemon_logs` | `daemon cron run` / `daemon cron toggle` / `daemon process toggle` / `daemon logs` |
| `page_list` / `page_create` / `page_resolve` | `page list` / `page create` / `page resolve` |
| `bismuth_cli` / `bismuth_cli_help` | none (the bridge itself) |

The docs and memory tools call shared code in `mcp/src/docs.ts` and `mcp/src/memory.ts`, which `cli/src/commands/docs.ts` and `memory.ts` import by relative path (`mcp/` never imports `core/`; `cli/` may import `mcp/`). The daemon and doctor tools go the other way: they spawn the CLI through `runCli`. Group reference: `cli/reference.md` § Docs commands, § Memory commands.

## Guides

A few docs pages are **guides**: procedures an agent must read *before* acting, not reference it looks up when stuck.

- [`bases/authoring.md`](../bases/authoring.md): the view-kind picker and cross-cutting gotchas for writing a `type: base` note, plus one [`bases/authoring/<kind>.md`](../bases/authoring/table.md) per view kind (the 12 `ViewType`s) with a working example, its config keys and its failure modes.
- [`guides/converting-obsidian-to-bismuth.md`](../guides/converting-obsidian-to-bismuth.md): turns an Obsidian vault into a Bismuth vault in a new folder, validating with the `bismuth` CLI and reporting what was lossy. Topic pages under `guides/converting-obsidian-to-bismuth/`.
- [`guides/converting-bismuth-to-obsidian.md`](../guides/converting-bismuth-to-obsidian.md): the reverse. Topic pages under `guides/converting-bismuth-to-obsidian/`.

**The trigger is `SERVER_INSTRUCTIONS`, not a tool.** An agent never has to know a guide exists or think to search for one: the instructions every client receives before its first tool call say *every time you create, edit or debug a base (a `type: base` note or a ```` ```query ```` block), read `bases/authoring.md` first, then the page for your view kind*, and name both conversion guides. The guide itself is read with `bismuth_docs_read`.

These used to ship as **skills**: a `skills/` tree, a `bismuth_skill` MCP tool, and installer symlinks into `~/.claude/skills/`. They were folded into docs because the MCP already reached all ten backends while the skill format only auto-triggered in Claude Code, `skills.ts` duplicated `docs.ts`, and the symlinks put three skill descriptions into every Claude Code session on the machine, Bismuth or not. The installer removes its old `~/.claude/skills/<id>` symlinks (only its own, pointing into `~/.bismuth`) and `~/.bismuth/skills` on every ensure (`core/src/bismuthInstall.ts`).

Codex's `AGENTS.md` managed block (`core/src/chatProviders/codex/driver.ts`'s `CODEX_AGENTS_MD_CONTENT`, written via `core/src/agentBackends/agentsMd.ts`; opt-in per `settings.codex.writeAgentsMd`) repeats the same pointers via `bismuth_docs_read`. It doesn't inline any guide, since AGENTS.md is a memory/persona channel refreshed every session, not a place to duplicate a maintained page.

Two drift tests keep the guides honest: one authoring page per view kind, every `docs/**/*.md` path a guide cites exists, and no guide still mentions the retired skill surface (`core/test/guides.test.ts`); every `bismuth <command>` a guide shows resolves in the CLI registry via `resolveCommand` (`cli/test/guideCommands.test.ts`). `mcp/src/serverInstructions.test.ts` checks every docs path the instructions name exists.

## App control — driving a running window (ZERO new MCP tools)

A Claude session can also drive a **running Bismuth app** — list/open/close/focus tabs, run a safe command, author a daemon inbox page. This adds **no new MCP tool schemas** on purpose: the machine-wide MCP is loaded into every session on the machine, so an extra always-listed tool would tax the context of every unrelated session. Instead, app control decomposes into the existing `bismuth_cli` tool via two CLI groups the CLI already exposes — discover them with `bismuth_cli_help` (there is no `group: "app"` scoped help; the global help lists every `app …` / `page …` command):

- **`app` group** (`bismuth app windows|tabs|open|close|focus|rename|pin|reorder|run|commands`) — hits the running core's `/ui/*` routes, which relay each request over a per-window control WebSocket (`core/src/uiControl.ts` ⇄ `app/src/uiControlClient.ts`). Requires a running app (a headless CLI has no window).
- **`page` group** (`bismuth page list|create|resolve|mark-failed`) — the daemon inbox; `create` authors a validated page (`core/src/daemonPages.ts` `createDaemonPage`) so a caller never hand-writes the nested `actions[]` frontmatter. Headless (no server).

**Core discovery** (the `app` group): `--api <url>` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the run-registry (`~/.bismuth/run/<vault>.json`, written by each core on boot; matched by `--vault`/`BISMUTH_VAULT`, else the single running core) → `:4321`. In-app terminal tabs already carry `BISMUTH_API`/`CLAUDE_RELAY_URL`, so `bismuth app …` from inside a tab targets its own window with no config. Zero windows connected → a benign `404 {error:"no Bismuth window is open"}` (the daemon treats this as expected, not a retry condition); several open windows → `409`, so pass `--window <id>` (see `app windows`).

**Deliberately excluded — opening a Claude chat.** A chat tab is a live, recursive Agent-SDK session: a materially different trust boundary for an unattended caller. Enforced at two layers (POST `/ui/command` AND the frontend dispatch): `run-command` refuses a small `UI_CONTROL_BLOCKLIST` (`core/src/commands.ts` — `new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat`), and `open-tab` refuses any `::chat:` content. Full reference: [app-control.md](app-control.md).

## Memory tools (daemon-gated, per-vault)

When the [daemon](../daemon/overview.md) is enabled for the active vault, the server **conditionally** exposes three more tools — the vault's 3rd-brain memory graph. The gate is `memoryDir()` (`mcp/src/memory.ts`). It first trusts an already-set `BISMUTH_MEMORY_DIR` as-is — `core/src/terminal.ts` injects it into a Bismuth tab's PTY **only** when `settings.daemon.enabled` is on for that vault (pointing at `<vault>/.daemon/memory`), and the MCP child inherits it; the daemon's own session wiring sets it explicitly too. Otherwise — the path a **machine-wide** `-s user` session actually takes, e.g. `claude` run from a normal terminal/IDE with no Bismuth-set env at all — it resolves the vault itself (`resolveVaultRoot()`: `BISMUTH_VAULT` if set, else the current working directory walked up to a `.settings` file) and reads **that vault's own** `.settings` for `daemon.enabled` directly, never weakening the gate to "some vault exists nearby". So `ListTools` returns `memoryDir() ? [...tools, ...memoryTools] : tools` — outside a daemon-enabled vault the bot never even sees `remember`/`recall`/`forget`. (If one is somehow called with no `memoryDir()`, the handler returns an `isError` "Memory is unavailable" message.)

| Tool | Args | Returns |
|---|---|---|
| `remember` | `name`, `content`, `type?`, `tags?`, `folder?` | saves/overwrites a note in the vault's memory graph (preserves an existing note's `type`/`created`) → `{ok, name}` |
| `recall` | `query`, `folder?` | searches the graph (supports `tag:`/`type:`/`keyword:`/`link:`/`after:`/`before:` filters) → `{ok, count, notes}` |
| `forget` | `name` (may be folder-prefixed) | removes a note → `{ok, name}` |

These delegate to the shared `@bismuth/memory` graph, so the MCP tools, the daemon writer, and the relay collect-hook all read/write **one** note format against `<vault>/.daemon/memory`.

## Daemon tools (daemon-gated, per-vault)

Behind the same gate, the server also exposes **eleven daemon-management tools** — the daemon's control surface (crons, background processes, the daemon activity log, the daemon inbox/pages, daemon status + device ownership). Each **bridges an existing `bismuth` CLI command** (`daemon`/`page` groups) rather than reimplementing daemon logic, so there's one code path per operation and no `@bismuth/core` dependency in this workspace. `ListTools` appends them alongside the memory tools: `daemonEnabled() ? [...tools, ...memoryTools, ...daemonTools] : tools`.

| Tool | Bridges to | Does |
|---|---|---|
| `daemon_status` / `daemon_devices` / `daemon_owner` | `daemon status`/`devices`/`owner` | liveness + this device; heartbeating devices; read/claim owner |
| `daemon_list` | `daemon graph` | this vault's crons + processes with enabled/running/schedule/last-result |
| `cron_run` / `cron_toggle` | `daemon cron run`/`toggle` | run a cron now (e.g. `dream`); enable/pause a cron |
| `process_toggle` | `daemon process toggle` | enable/disable a background process |
| `daemon_logs` | `daemon logs` | this vault's activity log — cron outcomes, process lifecycle, brain starts, newest first |
| `page_list` / `page_create` / `page_resolve` | `page list`/`create`/`resolve` | the daemon inbox: list, author a validated page, press an action |

Full reference (args, the pure name→CLI-argv mapper, and still-missing follow-ups): [daemon-tools.md](daemon-tools.md).

## Modules

- `mcp/src/docs.ts` — pure index/search/read over `docs/` (`listDocs`/`searchDocs`/`readDoc`); section-level scoring, path-traversal-guarded (`resolveWithin()` from `mcp/src/paths.ts`). Unit-tested (`docs.test.ts`).
- `mcp/src/cli.ts` — runs the CLI: the `BISMUTH_CLI` compiled binary when set (machine-wide install), else `bun run cli/src/index.ts` (dev). Passes `BISMUTH_VAULT`/`BISMUTH_MEMORY` through; `runCli`/`cliHelp`, never throws.
- `mcp/src/memory.ts` — the daemon-gated memory tools (`remember`/`recall`/`forget`) + the `memoryDir()` gate (and `memoryDirFor(vault)`, its vault-explicit half, which the `memory` CLI group uses); delegates to `@bismuth/memory` against `BISMUTH_MEMORY_DIR`. Also exports `resolveVaultRoot()` (`BISMUTH_VAULT` else cwd walked up to a `.settings` file), which `memoryDir()` falls back to when no `BISMUTH_MEMORY_DIR` is already set — checking the resolved vault's own `daemon.enabled` directly — and which `daemon.ts`'s `daemonVaultRoot()` reuses so the two gates always agree.
- `mcp/src/daemon.ts` — the daemon-gated daemon-management tools (crons/processes/pages/status/devices/owner); the pure `daemonCliArgs` name→CLI-argv mapper (unit-tested, `daemon.test.ts`), `daemonVaultRoot()` derivation, and `daemonEnabled()` gate; bridges the `bismuth` CLI via `runCli`. See [daemon-tools.md](daemon-tools.md).
- `mcp/src/cliTwins.ts` — `CLI_TWINS`, the tool → CLI-phrase table the parity test pins (see Parity above).
- `mcp/src/server.ts` — registers the tools (exports `ALL_TOOL_NAMES` and the pure `doctorCliArgs`) and dispatches to the above; docs root from `BISMUTH_DOCS_DIR` (install) else `../../docs` (dev). `ListTools` appends the memory + daemon tools only when `daemonEnabled()` resolves. Diagnostics go to stderr only (stdout is the protocol channel). Run standalone: `bun run mcp/src/server.ts`.

Source: `mcp/src/server.ts`, `mcp/src/memory.ts`, `mcp/src/daemon.ts`, `mcp/src/docs.ts`, `mcp/src/instructions.ts`, `mcp/src/cli.ts`, `mcp/src/cliTwins.ts`, `cli/test/mcpParity.test.ts`, `cli/src/commands/docs.ts`, `cli/src/commands/memory.ts`, `relay/.mcp.json`, `core/src/bismuthInstall.ts`, `core/src/terminal.ts`, `core/src/uiControl.ts`, `core/src/runRegistry.ts`, `core/src/daemonPages.ts`, `core/src/agentBackends/agentsMd.ts`, `core/src/agentBackends/catalog.ts`, `core/src/chatProviders/codex/driver.ts`, `app/src/uiControlClient.ts`, `cli/src/commands/app.ts`, `cli/src/commands/page.ts`, `daemon/src/daemon/session.ts`, `daemon/src/lib/bismuthPaths.ts`, `app/scripts/build-bismuth-tools.ts`, `docs/bases/authoring.md`, `docs/guides/`. Full app-control reference: [app-control.md](app-control.md).
