# MCP server

Bismuth's MCP server is a thin stdio adapter over the `bismuth` command line. The CLI owns every feature: an agent with a shell runs `bismuth <command>`, and a host with no shell calls the MCP tool `bismuth_cli` with the same arguments. The server also lists three memory tools inside a vault whose daemon is on. It is installed machine-wide, so every Claude Code session on the computer has it. Read this page to see which tools exist, how an agent is told which guides to read, and how the server gets into a session.

An agent finds a feature by asking the CLI, not by looking for a tool. A typical flow is to search the docs, read the top hit, then act:

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

Then `bismuth docs read daemon/setup.md --section "Approve or dismiss an inbox page"` prints that section. A host with no shell sends the same words through `bismuth_cli`, as `["docs","read","daemon/setup.md","--section","Approve or dismiss an inbox page"]`.

## Tools the server lists

| Tool | Listed | Arguments | Returns |
|---|---|---|---|
| `bismuth_cli` | always | `args: string[]` | stdout, stderr and exit code of the `bismuth` CLI |
| `remember` | daemon on | `name`, `content`, `type?`, `tags?`, `folder?`, `description?` | `{ok, name}` |
| `recall` | daemon on | `query`, `folder?` | `{ok, count, notes, more}` |
| `forget` | daemon on | `name` | `{ok, name}` |

The tool list stays this short on purpose, because every session pays for the schemas it lists. Every CLI command reaches agents through `bismuth_cli` with no tool added for it. Outside a daemon-enabled vault the server lists `bismuth_cli` and nothing else.

## Run a command through bismuth_cli

`bismuth_cli` takes one array element per argument, exactly as you would type them after `bismuth`. `["--help"]` lists every command, `["task","--help"]` lists one group, and `["task","list","--query","not done"]` runs a command.

```json
{ "args": ["docs", "search", "inbox page", "--limit", "3"] }
```

The server runs the CLI in its own working directory, which is the agent session's, so inside a vault no `--vault` is needed. A call times out after 2 minutes, and after 30 minutes when the first argument is `ocr` or `pdf`, because Marker's models take minutes on a long PDF. A command that exits non-zero comes back as an error, including a refusal by the vault's visibility settings: `bismuth_cli` runs through the same visibility gate as `bismuth` in the session's own shell. [The CLI reference](../cli/reference.md) lists every command.

## Commands agents run for common jobs

Each job below is one `bismuth` command, and one `bismuth_cli` call with the same words as `args`.

| Job | Command |
|---|---|
| Find, list or read a doc page | `bismuth docs search <words>`, `bismuth docs list`, `bismuth docs read <path> [--section <heading>]` |
| Check an install that misbehaves after an update | `bismuth doctor` (`--fix` repairs). See [doctor](../overview/doctor.md) |
| See the vault's folders, clusters, hubs and tags | `bismuth map`; `bismuth map --around <note>` shows where one note sits |
| Load who the agent works with, the vault map and the memory index | `bismuth brain` |
| Add a text layer to a scanned PDF | `bismuth ocr <file.pdf>`. See [OCR](../vault/ocr.md) |
| Read an image, handwritten scan or PDF into its note, math as LaTeX | `bismuth transcribe <file>`. See [Transcribe pages and handwritten scans](../vault/transcription.md) |
| Convert a PDF to a markdown note | `bismuth pdf md <file.pdf>`. See [Convert a PDF to markdown](../vault/pdf-to-markdown.md) |
| Inspect or drive the daemon | `bismuth daemon status`, `devices`, `owner`, `graph`, `logs`, `cron run`, `cron toggle`, `process toggle` |
| Read or author inbox pages | `bismuth page list`, `page create`, `page resolve` |
| Drive the running window | `bismuth app …`. See [app control](app-control.md) |

## Memory tools

In a vault whose daemon is on, the server lists `remember`, `recall` and `forget`, which read and write the vault's memory graph. Their content is a structured note rather than a command line, so they are named tools. [Memory](../daemon/memory.md) explains notes, the query syntax and visibility. The same operations are `bismuth memory remember`, `recall` and `forget`.

| Tool | Does |
|---|---|
| `remember` | Creates or overwrites a note and keeps an existing note's `type`, `created`, `description` and `visibility` |
| `recall` | Runs a query such as `type:person tag:climbing` or `after:2026-04-01 auth`; returns the best matches whole and the rest as pointers with a `path` |
| `forget` | Deletes a note; the name may be `folder/name` |

`remember` and `forget` refuse a note whose frontmatter restricts it, with `refused: that memory note is not visible to this agent`. The MCP server counts as an agent channel, so it applies the strict `daemon` rules: both `hidden` and `chat-only` notes are refused. A spawner that sets `BISMUTH_MCP_CHANNEL=chat` refuses only `hidden` notes. `recall` never returns a restricted note.

