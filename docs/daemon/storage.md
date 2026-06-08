# Daemon On-Disk Storage Layout

Bismuth reads (and minimally writes) the claude-bot daemon's shared on-disk state to power the
"daemon" graph mode and the `DaemonList` sidebar. The daemon is a separate process that authors
these files; Bismuth never starts or stops it. Every reader in Bismuth tolerates missing or
malformed files and never throws — a daemon that has never run, or a partially written file,
degrades to empty/null/false. This document is the exhaustive reference for every file Bismuth
reads, its exact byte-level shape, and the `daemon.home` setting that controls where Bismuth looks.

> This is the **consumer** view (what Bismuth reads). For the **producer** view — the same `~/.claude-bot` tree from claude-bot's own writers, plus every file claude-bot authors that Bismuth doesn't read (`session-id`, `CLAUDE.md`, `logs/`, process `.pids/`, etc.) — see [claude-bot storage](../claude-bot/storage.md). Note that the `daemon.home` / `OA_CLAUDEBOT_HOME` resolution below is **Bismuth-only**: claude-bot itself always writes to `~/.claude-bot` (no env override on its side).

---

## Home Directory Resolution

The root of the daemon's file tree is the **claude-bot home**. Bismuth resolves it with the
following priority (highest wins):

1. **`OA_CLAUDEBOT_HOME` environment variable** — ops/dev override, always wins.
2. **`daemon.home` setting in `settings.yaml`** — set by the user; applied via
   `setClaudeBotHomeOverride()` at server startup. Empty or whitespace is ignored.
3. **`~/.claude-bot`** — the platform default (`os.homedir() + "/.claude-bot"`).

The resolved path is returned by `claudeBotHome()` in `core/src/daemon.ts` and is passed through
to all file readers.

```yaml
# settings.yaml — override example
daemon:
  home: /Users/alice/.my-claude-bot
```

All paths below use `<home>` as a placeholder for the resolved home directory.

---

## Top-Level Identity and Status Files

### `<home>/device-id`

A plain UTF-8 text file containing this machine's stable UUID, one per line (trailing newline and
whitespace are trimmed). Written by the daemon on first boot and never changed.

```
a3f7c812-09e1-4d2b-b945-1e6c8de70923
```

- **Read by**: `thisDeviceId()` in `daemon.ts`.
- **Missing / empty**: returns `null`; the rest of Bismuth continues without a device identity.
- **No JSON**: raw text, not JSON. Do not wrap it.

### `<home>/devices.json`

A JSON object mapping each device UUID to its heartbeat record. Written by each device's daemon
on a heartbeat interval.

```json
{
  "a3f7c812-09e1-4d2b-b945-1e6c8de70923": {
    "label": "laptop",
    "lastSeenISO": "2026-06-01T00:00:00.000Z"
  },
  "f1e2d3c4-b5a6-7890-abcd-ef1234567890": {
    "label": "desktop",
    "lastSeenISO": "2026-06-02T00:00:00.000Z"
  }
}
```

**Fields per entry:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Human-readable device name (empty string when absent). |
| `lastSeenISO` | `string` | ISO 8601 UTC timestamp of last heartbeat (empty string when absent). |

- **Read by**: `listDevices()` in `daemon.ts`.
- **Missing / malformed**: returns `{ devices: [], ownerDeviceId: null }`.
- **Unknown extra fields**: ignored by Bismuth's reader.

### `<home>/owner.json`

A JSON object identifying which device is the "owner" — the one the daemon actively runs on.
Absent when the vault is unclaimed.

```json
{
  "ownerDeviceId": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
  "ownerLabel": "desktop",
  "updatedAt": "2026-06-02T00:00:00.000Z"
}
```

**Fields (all required for a valid owner; extras are ignored):**

| Field | Type | Description |
|-------|------|-------------|
| `ownerDeviceId` | `string` | UUID of the device claiming ownership. Must be non-empty. |
| `ownerLabel` | `string` | Human-readable name of the owner device (empty string when absent). |
| `updatedAt` | `string` | ISO 8601 UTC timestamp of when ownership was last set. |

