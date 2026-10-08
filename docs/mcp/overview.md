# MCP server

Bismuth's MCP server is a small stdio server that gives an AI agent the Bismuth documentation and the `bismuth` command line, plus memory and daemon tools inside a vault whose daemon is on. It is installed machine-wide, so every Claude Code session on the computer has it. Read this page to see which tools exist, how an agent is told which guides to read, and how the server gets into a session; [daemon tools](daemon-tools.md) lists the tools that only appear in a daemon-enabled vault.

The server keeps its always-on tool list short on purpose, because every session pays for the tool schemas it lists. Docs are returned as pointers and snippets, so an agent spends tokens only on the page it needs. A typical flow is to search, read the top hit, then act through the CLI:

```bash
bismuth docs search "inbox page approve" --limit 1 --pretty
```

```json
[
  {
    "path": "daemon/setup.md#approve-or-dismiss-an-inbox-page",
    "heading": "Approve or dismiss an inbox page",
    "snippet": "The daemon files an inbox page when something needs you. A toast reads \"N pages ready for review\", and the inbox section of the daemon page lists each page. …",
    "score": 35
  }
]
```

An agent runs the same search with `bismuth_docs_search`, then `bismuth_docs_read` with `path: "daemon/setup.md"` and `section: "Approve or dismiss an inbox page"`.

## Tools every session has

| Tool | Arguments | Returns |
|---|---|---|
| `bismuth_docs_list` | none | Every doc page as `{path, title}`; the index |
| `bismuth_docs_search` | `query`, `limit?` (default 8) | Ranked `{path, heading, snippet}` hits; snippets only |
| `bismuth_docs_read` | `path`, `section?` | One page, or one `##` section of it |
| `bismuth_doctor` | `fix?`, `safeOnly?`, `only?`, `section?`, `vault?` | The `bismuth doctor --json` report: leftovers from older builds, version skew, pending migrations. `fix: true` repairs |
| `bismuth_cli` | `args: string[]` | stdout, stderr and exit code of the `bismuth` CLI, for example `["task","list","--vault","…"]` |
| `bismuth_cli_help` | `group?` | The CLI reference, all commands or one group such as `daemon` |

Every vault feature rides `bismuth_cli`: notes, search, tasks, bases, flashcards, settings, calendar events, and so on. There are no per-feature tools, so a new CLI command is available to agents the moment it ships. [The CLI reference](../cli/reference.md) lists every command. `bismuth_doctor` takes `section` values `legacy`, `install`, `daemon`, `runtime`, `vault` and `backends`; if Bismuth misbehaves after an update (missing CLI, stale MCP, daemon not running), run it first.

A tool call that the CLI answers with a non-zero exit comes back as an error, including a refusal by the vault's visibility settings. `bismuth_cli` times out after 30 seconds.

## Memory and daemon tools

In a vault whose daemon is on, the server lists more tools: `remember`, `recall` and `forget` for the vault's memory, and tools for crons, background processes, the activity log and inbox pages. They are described in [daemon tools](daemon-tools.md). They use one gate: the server lists them only when the daemon is enabled for the session's vault. Outside such a vault the server lists the table above and nothing else.

## How an agent learns which guide to read

Before an agent calls any tool, the server hands it a short block of instructions. The instructions name the pages to read before certain tasks, because an agent never has to know a guide exists to be sent to it.

| Task | The agent is told to read first |
|---|---|
| Create, edit or debug a base (a `type: base` note or a `query` block) | [`bases/authoring.md`](../bases/authoring.md), then `bases/authoring/<view kind>.md` |
| Convert a vault from Obsidian | [`guides/converting-obsidian-to-bismuth.md`](../guides/converting-obsidian-to-bismuth.md) |
| Convert a vault to Obsidian | [`guides/converting-bismuth-to-obsidian.md`](../guides/converting-bismuth-to-obsidian.md) |
| Make or change a colour theme | [`guides/custom-themes.md`](../guides/custom-themes.md) |

The instructions also carry one rule. An image or PDF has no frontmatter of its own, so its tags and properties live in a hidden companion note named `<file>.<ext>.md`. An agent tags a binary with `bismuth prop set <file.pdf> tags '["a","b"]'`, which creates the companion if needed, and never writes a separate note that only embeds the file. [Frontmatter](../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs) has the companion-note model. The instructions end by pointing a misbehaving install at `bismuth_doctor`.

The block is capped at 160 words by `mcp/test/serverInstructions.test.ts`, because every session on the machine loads it. A new guide needs a docs page and one line in `mcp/src/instructions.ts`. The Codex backend gets the same pointers from a managed block in the vault's `AGENTS.md`, when `codex.writeAgentsMd` is on.

## How the server gets into a session

### The bundled app

