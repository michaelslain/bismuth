# claude-bot

`claude-bot` is a **separate project and process** from Bismuth. It lives at the sibling path `../claude-bot` and is symlinked into this repo as `./claude-bot` so its source can be read in-tree; nothing here builds or owns it. This section documents claude-bot itself (its daemon, memory store, MCP server, and install path), and — precisely — the two narrow, file-based seams through which Bismuth integrates with it.

> If you are looking for **Bismuth's side** of the integration (the "daemon" graph mode, the `DaemonList` sidebar, what Bismuth reads/writes), see `../daemon/overview.md` and `../daemon/storage.md`. This page documents the thing those pages talk to.

## What claude-bot is

> "Persistent Claude Code daemon with long-term memory, intelligent consolidation, and scheduled tasks. One always-on agent session + file-based cron scheduling + memory graph with folder organization." — `README.md`

It is a thin [Bun](https://bun.sh) daemon kept alive by **launchd** (macOS) / **systemd** (Linux), routing **every** message through **one** persistent Claude Code session via `@anthropic-ai/claude-agent-sdk`. A single agent session accumulates context over time; cron jobs, background processes, and the memory "dream" cycle all talk to that same session.

| Property | Value |
| --- | --- |
| Package | `claude-bot`, version `0.1.0` |
| Runtime | Bun |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |
| MCP SDK | `@modelcontextprotocol/sdk` (stdio) |
| Process supervisor | launchd (macOS) / systemd (Linux) — **Windows not yet supported** |
| Storage | markdown files with YAML frontmatter |
| Default model | `haiku` |
| License | Internal (Anthropic) |

### "All roads lead to one session"

From `CLAUDE.md`: there is exactly one persistent agent session, and every entry point converges on it via `sendMessage()` → `query({ resume: sessionId })`:

| Entry point | Path |
| --- | --- |
| `message_bot` MCP tool | `message_bot` → `sendMessage()` → `query({ resume: sessionId })` |
| A cron firing | cron fires → `sendMessage()` → same session |
| Memory "dreaming" | dream cycle → `sendMessage()` → same session |

The session id is persisted on disk so the same conversation resumes across daemon restarts.

## The three layers

claude-bot's architecture (from `CLAUDE.md` "Architecture") is three cooperating layers:

| Layer | Code | Role |
| --- | --- | --- |
| **1. MCP Server** | `server.ts` | stdio MCP server exposing memory tools (`remember`/`recall`/`forget`), dream tools, `message_bot`, and cron/process/device/setup tools. Registered **globally** so every Claude Code session on the machine has these tools. |
| **2. Thin Daemon** | `daemon/` | The Bun process under launchd/systemd. Manages the **one** persistent agent SDK session, the **cron scheduler**, and the **background-process supervisor**. |
| **3. Memory Graph** | `memory/` | An Obsidian-style markdown vault at `~/.claude-bot/memory/` with `[[backlinks]]`, YAML frontmatter, query/search engines, and a **dream** consolidation cycle. |

## Repo layout

Top-level files in the claude-bot repo:

```
server.ts                         # the MCP server (layer 1)
daemon/
  index.ts                        # supervisor: boot/shutdown, scheduling tick
  session.ts                      # the one persistent agent SDK session
  cron.ts                         # file-based cron scheduler
  process.ts                      # background-process supervisor
memory/
  graph.ts                        # backlink graph over the memory vault
  query.ts                        # structured query engine
  search.ts                       # full-text search
  dream.ts                        # consolidation ("dream") cycle
bin/
  ensure-installed.ts             # adopt-only installer entrypoint
  collect-hook.ts                 # SessionEnd hook
  recall-hook.ts                  # UserPromptSubmit hook
  forget-cron-auto-notes.ts       # one-shot cleanup CLI (not a hook)
lib/
  config.ts                       # BOT_DIR + paths (hard-coded ~/.claude-bot)
  platform.ts                     # launchd / systemd specifics
  device.ts                       # device identity
  owner.ts                        # owner gating
  install.ts                      # getInstallStatus / ensureInstalled (adopt-only)
  frontmatter.ts                  # YAML frontmatter read/write
  json.ts                         # JSON file helpers
defaults/crons/dream.md           # the shipped dream cron
skills/setup/SKILL.md             # setup skill
.claude-plugin/
  plugin.json
  marketplace.json
.mcp.json
```

## On-disk home: `~/.claude-bot/`

The home directory is **hard-coded** in `lib/config.ts` as `BOT_DIR`, derived from `os.homedir()`. There is **no environment override on the claude-bot side** — it is always `~/.claude-bot/`.

| Path | Contents |
| --- | --- |
| `device-id` | this machine's device identifier |
| `devices.json` | known devices |
| `owner.json` | owner identity (gates who the daemon answers to) |
| `daemon.pid` | running daemon's pid |
| `session-id` | the persistent agent session id |
| `CLAUDE.md` | the daemon's own instructions |
| `.mcp.json` | the daemon's MCP registration |
| `memory/` | the markdown memory vault |
| `crons/` | file-based cron definitions |
| `processes/` | background-process definitions |
| `logs/` | daemon + task logs |

## How it relates to Bismuth

claude-bot is a fully separate process and project. **Bismuth never starts, stops, or restarts it.** Bismuth integrates in exactly two narrow, file-based, **adopt-only** ways:

1. **Reads (and minimally writes) shared on-disk state.** Bismuth reads claude-bot's files under `~/.claude-bot` to power Bismuth's "daemon" graph mode and the `DaemonList` sidebar. The only things Bismuth **writes** are `owner.json`, cron/process **frontmatter**, and **trigger files** (run/enable/disable). Everything else is read-only. See `../daemon/overview.md` and `../daemon/storage.md`.
2. **Can provision + invoke the installer.** Bismuth does not bundle claude-bot; on opt-in it `git clone`s claude-bot to `~/.bismuth/claude-bot` + `bun install`s it (`provisionClaudeBot()`), then invokes claude-bot's **adopt-only** installer entrypoint `bin/ensure-installed.ts` to install or adopt the daemon. The installer never clobbers, restarts, or repoints a live daemon. See `install.md`.

### Two different MCP servers — do not conflate

claude-bot has its **own** stdio MCP server (`server.ts`) exposing `mcp__claude-bot__*` tools (memory, cron, process, device, daemon control). This is **different** from Bismuth's `mcp/` workspace, which exposes `mcp__bismuth__*` tools serving Bismuth's `docs/` reference and the `bismuth` CLI. They share nothing but the MCP protocol. Compare `mcp.md` (claude-bot's) with `../mcp/overview.md` (Bismuth's).

## This section

- [daemon.md](daemon.md) — the supervisor process (`daemon/index.ts` + `session.ts`): boot/shutdown, the persistent session, the scheduling tick, launchd/systemd, owner gating.
- [crons-and-processes.md](crons-and-processes.md) — file-based crons (`daemon/cron.ts`) + background processes (`daemon/process.ts`): frontmatter model, scheduling, `.last-fired.json`/`.running.json`, triggers, enable/disable/run.
- [memory.md](memory.md) — the memory store (`memory/graph,query,search,dream`): note format, backlinks, query vs search, the dream consolidation cycle.
- [mcp.md](mcp.md) — claude-bot's own stdio MCP server (`server.ts`) and its full tool catalog, vs Bismuth's MCP.
- [communication.md](communication.md) — hooks (`recall-hook` UserPromptSubmit, `collect-hook` SessionEnd) + what device coordination actually exists (and that cross-machine messaging does **not** exist).
- [install.md](install.md) — installation: `lib/install.ts` (`getInstallStatus`/`ensureInstalled`, adopt-only), `lib/platform.ts` (launchd/systemd), `lib/device.ts`, `bin/ensure-installed.ts`, and how Bismuth bundles + invokes it (`OA_CLAUDEBOT_BUNDLE`).
- [storage.md](storage.md) — the `~/.claude-bot` on-disk layout (cross-links to Bismuth's `../daemon/storage.md`).

---

Source: README.md, CLAUDE.md, package.json, server.ts, daemon/index.ts, daemon/session.ts, daemon/cron.ts, daemon/process.ts, memory/graph.ts, memory/query.ts, memory/search.ts, memory/dream.ts, bin/ensure-installed.ts, bin/collect-hook.ts, bin/recall-hook.ts, bin/forget-cron-auto-notes.ts, lib/config.ts, lib/platform.ts, lib/device.ts, lib/owner.ts, lib/install.ts, lib/frontmatter.ts, lib/json.ts, defaults/crons/dream.md, skills/setup/SKILL.md, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .mcp.json