- **Read by**: `getOwner()` in `daemon.ts`. Returns `null` when the file is absent, malformed, or
  `ownerDeviceId` is missing/empty.
- **Written by Bismuth**: `setOwner(deviceId)` — the only file Bismuth writes other than `enabled`
  frontmatter. Writes exactly `{ ownerDeviceId, ownerLabel, updatedAt }` with 2-space pretty
  indentation. The `ownerLabel` is looked up from `devices.json`; throws if `deviceId` is not a
  known, heartbeating device.
- **Byte-compatible contract**: Bismuth writes exactly the three keys claude-bot expects; it never
  adds extra keys.

### `<home>/daemon.pid`

A plain UTF-8 text file containing the PID of the running daemon process, as a decimal integer.

```
34817
```

- **Liveness check**: Bismuth calls `pidAlive(pid)` (signals the process with `kill(pid, 0)`)
  after reading. Both conditions must hold: file exists **and** the pid is alive. If either fails,
  `running = false`.
- **Read by**: `daemonStatus()` in `daemon.ts` and `daemonRunning()` in `daemonGraph.ts`.
- **Missing / malformed / dead pid**: `running = false` — no error.

---

## Crons Directory

### `<home>/crons/<name>.md`

One Markdown file per scheduled cron job. The filename's basename (without `.md`) is the canonical
identifier claude-bot keys on internally. Files beginning with `.` are ignored.

**Frontmatter fields** (parsed via `core/src/frontmatter.ts`):

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | No | filename basename | Display label / graph node label. Overrides the filename when present. |
| `schedule` | `string` | Yes (functionally) | `""` | Cron expression, e.g. `"0 * * * *"`. Empty string when absent. |
| `enabled` | `boolean` | No | `true` | `enabled: false` disables the cron. **Only explicit `false` disables** — absent, `null`, or any other value = enabled. |

