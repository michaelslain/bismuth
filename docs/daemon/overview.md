# Daemon Integration Overview

This document covers Bismuth's read/write window onto the **claude-bot daemon** — a separate, independently-managed background process that runs scheduled crons and supervised background processes. Bismuth shares the daemon's on-disk state files to power the "daemon" graph mode and sidebar panel. Bismuth **never starts, stops, or restarts the daemon process**, and it **never installs the daemon itself without an explicit user action**. All reads degrade gracefully when the daemon has never run or its files are partially written.

> **Looking for claude-bot itself?** This page is the **consumer** side (what Bismuth reads/writes). The **producer** side — claude-bot's daemon, memory store, MCP server, crons/processes, hooks, and install path — is documented in [the claude-bot section](../claude-bot/overview.md). Of particular relevance: [the daemon supervisor](../claude-bot/daemon.md), [crons & processes](../claude-bot/crons-and-processes.md) (the file formats Bismuth writes into), [installation](../claude-bot/install.md) (the `bin/ensure-installed.ts` entrypoint Bismuth spawns), and [storage](../claude-bot/storage.md) (the same on-disk tree from the writer's view).

---

## What the Daemon Is

The **claude-bot daemon** is a separate process, not part of Bismuth. It runs on the same machine and manages:

- **Crons** — scheduled tasks defined in `<home>/crons/<name>.md` files.
- **Background processes** — long-running services defined in `<home>/processes/<name>.md` files.

Bismuth reads the daemon's on-disk shared state files (the "integration contract") and writes a small subset of them (owner selection, `enabled` frontmatter, trigger files) to control crons and processes through the daemon's own file-based ports. It never touches the daemon process itself.

---

## Daemon Home Directory

The daemon's shared state lives under a configurable home directory. Resolution order (first match wins):

1. `OA_CLAUDEBOT_HOME` environment variable (ops/dev override; always wins).
2. `daemon.home` setting in `settings.yaml` (per-vault, user-configurable).
3. `~/.claude-bot` (default).

**`claudeBotHome()` in `core/src/daemon.ts`** implements this resolution. The settings-driven override is loaded at server startup and on each config reload via `setClaudeBotHomeOverride(home)`.

### settings.yaml keys

```yaml
daemon:
  enabled: false            # Whether to supervise the daemon (show the graph mode)
  home: ""                  # Override home dir; empty string = ~/.claude-bot
```

---

## On-Disk Integration Contract

All files are authored by the claude-bot daemon. Bismuth reads them all and writes only `owner.json`, `enabled` frontmatter, and trigger files.

| File | Author | Description |
|---|---|---|
| `<home>/device-id` | claude-bot | Stable UUID for this machine (one line, trimmed). |
| `<home>/devices.json` | claude-bot | `{ "<deviceId>": { "label", "lastSeenISO" } }` — all heartbeating devices. |
| `<home>/owner.json` | **Bismuth writes** | `{ ownerDeviceId, ownerLabel, updatedAt }` — which device owns the daemon. Absent = unclaimed. |
| `<home>/daemon.pid` | claude-bot | PID of the running daemon. Presence + liveness (via `process.kill(pid, 0)`) = running. |
| `<home>/crons/<name>.md` | claude-bot | Cron definition; frontmatter `{ name?, schedule, enabled? }`. `enabled` defaults `true` if absent. |
| `<home>/crons/.last-fired.json` | claude-bot | `{ "<name>": { timestamp, result } }` — last execution outcome per cron. |
| `<home>/crons/.running.json` | claude-bot | `{ "<name>": { startedAt } }` — currently-executing crons. |
| `<home>/processes/<name>.md` | claude-bot | Process definition; frontmatter `{ name?, enabled? }`. |
| `<home>/crons/.triggers/<base>` | **Bismuth writes** | Trigger file for "run now"; content is an ISO timestamp. |
| `<home>/processes/.triggers/<base>` | **Bismuth writes** | Trigger file for reconciling a process's enabled/disabled state at runtime. |

**Resilience**: every reader in `daemon.ts` and `daemonGraph.ts` catches all errors and returns a safe default (`null`, `[]`, `false`). A daemon that has never run, or a partially written file, never causes a server crash.

---

## TypeScript Interfaces

### From `core/src/daemon.ts`

