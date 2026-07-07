# MCP server (Claude Code integration)

`mcp/` is a stdio [MCP](https://modelcontextprotocol.io) server that exposes the Bismuth docs + CLI to a Claude Code session — token-frugally. Together with the `bismuth` CLI, this is the Claude-Code integration surface for the vault.

## How it loads — two paths

**Dev repo** — it rides the [relay plugin](../terminal/overview.md): an app terminal's PTY runs a bare `claude` as `claude --plugin-dir <relay>`, and the relay plugin's `relay/.mcp.json` declares the server, so Claude Code auto-starts it per-session when the plugin loads (no flags, no prompts — plugin-provided MCP servers are trusted):

```json
{ "mcpServers": { "bismuth": { "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../mcp/src/server.ts"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is the loaded relay plugin dir (`relay/`), so `../mcp/src/server.ts` resolves to this workspace.

**Bundled app — machine-wide install.** The packaged app doesn't rely on the relay `.mcp.json` (the bundled relay is hooks-only). Instead, on launch the core sidecar runs a **version-gated installer** (`core/src/bismuthInstall.ts`) that copies the compiled `bismuth` + `bismuth-mcp` binaries and the `docs/` tree into `~/.bismuth/`, symlinks the CLI onto `PATH` (`/usr/local/bin`, fallback `~/.local/bin`), and registers the MCP in the user's **global** Claude config via `claude mcp add -s user bismuth …` (passing `BISMUTH_DOCS_DIR` + `BISMUTH_CLI`). So **every** interactive Claude session on the machine — not just Bismuth tabs — gets the bismuth MCP and the `bismuth` CLI. The install is idempotent: a content hash of the binaries is stored at `~/.bismuth/.version`, so it only reinstalls when the bundled tools change. Run/inspect it manually with `bismuth install` / `bismuth install --status` / `bismuth uninstall`, or the in-app "Install Bismuth CLI + MCP…" command.

**Daemon sessions — explicit wiring (NOT `-s user`).** The [daemon](../daemon/overview.md) is a separate launchd/systemd process, not an interactive Claude session, so it does NOT inherit the `-s user` registration above. Instead, `daemon/src/daemon/session.ts` (`buildQueryOptions`) sets the SDK's `mcpServers` **explicitly** per call — `{ bismuth: { command: <~/.bismuth/bin/bismuth-mcp>, env: { BISMUTH_VAULT, BISMUTH_MEMORY_DIR, BISMUTH_DOCS_DIR, BISMUTH_CLI } } }` — and `settingSources: []` so it never inherits a human's ambient config. The absolute binary path (via `daemon/src/lib/bismuthPaths.ts`, `existsSync`-gated) works under launchd's minimal PATH; `BISMUTH_VAULT` in the server's own env closes the vault-targeting gap for `bismuth_cli` regardless of cwd. Absent the installed tools, the daemon degrades gracefully to no-MCP. See [daemon/overview.md](../daemon/overview.md).

The compiled binary reads `BISMUTH_DOCS_DIR` for the docs (`mcp/src/server.ts`) and `BISMUTH_CLI` for the `bismuth_cli` tool's binary (`mcp/src/cli.ts`); in the dev repo both fall back to the source tree.

## Tools (token-frugal by design)

The server (`mcp/src/server.ts`, low-level `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`, raw JSON-Schema — no zod) registers **five always-on tools** (plus three daemon-gated memory tools — see below). That count is deliberately fixed: richer capabilities (app control, the daemon inbox) route through `bismuth_cli`/`bismuth_cli_help` rather than adding schemas, because this MCP is machine-wide and every extra always-listed tool costs context in every session on the machine. Docs are served as **pointers + snippets, not full bodies**, so a session spends tokens only on the one page it actually needs:

| Tool | Args | Returns |
|---|---|---|
| `bismuth_docs_list` | — | every doc page `{path, title}` (the index — start here) |
| `bismuth_docs_search` | `query`, `limit?` | ranked `{path, heading, snippet}` — **snippets only**, cheap |
| `bismuth_docs_read` | `path`, `section?` | one doc page, or a single `##` section, on demand |
| `bismuth_cli` | `args: string[]` | runs the `bismuth` CLI (e.g. `["task","list","--vault","…"]`) → stdout/stderr/exit |
| `bismuth_cli_help` | `group?` | the CLI reference (all commands, or one group) |

Typical flow: `docs_search` → read only the top hit with `docs_read`; act with `bismuth_cli`.

## App control — driving a running window (ZERO new MCP tools)

A Claude session can also drive a **running Bismuth app** — list/open/close/focus tabs, run a safe command, author a daemon inbox page. This adds **no new MCP tool schemas** on purpose: the machine-wide MCP is loaded into every session on the machine, so an extra always-listed tool would tax the context of every unrelated session. Instead, app control decomposes into the existing `bismuth_cli` tool via two CLI groups the CLI already exposes — discover them with `bismuth_cli_help` (there is no `group: "app"` scoped help; the global help lists every `app …` / `page …` command):

- **`app` group** (`bismuth app windows|tabs|open|close|focus|run|commands`) — hits the running core's `/ui/*` routes, which relay each request over a per-window control WebSocket (`core/src/uiControl.ts` ⇄ `app/src/uiControlClient.ts`). Requires a running app (a headless CLI has no window).
- **`page` group** (`bismuth page list|create|resolve|mark-failed`) — the daemon inbox; `create` authors a validated page (`core/src/daemonPages.ts` `createDaemonPage`) so a caller never hand-writes the nested `actions[]` frontmatter. Headless (no server).

**Core discovery** (the `app` group): `--api <url>` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the run-registry (`~/.bismuth/run/<vault>.json`, written by each core on boot; matched by `--vault`/`BISMUTH_VAULT`, else the single running core) → `:4321`. In-app terminal tabs already carry `BISMUTH_API`/`CLAUDE_RELAY_URL`, so `bismuth app …` from inside a tab targets its own window with no config. Zero windows connected → a benign `404 {error:"no Bismuth window is open"}` (the daemon treats this as expected, not a retry condition); several open windows → `409`, so pass `--window <id>` (see `app windows`).

**Deliberately excluded — opening a Claude chat.** A chat tab is a live, recursive Agent-SDK session: a materially different trust boundary for an unattended caller. Enforced at two layers (POST `/ui/command` AND the frontend dispatch): `run-command` refuses a small `UI_CONTROL_BLOCKLIST` (`core/src/commands.ts` — `new-window`, `open-folder`, `update-app`, `update-daemon`, `new-claude-chat`), and `open-tab` refuses any `::chat:` content. Full reference: [app-control.md](app-control.md).

## Memory tools (daemon-gated, per-vault)

When the [daemon](../daemon/overview.md) is enabled for the active vault, the server **conditionally** exposes three more tools — the vault's 3rd-brain memory graph. The gate is `memoryDir()` (`mcp/src/memory.ts`), which just returns `process.env.BISMUTH_MEMORY_DIR || null`. `core/src/terminal.ts` injects `BISMUTH_MEMORY_DIR` into a Bismuth tab's PTY **only** when `settings.daemon.enabled` is on for that vault (pointing at `<vault>/.daemon/memory`), and the MCP child inherits it. So `ListTools` returns `memoryDir() ? [...tools, ...memoryTools] : tools` — outside a daemon-enabled Bismuth session the bot never even sees `remember`/`recall`/`forget`. (If one is somehow called with no `memoryDir()`, the handler returns an `isError` "Memory is unavailable" message.)

| Tool | Args | Returns |
|---|---|---|
| `remember` | `name`, `content`, `type?`, `tags?`, `folder?` | saves/overwrites a note in the vault's memory graph (preserves an existing note's `type`/`created`) → `{ok, name}` |
| `recall` | `query`, `folder?` | searches the graph (supports `tag:`/`type:`/`keyword:`/`link:`/`after:`/`before:` filters) → `{ok, count, notes}` |
| `forget` | `name` (may be folder-prefixed) | removes a note → `{ok, name}` |

