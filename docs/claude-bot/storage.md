# claude-bot On-Disk Storage Layout

This page documents the `~/.claude-bot` storage tree from the **producer** (daemon-owner) side — what claude-bot itself writes, where, and in what format. Bismuth reads this same tree to power its "daemon" graph mode and `DaemonList` sidebar; for the **consumer**-side read contract (which files Bismuth reads, how it degrades on missing/partial files, and the `daemon.home` / `BISMUTH_DAEMON_DIR` resolution Bismuth uses to find this tree), see [../daemon/storage.md](../daemon/storage.md) and [../daemon/overview.md](../daemon/overview.md). This page does not duplicate that — it is the claude-bot view.

## Home directory

The root is `BOT_DIR`:

```ts
// lib/config.ts:6
export const BOT_DIR = join(os.homedir(), ".claude-bot")
```

On the claude-bot side this path is **hard-coded** — there is **no env-var override**. Tests inject an alternate directory by passing a `dir` function argument instead of reading an env var. (Bismuth, the consumer, additionally honors `BISMUTH_DAEMON_DIR` and a `daemon.home` setting to choose where *it* looks — but that only changes Bismuth's read path, never where claude-bot itself writes. See [../daemon/storage.md](../daemon/storage.md).)

`ensureDirs()` in `daemon/index.ts` creates `BOT_DIR`, `logs/`, `crons/`, `memory/`, and `processes/` on boot. `lib/install.ts` deliberately does **not** create these state dirs — the daemon self-creates them on first run (so an install without a daemon launch leaves no state behind).

## Directory tree

```
~/.claude-bot/                       # BOT_DIR (lib/config.ts:6)
├── device-id                        # plain UTF-8 UUID (no JSON)
├── devices.json                     # { "<deviceId>": { label, lastSeenISO } }
├── owner.json                       # { ownerDeviceId, ownerLabel, updatedAt } (absent = unclaimed)
├── daemon.pid                       # plain int (process.pid)
├── session-id                       # persistent SDK session id
├── CLAUDE.md                        # bot personality (written only if absent)
├── .mcp.json                        # MCP server config
├── .claude/
│   └── settings.local.json          # daemon tool allowlist
├── logs/                            # daemon + per-process stdout/stderr
│   └── …
├── memory/                          # markdown notes (single-level folders allowed)
│   └── <name>.md
├── crons/
│   ├── <name>.md                    # cron definition (frontmatter + body=prompt)
│   ├── .last-fired.json             # { "<name>": { timestamp, result } }
│   ├── .running.json                # { "<name>": { startedAt } }
│   └── .triggers/
│       └── <name>                   # ISO-timestamp file (presence = signal; no .md)
└── processes/
    ├── <name>.md                    # process definition (frontmatter; no body)
    ├── .pids/
    │   └── <name>.pid               # plain int
    └── .triggers/
        └── <name>                   # ISO-timestamp file (no .md)
```

Service-config files live **outside** `BOT_DIR` (`lib/platform.ts`):

| Platform | Path |
| --- | --- |
| macOS | `~/Library/LaunchAgents/com.claude-bot.daemon.plist` |
| Linux | `~/.config/systemd/user/claude-bot.service` |

## Per-file reference

| Path | Format | Owning module | Written / created by |
| --- | --- | --- | --- |
| `~/.claude-bot/` (`BOT_DIR`) | dir | `lib/config.ts:6` | `ensureDirs` (`daemon/index.ts`); also `getDeviceId` mkdir |
| `device-id` | plain UTF-8 UUID, trimmed, no JSON | `lib/device.ts` | `getDeviceId` — atomic `<path>.<pid>.tmp` then rename; read+trim; reused across restarts |
| `devices.json` | JSON map `{ "<deviceId>": { label, lastSeenISO } }` | `lib/owner.ts` | `heartbeatDevice()` upserts this device's entry every tick (even idle / non-owner) with `label = os.hostname()` and a fresh ISO; atomic |
| `owner.json` | JSON `{ ownerDeviceId, ownerLabel, updatedAt }`; absent = unclaimed | `lib/owner.ts` | `setOwnerDevice()` (atomic, pretty-printed); `getOwner()` / `isOwner()` read it; written byte-compatibly with what Bismuth reads |
| `daemon.pid` | plain int | `daemon/index.ts` | `writePid` (`String(process.pid)`) / `removePid` on shutdown; liveness via `process.kill(pid, 0)` (`lib/install.ts` `defaultPidAlive`, `lib/platform.ts` `isDaemonProcess`) |
| `session-id` | persistent SDK session id | `daemon/session.ts` | `saveSessionId` / `getSessionId` (`SESSION_FILE`) |
| `CLAUDE.md`, `.mcp.json`, `.claude/settings.local.json` | bot personality + MCP config + daemon tool allowlist | `server.ts` (the `setup` tool) | `server.ts`; `CLAUDE.md` only written if absent |
| `memory/<name>.md` | markdown note: frontmatter `{ type, tags, created, updated }` + body with `[[backlinks]]` | `memory/graph.ts` | `memory/graph.ts` (single-level folders allowed). Full note format + parsing: [memory.md](memory.md) |
| `crons/<name>.md` | cron def frontmatter `{ name?, schedule, enabled?(default true), catchup?, notify?, model?, effort?, timeout?, waitFor? }` + body (= prompt) | `daemon/cron.ts` | `daemon/cron.ts`. Full model: [crons-and-processes.md](crons-and-processes.md) |
| `crons/.last-fired.json` | `{ "<name>": { timestamp: ISO, result: "success"\|"failed"\|"unknown"\|"killed" } }`, keyed by job name | `daemon/cron.ts` | `updateLastFired` (atomic temp+rename, serial queue). `loadLastFired` migrates a legacy plain-string value to `{ timestamp, result: "success" }` |
| `crons/.running.json` | `{ "<name>": { startedAt: ISO } }`, keyed by job name | `daemon/cron.ts` | `markRunning` / `markDone` |
| `crons/.triggers/<name>` | ISO-timestamp file (content unused; presence is the signal); filename = job name, **no** `.md` | `daemon/cron.ts` | `requestCronRun`; consumed (unlinked) by `processTriggers` every 5s |
| `processes/<name>.md` | process def frontmatter `{ command(required), name?, args?, cwd?, env?, restart?, restartDelay?, enabled?(default true) }` (no body usage) | `daemon/process.ts` | `daemon/process.ts` |
| `processes/.pids/<name>.pid` | plain int (`PIDS_SUBDIR = ".pids"`) | `daemon/process.ts` | `writePidFile` — the cross-restart link a fresh daemon reads to reap orphans. There is **no** `.running.json` for processes; process liveness is in-memory + the pid file |
| `processes/.triggers/<name>` | ISO-timestamp file; filename = process file basename, **no** `.md` | `daemon/process.ts` | `requestProcessRun`; consumed by `processProcessTriggers` every 5s, which then reconciles runtime to the on-disk `enabled` flag |
| `logs/*` | daemon + per-process stdout/stderr | `lib/platform.ts` (daemon) + `daemon/process.ts` (per-process append) | `lib/platform.ts` / `daemon/process.ts` |

## Invariants

- **`enabled` defaults to `true`.** Only an explicit `enabled: false` disables a cron/process. The parser stores raw strings, so the check is `frontmatter.enabled !== "false"`. See [crons-and-processes.md](crons-and-processes.md).
- **Keying differs.** Crons are keyed by `job.name` (frontmatter `name ?? filename`); processes are keyed by file basename.
- **Trigger files: unlink-first, then act.** Dotfiles are excluded from the scan; a non-owner daemon consumes a trigger without acting on it.
- **All identity/owner writes are atomic** (tmp + rename). Cron state writes additionally go through a per-file serial queue plus the atomic temp-rename.
- **Memory has no on-disk index or DB** — the graph is recomputed from the `.md` files on demand (see [memory.md](memory.md)).

## Relationship to Bismuth

Bismuth reads this same tree to power its "daemon" graph mode and `DaemonList` sidebar, and writes only `owner.json`, the `enabled` frontmatter, and trigger files. For the consumer-side, byte-level read contract — which files Bismuth reads, how it degrades on missing/partial files, and the `daemon.home` / `BISMUTH_DAEMON_DIR` resolution Bismuth uses to locate this tree — see [../daemon/storage.md](../daemon/storage.md) and [../daemon/overview.md](../daemon/overview.md). This page is the producer (claude-bot) view and does not duplicate that contract.

See also: [crons-and-processes.md](crons-and-processes.md), [memory.md](memory.md), [install.md](install.md), [daemon.md](daemon.md).

Source: lib/config.ts, lib/device.ts, lib/owner.ts, lib/install.ts, lib/platform.ts, daemon/index.ts, daemon/cron.ts, daemon/process.ts, daemon/session.ts, memory/graph.ts, server.ts