```ts
interface Owner {
  ownerDeviceId: string;
  ownerLabel: string;
  updatedAt: string;        // ISO 8601
}

interface DeviceEntry {
  deviceId: string;
  label: string;
  lastSeenISO: string;      // ISO 8601
  isOwner: boolean;         // true if this device holds owner.json
  isThis: boolean;          // true if this device's device-id matches
}

interface DeviceList {
  devices: DeviceEntry[];
  ownerDeviceId: string | null;
}

interface DaemonStatus {
  running: boolean;         // daemon.pid exists + pid is alive
  thisDeviceId: string | null;
  owner: Owner | null;
}
```

### From `core/src/daemonGraph.ts`

```ts
interface DaemonCron {
  name: string;             // frontmatter `name` if present, else file basename
  schedule: string;         // cron expression from frontmatter
  enabled: boolean;         // frontmatter `enabled` (default true if absent)
  lastFired: { timestamp: string; result: string } | null;
  running: boolean;         // entry exists in .running.json
  startedAt: string | null; // ISO timestamp from .running.json, or null
}

interface DaemonProcess {
  name: string;             // frontmatter `name` if present, else file basename
  enabled: boolean;
  running: boolean;         // always false — no per-process liveness file
}

interface DaemonSnapshot {
  daemon: { label: string; running: boolean; home: string };
  crons: DaemonCron[];
  processes: DaemonProcess[];
}
```

### `DaemonVizState` on `GraphNode` (from `core/src/graph.ts`)

Cron and process nodes carry a `daemon` field of this shape, consumed by `nodeVisualState`:

```ts
interface DaemonVizState {
  enabled: boolean;
  running: boolean;
  lastResult: string | null;  // "success" | "failed" | "unknown" | null (never ran)
  lastFiredMs: number | null; // epoch-ms of last run, or null
  schedule?: string;          // cron expression; present on cron nodes only
}
```

---

## Graph Mode: "daemon"

The "daemon" graph mode visualizes the daemon hub and all its supervised crons and processes as a star graph. It is completely separate from the vault/memory/agents graphs.

### Graph Structure

- **One hub node** — `id: "::daemon"`, `kind: "daemon"`, `label: "claude-bot"`. This is the center. There is NO "you"/self node in daemon mode (unlike vault or agents mode).
- **One node per cron** — `id: "cron:<name>"`, `kind: "cron"`, carries `daemon` viz-state.
- **One node per process** — `id: "process:<name>"`, `kind: "process"`, carries `daemon` viz-state.
- **`supervises` edges** — one per cron/process, always running `from: "::daemon"` → `to: "cron:<name>"` or `"process:<name>"`.

```
::daemon ──supervises──> cron:vault-review
::daemon ──supervises──> cron:daily-summary
::daemon ──supervises──> process:engage-loop
```

### Node ID Format

| Kind | ID format |
|---|---|
| daemon hub | `::daemon` (the `DAEMON_NODE_ID` constant) |
| cron | `cron:<name>` |
| process | `process:<name>` |

**Name resolution**: the node's `name` (and thus its id) is `frontmatter.name` if that field is present in the `*.md` file, otherwise the file's basename (without `.md`). The graph node label is this same resolved name.

### Stale `.last-fired` entries

Only crons/processes that have a backing `*.md` file are included. A stale `.last-fired.json` entry for a cron whose file has been removed is silently dropped.

### Backend Positions

Unlike the agents graph, the daemon graph receives precomputed layout positions (`position2d`/`position3d`) via `attachLayout(daemonGraph(), "daemon")` so the WebGL renderer can place nodes immediately. The layout is cached by graph signature, meaning polled state changes (opacity/tint changes) keep stable positions.

### Frontend Polling

The frontend polls `GET /daemon/graph` only while in daemon mode. Between polls, node visual state (opacity/color) reflects the latest on-disk daemon state.

---

## Visual State Encoding (`core/src/daemonViz.ts`)

Each cron/process node's visual appearance is determined **only** by `enabled` and `running`. The `lastResult` and `lastFiredMs` fields are carried on the node but do **not** influence rendering.

### Three States

| State | Condition | Fill | Border | Opacity |
|---|---|---|---|---|
| **disabled** | `enabled = false` | `"base"` (muted daemon neutral) | `"none"` | `0.15` |
| **enabled, idle** | `enabled = true`, `running = false` | `"bg"` (canvas background — hollow dot) | `"palette"` (crisp per-node color ring) | `1.0` |
| **running** | `running = true` | `"palette"` (solid per-node color) | `"none"` | `1.0` |

