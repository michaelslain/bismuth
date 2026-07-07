# Daemon Overview

The **daemon** is Bismuth's in-repo background agent runtime — the `@bismuth/daemon` workspace (`daemon/src/**`), absorbed from the former standalone `claude-bot` sibling repo. It is **one machine process that multiplexes per-vault "brains"**: a single long-lived service started by launchd/systemd, looping over every vault whose daemon is enabled and running that vault's crons, background processes, conversation session, and memory.

This page covers what the daemon **is** now, the machine-vs-vault split, the `daemon.enabled` master switch, the per-vault `identity.md`, the "daemon" graph mode, and how Bismuth's core reads the daemon's state. The deeper pages are indexed at the bottom.

> **Where the daemon lives:** it ships as a compiled sidecar binary (`bismuth-daemon`) staged by the bundled app and installed to `~/.bismuth/bin`, then registered as a launchd/systemd **service** so it outlives the app (crons keep firing when Bismuth is closed). It is **not** a Tauri child process. See [lifecycle.md](lifecycle.md).

---

## One runtime, many brains

There is exactly **one** daemon process per machine. It does not run per-vault. Instead, on boot it loads every enabled vault and brings each vault's "brain" online; a reconcile loop then starts/pauses a vault's brain as that vault's `settings.daemon.enabled` flips, with no restart (`daemon/src/daemon/index.ts`: `main`, `startVault`, `stopVault`, `reconcileVaults`).

Each per-call operation is fully vault-scoped so concurrent vault sessions never race (`daemon/src/daemon/session.ts` `sendMessage`):

- **cwd** = the vault root,
- **env** `BISMUTH_MEMORY_DIR` = that vault's `<vault>/.daemon/memory`,
- **resume** = that vault's own session id (`<vault>/.daemon/session-id`),
- **appended system prompt** = that vault's `identity.md` (name + personality).

Three entry points converge on `sendMessage()` per vault: a cron firing (`daemon/src/daemon/cron.ts`), a background process loop (`daemon/src/daemon/process.ts`), and the boot prompt that wakes the session. The default model is `haiku`, pointed at the user's own installed `claude` binary (machine-login auth, no API key).

---

## Machine vs. vault split

State is partitioned into a **machine-level identity home** and **per-vault brains**.

### Machine home — `~/.bismuth/daemon`

Resolved by `MACHINE_DIR` (`daemon/src/lib/config.ts`) = `BISMUTH_DAEMON_DIR` env override, else `~/.bismuth/daemon`. On Bismuth's read side this is `daemonMachineDir()` (`core/src/daemon.ts`), same resolution. It holds the things that are **one-per-machine**, not one-per-vault:

| Path | Contents |
|---|---|
| `device-id` | this machine's stable device id |
| `devices.json` | `{ "<deviceId>": { label, lastSeenISO } }` — every heartbeating device |
| `owner.json` | `{ ownerDeviceId, ownerLabel, updatedAt }` — which device owns the daemon (absent = unclaimed) |
| `daemon.pid` | the running daemon's pid (presence + liveness ⇒ running) |
| `logs/` | daemon stdout/stderr |
| `vaults.json` | `VAULTS_FILE` — JSON array of vault roots the daemon knows about (written by Bismuth core) |
| `.claude-bot-migrated` | one-time legacy-migration marker (see Migration) |

Ownership gates the persistent session: a non-owner device still heartbeats but stays idle (`daemon/src/lib/owner.ts` `isOwner` — absent `owner.json` ⇒ unclaimed ⇒ `true`, so a single-device install just works).

### Per-vault brain — `<vault>/.daemon`

`vaultPaths(root)` (`daemon/src/lib/config.ts`) / `vaultDaemonDir(vault)` (`core/src/daemon.ts`) resolve everything one vault's brain touches under `<vault>/.daemon`:

| Path | Contents |
|---|---|
| `identity.md` | the daemon's name (frontmatter `name:`) + personality (body) for this vault |
| `memory/` | this vault's 3rd-brain memory graph (`BISMUTH_MEMORY_DIR`) |
| `crons/<name>.md` | cron definitions; `crons/.last-fired.json`, `crons/.running.json`, `crons/.triggers/` |
| `processes/<name>.md` | background-process definitions; `processes/.triggers/` |
| `session-id` | this vault's resumable conversation session id |
| `logs/` | per-vault logs |

