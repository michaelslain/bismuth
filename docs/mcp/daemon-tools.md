# MCP daemon tools

When the daemon is on for a vault, the Bismuth MCP server adds tools to the [always-on set](overview.md#tools-every-session-has): `remember`, `recall` and `forget` for the vault's memory, and tools for crons, background processes, the activity log, inbox pages, daemon status and device ownership. They let an agent in that vault answer "what has the daemon been doing?" or run a cron without guessing a CLI command. Read this page to see what each tool does and when it appears.

An agent that asks the daemon to consolidate memory now calls `cron_run` with `{ "name": "dream" }`. The server runs the CLI command behind it, aimed at the session's vault:

```bash
bismuth daemon cron run dream --vault ~/vault
```

Each daemon tool runs one `bismuth` command through the same code path as `bismuth_cli`. The tools exist as named schemas because they are listed only in a daemon-enabled session, so they cost nothing in the many sessions that have no daemon.

## When the tools appear

The server lists these tools only when the daemon is enabled for the session's vault, and refuses a call outside one with `Daemon tools are unavailable — the daemon is not enabled for this vault.` It decides in this order:

1. If `BISMUTH_MEMORY_DIR` is set, the vault's daemon is on. Bismuth sets it in an app terminal tab only when `daemon.enabled` is true, and in every daemon session.
2. Otherwise the server finds the vault itself: `BISMUTH_VAULT` if set, else the working directory walked upward to a folder holding a `.settings` file. It reads that vault's own `daemon.enabled`.

The second path makes the tools appear in a plain terminal or an IDE whose working directory is inside a daemon-enabled vault. It checks that one vault's key and nothing broader. The vault root the CLI commands use comes from `BISMUTH_MEMORY_DIR` with its `/.daemon/memory` suffix removed, else the same lookup.

## Memory tools

The memory tools read and write the vault's memory graph. [Memory](../daemon/memory.md) explains notes, the query syntax and visibility.

| Tool | Arguments | Returns |
|---|---|---|
| `remember` | `name`, `content`, `type?`, `tags?`, `folder?`, `description?` | `{ok, name}`. Creates or overwrites a note and keeps an existing note's `type`, `created`, `description` and `visibility` |
| `recall` | `query`, `folder?` | `{ok, count, notes}`. Runs a query such as `type:person tag:climbing` or `after:2026-04-01 auth` |
| `forget` | `name` | `{ok, name}`. Deletes a note; the name may be `folder/name` |

`remember` and `forget` refuse a note whose frontmatter restricts it, with `refused: that memory note is not visible to this agent`. The MCP server counts as an agent channel, so it applies the strict `daemon` rules: both `hidden` and `chat-only` notes are refused. A spawner that sets `BISMUTH_MCP_CHANNEL=chat` refuses only `hidden` notes. `recall` never returns a restricted note. Memory tools called when no memory directory resolves return `Memory is unavailable — the daemon is not enabled for this vault.`

## Daemon tools

| Tool | Arguments | Runs | Does |
|---|---|---|---|
| `daemon_status` | none | `daemon status` | Whether the daemon is running, this device's id, and the owner |
| `daemon_devices` | none | `daemon devices` | Every device that has checked in, with the owner and this device flagged |
| `daemon_owner` | `device?` | `daemon owner [device]` | Read the owner, or claim `device` as owner |
| `daemon_list` | none | `daemon graph` | This vault's crons and processes with enabled, running, schedule and last result |
| `cron_run` | `name` | `daemon cron run <name>` | Run a cron now, outside its schedule |
| `cron_toggle` | `name`, `enabled?` | `daemon cron toggle <name> [--off]` | Enable a cron, or pause it with `enabled: false` |
| `process_toggle` | `name`, `enabled?` | `daemon process toggle <name> [--off]` | Enable or disable a background process, and start or stop it |
| `daemon_logs` | `limit?`, `kind?`, `name?`, `since?` | `daemon logs` | This vault's activity log, newest first |
| `page_list` | none | `page list` | The inbox, each page with its status |
| `page_create` | `slug`, `title?`, `body?`, `actions?`, `source?`, `deliver_at?` | `page create <slug> …` | Write an inbox page with validated frontmatter |
| `page_resolve` | `path`, `action` | `page resolve <path> <action>` | Press a page's button: approve runs its prompt, dismiss closes it |

`name` is a cron's or process's file name or its `name:` value. `daemon_status`, `daemon_devices` and `daemon_owner` read the machine's state and take no vault; the rest are scoped to the session's vault.

### Read the activity log

`daemon_logs` is the tool to use for "what has the daemon been doing". It reads the real record, with each cron's outcome, failure cause and duration, process restarts and brain starts, instead of the single last result in `daemon_list`. All arguments are optional.

| Argument | Values | Default |
|---|---|---|
| `limit` | number of events | 100, at most 1000 |
| `kind` | `cron`, `process`, `daemon`, `session` | all |
| `name` | a cron or process name, exact | all |
| `since` | an ISO-8601 instant; an unparseable value is ignored | no lower bound |

The event fields and retention are in [daemon storage](../daemon/storage.md#activity-log-logsactivity-yyyy-mm-ddjsonl).

### Write an inbox page

`page_create` takes `actions` as an array of `{id, label, kind?, prompt?, model?, timeout?}`. An action with a `prompt` is an approve button, and one without is a dismiss button. The tool serializes the array to JSON for `--actions`, so the agent never hand-writes the nested YAML. A call that omits `slug`, or `path` or `action` on `page_resolve`, fails with `<tool>: '<arg>' is required`. [Pages](../daemon/pages.md) has the format and lifecycle.

## What the tools do not cover

There are no tools to create or delete a cron or process, to start or stop a process without changing its `enabled` line, or to stop, restart or reinstall the daemon. Each of those is a `bismuth` command, so an agent runs it through `bismuth_cli`: `daemon cron create`, `daemon cron delete`, `daemon process create`, `daemon process delete`, `daemon stop`, `daemon restart` and `daemon setup`. No command or tool sends the daemon a message; its chat on the daemon page is how you talk to it.

## How it works

`mcp/src/daemon.ts` holds the tool definitions and `daemonCliArgs`, a pure function that maps a tool name and its arguments, plus the vault root, to the CLI arguments. It throws on an unknown tool or a missing required argument, and the server turns that into an error result. `runDaemonTool` resolves the vault root, calls `runCli` from `mcp/src/cli.ts`, and returns the combined output with `isError` set for a non-zero exit. The vault visibility gate checks the arguments before the CLI runs, in `runCli`, so a daemon tool cannot reach a hidden note either.

Every tool here has a CLI twin, listed in `CLI_TWINS` in `mcp/src/cliTwins.ts`: `remember`, `recall` and `forget` pair with `memory remember`, `memory recall` and `memory forget`, and each daemon tool with the command in the table. `cli/test/mcpParity.test.ts` fails when a tool lacks a twin. The memory tools call functions in `mcp/src/memory.ts` that the `bismuth memory` commands import directly; the daemon tools spawn the CLI instead, so this workspace has no dependency on `@bismuth/core`.

Source: `mcp/src/{daemon,memory,server,cli,cliTwins}.ts`, `cli/src/commands/{daemon,page,memory}.ts`, `core/src/{daemon,daemonGraph,daemonPages,daemonActivity}.ts`, `mcp/test/daemon.test.ts`