On every launch the app's core runs a version-gated installer (`core/src/bismuthInstall.ts`). It copies the compiled `bismuth` and `bismuth-mcp` binaries and the docs to `~/.bismuth/`, links `bismuth` into `/usr/local/bin` or else `~/.local/bin`, and registers the server with Claude Code at user scope:

```bash
claude mcp add -s user bismuth -e BISMUTH_DOCS_DIR=~/.bismuth/docs -e BISMUTH_CLI=~/.bismuth/bin/bismuth -- ~/.bismuth/bin/bismuth-mcp
```

The installer stores a hash of the two binaries in `~/.bismuth/.version` and does nothing when the binaries, the CLI link and the registration are all current, so it reinstalls only when a new build ships or a piece is missing. Manage it by hand with `bismuth install`, `bismuth install --status`, `bismuth uninstall`, or the **Install Bismuth CLI + MCP…** command.

Claude Code is registered automatically. Other agent CLIs are opt-in: list them in the `mcp.registerWith` setting (registrar ids `codex`, `cline`, `openclaw`, `gemini`, `qwen`, `copilot`, `amp`, `droid`, `crush`, `goose`) or run `bismuth install --mcp <cli>` (`--mcp all` for every detected one).

### A source checkout

In the repository the server rides the relay plugin. A terminal tab in the dev app runs `claude --plugin-dir relay`, and `relay/.mcp.json` declares the server as `bun run ${CLAUDE_PLUGIN_ROOT}/../mcp/src/server.ts`. Claude Code starts it when the plugin loads, and plugin servers are trusted, so there is no prompt.

### Daemon sessions

A daemon session is a launchd or systemd process, so it gets the server through explicit wiring instead of the user-scope registration. Each session starts with `~/.bismuth/bin/bismuth-mcp` aimed at its vault, and your own MCP servers stay out unless `daemon.inheritUserMcp` is on. [The daemon overview](../daemon/overview.md#how-a-daemon-session-is-built) has the details. A vault that restricts any note removes `bismuth_cli` from daemon sessions.

## Tools mirror CLI commands

Every MCP tool has a CLI command that does the same thing, and every CLI command is reachable from MCP through `bismuth_cli`. `bismuth_cli` and `bismuth_cli_help` are the bridge itself and have no twin.

| Tool | CLI twin |
|---|---|
| `bismuth_docs_list`, `bismuth_docs_search`, `bismuth_docs_read` | `docs list`, `docs search`, `docs read` |
| `bismuth_doctor` | `doctor` |

[Daemon tools](daemon-tools.md) lists the twins of the gated tools. `CLI_TWINS` in `mcp/src/cliTwins.ts` holds the table, and `cli/test/mcpParity.test.ts` fails when a tool is added without a twin or the other way round.

## Drive the running app

An agent can open, close and rename tabs, run a safe command, and author an inbox page in a running Bismuth window. This adds no tools: it uses `bismuth_cli` with the `app` and `page` command groups. See [app control](app-control.md).

## How it works

`mcp/src/server.ts` builds the server on the low-level `@modelcontextprotocol/sdk` `Server` with raw JSON Schema, and serves over stdio. Diagnostics go to stderr only, since stdout is the protocol channel. `ListTools` returns the always-on list, plus the memory and daemon lists when `daemonEnabled()` is true; the call handler also refuses a gated tool outside a daemon-enabled vault.

| Module | Role |
|---|---|
| `mcp/src/docs.ts` | `listDocs`, `searchDocs` and `readDoc` over the docs folder, scoring at section level, with path-traversal protection. `BISMUTH_DOCS_DIR` names the folder; in a source checkout it is `docs/` |
| `mcp/src/cli.ts` | `runCli` and `cliHelp`. Runs the compiled CLI named by `BISMUTH_CLI`, or `bun run cli/src/index.ts` in a checkout. Checks the visibility gate first, passes the environment through, stamps `BISMUTH_MCP_CHANNEL`, and never throws |
| `mcp/src/memory.ts` | `remember`, `recall`, `forget` and the `memoryDir()` gate |
| `mcp/src/daemon.ts` | The daemon tools, the `daemonCliArgs` mapper from tool call to CLI arguments, and the vault resolution |
| `mcp/src/cliTwins.ts` | The parity table |
| `mcp/src/instructions.ts` | The server instructions |

`cli/src/commands/docs.ts` and `memory.ts` import `mcp/src/docs.ts` and `memory.ts` directly, so the MCP tool and its CLI twin run one implementation. The daemon and doctor tools go the other way and spawn the CLI.

Source: `mcp/src/{server,docs,cli,memory,daemon,cliTwins,instructions}.ts`, `cli/test/mcpParity.test.ts`, `relay/.mcp.json`, `core/src/{bismuthInstall,agentBackends/mcpRegistrars}.ts`, `core/src/schema/settingsSchema.ts`