Disabling a vault's daemon **pauses** its brain — it never deletes on-disk state (`stopVault`).

---

## The `daemon.enabled` master switch

`settings.daemon` has exactly **one** key — `enabled` (`core/src/schema/settingsSchema.ts`). There is **no** `daemon.name`, `daemon.home`, or `daemon.autoUpdate` (all removed); the daemon updates *with* the app, not via git-pull.

- **`daemon.enabled`** (default `false`) — the master switch for this vault's whole 3rd-brain/assistant surface: the background crons/processes, this vault's memory injection into Claude sessions, the `.daemon` folder's visibility, and the **3rd-brain + daemon** graph modes. Off = dormant: state is preserved on disk and `.daemon` is hidden. Set automatically from the first-run intro; toggle anytime.

The daemon's **name** does NOT live in settings — it is the `name:` frontmatter of `<vault>/.daemon/identity.md` (see below).

---

## Per-vault identity — `identity.md`

Each vault's daemon has a single editable markdown file, `<vault>/.daemon/identity.md`, that is both its name and its personality:

```markdown
---
name: daemon
---

A persistent personal-assistant daemon for this Bismuth vault…
```

- The **frontmatter `name:`** drives the sidebar folder label, the daemon-graph hub label, and the bot's self-identity (`daemonIdentityName(vault)` in `core/src/daemon.ts`; the daemon-side registry → `ctx.name`). It defaults to `"daemon"` when the file is absent or has no name.
- The **body** is the daemon's system prompt, read **fresh per session** and appended to Claude Code's prompt as `You are <name>.\n\n<body>` (`daemon/src/daemon/session.ts` `buildSystemPrompt` + `DEFAULT_DAEMON_IDENTITY`). Editing the body in the Bismuth editor takes effect on the next cron/message.

`identity.md` and the default crons are seeded **non-clobbering** by `reconcileSeeds(ctx)` (`daemon/src/daemon/seeds.ts`) — the daemon's analog of core's `reconcileSettings`. It runs every time a vault's brain comes online and writes only what is **missing**, so a new seedable added in a later version lands in already-set-up vaults on the next boot while user edits and deliberate `enabled: false` are preserved. The shipped defaults (`daemon/src/daemon/defaultCrons.ts`, embedded string constants so they survive `bun build --compile`):

- **`dream`** — hourly (`0 * * * *`) consolidation of this vault's memory graph into an atomic, densely-linked zettelkasten.
- **`vault-review`** — every 4 hours (`0 */4 * * *`); reviews the vault to keep a living model of the user in memory.

---

## Graph mode: "daemon"

Bismuth's core is the **read/write window** onto the daemon's on-disk state. The "daemon" graph mode visualizes one vault's supervised work as a star graph (`core/src/daemonGraph.ts`):

- **One hub** — `id: "::daemon"` (`DAEMON_NODE_ID`), `kind: "daemon"`, `label` = the daemon's name (default `"daemon"`, never `"claude-bot"`). There is **no** "you"/self node.
- **One node per cron** — `id: "cron:<name>"`, `kind: "cron"`, carrying `DaemonVizState` (`{ enabled, running, lastResult, lastFiredMs, schedule }`).
- **One node per process** — `id: "process:<name>"`, `kind: "process"`.
- **`supervises` edges** — hub → each cron/process.

Crons/processes are read from the **active vault's** `<vault>/.daemon` (`vaultDaemonDir`), but daemon **liveness** is read **machine-level** from `daemonMachineDir()/daemon.pid` — because one machine process serves every vault. Only crons/processes with a backing `*.md` file are included; a node's name (and label) is `frontmatter.name ?? basename`.

`core/src/daemonViz.ts` (`nodeVisualState`) maps each node's `{ enabled, running }` to visual tokens: **disabled** = dim/hollow (`opacity 0.15`); **enabled-idle** = hollow `bg` fill + per-node palette border ring; **running** = solid palette fill. `disabled` wins over `running`.

Every reader in `daemon.ts` / `daemonGraph.ts` catches all errors and returns a safe default (`null`, `[]`, `false`) — a daemon that has never run, or a half-written file, never crashes core.

---

## Memory: the shared 3rd brain

