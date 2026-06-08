# claude-bot's MCP Server

`server.ts` at the claude-bot repo root **is** the claude-bot MCP server — a single STDIO entry point registered globally so that every Claude Code session gains claude-bot's memory, cron, process, daemon, and device tools (all exposed as `mcp__claude-bot__*`). The same file runs in three launch contexts, including inside the daemon's own persistent bot session.

> This is **not** Bismuth's MCP server. See [Distinction from Bismuth's MCP](#distinction-from-bismuths-mcp) below.

## What `server.ts` is

| Aspect | Detail |
| --- | --- |
| SDK | `@modelcontextprotocol/sdk` — `Server` from `@modelcontextprotocol/sdk/server/index.js`, request schemas from `@modelcontextprotocol/sdk/types.js` |
| Transport | **STDIO** — `new StdioServerTransport()` + `server.connect(transport)`. No HTTP. |
| Identity | `new Server({ name: "claude-bot", version: "1.0.0" }, { capabilities: { tools: {} } })` |
| Handlers | Two: `ListToolsRequestSchema` enumerates the tool catalog; `CallToolRequestSchema` is a single `switch (name)` dispatcher |
| Result shape | Every handler wraps its output via `toResult(data)` → `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`. Payloads consistently carry an `ok` field. |

**Version inconsistency to be aware of:** the MCP `Server` constructor reports `version: "1.0.0"`, while the plugin manifest (`.claude-plugin/plugin.json`) and marketplace manifest (`.claude-plugin/marketplace.json`) both report `0.1.0`. The code is the same; the version strings disagree.

## How it's launched (three contexts, one file)

The identical `server.ts` is started from three different MCP configs:

1. **Repo `.mcp.json`** (local dev, relative):
   ```json
   { "command": "bun", "args": ["run", "server.ts"] }
   ```
2. **Plugin manifest `.claude-plugin/plugin.json`** (this is what installs globally for every session):
   ```json
   { "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/server.ts"], "cwd": "${CLAUDE_PLUGIN_ROOT}" }
   ```
3. **The bot's own `~/.claude-bot/.mcp.json`** (written by the `setup` tool; this is the copy the daemon's persistent session loads):
   ```json
   { "claude-bot": { "command": "bun", "args": ["run", SERVER_PATH] } }
   ```
   where `SERVER_PATH = join(import.meta.dir, "server.ts")`.

So the **same `server.ts` runs both as the user-facing MCP server and inside the daemon's bot session.**

## Distinction from Bismuth's MCP

This claude-bot server is **a completely separate thing** from Bismuth's MCP server, with no overlap in code or purpose:

| | claude-bot MCP (this page) | Bismuth MCP ([`../mcp/overview.md`](../mcp/overview.md)) |
| --- | --- | --- |
| Server name | `claude-bot` | `bismuth` |
| Tool prefix | `mcp__claude-bot__*` | `mcp__bismuth__*` |
| Exposes | Daemon control, the memory graph, cron scheduling, background-process management, device ownership | Bismuth docs + the `bismuth` CLI |
| Tools | The 26 below | `bismuth_cli`, `bismuth_docs_list/read/search`, `bismuth_cli_help` |

Both can be registered in the **same** Claude session at once — they have different server names and never collide.

## Full tool catalog (26 tools)