**Precedence**: disabled wins over running. A cron can't be meaningfully "running" if it's disabled.

### Token Semantics

Tokens are **abstract** — the renderer resolves them against the live theme and node id:

- `fill: "base"` — the muted default daemon fill (`daemonNeutral`).
- `fill: "bg"` — the canvas background (`--bg`); makes the dot appear hollow, only the border ring reads.
- `fill: "palette"` — a stable per-node color derived from the node id hash.
- `border: "palette"` — a crisp ring in the same stable per-node palette color.
- `border: "none"` — no border ring.

### `nodeVisualState` function

```ts
import { nodeVisualState } from "core/src/daemonViz";
import type { DaemonVizState } from "core/src/graph";

const state: DaemonVizState = { enabled: true, running: false, lastResult: "success", lastFiredMs: 1749081600000 };
const visual = nodeVisualState(state);
// => { fill: "bg", border: "palette", opacity: 1 }

nodeVisualState({ enabled: false, running: false, lastResult: null, lastFiredMs: null });
// => { fill: "base", border: "none", opacity: 0.15 }

nodeVisualState({ enabled: true, running: true, lastResult: null, lastFiredMs: null });
// => { fill: "palette", border: "none", opacity: 1 }
```

The optional `_now` parameter (second argument) is accepted for call-site stability but is **unused** — visual state is computed from `enabled`/`running` only.

---

## API Endpoints

All `/daemon/*` endpoints are vault-independent — they work regardless of which vault is open.

### Read Endpoints (in `routes` table, no cache invalidation)

#### `GET /daemon/status`

Returns the current daemon status.

