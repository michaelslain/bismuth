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

The server in `mcp/src/server.ts` uses the low-level `@modelcontextprotocol/sdk` `Server` and `StdioServerTransport` with raw JSON Schema, not zod. Before a client calls a tool, it receives `SERVER_INSTRUCTIONS` from `mcp/src/instructions.ts`; `mcp/src/serverInstructions.test.ts` keeps that text under 120 words. The instructions prevent a common tagging mistake: an image or PDF uses the hidden companion note `<file>.<ext>.md`, set with `bismuth prop set <file.pdf> tags '[...]'`. Do not create a separate `<name>.md` solely to embed a binary and hold its tags. See [`vault/frontmatter.md`](../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs) for the complete companion-note model.

It registers **six always-on tools** (plus, when the daemon is enabled for the vault, three daemon-gated memory tools + eleven daemon-management tools — see below). The always-on count is deliberately fixed: broad capabilities (e.g. app control) route through `bismuth_cli`/`bismuth_cli_help` rather than adding always-listed schemas, because this MCP is machine-wide and every extra always-listed tool costs context in every session on the machine. `bismuth_skill` earns its own schema anyway — it isn't a CLI capability to route through `bismuth_cli`, it's read-only guidance content, the same shape as the doc tools (see **Skills** below). The daemon-gated tools sidestep that tax entirely by only appearing inside a daemon-enabled session. Docs and skills are both served as **pointers + snippets, not full bodies**, so a session spends tokens only on the one page it actually needs:

| Tool | Args | Returns |
|---|---|---|
| `bismuth_docs_list` | — | every doc page `{path, title}` (the index — start here) |
| `bismuth_docs_search` | `query`, `limit?` | ranked `{path, heading, snippet}` — **snippets only**, cheap |
| `bismuth_docs_read` | `path`, `section?` | one doc page, or a single `##` section, on demand |
| `bismuth_skill` | `name?`, `reference?` | one skill's `SKILL.md`, or a `references/<kind>.md` within it; omit `name` to list every skill as `{name, description}` |
| `bismuth_cli` | `args: string[]` | runs the `bismuth` CLI (e.g. `["task","list","--vault","…"]`) → stdout/stderr/exit |
| `bismuth_cli_help` | `group?` | the CLI reference (all commands, or one group) |

Typical flow: `docs_search` → read only the top hit with `docs_read`; act with `bismuth_cli`. For a skill: call `bismuth_skill` with no args to see what's available, then `bismuth_skill {name: "…"}` for the guide, then add `reference` for one of its `references/<kind>.md` pages.

Every vault feature rides `bismuth_cli` the same way — notes, search, tasks, bases/rows, flashcards, settings, and **calendar management** (discover calendar bases, event CRUD incl. recurrence/RRULE and per-occurrence overrides, categories/colors — the `calendar` group; see `cli/reference.md` § Calendar commands). No per-feature MCP tools exist by design.

## Skills (`bismuth_skill`)

Claude Code auto-loads skills from `~/.claude/skills` on its own — but none of the other nine backends this MCP serves (opencode, codex, and the seven ACP-based ones: cline, gemini, goose, openclaw, hermes, claude-code-acp, codex-acp) read that directory. MCP is the one surface all ten backends share, so `bismuth_skill` is what makes a Bismuth skill reachable from every backend, not just Claude Code's own auto-load. That's also why the tool's description names the available skill explicitly instead of describing the tool generically — a caller has no ambient skills directory to discover from, so it has to learn what exists from the schema text alone. The description, from `mcp/src/server.ts`'s `skillToolDescription()`:

> Read a Bismuth skill (a how-to guide) by name — the same guidance Claude Code auto-loads from ~/.claude/skills, exposed here so every other agent backend (opencode, codex, cline, gemini, goose, openclaw, and the ACP backends) can reach it too, since none of them read that directory. Available: <every skill directory found under the skills root, comma-separated>. Omit name to list all available skills with descriptions.

Args: `name?` (a skill's directory name, e.g. `authoring-bismuth-bases`; omit to list every skill as `{name, description}`, sourced from each skill's `SKILL.md` YAML frontmatter — `mcp/src/skills.ts`'s `listSkills()`), `reference?` (one of that skill's `references/<kind>.md` files, given without path or extension, e.g. `kanban`). Both args are path-traversal-guarded (`resolveWithin()`) the same way `bismuth_docs_read` guards its `path` arg — `skills.ts` mirrors `docs.ts`'s rejection shape on purpose, same repo, same pattern for a reader to already know.