### When the memory tools appear

The server lists the memory tools only when the daemon is enabled for the session's vault, and a call outside one returns `Memory is unavailable — the daemon is not enabled for this vault.` It decides in this order:

1. If `BISMUTH_MEMORY_DIR` is set, the vault's daemon is on. Bismuth sets it in an app terminal tab only when `daemon.enabled` is true, and in every daemon session.
2. Otherwise the server finds the vault itself: `BISMUTH_VAULT` if set, else the working directory walked upward to a folder holding a `.settings` file. It reads that vault's own `daemon.enabled`.

The second path makes the tools appear in a plain terminal or an IDE whose working directory is inside a daemon-enabled vault. It checks that one vault's key and nothing broader.

## How an agent learns which guide to read

Before an agent calls any tool, the server hands it a short block of instructions. The instructions name the pages to read before certain tasks, because an agent never has to know a guide exists to be sent to it.

| Task | The agent is told to read first |
|---|---|
| Create, edit or debug a base (a `type: base` note or a `query` block) | [`bases/authoring.md`](../bases/authoring.md), then `bases/authoring/<layout>.md` |
| Convert a vault from Obsidian | [`guides/converting-obsidian-to-bismuth.md`](../guides/converting-obsidian-to-bismuth.md) |
| Convert a vault to Obsidian | [`guides/converting-bismuth-to-obsidian.md`](../guides/converting-bismuth-to-obsidian.md) |
| Make or change a colour theme | [`guides/custom-themes.md`](../guides/custom-themes.md) |

The instructions open by naming the `bismuth` CLI as the way in: run `bismuth <command>` in a shell, or call `bismuth_cli` with the same arguments when there is no shell; no `--vault` is needed inside a vault; `bismuth --help` lists commands; never run anything inside Bismuth.app, because that binary is the app and opens a second window. Every pointer after that names a `bismuth …` command.

The instructions also carry one rule. An image or PDF has no frontmatter of its own, so its tags and properties live in a hidden companion note named `<file>.<ext>.md`. An agent tags an image or PDF with `bismuth prop set <file.pdf> tags '["a","b"]'`, which creates the companion if needed, and never writes a separate note that only embeds the file. [Frontmatter](../vault/frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs) has the companion-note model. A question about a past conversation ("yesterday", "what we talked about") goes to `bismuth history` first, because memory keeps distilled facts and not what was said. A question about what the user highlighted in a PDF or image goes to `bismuth highlights <file.pdf>`, because a PDF keeps its highlights inside the file as standard annotations, which other apps show and list too, while ink lives in the `<file>.<ext>.draw` sidecar. A question about the user's tasks or deadlines goes to `bismuth task list --query`, never a grep for the user's wording, because a task names its deliverable rather than its project. A request to open or show a file goes to `bismuth app open <vault-relative path>`, which opens it in its own tab in the running app. An agent whose session context has no `# Vault map` section inside a `<bismuth-memory>` block runs `bismuth brain` once at the start, and runs `bismuth map --around <note>` to see where a note sits before reorganising or linking it. The instructions end by pointing a misbehaving install at `bismuth doctor`.

The block's word count is capped in `mcp/test/serverInstructions.test.ts`, because every session on the machine loads it. A new guide needs a docs page and one line in `mcp/src/instructions.ts`. The Codex backend gets the same pointers from a managed block in the vault's `AGENTS.md`, when `codex.writeAgentsMd` is on.

## How an agent's shell reaches the CLI

Every Claude Code session Bismuth starts has `bismuth` on its PATH: the app's chat, the daemon's sessions, and a `claude` typed in an app terminal tab. Each of them also gets a short system-prompt note saying the CLI does everything, that no `--vault` is needed inside the vault, and that `bismuth --help` and `bismuth docs search` are the way in.

Claude Code's Bash tool replaces PATH with the one from its snapshot of your login shell, so a PATH set in the spawn environment never reaches the agent's shell. Bismuth writes `~/.bismuth/agent-env.sh` and sets `CLAUDE_ENV_FILE` to it. Claude Code sources that file before every Bash command, and the file prepends `~/.bismuth/bin` to PATH. If you already set `CLAUDE_ENV_FILE`, Bismuth passes yours on as `BISMUTH_PREV_CLAUDE_ENV_FILE` and the file sources it after the PATH line.

The session environment also carries `BISMUTH_CLI`, the installed binary, and `BISMUTH_VAULT`. A terminal tab sets no `BISMUTH_VAULT`: the CLI finds the vault from the working directory.

### Which vault a flagless command uses

