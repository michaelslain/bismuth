# Daemon On-Disk Storage Layout

This page documents the daemon's **two-tier** storage model — what the `@bismuth/daemon` runtime
writes, where, and in what format. The daemon is **one machine process that multiplexes per-vault
"brains"**: machine-level identity + runtime state live in a single home dir, and each enabled
vault's brain (its crons, processes, memory, and conversation session) lives under that vault's own
`.daemon` directory. Bismuth core reads the same tree to power the "daemon" graph mode and the
`DaemonList` sidebar, and writes only a few control files (`owner.json`, the `enabled` frontmatter,
and trigger files) — see [overview.md](overview.md).

> **Legacy migration note.** `~/.claude-bot` is not a live layout — it survives only as a
> **one-time, copy-only migration source** (see [Legacy migration](#legacy-claude-bot-migration)
> below). There is **no** `daemon.home` setting.

---

## The two tiers

```
~/.bismuth/daemon/                       # MACHINE_DIR — one per machine (identity + runtime)
└── …                                    # device-id, devices.json, owner.json, daemon.pid, logs/, vaults.json

<vault>/.daemon/                         # PER-VAULT brain — one per enabled vault
└── …                                    # crons/, processes/, memory/, identity.md, session-id
```

| Tier | Root | Holds | Resolved by |
| --- | --- | --- | --- |
| **Machine** | `~/.bismuth/daemon` (env `BISMUTH_DAEMON_DIR`) | device identity, owner selection, device heartbeats, the daemon PID, daemon logs, and the `vaults.json` registry of known vault roots — **shared across all vaults** | `MACHINE_DIR` (`daemon/src/lib/config.ts`); core's `daemonMachineDir()` |
| **Per-vault** | `<vault>/.daemon` | one vault's crons, processes, 3rd-brain memory, daemon identity/personality, conversation session id, and cron run-state | `vaultPaths(root, name)` → `VaultContext` (`daemon/src/lib/config.ts`); core's `vaultDaemonDir(vault)` |

The machine dir is resolved as `BISMUTH_DAEMON_DIR || ~/.bismuth/daemon` — the env var is the only
override (ops/dev/tests), and core's `daemonMachineDir()` resolves the same way so both processes
agree byte-for-byte. There is no per-user setting that moves it.

---

## Tier 1 — Machine directory (`~/.bismuth/daemon`)

Created on daemon boot by `ensureDirs()` (`daemon/src/daemon/index.ts`): it `mkdir -p`s `MACHINE_DIR`
and `logs/`. The identity files are created lazily on first heartbeat/claim.

```
~/.bismuth/daemon/                       # MACHINE_DIR (config.ts) — env BISMUTH_DAEMON_DIR overrides
├── device-id                            # plain UTF-8 UUID for THIS machine (no JSON)
├── devices.json                         # { "<deviceId>": { label, lastSeenISO } }
├── owner.json                           # { ownerDeviceId, ownerLabel, updatedAt } (absent = unclaimed)
├── daemon.pid                           # plain int (process.pid); presence + liveness ⇒ running
├── vaults.json                          # JSON array of absolute vault roots (written by Bismuth core)
├── .claude-bot-migrated                 # one-time legacy-migration marker (records the dest vault)
├── .daemon-installed                    # bundle install marker (size:mtime of the staged binary)
└── logs/                                # daemon stdout/stderr (launchd/systemd redirect here)
    ├── bismuth-daemon.stdout.log
    └── bismuth-daemon.stderr.log
```

### Per-file reference (machine tier)

| Path | Format | Owning module | Written / created by |
| --- | --- | --- | --- |
| `~/.bismuth/daemon/` (`MACHINE_DIR`) | dir | `lib/config.ts` | `ensureDirs` (`daemon/index.ts`); also `getDeviceId` mkdir |
| `device-id` | plain UTF-8 UUID, trimmed, no JSON | `lib/device.ts` | `getDeviceId` — generates+persists a `randomUUID()` on first read (atomic `<path>.<pid>.tmp` then rename), reused across restarts |
| `devices.json` | JSON map `{ "<deviceId>": { label, lastSeenISO } }` | `lib/owner.ts` | `heartbeatDevice()` upserts this device's entry every tick (even idle / non-owner) with `label = os.hostname()` (`getDeviceLabel`) and a fresh ISO; atomic |
| `owner.json` | JSON `{ ownerDeviceId, ownerLabel, updatedAt }`; absent = unclaimed | `lib/owner.ts` | `setOwnerDevice()` (atomic, pretty-printed); `getOwner()` / `isOwner()` read it. **`isOwner()` is true when absent** (unclaimed = single-device behavior). Bismuth core writes it byte-compatibly via `setOwner()` |
| `daemon.pid` | plain int | `daemon/index.ts` | `writePid` (`String(process.pid)`) / `removePid` on graceful shutdown. Liveness via `process.kill(pid, 0)` — the pid file survives a crash/SIGKILL, so readers always re-check liveness |
| `vaults.json` | JSON array of absolute vault roots | `lib/config.ts` (`VAULTS_FILE`), read by `lib/registry.ts` | **Written by Bismuth core** on vault open; the daemon only reads it (`knownVaultRoots()`) to discover which vaults exist. Each vault opts in via its own `.settings` (`daemon.enabled`) |
| `.claude-bot-migrated` | plain text = the destination vault root | `core/src/daemon.ts` | `migrateDaemonState` — written once, machine-wide, to gate the legacy copy to exactly one vault (see below) |
| `.daemon-installed` | plain text = `"<size>:<mtimeMs>"` of the staged binary | `core/src/daemonInstall.ts` | `installDaemonFromBundle` — version marker so the daemon binary is only re-copied when a new app build ships a new one |
| `logs/bismuth-daemon.{stdout,stderr}.log` | plain text | `lib/platform.ts` | launchd `StandardOutPath`/`StandardErrorPath` (or systemd `StandardOutput=append:`) redirect the service's output here |

The launchd/systemd service definition itself lives **outside** `MACHINE_DIR` (`lib/platform.ts`):

| Platform | Service file | Service id |
| --- | --- | --- |
| macOS | `~/Library/LaunchAgents/com.bismuth.daemon.plist` | launchd label `com.bismuth.daemon` |
| Linux | `~/.config/systemd/user/bismuth-daemon.service` | systemd unit `bismuth-daemon` |

The daemon **binary** is installed at `~/.bismuth/bin/bismuth-daemon` (env override `BISMUTH_DAEMON_BIN`)
by core's `installDaemonFromBundle()`, which then runs `<bin> --ensure-installed` to write+load the
service. See [lifecycle.md](lifecycle.md) and [install](../overview/install.md).

---

## Tier 2 — Per-vault brain (`<vault>/.daemon`)

`vaultPaths(root, name)` resolves every path the runtime touches for one vault into a `VaultContext`.
On each brain-start (`startVault` → `ensureVaultDirs`, `daemon/src/daemon/index.ts`) the daemon
`mkdir -p`s `daemonDir`, `memory/`, `crons/`, `processes/`, and `logs/`, then runs `reconcileSeeds()`
(below) to write any missing seeded defaults.

```
<vault>/.daemon/                         # vaultPaths(root).daemonDir
├── identity.md                          # name (frontmatter) + personality (body) — user-editable, SEEDED
├── session-id                           # this vault's latest SDK session id (a moving pointer)
├── session-ids                          # durable append-only SET of daemon-minted session ids
├── session-ids-legacy                   # one-time backfill of that set, written ONCE by core
├── memory/                              # 3rd-brain markdown notes (single-level folders allowed)
│   └── <name>.md
├── logs/                                # per-process stdout/stderr for THIS vault's processes
│   ├── <process>.stdout.log
│   └── <process>.stderr.log
├── crons/
│   ├── <name>.md                        # cron def (frontmatter + body = prompt) — defaults SEEDED
│   ├── .last-fired.json                 # { "<name>": { timestamp, result } }
│   ├── .running.json                    # { "<name>": { startedAt } }
│   └── .triggers/
│       └── <name>                       # ISO-timestamp file (presence = "run now"; no .md)
└── processes/
    ├── <name>.md                        # process def (frontmatter; command required)
    ├── .pids/
    │   └── <name>.pid                   # plain int — the cross-restart orphan-reap link
    └── .triggers/
        └── <name>                       # ISO-timestamp file (presence = "reconcile runtime"; no .md)
```

### Per-file reference (per-vault tier)

| Path | Format | Owning module | Written / created by |
| --- | --- | --- | --- |
| `<vault>/.daemon/` | dir | `lib/config.ts` (`vaultPaths`) | `ensureVaultDirs` (`daemon/index.ts`) |
| `identity.md` | markdown: `name:` frontmatter + personality body | `daemon/seeds.ts`, read by `session.ts` + `lib/registry.ts` | Seeded with `name: daemon` + `DEFAULT_DAEMON_IDENTITY` when absent (`reconcileSeeds`). The `name:` drives the sidebar label + daemon-graph hub (`daemonIdentityName()` in core, `readDaemonSettings()` in the daemon); the body is the bot's system prompt, read fresh per session via `buildSystemPrompt` (`You are <name>.\n\n<body>`). User-editable; never clobbered. See [memory.md](memory.md) |
| `session-id` | plain text SDK session id | `daemon/session.ts` | `saveSessionId(ctx, id)` / `getSessionId(ctx)` — per-vault, so the one runtime `resume`s the right thread for each concurrent vault. A **moving pointer**: overwritten on every new session, so it names only the daemon's LATEST run |
| `session-ids` | newline-delimited session ids, oldest first, deduped, capped at 2000 | `daemon/sessionIds.ts` | `recordDaemonSessionId(ctx, id)` — the **durable set** of every session the daemon minted, appended from `saveSessionId`. Read by core (`readDaemonSessionIds`, `core/src/daemon.ts`) so the chat page lists only the user's own chats and a future surface can find the daemon's. Answers "did the daemon mint this session?" for ALL of them — which `session-id` cannot |
| `session-ids-legacy` | same format as `session-ids` | **core** (`core/src/chatDaemonLegacy.ts`) | The **one-time backfill** of the durable set, for daemon sessions minted *before* `session-ids` existed. `backfillLegacyDaemonSessions(vault)` scans the SDK store once (first History open; gated on `.daemon` existing, bounded by reading only each transcript's first message) and records every session whose OPENING prompt the daemon itself composed — an exact match on `DAEMON_BOOT_PROMPT`, or the `[Cron: ` prefix **and** the cron result instruction together. `readDaemonSessionIds` unions this with `session-ids`. Its own existence is the done-marker (an empty file = "scanned, found nothing"); it is frozen once written, since it describes history. **A separate file on purpose**: its writer is a different OS process (core, not the daemon), so each file keeps a single writing process and the daemon's in-process lock stays sufficient. See [lifecycle.md](lifecycle.md) |
| `memory/<name>.md` | markdown note: frontmatter `{ type, tags, created, updated }` + body with `[[backlinks]]`; single-level folders allowed | `@bismuth/memory` (`memory/src/graph.ts`) | The 3rd brain. Written by the daemon's bot, the relay collect hook, and the MCP `remember` tool — all against `<vault>/.daemon/memory` via `BISMUTH_MEMORY_DIR`. Full note format: [memory.md](memory.md) |
| `crons/<name>.md` | cron def frontmatter, EITHER `{ name?, schedule, catchup?(default true) }` (time-based, the default) OR `{ name?, on: file-change, watch }` (fires on a vault file/glob change instead) — both share `{ enabled?(default true), notify?, model?, effort?, timeout?, waitFor? }` + body (= prompt) | `daemon/cron.ts` | `daemon/cron.ts` CRUD; the two defaults (`dream`, `vault-review`) are seeded, both schedule-based. Full model incl. file-change crons: [crons-and-processes.md](crons-and-processes.md#file-change-crons) |
| `crons/.last-fired.json` | `{ "<name>": { timestamp: ISO, result: "success"\|"failed"\|"unknown"\|"killed" } }`, keyed by job name | `daemon/cron.ts` | `updateLastFired` (unique-tmp atomic write under a per-file serial queue). `loadLastFired` migrates a legacy plain-string value to `{ timestamp, result: "success" }` |
| `crons/.running.json` | `{ "<name>": { startedAt: ISO } }`, keyed by job name | `daemon/cron.ts` | `markRunning` / `markDone` (same serial-queue + atomic write) |
| `crons/.triggers/<name>` | ISO-timestamp file (content unused; presence is the signal); filename = job name, **no** `.md` | `daemon/cron.ts` | `requestCronRun` (or core's `runCron`); consumed (unlinked) by `processTriggers` every 5s. Owner-gated — a non-owner daemon unlinks without firing |
| `processes/<name>.md` | process def frontmatter `{ command(required), name?, args?, cwd?, env?, restart?(default on-failure), restartDelay?(default 1000), enabled?(default true) }` | `daemon/process.ts` | `daemon/process.ts`. Full model: [crons-and-processes.md](crons-and-processes.md) |
| `processes/.pids/<name>.pid` | plain int (`PIDS_SUBDIR = ".pids"`) | `daemon/process.ts` | `writePidFile` — the cross-restart link a fresh daemon reads (`reapOrphans`) to kill children orphaned by a previous instance. Removed on confirmed exit. No `.running.json` for processes; liveness is in-memory + this pid file |
| `processes/.triggers/<name>` | ISO-timestamp file; filename = process file basename, **no** `.md` | `daemon/process.ts` | `requestProcessRun` (or core's `setProcessEnabled`); consumed by `processProcessTriggers` every 5s, which reconciles that process's runtime to its on-disk `enabled` flag |
| `logs/<process>.{stdout,stderr}.log` | plain text | `daemon/process.ts` | `spawnProcess` opens these append-mode and wires the child's stdio to them |

### Seeded defaults (`reconcileSeeds`)

`reconcileSeeds(ctx)` (`daemon/src/daemon/seeds.ts`) is the daemon's analog of core's
`reconcileSettings`: one declarative, **incremental, non-clobbering** pass run on every brain-start.
It writes each registered seed only when its file is MISSING, so a fresh vault gets the full set, an
already-set-up vault that predates a newly-added default gets just that new piece on next boot, and
user edits (or a deliberate `enabled: false`) are never overwritten. `seedsFor(ctx)` currently seeds:

- **`identity.md`** — `---\nname: daemon\n---` + `DEFAULT_DAEMON_IDENTITY`.
- **The default crons** (`daemon/src/daemon/defaultCrons.ts`, embedded as string constants so they
  survive `bun build --compile`):
  - **`dream`** — `schedule: 0 * * * *` (hourly), `timeout: 1800`: consolidates this vault's
    `memory/` graph into an atomic, densely-linked zettelkasten.
  - **`vault-review`** — `schedule: 0 */4 * * *` (every 4h), `timeout: 900`, `notify: true`:
    reviews the vault to maintain a living model-of-the-user in memory.

Add a future seedable by appending one entry to `seedsFor()`.

---

## Invariants

- **`enabled` defaults to `true`.** Only an explicit `enabled: false` disables a cron/process — the
  daemon's parsers check `frontmatter.enabled !== "false"`, and core's reader checks `data.enabled !== false`.
- **Keying differs.** A cron's runtime/display name is `frontmatter.name ?? filename`; a process's
  is likewise `frontmatter.name ?? filename`. Trigger files and `.pids/` files, however, are always
  named by the **file basename**. In-memory runtime state is keyed `${ctx.root}::${name}` so two
  vaults can each own an identically-named cron/process without colliding.
- **Trigger files: unlink-first, then act.** Dotfiles are excluded from the trigger scan; a non-owner
  daemon consumes a trigger without acting on it.
- **All identity/owner writes are atomic** (tmp + rename). Cron state writes additionally go through a
  per-file serial queue (keyed by the absolute, already-vault-unique path).
- **Memory has no on-disk index or DB** — the graph is recomputed from the `.md` files on demand by
  `@bismuth/memory` (see [memory.md](memory.md)). The memory dir is always supplied explicitly (the
  daemon passes `<vault>/.daemon/memory`; the MCP + relay hooks set `BISMUTH_MEMORY_DIR`) — there is
  no machine-global default.
- **Disable = pause, never delete.** Disabling a vault's daemon (or dropping it from `vaults.json`)
  tears down its live processes/session but never touches its on-disk `.daemon` state.

---

## Legacy `~/.claude-bot` migration

`~/.claude-bot` is not a live layout. It survives only as
a **one-time, copy-only** migration source, handled by `migrateDaemonState(vault, legacy?)` in
`core/src/daemon.ts`:

- **Copy-only — never deletes or moves the source.** `~/.claude-bot` stays in place as a permanent
  backup, so the migration can never lose the user's memory graph.
- **Machine-wide, gated to ONE vault.** A `~/.bismuth/daemon/.claude-bot-migrated` marker records the
  destination vault root; once present, no other vault ever migrates. The brain lands in the first
  vault whose daemon is enabled after upgrade.
- **Per-file merge.** For each of `memory/`, `crons/`, `processes/`, it copies only legacy items not
  already present in `<vault>/.daemon/<sub>` — so seeded defaults and the vault's own newer notes are
  never clobbered.
- **Best-effort; never throws.** Any failure leaves `~/.claude-bot` untouched as the source of truth.
- **Source override.** The legacy root defaults to `~/.claude-bot` but is overridable via
  `BISMUTH_LEGACY_CLAUDE_BOT_DIR` (or the `legacy` arg) so tests never read the user's real dir.

---

## Relationship to Bismuth

Bismuth core reads this tree to power the "daemon" graph mode and `DaemonList` sidebar. It writes only:
`owner.json` (`setOwner`), a cron/process's `enabled` frontmatter (`setCronEnabled`/`setProcessEnabled`),
and trigger files (`runCron`/`setProcessEnabled`). Crucially, daemon **liveness** is read MACHINE-level
(`daemonMachineDir()/daemon.pid`) while crons/processes are read PER-VAULT (`vaultDaemonDir(vault)/{crons,processes}`),
because one machine process multiplexes every vault's brain. Every reader tolerates missing/malformed
files and never throws.

See also: [overview.md](overview.md), [lifecycle.md](lifecycle.md),
[crons-and-processes.md](crons-and-processes.md), [memory.md](memory.md),
[communication.md](communication.md), and the docs [README](../README.md).

Source: daemon/src/lib/config.ts, daemon/src/lib/device.ts, daemon/src/lib/owner.ts, daemon/src/lib/platform.ts, daemon/src/lib/registry.ts, daemon/src/daemon/index.ts, daemon/src/daemon/cron.ts, daemon/src/daemon/fileWatch.ts, daemon/src/daemon/process.ts, daemon/src/daemon/session.ts, daemon/src/daemon/seeds.ts, daemon/src/daemon/defaultCrons.ts, core/src/daemon.ts, core/src/daemonState.ts, core/src/daemonGraph.ts, core/src/daemonInstall.ts, memory/src/graph.ts, mcp/src/memory.ts, relay/lib/memory.ts
