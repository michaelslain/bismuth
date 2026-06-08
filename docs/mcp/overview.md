# MCP server (Claude Code integration)

`mcp/` is a stdio [MCP](https://modelcontextprotocol.io) server that **auto-attaches to every Claude Code session launched from a Bismuth app terminal** and exposes the Bismuth docs + CLI to that session — token-frugally. Together with the `bismuth` CLI, this is the Claude-Code integration surface for the vault.

## Auto-attach (how it loads)

It rides the same mechanism as the [relay plugin](../terminal/overview.md): the app terminal's PTY runs a bare `claude` as `claude --plugin-dir <relay>`. The relay plugin's `relay/.mcp.json` declares the server, so Claude Code auto-starts it when the plugin loads — no flags, no approval prompts (plugin-provided MCP servers are trusted):

```json
{ "mcpServers": { "bismuth": { "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../mcp/src/server.ts"] } } }
```

`${CLAUDE_PLUGIN_ROOT}` is the loaded relay plugin dir (`relay/`), so `../mcp/src/server.ts` resolves to this workspace. Scope is app-local (dev repo), same as relay — no global install.

## Tools (token-frugal by design)

The server (`mcp/src/server.ts`, low-level `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`, raw JSON-Schema — no zod) registers five tools. Docs are served as **pointers + snippets, not full bodies**, so a session spends tokens only on the one page it actually needs:

| Tool | Args | Returns |
|---|---|---|
| `bismuth_docs_list` | — | every doc page `{path, title}` (the index — start here) |
| `bismuth_docs_search` | `query`, `limit?` | ranked `{path, heading, snippet}` — **snippets only**, cheap |
| `bismuth_docs_read` | `path`, `section?` | one doc page, or a single `##` section, on demand |
| `bismuth_cli` | `args: string[]` | runs the `bismuth` CLI (e.g. `["task","list","--vault","…"]`) → stdout/stderr/exit |
| `bismuth_cli_help` | `group?` | the CLI reference (all commands, or one group) |

Typical flow: `docs_search` → read only the top hit with `docs_read`; act with `bismuth_cli`.

## Modules

- `mcp/src/docs.ts` — pure index/search/read over `docs/` (`listDocs`/`searchDocs`/`readDoc`); section-level scoring, path-traversal-guarded. Unit-tested (`docs.test.ts`).
- `mcp/src/cli.ts` — spawns the CLI (`bun run cli/src/index.ts …`), passes `OA_VAULT`/`OA_MEMORY` through; `runCli`/`cliHelp`, never throws.
- `mcp/src/server.ts` — registers the tools and dispatches to the above. Diagnostics go to stderr only (stdout is the protocol channel). Run standalone: `bun run mcp/src/server.ts`.

Source: mcp/src/server.ts, mcp/src/docs.ts, mcp/src/cli.ts, relay/.mcp.json, core/src/terminal.ts