A `bismuth` command with no `--vault` resolves its vault in this order: `--vault`, then `BISMUTH_VAULT`, then the nearest ancestor of the working directory that holds a `.settings` file. Only `.settings` marks a vault for this, because `settings.yaml` is a common file name in unrelated projects. The visibility gate checks the same root when no `--vault`, `--dir` or `BISMUTH_VAULT` is given.

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

A daemon session is a launchd or systemd process, so it gets the server through explicit wiring instead of the user-scope registration. Each session starts with `~/.bismuth/bin/bismuth-mcp` aimed at its vault, and your own MCP servers stay out unless `daemon.inheritUserMcp` is on. [The daemon overview](../daemon/overview.md#how-a-daemon-session-is-built) has the details. A vault that restricts any note disables `Grep` and `Glob` in daemon sessions, because an unscoped scan returns a hidden file's lines; `bismuth_cli` stays, behind the visibility gate.

## Tools mirror CLI commands

Every MCP tool has a CLI command that does the same thing, and every CLI command is reachable from MCP through `bismuth_cli`. `bismuth_cli` is the bridge itself and has no twin.

| Tool | CLI twin |
|---|---|
| `remember` | `memory remember` |
| `recall` | `memory recall` |
| `forget` | `memory forget` |

`CLI_TWINS` in `mcp/src/cliTwins.ts` holds the table. `cli/test/mcpParity.test.ts` fails when a tool is added without a twin or the other way round, and fails when any named tool other than `bismuth_cli` and the memory tools appears. `cli/test/mcpArgParity.test.ts` pairs their arguments.

### Parameters pair with flags

Every input parameter of a tool pairs with a flag or positional of its CLI twin, and every flag or positional of the twin pairs with a parameter.
Names pair after dropping `-` and `_` and ignoring case, so a parameter `some_param` pairs with `--some-param`.
A boolean parameter pairs with a bare flag and every other type with a flag that takes a value or with a positional.

An argument that exists on one side only is listed in `ARG_EXCEPTIONS` in `mcp/src/cliTwins.ts`, one entry per tool and argument, with the reason it is one-sided.
The reasons that recur:

| Reason | Example |
|---|---|
| Output format: the tool returns its result in the format it chose | `--pretty`, `--json` |
| Session scope: the MCP server supplies the value itself, so an agent cannot redirect the tool | `--vault`, `--memory` |

An entry that matches no one-sided argument fails the test, so the table cannot go stale.
A reason that starts with `TODO(user)` marks an argument whose fate is an open decision.

To add a parameter, add the flag to the twin in the same change, or add an exception with a reason.

## Drive the running app

An agent can open, close and rename tabs, run a safe command, and author an inbox page in a running Bismuth window. This adds no tools: an agent runs `bismuth app …` in its shell, or `bismuth_cli` with the `app` and `page` command groups when it has no shell. See [app control](app-control.md).

## How it works

`mcp/src/server.ts` builds the server on the low-level `@modelcontextprotocol/sdk` `Server` with raw JSON Schema, and serves over stdio. Diagnostics go to stderr only, since stdout is the protocol channel. `ListTools` returns `bismuth_cli`, plus the memory tools when `memoryDir()` resolves; the call handler also refuses a memory tool outside a daemon-enabled vault.

| Module | Role |
|---|---|
| `mcp/src/docs.ts` | `listDocs`, `searchDocs` and `readDoc` over the docs folder, scoring at section level, with path-traversal protection. `BISMUTH_DOCS_DIR` names the folder; in a source checkout it is `docs/` |
| `mcp/src/cli.ts` | `runCli` and `cliTimeoutMs`. Runs the compiled CLI named by `BISMUTH_CLI`, or `bun run cli/src/index.ts` in a checkout. Checks the visibility gate first (`gateCliArgs`), runs in the server's working directory, passes the environment through, stamps `BISMUTH_MCP_CHANNEL`, and never throws |
| `mcp/src/memory.ts` | `remember`, `recall`, `forget` and the `memoryDir()` gate |
| `mcp/src/cliTwins.ts` | The parity table and `ARG_EXCEPTIONS` |
| `mcp/src/instructions.ts` | The server instructions |

`cli/src/commands/docs.ts` and `memory.ts` import `mcp/src/docs.ts` and `memory.ts` directly, so the MCP tool and its CLI twin run one implementation. `bismuth_cli` goes the other way and spawns the CLI.

Source: `mcp/src/{server,docs,cli,memory,cliTwins,instructions}.ts`, `cli/test/{mcpParity,mcpArgParity}.test.ts`, `cli/src/args.ts`, `relay/.mcp.json`, `core/src/{bismuthInstall,agentBackends/mcpRegistrars,findVaultRoot,agentEnvFile,agentCliNote,visibilityCliGate}.ts`, `core/src/schema/settingsSchema.ts`