The `Available:` list in that description is **built at server startup** from `listSkills(skillsRoot)` (`mcp/src/server.ts`'s `skillToolDescription()`), so a new `skills/<name>/` directory is advertised with no edit to the server; with nothing on disk it reads `Available: none found at <skillsRoot>`.

Three skills ship today (`core/src/bismuthInstall.ts`'s `SKILL_IDS`, pinned to the `skills/` directory set by `core/test/skills.test.ts`):

- **`authoring-bismuth-bases`** (`skills/authoring-bismuth-bases/`): a `SKILL.md` (the view-kind picker table + cross-cutting gotchas for writing a `type: base` note) plus one `references/<kind>.md` per Bases view kind — `bar`, `bullets`, `calendar`, `cards`, `flashcards`, `heatmap`, `kanban`, `line`, `list`, `map`, `stat`, `table` — matching the 12 `ViewType`s.
- **`converting-obsidian-to-bismuth`** (`skills/converting-obsidian-to-bismuth/`): turns an Obsidian vault into a Bismuth vault in a new folder, validating with the `bismuth` CLI and reporting what was lossy.
- **`converting-bismuth-to-obsidian`** (`skills/converting-bismuth-to-obsidian/`): the reverse — exports a Bismuth vault to an Obsidian-shaped folder and reports what was lossy.

Two drift tests keep the skills honest: every `docs/**/*.md` path a skill cites must exist (`core/test/skills.test.ts`), and every `bismuth <command>` a skill shows must resolve in the CLI registry via `resolveCommand` (`cli/test/skillCommands.test.ts`).

**Three delivery adapters carry these skills to different surfaces, not just `bismuth_skill`:**

1. **The MCP tool itself** (`bismuth_skill`, above) — universal, reaches all ten backends. `skillsRoot` resolves from `BISMUTH_SKILLS_DIR` if set, else `<repoRoot>/skills` (dev); a machine-wide install stages `skills/` alongside `docs/` and sets `BISMUTH_SKILLS_DIR` to the staged copy — the same pattern `BISMUTH_DOCS_DIR` uses for docs.
2. **A `~/.claude/skills/` symlink staged at install time** (`core/src/bismuthInstall.ts`) — the installer symlinks EVERY staged skill (each id in `SKILL_IDS`) into Claude Code's own native skills directory (`linkClaudeSkill()`, never clobbering a pre-existing entry Bismuth didn't create; one warning per id that was skipped), so a Claude Code session picks them up through its own auto-load without ever calling the MCP tool. The install only counts as up to date when all ids are linked, so a machine upgraded from the one-skill build relinks the new ones on the next ensure.
3. **An `AGENTS.md` managed block** (`core/src/chatProviders/codex/driver.ts`'s `CODEX_AGENTS_MD_CONTENT`, written via `core/src/agentBackends/agentsMd.ts`) — for backends that read the `AGENTS.md` context-file convention (Codex, Cursor, Amp, Droid; opt-in per `settings.codex.writeAgentsMd`). The block doesn't inline any skill's content — it points the backend at the `bismuth_skill` MCP tool (naming the bases skill and both conversion skills), since AGENTS.md is a memory/persona channel refreshed every session, not a place to duplicate a maintained guide.

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

- `mcp/src/docs.ts` — pure index/search/read over `docs/` (`listDocs`/`searchDocs`/`readDoc`); section-level scoring, path-traversal-guarded. Unit-tested (`docs.test.ts`).
- `mcp/src/skills.ts` — pure index/read over `skills/` (`listSkills`/`readSkill`); parses `name`/`description` out of each `SKILL.md`'s YAML frontmatter, path-traversal-guarded (`resolveWithin()` from `mcp/src/paths.ts`, mirroring `docs.ts`'s rejection shape on purpose). Unit-tested (`mcp/test/skills.test.ts`).
- `mcp/src/cli.ts` — runs the CLI: the `BISMUTH_CLI` compiled binary when set (machine-wide install), else `bun run cli/src/index.ts` (dev). Passes `BISMUTH_VAULT`/`BISMUTH_MEMORY` through; `runCli`/`cliHelp`, never throws.
- `mcp/src/memory.ts` — the daemon-gated memory tools (`remember`/`recall`/`forget`) + the `memoryDir()` gate; delegates to `@bismuth/memory` against `BISMUTH_MEMORY_DIR`. Also exports `resolveVaultRoot()` (`BISMUTH_VAULT` else cwd walked up to a `.settings` file), which `memoryDir()` falls back to when no `BISMUTH_MEMORY_DIR` is already set — checking the resolved vault's own `daemon.enabled` directly — and which `daemon.ts`'s `daemonVaultRoot()` reuses so the two gates always agree.
- `mcp/src/daemon.ts` — the daemon-gated daemon-management tools (crons/processes/pages/status/devices/owner); the pure `daemonCliArgs` name→CLI-argv mapper (unit-tested, `daemon.test.ts`), `daemonVaultRoot()` derivation, and `daemonEnabled()` gate; bridges the `bismuth` CLI via `runCli`. See [daemon-tools.md](daemon-tools.md).
- `mcp/src/server.ts` — registers the tools and dispatches to the above; docs root from `BISMUTH_DOCS_DIR` (install) else `../../docs` (dev), skills root from `BISMUTH_SKILLS_DIR` (install) else `../../skills` (dev). `ListTools` appends the memory + daemon tools only when `daemonEnabled()` resolves. Diagnostics go to stderr only (stdout is the protocol channel). Run standalone: `bun run mcp/src/server.ts`.

Source: `mcp/src/server.ts`, `mcp/src/memory.ts`, `mcp/src/daemon.ts`, `mcp/src/docs.ts`, `mcp/src/skills.ts`, `mcp/src/cli.ts`, `relay/.mcp.json`, `core/src/bismuthInstall.ts`, `core/src/terminal.ts`, `core/src/uiControl.ts`, `core/src/runRegistry.ts`, `core/src/daemonPages.ts`, `core/src/agentBackends/agentsMd.ts`, `core/src/agentBackends/catalog.ts`, `core/src/chatProviders/codex/driver.ts`, `app/src/uiControlClient.ts`, `cli/src/commands/app.ts`, `cli/src/commands/page.ts`, `daemon/src/daemon/session.ts`, `daemon/src/lib/bismuthPaths.ts`, `app/scripts/build-bismuth-tools.ts`, `skills/authoring-bismuth-bases/`. Full app-control reference: [app-control.md](app-control.md).