| Tool | Required args | Optional args | What it does / backing call |
| --- | --- | --- | --- |
| `remember` | `name:string`, `content:string` | `type:string`, `tags:string[]`, `folder:string` | Save a note to the memory graph; validates `folder`, merges with existing note frontmatter, `writeNote()` (`memory/graph.ts`); returns `{ok, name}` (folder-prefixed) |
| `forget` | `name:string` | — | Remove a note from the memory graph. Accepts folder-prefixed names (e.g. `moltbook/foo`); `parseNoteRef()` + `deleteNote()`; `{ok, name}` |
| `recall` | `query:string` | `folder:string` | Search the memory graph (supports `tag:`, `type:`, `keyword:`, `link:`, `after:`, `before:` filters); `query()` (`memory/query.ts`); `{ok, count, notes}` |
| `dream_run` | — | — | Trigger a manual dream cycle — consolidates, deduplicates, and improves memory notes; `dream()` (`memory/dream.ts`) |
| `dream_status` | — | — | Get dreaming (memory consolidation) status and config; `getDreamConfig()` |
| `dream_config` | — | `enabled:boolean`, `intervalMs:number` | Update dreaming configuration; `updateDreamConfig()`; rejects `intervalMs <= 0` |
| `status` | — | — | Get claude-bot daemon status — whether it's running, session ID, uptime, memory note count, cron job count; aggregates daemon PID, session id, note count, crons (`lastRun`/`running`), processes, orphans |
| `message_bot` | `message:string` | `model:string`, `effort:string` | Send a message to the claude-bot. Runs a Claude Code session in `~/.claude-bot/` with the bot's `CLAUDE.md` and memory tools; `sendMessage()` (`daemon/session.ts`); validates `model` ∈ `{opus, sonnet, haiku}`; `{ok, response, sessionId}`. **Precondition:** if `!isInstalled()`, returns `"claude-bot is not set up yet. Run /claude-bot:setup or call the setup tool first."` |
| `process_list` | — | — | List all managed background processes and their status; `listProcesses()` |
| `process_start` | `name:string` | — | Start a stopped background process; **daemon-gated** then `startProcess()` |
| `process_stop` | `name:string` | — | Stop a running background process; **daemon-gated** then `stopProcess()` |
| `process_enable` | `name:string` | — | Mark a process as enabled (will auto-start on next daemon boot). Registers the process if not already registered. Does not spawn it — call `process_start` to run it now; **daemon-gated** then `enableProcess()` |
| `process_disable` | `name:string` | — | Mark a process as disabled (will not auto-start on next daemon boot). If currently running, stops it. Keeps the process registered so it can still be `process_start`-ed at runtime; **daemon-gated** then `disableProcess()` |
| `cron_list` | — | — | List all cron jobs with their schedule, status, and config; `loadCronJobs()` + `loadLastFired()`; truncates `prompt` to 200 chars |
| `cron_create` | `name:string`, `schedule:string`, `prompt:string` | `model:string`, `effort:string`, `catchup:boolean`, `notify:boolean`, `enabled:boolean` | Create a new cron job; `createCronJob()` |
| `cron_run` | `name:string` | — | Trigger a cron job immediately, regardless of schedule; `requestCronRun()` (drops a trigger file the daemon polls) |
| `cron_stop` | `name:string` | — | Stop a currently running cron job session. Use before `cron_run` to restart a stuck job; `stopCronJob()` |
| `cron_update` | `name:string` | `enabled:boolean`, `schedule:string`, `model:string`, `effort:string`, `catchup:boolean`, `notify:boolean`, `prompt:string` | Update a cron job's config (enable/disable, change schedule, model, etc.); `updateCronJob()` |
| `cron_delete` | `name:string` | — | Delete a cron job; `deleteCronJob()` |
| `device_info` | — | — | Get this device's identity and ownership status: `deviceId`, `label`, whether it's the owner, and the current owner record (or `null` if unclaimed); `deviceInfo()` (`lib/owner.ts`) |
| `device_list` | — | — | List all devices known to this claude-bot install (from `devices.json`) with their labels, last-seen times, and owner/self flags; `listDevices()` |
| `set_owner_device` | `deviceId:string` | — | Claim ownership for a device by id. The device must already be present in `devices.json` (it must have heartbeated). Writes `owner.json` and returns `device_info()`; `setOwnerDevice()` |
| `setup` | — | — | First-time install of claude-bot. Creates `~/.claude-bot/` directory, `CLAUDE.md`, MCP config, crons, and daemon service. Only runs once — fails if already installed; `setupBot()` |
| `restart` | — | — | Restart the claude-bot daemon. Use after changing code or config; `restartBot()` → `reloadDaemon()` |
| `stop` | — | — | Stop the claude-bot daemon; `stopBot()` → `unloadDaemon()` |
| `uninstall` | — | — | Uninstall claude-bot. Stops the daemon and removes the service config; `uninstallBot()` (preserves memory) |

> The project's own `CLAUDE.md` tool table omits `cron_stop`, `device_info`, `device_list`, and `set_owner_device`. The **code is authoritative** — those four tools exist and are registered.