**Response shape** (`DaemonStatus`):
```json
{
  "running": true,
  "thisDeviceId": "550e8400-e29b-41d4-a716-446655440000",
  "owner": {
    "ownerDeviceId": "550e8400-e29b-41d4-a716-446655440000",
    "ownerLabel": "my-laptop",
    "updatedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

- `running`: `true` if `daemon.pid` exists and that pid responds to signal 0.
- `thisDeviceId`: contents of `<home>/device-id`, or `null` if absent.
- `owner`: parsed `owner.json`, or `null` if unclaimed.

#### `GET /daemon/devices`

Returns all devices known to the daemon.

**Response shape** (`DeviceList`):
```json
{
  "devices": [
    {
      "deviceId": "dev-a",
      "label": "laptop",
      "lastSeenISO": "2026-06-01T00:00:00.000Z",
      "isOwner": false,
      "isThis": true
    },
    {
      "deviceId": "dev-b",
      "label": "desktop",
      "lastSeenISO": "2026-06-02T00:00:00.000Z",
      "isOwner": true,
      "isThis": false
    }
  ],
  "ownerDeviceId": "dev-b"
}
```

#### `GET /daemon/graph`

Returns the daemon graph as `GraphData` with precomputed layout positions attached. Polled by the frontend while in daemon mode.

**Response**: `GraphData` — hub node + cron/process nodes + `supervises` edges, each node with `position2d`/`position3d` attached. See [Graph Structure](#graph-structure) above.

#### `GET /daemon/install`

READ-ONLY install probe. Spawns the claude-bot installer entrypoint with `--status` and returns its output. Never throws — degrades to `{ installed: false, running: false }` if the entrypoint can't be found or produces no parseable output.

**Response shape** (`InstallStatus`):
```json
{
  "installed": true,
  "running": true,
  "daemonLabel": "com.claude-bot.daemon",
  "home": "/Users/alice/.claude-bot",
  "plistPath": "/Users/alice/Library/LaunchAgents/com.claude-bot.daemon.plist"
}
```

### Write Endpoints (in `routes` table — NOT vault mutations, no cache invalidation)

These endpoints mutate the claude-bot daemon's shared state files but are **not** vault mutations — they do not invalidate the vault graph/tree caches or push vault SSE events. The frontend re-polls `/daemon/graph` after these actions to pick up updated state.

#### `POST /daemon/setup`

Runs the idempotent, **adopt-only** installer. Spawns the claude-bot `ensure-installed.ts` entrypoint with no flag. Safe to call even when the daemon is already running — the entrypoint will report `action: "adopted"` and make no changes.

**Response shape** (`SetupResult`):
```json
{
  "action": "adopted",
  "status": {
    "installed": true,
    "running": true,
    "daemonLabel": "com.claude-bot.daemon"
  }
}
```

`action` is one of `"adopted"` | `"installed"` | `"would-install"`.

#### `POST /daemon/cron/toggle`

Enable or disable a cron by editing its `enabled` frontmatter in `<home>/crons/<name>.md`. The daemon re-reads cron files on its next scheduler tick, so no trigger file is needed for crons.

**Request body**:
```json
{ "name": "vault-review", "enabled": false }
```

- `name`: the graph node label (resolved to the backing file by either filename match or frontmatter `name` match).
- `enabled`: `true` to enable, `false` to disable.

**Response**: `{ "ok": true }` on success. `400` if `name` or `enabled` is missing. `404` if no cron matches `name`.

**What it writes**: edits only the `enabled` frontmatter key in the cron's `*.md` file, preserving all other content (comments, key order, body). The on-disk value is a bare boolean (`enabled: false`), not a quoted string.

**Does NOT write a trigger** — crons are re-read per scheduler tick automatically.

#### `POST /daemon/cron/run`

Request the daemon to run a cron immediately, out of schedule. Drops a trigger file at `<home>/crons/.triggers/<basename>`. The daemon polls this directory approximately every 5 seconds via `processTriggers()`. The trigger is only consumed if the daemon is running and this device is the owner; otherwise the file persists harmlessly until the daemon starts or ownership changes.

**Request body**:
```json
{ "name": "vault-review" }
```

**Response**: `{ "ok": true }` on success. `400` if `name` is missing. `404` if no cron matches `name`.

**Trigger file**: named by the file **basename** (not the display label), content is an ISO timestamp. The basename is what claude-bot's `processTriggers()` uses to load `<base>.md`.

#### `POST /daemon/process/toggle`

Enable or disable a background process. Does two things atomically:
1. Edits the `enabled` frontmatter in `<home>/processes/<name>.md` (the persistent source of truth — honored on the next daemon boot even if the daemon isn't running now).
2. Drops a reconcile trigger file at `<home>/processes/.triggers/<basename>` to nudge the running daemon to start or stop the process immediately without waiting for a restart.

**Request body**:
```json
{ "name": "engage-loop", "enabled": false }
```

**Response**: `{ "ok": true }` on success. `400` if `name` or `enabled` is missing. `404` if no process matches `name`.

### Vault-Mutating Endpoint (in `mutatingRoutes` table — triggers cache invalidation + SSE)

#### `POST /daemon/owner`

Claim a device as the daemon owner. Writes `owner.json` with the device's label looked up from `devices.json`. The file is byte-compatible with what the daemon reads. Because `owner.json` lives outside the vault, it passes a stable constant scope (`"::daemon-owner"`) to the mutating handler — the path-derived invalidation is a no-op for vault caches, but the handler's SSE broadcast still fires.

**Request body**:
```json
{ "deviceId": "dev-b" }
```

**Response** (`Owner`):
```json
{
  "ownerDeviceId": "dev-b",
  "ownerLabel": "desktop",
  "updatedAt": "2026-06-07T12:00:00.000Z"
}
```

`400` if `deviceId` is missing or the device is not a known, heartbeating device (not in `devices.json`). The returned `owner.json` has exactly three keys: `ownerDeviceId`, `ownerLabel`, `updatedAt`.

---

## Adopt-Only Setup

The install/setup path is deliberately conservative:

- **`GET /daemon/install`** is read-only. It spawns `ensure-installed.ts --status` to probe what is already on disk. Never modifies anything.
- **`POST /daemon/setup`** runs `ensure-installed.ts` (no flag). This is the claude-bot package's idempotent entrypoint: if the daemon is already installed and running, it reports `"adopted"` and does nothing. It never clobbers a live daemon, never repoints a running daemon at a different home, and never restarts it.

The entrypoint is resolved via a three-step lookup (`resolveEntrypoint` in `core/src/claudebot.ts`):
1. An already-installed claude-bot on this machine (parsed from the launchd plist or systemd unit — `installedEntrypoint()` matches the absolute path ending in `daemon/index.ts` and derives `../bin/ensure-installed.ts`).
2. The Tauri-bundled copy (`$OA_CLAUDEBOT_BUNDLE/bin/ensure-installed.ts`).
3. The linked `claude-bot` dev-dep in the monorepo (resolved via `createRequire`).

The entrypoint itself — its exact flags, the single-JSON-line output (`{installed,running,daemonLabel,home,plistPath}` for `--status`; `{action,status}` for the default `ensureInstalled()` path), and why it's adopt-only — is the claude-bot project's; see [claude-bot installation](../claude-bot/install.md). The relocatable `dist/claude-bot/` tree that `$OA_CLAUDEBOT_BUNDLE` points at is produced by claude-bot's `scripts/bundle.ts`.

---

## Name Resolution for Cron/Process Controls

The UI sends the **graph node label** (the display name) when toggling or running a cron/process. Internally, `resolveDaemonFile(dir, name)` in `daemon.ts` maps that label to the backing file's **basename** (without `.md`). Resolution:

1. If `<basename>.md` exists directly — match by filename.
2. Otherwise scan all `*.md` files in `dir` and match on `frontmatter.name`.

This means a file `weird.md` with `name: "Pretty Name"` in its frontmatter is correctly found when the UI sends `"Pretty Name"`. The trigger file is always named by the **file basename** (`weird`), not the display label, because that is the key claude-bot's `processTriggers()` uses.

```
# <home>/crons/weird.md
---
name: Pretty Name
schedule: 0 0 * * *
---
```

`POST /daemon/cron/run` with `{ "name": "Pretty Name" }` → trigger written at `<home>/crons/.triggers/weird`.

---

## Sidebar: DaemonList

In daemon graph mode, the left-sidebar cluster legend is replaced by `app/src/DaemonList.tsx`. It lists all cron and process nodes with their status (running / failed / idle / disabled) and last-fired time. Right-clicking a row opens a context menu with:

- **Enable / Disable** (toggle `enabled`) — calls `POST /daemon/cron/toggle` or `POST /daemon/process/toggle`.
- **Run Now** (crons only) — calls `POST /daemon/cron/run`.

After each action, the component asks the graph parent to re-poll `/daemon/graph` so the row reflects the new state immediately.

---

## `enabled` Default

The `enabled` frontmatter key **defaults to `true`** when absent. Only an explicit `enabled: false` disables a cron or process. This is implemented in `isEnabled` in `core/src/daemonState.ts`:

```ts
export function isEnabled(data: Record<string, unknown>): boolean {
  return data.enabled !== false;
}
```

---

## Key Files Summary

| File | Role |
|---|---|
| `core/src/daemon.ts` | Reads/writes owner.json, device-id, devices.json, daemon.pid; setCronEnabled, setProcessEnabled, runCron |
| `core/src/daemonState.ts` | Low-level shared helpers: `pidAlive`, `readJsonObj`, `readFrontmatter`, `isEnabled` |
| `core/src/daemonGraph.ts` | `daemonSnapshot` (reads disk → `DaemonSnapshot`), `buildDaemonGraph` (snapshot → `GraphData`), `daemonGraph` (convenience) |
| `core/src/daemonViz.ts` | Pure `nodeVisualState(state)` — enabled/running → fill/border/opacity tokens |
| `core/src/claudebot.ts` | Adopt-only installer bridge: `installStatus`, `runSetup`, `resolveEntrypoint` |
| `core/src/server.ts` | `/daemon/*` route handlers |
| `app/src/DaemonList.tsx` | Daemon-mode sidebar panel with right-click controls |
| `core/test/daemon.test.ts` | Unit tests for all daemon.ts functions |
| `core/test/daemonGraph.test.ts` | Unit tests for snapshot + graph building |
| `core/test/daemonViz.test.ts` | Unit tests for nodeVisualState |

---

## Related Docs

- [claude-bot section](../claude-bot/overview.md) — the daemon itself (producer side): [daemon supervisor](../claude-bot/daemon.md), [crons & processes](../claude-bot/crons-and-processes.md), [installation](../claude-bot/install.md), [on-disk storage](../claude-bot/storage.md)
- [Graph types](../graph/overview.md) — `NodeKind`, `EdgeKind`, `GraphNode.daemon`, `DaemonVizState`
- [Agents graph](../terminal/overview.md) — the "agents" graph mode (terminal-tab sessions vs daemon supervision)
- [Settings schema](../settings/overview.md) — `daemon.enabled`, `daemon.home`

Source: core/src/daemon.ts, core/src/daemonGraph.ts, core/src/daemonViz.ts, core/src/daemonState.ts, core/src/server.ts, core/src/claudebot.ts, core/src/graph.ts, core/src/schema/settingsSchema.ts, core/test/daemon.test.ts, core/test/daemonGraph.test.ts, core/test/daemonViz.test.ts, app/src/DaemonList.tsx
