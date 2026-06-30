# MCP server (Claude Code integration)

`mcp/` is a stdio [MCP](https://modelcontextprotocol.io) server that exposes the Bismuth docs + CLI to a Claude Code session — token-frugally. Together with the `bismuth` CLI, this is the Claude-Code integration surface for the vault.

## How it loads — two paths

**Dev repo** — it rides the [relay plugin](../terminal/overview.md): an app terminal's PTY runs a bare `claude` as `claude --plugin-dir <relay>`, and the relay plugin's `relay/.mcp.json` declares the server, so Claude Code auto-starts it per-session when the plugin loads (no flags, no prompts — plugin-provided MCP servers are trusted):

```json
{ "mcpServers": { "bismuth": { "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../mcp/src/server.ts"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is the loaded relay plugin dir (`relay/`), so `../mcp/src/server.ts` resolves to this workspace.

**Bundled app — machine-wide install.** The packaged app doesn't rely on the relay `.mcp.json` (the bundled relay is hooks-only). Instead, on launch the core sidecar runs a **version-gated installer** (`core/src/bismuthInstall.ts`) that copies the compiled `bismuth` + `bismuth-mcp` binaries and the `docs/` tree into `~/.bismuth/`, symlinks the CLI onto `PATH` (`/usr/local/bin`, fallback `~/.local/bin`), and registers the MCP in the user's **global** Claude config via `claude mcp add -s user bismuth …` (passing `BISMUTH_DOCS_DIR` + `BISMUTH_CLI`). So **every** Claude session on the machine — not just Bismuth tabs — gets the bismuth MCP and the `bismuth` CLI. The install is idempotent: a content hash of the binaries is stored at `~/.bismuth/.version`, so it only reinstalls when the bundled tools change. Run/inspect it manually with `bismuth install` / `bismuth install --status` / `bismuth uninstall`, or the in-app "Install Bismuth CLI + MCP…" command.

The compiled binary reads `BISMUTH_DOCS_DIR` for the docs (`mcp/src/server.ts`) and `BISMUTH_CLI` for the `bismuth_cli` tool's binary (`mcp/src/cli.ts`); in the dev repo both fall back to the source tree.

## Tools (token-frugal by design)

The server (`mcp/src/server.ts`, low-level `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`, raw JSON-Schema — no zod) registers five always-on tools (plus three daemon-gated memory tools — see below). Docs are served as **pointers + snippets, not full bodies**, so a session spends tokens only on the one page it actually needs:

| Tool | Args | Returns |
|---|---|---|
| `bismuth_docs_list` | — | every doc page `{path, title}` (the index — start here) |
| `bismuth_docs_search` | `query`, `limit?` | ranked `{path, heading, snippet}` — **snippets only**, cheap |
| `bismuth_docs_read` | `path`, `section?` | one doc page, or a single `##` section, on demand |
| `bismuth_cli` | `args: string[]` | runs the `bismuth` CLI (e.g. `["task","list","--vault","…"]`) → stdout/stderr/exit |
| `bismuth_cli_help` | `group?` | the CLI reference (all commands, or one group) |

Typical flow: `docs_search` → read only the top hit with `docs_read`; act with `bismuth_cli`.

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

Source: mcp/src/server.ts, mcp/src/memory.ts, mcp/src/docs.ts, mcp/src/cli.ts, relay/.mcp.json, core/src/bismuthInstall.ts, core/src/terminal.ts, app/scripts/build-bismuth-tools.ts