The Markdown body after the frontmatter block is not read by Bismuth (it is documentation for the
human author or the daemon's executor).

**Example file `<home>/crons/vault-review.md`:**

```markdown
---
name: vault-review
schedule: 0 */4 * * *
enabled: true
---

Review vault notes and surface anything overdue.
```

**Name resolution**: when the graph node label (used by the UI) differs from the filename, Bismuth
resolves the backing file by matching either the label against `<basename>.md` directly, or by
scanning all `*.md` files for a `name` frontmatter key equal to the label. The trigger file (see
below) is always named by the **file basename**, not the display label.

```
# Graph node label "Pretty Name" backed by the file weird.md
<home>/crons/weird.md        (frontmatter: name: "Pretty Name")
<home>/crons/.triggers/weird (trigger written by Bismuth for "run now")
```

**Enable/disable writes**: `setCronEnabled(name, enabled)` flips only the `enabled` frontmatter
key using `setFrontmatterKey()`, which preserves comments, key order, flow arrays, and the Markdown
body. The daemon re-reads cron definitions on each scheduler tick, so no trigger file is needed.

### `<home>/crons/.last-fired.json`

A JSON object recording the last execution result for each cron, keyed by the cron's display name
(i.e. `frontmatter.name ?? basename`).

```json
{
  "vault-review": {
    "timestamp": "2026-06-07T04:00:00.000Z",
    "result": "success"
  },
  "nightly-backup": {
    "timestamp": "2026-06-06T22:00:00.000Z",
    "result": "failed"
  }
}
```

**Fields per entry:**

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `string` | ISO 8601 UTC timestamp of when the run completed. Empty string when absent. |
| `result` | `string` | Execution outcome string — e.g. `"success"`, `"failed"`, `"unknown"`. |

- **Read by**: `daemonSnapshot()` in `daemonGraph.ts`.
- **Stale entries**: entries with no backing `*.md` file (e.g. a renamed or removed cron) are
  silently dropped — they never appear in the graph or snapshot.
- **Missing / malformed**: treated as `{}` — all `lastFired` fields become `null`.
- **Key space**: keyed by the cron's `name` frontmatter value (or basename fallback), **not** by
  the filename directly. This is the same key space the daemon writes.

### `<home>/crons/.running.json`

A JSON object listing crons that are currently mid-execution, keyed by the cron's display name.

```json
{
  "vault-review": {
    "startedAt": "2026-06-07T04:00:01.234Z"
  }
}
```

**Fields per entry:**

| Field | Type | Description |
|-------|------|-------------|
| `startedAt` | `string` | ISO 8601 UTC timestamp of when the run started. |

- **Read by**: `daemonSnapshot()` in `daemonGraph.ts`.
- A cron is considered `running: true` in the snapshot iff it has an entry here with a string
  `startedAt`.
- **Missing / malformed**: treated as `{}` — no crons are running.

### `<home>/crons/.triggers/<basename>`

Trigger files written by Bismuth to signal out-of-schedule runs to the daemon. The filename is the
cron's **file basename** (not the display label). The content is a single ISO 8601 UTC timestamp.

```
2026-06-07T14:32:09.123Z
```

- **Written by**: `runCron(name)` in `daemon.ts` → `writeTrigger()`.
- **Read by**: the daemon process (polls every ~5 s via `processTriggers()`). Bismuth never reads
  these files.
- The `.triggers/` directory is created with `mkdirSync({ recursive: true })` if absent.
- **Cron enable/disable does NOT write a trigger** — crons are re-read each scheduler tick, so the
  daemon picks up the frontmatter change on its own.

---

## Processes Directory

### `<home>/processes/<name>.md`

One Markdown file per supervised background process. Same conventions as cron files.

**Frontmatter fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | No | filename basename | Display label / graph node label. |
| `enabled` | `boolean` | No | `true` | `enabled: false` stops the process on next reconcile. |
| Other keys (e.g. `command`) | any | No | — | Ignored by Bismuth; read by the daemon. |

**Example file `<home>/processes/engage-loop.md`:**

```markdown
---
name: engage-loop
command: bun run loop.ts
enabled: true
---

The main engagement loop process.
```

- Bismuth reads `name` and `enabled` only. Any other frontmatter key (`command`, etc.) passes
  through unmodified when Bismuth writes back.
- `running` state for processes is **always `false`** in the snapshot — unlike crons, there is no
  per-process liveness file Bismuth can reliably read. The graph renders processes as
  enabled-idle or disabled, never as actively running.

**Enable/disable writes**: `setProcessEnabled(name, enabled)` does two things:
1. Flips the `enabled` frontmatter key in the file (same `setFrontmatterKey()` mechanism as crons,
   preserving comments and body).
2. Drops a **reconcile trigger** at `<home>/processes/.triggers/<basename>` — unlike crons, the
   daemon does not re-read process definitions on each tick, so the trigger nudges the running
   daemon to bring the process runtime in line with the new `enabled` value immediately.

### `<home>/processes/.triggers/<basename>`

Trigger files written by Bismuth to signal the daemon to reconcile a process's runtime to its
on-disk `enabled` value (start it or stop it).

- **Written by**: `setProcessEnabled()` in `daemon.ts` → `writeTrigger()`.
- **Content**: a single ISO 8601 UTC timestamp (same format as cron triggers).
- **Consumed by**: the daemon's general process-trigger port. If the daemon is not running, the
  disk `enabled` flip still takes effect on next daemon boot; the trigger is simply never consumed.

---

## File-System Invariants Bismuth Relies On

| Invariant | Details |
|-----------|---------|
| Hidden files are ignored | Any file beginning with `.` inside `crons/` or `processes/` is not treated as a cron/process definition. This excludes `.last-fired.json`, `.running.json`, and `.triggers/` automatically. |
| Alphabetical iteration order | `listMarkdownNames()` sorts results with `.sort()` for deterministic graph node ordering, since `readdir` order is filesystem-dependent. |
| Stale JSON entries are dropped | Entries in `.last-fired.json` or `.running.json` with no matching `*.md` file are silently discarded — they never appear in the snapshot or graph. |
| `enabled` defaults to `true` | Only an explicit `enabled: false` in frontmatter disables a cron/process. Absent, `null`, `0`, or any non-`false` value all mean enabled. |
| Trigger filename = file basename | The `.triggers/<basename>` file is named by the `*.md` file's basename (without extension), NOT the display label from frontmatter. This is the key claude-bot's `processTriggers()` loads. |

---

## TypeScript Interfaces

```typescript
// From core/src/daemon.ts

interface Owner {
  ownerDeviceId: string;
  ownerLabel: string;
  updatedAt: string;
}

interface DeviceEntry {
  deviceId: string;
  label: string;
  lastSeenISO: string;
  isOwner: boolean;  // true if this device is the current owner
  isThis: boolean;   // true if this device is the local machine
}

interface DeviceList {
  devices: DeviceEntry[];
  ownerDeviceId: string | null;
}

interface DaemonStatus {
  running: boolean;
  thisDeviceId: string | null;
  owner: Owner | null;
}

// From core/src/daemonGraph.ts

interface DaemonCron {
  name: string;
  schedule: string;
  enabled: boolean;
  lastFired: { timestamp: string; result: string } | null;
  running: boolean;
  startedAt: string | null;
}

interface DaemonProcess {
  name: string;
  enabled: boolean;
  running: boolean;  // always false; no per-process liveness file
}

interface DaemonSnapshot {
  daemon: { label: string; running: boolean; home: string };
  crons: DaemonCron[];
  processes: DaemonProcess[];
}
```

---

## Complete Directory Tree

```
~/.claude-bot/                         (or OA_CLAUDEBOT_HOME / daemon.home)
├── device-id                          plain text UUID for this machine
├── devices.json                       { "<uuid>": { label, lastSeenISO } }
├── owner.json                         { ownerDeviceId, ownerLabel, updatedAt } (absent = unclaimed)
├── daemon.pid                         running daemon PID (plain text integer)
├── crons/
│   ├── <name>.md                      cron def: frontmatter { name?, schedule, enabled? } + body
│   ├── <name>.md                      (one per cron job)
│   ├── .last-fired.json               { "<name>": { timestamp, result } }
│   ├── .running.json                  { "<name>": { startedAt } }
│   └── .triggers/
│       └── <basename>                 ISO timestamp; signals "run now" to daemon
└── processes/
    ├── <name>.md                      process def: frontmatter { name?, enabled?, command?, ... }
    ├── <name>.md                      (one per process)
    └── .triggers/
        └── <basename>                 ISO timestamp; signals "reconcile runtime" to daemon
```

---

## Relationship to the Graph

`daemonSnapshot()` reads the entire tree above and returns a `DaemonSnapshot`. `buildDaemonGraph()`
turns it into `GraphData`:

- One `daemon` hub node (`id: "::daemon"`, `kind: "daemon"`).
- One `cron` node per cron (`id: "cron:<name>"`, `kind: "cron"`), carrying a `daemon` viz-state
  field for `nodeVisualState()`.
- One `process` node per process (`id: "process:<name>"`, `kind: "process"`), same `daemon` field.
- One `supervises` edge from the hub to each cron/process node.
- No `self`/you node — the daemon hub is the center of the daemon graph.

See [daemonViz](../daemon/overview.md) for how `{ enabled, running }` maps to visual fill/border tokens.

`GET /daemon/graph` serves this graph (polled by the frontend only while daemon mode is active).
`GET /daemon/status` and `GET /daemon/devices` return `DaemonStatus` and `DeviceList` respectively.

## See Also

- [claude-bot storage](../claude-bot/storage.md) — the producer view of this exact tree.
- [claude-bot crons & processes](../claude-bot/crons-and-processes.md) — the full cron/process file model + trigger semantics Bismuth writes into.
- [Daemon integration overview](overview.md) — the graph mode, controls, and `/daemon/*` routes.

Source: core/src/daemon.ts, core/src/daemonGraph.ts, core/src/daemonState.ts, core/test/daemon.test.ts, core/test/daemonGraph.test.ts