These delegate to the shared `@bismuth/memory` graph, so the MCP tools, the daemon writer, and the relay collect-hook all read/write **one** note format against `<vault>/.daemon/memory`.

## Modules

- `mcp/src/docs.ts` — pure index/search/read over `docs/` (`listDocs`/`searchDocs`/`readDoc`); section-level scoring, path-traversal-guarded. Unit-tested (`docs.test.ts`).
- `mcp/src/cli.ts` — runs the CLI: the `BISMUTH_CLI` compiled binary when set (machine-wide install), else `bun run cli/src/index.ts` (dev). Passes `BISMUTH_VAULT`/`BISMUTH_MEMORY` through; `runCli`/`cliHelp`, never throws.
- `mcp/src/memory.ts` — the daemon-gated memory tools (`remember`/`recall`/`forget`) + the `memoryDir()` gate; delegates to `@bismuth/memory` against `BISMUTH_MEMORY_DIR`.
- `mcp/src/server.ts` — registers the tools and dispatches to the above; docs root from `BISMUTH_DOCS_DIR` (install) else `../../docs` (dev). `ListTools` appends the memory tools only when `memoryDir()` resolves. Diagnostics go to stderr only (stdout is the protocol channel). Run standalone: `bun run mcp/src/server.ts`.

Source: mcp/src/server.ts, mcp/src/memory.ts, mcp/src/docs.ts, mcp/src/cli.ts, relay/.mcp.json, core/src/bismuthInstall.ts, core/src/terminal.ts, core/src/uiControl.ts, core/src/runRegistry.ts, core/src/daemonPages.ts, app/src/uiControlClient.ts, cli/src/commands/app.ts, cli/src/commands/page.ts, daemon/src/daemon/session.ts, daemon/src/lib/bismuthPaths.ts, app/scripts/build-bismuth-tools.ts. Full app-control reference: [app-control.md](app-control.md).