The memory tools (`remember`/`forget`/`recall`/`dream_*`) are backed by the memory engine — see [`memory.md`](memory.md). The cron/process tools are backed by the daemon's scheduler and process supervisor — see [`crons-and-processes.md`](crons-and-processes.md). The lifecycle tools (`setup`/`restart`/`stop`/`uninstall`) are covered in [`install.md`](install.md).

## Daemon-gating

`process_start`, `process_stop`, `process_enable`, and `process_disable` each first check `isDaemonProcess()` (`lib/platform.ts` — true **only** when the calling pid equals the pid in `~/.claude-bot/daemon.pid`). If false, they return `notDaemonError()`:

> Process-management commands must run inside the daemon. This `server.ts` (PID …) is not the daemon — check `~/.claude-bot/daemon.pid` and route the call through the daemon's MCP surface.

So from a normal user session the **process tools refuse**, while the memory, cron, dream, device, and setup tools work from any context.

## Prompts and instructions the server injects

**(a) The bot's `CLAUDE.md` personality.** A large template string `CLAUDE_MD` is written to `~/.claude-bot/CLAUDE.md` during `setup` **only if it doesn't already exist**. It is titled `# Claude Bot` and opens with `"You are a persistent Claude Code daemon running as a background service…"`. Its `## CRITICAL: You MUST use your MCP memory tools` section documents `remember`/`recall`/`forget`/`dream_run` plus the note-`type` enum, and lays out rules such as:

- "Be direct and concise — you're a daemon, not a chatbot"
- "Check memory before every response"
- "When unsure if something is worth remembering, remember it anyway."

The tool description strings (the catalog table above) are the other model-facing instructions.

**(b) The daemon boot prompt.** On daemon init, `daemon/index.ts` sends this through `sendMessage`:

> You are now running as a background daemon. Check memory for any prior context. Set up any crons you need.

## Side effects at server startup (beyond tool registration)

Before connecting the transport, `server.ts` **mutates the user's global `~/.claude/settings.json`** to self-register two hooks (idempotently, on every launch):

| Event | Hook |
| --- | --- |
| `UserPromptSubmit` | `bun run …/bin/recall-hook.ts` |
| `SessionEnd` | `bun run …/bin/collect-hook.ts` |

A migration cleanup strips old `memory-hook.ts` entries and removes `collect-hook.ts` from `UserPromptSubmit` (it moved to `SessionEnd`). Full hook detail is in [`communication.md`](communication.md).

`setup` **also** writes the daemon's own `~/.claude-bot/.claude/settings.local.json`, allowlisting all `mcp__claude-bot__*` tools plus `Bash(*)`, `Read(*)`, `Write(*)`, `Edit(*)`, `Glob(*)`, and `Grep(*)`, so the daemon session runs autonomously.

## Plugin / marketplace declaration

`.claude-plugin/plugin.json`:

| Field | Value |
| --- | --- |
| name | `claude-bot` |
| version | `0.1.0` |
| author | Michael Slain |
| license | MIT |
| description | "Persistent Claude Code agent with long-term memory, cron jobs, and messaging adapters" |
| MCP server | declared via `${CLAUDE_PLUGIN_ROOT}/server.ts` |

`.claude-plugin/marketplace.json`: marketplace name `claude-bot-local`, listing one plugin `claude-bot` v0.1.0 with `source: "./"`. Install flow:

```
Adding marketplace…
Installing plugin "claude-bot@claude-bot-local"...
✔ Successfully installed plugin: claude-bot@claude-bot-local (scope: user)
```

## See also

- [`memory.md`](memory.md) — the engines behind the memory tools (`remember`/`forget`/`recall`/`dream_*`)
- [`crons-and-processes.md`](crons-and-processes.md) — backings for the cron/process tools
- [`communication.md`](communication.md) — the hooks this server registers
- [`install.md`](install.md) — `setup`/`restart`/`stop`/`uninstall`
- [`../mcp/overview.md`](../mcp/overview.md) — Bismuth's separate MCP server

Source: server.ts, .mcp.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, memory/graph.ts, memory/query.ts, memory/dream.ts, daemon/session.ts, daemon/index.ts, lib/platform.ts, lib/owner.ts, bin/recall-hook.ts, bin/collect-hook.ts