The daemon's memory is the pure `@bismuth/memory` graph (`memory/src/{index,graph,query,search}.ts`) — note CRUD + frontmatter + `[[backlinks]]`, keyword search, and a query DSL — stored per-vault under `<vault>/.daemon/memory`. The **same** graph and one note format is shared by three writers:

- the **daemon** itself (the `dream`/`vault-review` crons and sessions),
- the **MCP** `remember`/`recall`/`forget` tools (`mcp/src/memory.ts`), exposed only when `BISMUTH_MEMORY_DIR` is set,
- the **relay** recall (`UserPromptSubmit`) + collect (`SessionEnd`) hooks (`relay/bin/{recall-hook,session-end-hook}.ts`, `relay/lib/memory.ts`).

All of them gate on `BISMUTH_MEMORY_DIR`, which `core/src/terminal.ts` injects into Bismuth terminal PTYs **only when the vault's daemon is enabled**. There is no global `~/.claude/settings.json` hook. See [memory.md](memory.md) and [communication.md](communication.md).

---

## Install & update

Bismuth no longer git-clones a sibling project. The bundled app stages the compiled daemon at `resources/daemon` (`BISMUTH_DAEMON_BUNDLE`); on boot, core copies it to `~/.bismuth/bin/bismuth-daemon` and runs `<bin> --ensure-installed`, which writes the launchd/systemd service pointing at that stable path (`core/src/daemonInstall.ts` `installDaemonFromBundle`; daemon CLI modes in `daemon/src/daemon/index.ts`). Service ids: launchd `com.bismuth.daemon`, systemd `bismuth-daemon` (`daemon/src/lib/{config,platform}.ts`).

- `InstallStatus = { installed, running, binPath }` (`installStatus()` runs `<bin> --status`).
- `runSetup() = { ok, binPath, error? }` runs `<bin> --ensure-installed`; `POST /daemon/update` calls it.

There is **no git-pull self-update** — the daemon binary is replaced (atomic rename to survive an ETXTBSY on the running inode) whenever a new app build ships a new daemon, version-gated by a size+mtime marker. See [lifecycle.md](lifecycle.md).

### Legacy migration

On the first per-machine enable, `migrateDaemonState(vault)` (`core/src/daemon.ts`) **copies** a legacy standalone `~/.claude-bot/{memory,crons,processes}` into `<vault>/.daemon` — **copy-only**, never deleting the source, machine-marker-gated (`.claude-bot-migrated`) so the legacy brain lands in exactly one vault, per-file so it never clobbers seeded defaults.

---

## This section

- [lifecycle.md](lifecycle.md) — the runtime: boot/shutdown, per-vault `startVault`/`stopVault`, the reconcile loop, the cron scheduler tick, the launchd/systemd service, install/update from the bundled binary.
- [storage.md](storage.md) — the on-disk layout: the machine home (`~/.bismuth/daemon`) and a vault's `.daemon/` brain, file-by-file.
- [crons-and-processes.md](crons-and-processes.md) — cron + background-process model: frontmatter, scheduling, `.last-fired.json`/`.running.json`, triggers, the default `dream`/`vault-review` crons, and Bismuth's enable/disable/run controls.
- [pages.md](pages.md) — the daemon inbox: daemon-authored pages awaiting user approval/dismissal, the `.state` sidecar, delivery timing, the button-press → execution → completion lifecycle, and the `::inbox` frontend surfaces.
- [memory.md](memory.md) — the per-vault memory graph (`@bismuth/memory`): note format, backlinks, query vs. search, the `dream` consolidation cycle.
- [communication.md](communication.md) — memory injection + the relay recall/collect hooks + the MCP `remember`/`recall`/`forget` tools, and device ownership/heartbeat coordination.

See also [the docs index](../README.md).

---

Source: daemon/src/index.ts, daemon/src/daemon/{index,cron,process,session,seeds,defaultCrons}.ts, daemon/src/lib/{config,owner,device,platform}.ts, daemon/src/memory/dream.ts, core/src/{daemon,daemonState,daemonInstall,daemonGraph,daemonViz,fsPaths}.ts, core/src/schema/settingsSchema.ts, memory/src/{index,graph,query,search}.ts, mcp/src/{server,memory}.ts, relay/bin/{recall-hook,session-end-hook}.ts, relay/lib/memory.ts
