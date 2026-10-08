# Daemon storage

The daemon keeps its state in two places: one machine directory shared by every vault, and a `.daemon/` folder inside each vault it serves. Everything is a plain file (markdown, JSON or text), and Bismuth's core reads the same files to draw the daemon page. Read this page to find a file, learn what writes it, or recover from a bad edit. For the runtime behind these files see [the overview](overview.md).

```
~/.bismuth/daemon/                 one per machine
  device-id  devices.json  owner.json  daemon.pid  daemon.bin-sig
  vaults.json  vaults-seen.json  logs/

<vault>/.daemon/                   one per vault
  identity.md  PAGES.md
  crons/  processes/  pages/  memory/  logs/
  session-id  session-ids
```

## Machine directory

`~/.bismuth/daemon` (override: `BISMUTH_DAEMON_DIR`) holds what is true of the machine, not of one vault. The daemon creates the directory and `logs/` at boot and writes the identity files on first use. It writes `device-id`, `devices.json` and its state files atomically (temp file, then rename), so a reader never sees a half-written file.

| Path | Format | What it holds |
|---|---|---|
| `device-id` | bare UUID | This machine's stable id, created on first use |
| `devices.json` | `{ "<deviceId>": { "label", "lastSeenISO" } }` | Every device that has heartbeated; `label` is the hostname |
| `owner.json` | `{ "ownerDeviceId", "ownerLabel", "updatedAt" }` | The device allowed to run sessions. Absent means unclaimed, and every device is allowed |
| `daemon.pid` | integer | The running daemon's pid; removed on a clean shutdown |
| `daemon.bin-sig` | `<size>:<mtimeMs>` | The binary the running daemon started from; `--ensure-installed` restarts the service when the installed binary differs |
| `vaults.json` | JSON array of absolute vault paths | The vaults the daemon may serve |
| `vaults-seen.json` | `{ "<vault path>": "<ISO>" }` | When each vault was last in use |
| `logs/bismuth-daemon.{stdout,stderr}.log` | text | The service's output |
| `logs/vault-registry.log` | text | A line each time a vault is dropped from `vaults.json` |
| `.claude-bot-migrated` | vault path | The vault that received a copy of a standalone `~/.claude-bot` brain; see [migrating](../overview/migrating.md) |

The service definition itself lives outside this directory: see [the service files](lifecycle.md#where-the-service-files-and-logs-are). The binary is `~/.bismuth/bin/bismuth-daemon`, and the install marker is `~/.bismuth/.daemon-installed`.

## Vault folder

`<vault>/.daemon/` holds one vault's brain. Files whose names start with a dot are bookkeeping the daemon rewrites constantly; they stay out of the file tree.

| Path | Format | What it holds |
|---|---|---|
| `identity.md` | markdown, `name` in frontmatter | The daemon's name and personality; seeded once, never overwritten |
| `PAGES.md` | markdown | The inbox-page format guide the daemon reads before writing a page; seeded once |
| `crons/<name>.md` | frontmatter plus prompt body | One cron. See [crons and processes](crons-and-processes.md) |
| `crons/.last-fired.json` | JSON keyed by cron name | The latest result of each cron |
| `crons/.running.json` | `{ "<name>": { "startedAt" } }` | Crons running now |
| `crons/.triggers/<name>` | empty file named for the cron | A pending "run now" request |
| `processes/<name>.md` | frontmatter | One background process |
| `processes/.pids/<name>.pid` | integer | The child's pid, so the next daemon instance can find an orphan |
| `processes/.triggers/<name>` | empty file | A pending "reconcile this process" request |
| `pages/<slug>.md` | frontmatter plus body | One inbox page. See [pages](pages.md) |
| `pages/.state/<slug>.json` | JSON | A page's status, kept apart from the page so an edit cannot clobber it |
| `pages/.triggers/<slug>` | empty file | A pending "run the approved action" request |
| `memory/<name>.md`, `memory/<folder>/<name>.md` | markdown | The memory graph. See [memory](memory.md) |
| `logs/activity-YYYY-MM-DD.jsonl` | JSON lines | The activity log, below |
| `logs/<process>.{stdout,stderr}.log` | text | A background process's output, appended |
| `session-id` | session id | The most recent daemon session. It changes with every new session |
| `session-ids` | one id per line | Every session the daemon started, oldest first, capped at 2000 |
| `session-ids-legacy` | one id per line | Daemon sessions found by scanning the Claude session store once, the first time chat History opens; core writes it |
| `codex-session-id` | thread id | The Codex thread, when `daemon.backend` is `codex`; separate from `session-id` so switching backends keeps both |
| `codex/` | Codex's own state | `CODEX_HOME` for the Codex backend |

A trigger file's name is its payload and its presence is the signal: the file's content is never read. The daemon polls trigger folders every 5 seconds, deletes each file before acting on it, and ignores names that start with a dot.

## Activity log (`logs/activity-YYYY-MM-DD.jsonl`)

The activity log is the daemon's history: every cron outcome, background-process lifecycle moment and brain start, one JSON object per line, one file per UTC day. `crons/.last-fired.json` keeps only the latest result per cron; the log is the only place to see what an earlier failure was.

```json
{
  "kind": "cron",
  "name": "dream",
  "event": "finished",
  "outcome": "success",
  "durationMs": 84213,
  "summary": "vault=3 memory=1 transcripts=2 merged=1 pages=0",
  "ts": "2026-10-08T03:25:25.415Z"
}
```

| Field | Type | Meaning |
|---|---|---|
| `ts` | ISO-8601 UTC | When the event was logged |
| `kind` | `cron`, `process`, `daemon` or `session` | What produced it |
| `name` | string | The cron or process name; the daemon's name for `daemon` events |
| `event` | string | The moment, from the table below |
| `outcome` | `success`, `failed`, `unknown`, `killed` or `skipped` | Only on an event that ends a unit of work |
| `cause` | `environment`, `timeout` or `job` | Why a run failed or was killed |
| `durationMs` | number | Wall-clock time of a run that ended |
| `detail` | string | A one-line explanation |
| `summary` | string | A cron's closing report line, at most 300 characters |

| `kind` | `event` | Notes |
|---|---|---|
| `cron` | `started` | A run began |
| `cron` | `finished` | Carries `outcome`, `durationMs`, `summary`, and `cause` on failure |
| `cron` | `skipped` | An incremental cron found nothing changed; `detail` holds the reason |
| `process` | `started` | `detail` is `pid <n>` |
| `process` | `exited` | `outcome` is `success` on code 0, `failed` on another code, `killed` on a signal |
| `process` | `restarting` | `detail` is the wait and the restart count |
| `process` | `reaped` | A process left by a previous daemon instance was killed |
| `process` | `spawn-failed` | The command could not start; the process is not restarted |
| `daemon` | `brain-started` | A vault's brain came online; carries no `detail` |
| `daemon` | `cron-retired` | `reconcileSeeds` renamed a merged cron to `.disabled` |

Read it with `bismuth daemon logs --vault <vault>` (flags `--limit`, `--kind`, `--name`, `--since`), `GET /daemon/logs`, or the `daemon_logs` MCP tool. Files older than 30 days are deleted when a vault's brain starts. The log is append-only, so a crash costs at most a truncated last line, and a full disk never fails a cron.

## Which vaults the daemon serves

The daemon serves the vaults listed in `vaults.json`. Bismuth adds a vault to the list when it opens the vault, and each vault still has to set `daemon.enabled: true`. The list is a plain array of path strings; the daemon ignores any element that is not one, so never edit it into another shape.

Bismuth keeps the list short. When it registers a vault it also drops entries for directories that do not exist, for temp or agent scratch folders, and for vaults unseen for 30 days whose daemon is off. A vault with the daemon on is never dropped for age. Dropped entries are logged in `logs/vault-registry.log`. A vault inside a folder whose name starts with `.dev-vault` is never registered, and the daemon skips one it finds. A vault on `/Volumes`, `/mnt`, `/media`, `/net` or `/run/media` is kept when its path is missing, because an unplugged drive looks the same as a deleted one.

## What a vault snapshot includes

Bismuth's local git snapshots of a vault (`vault.backupOnSave`) track `identity.md`, `PAGES.md` and the non-dot files in `crons/`, `processes/` and `pages/`. They skip `memory/` (its own repo), `logs/`, the session files and every dot-file. So `git log -p -- .daemon/crons/dream.md` in the vault shows how a cron changed, and a deleted cron or page can be restored from a snapshot.

## How it works

- `enabled` defaults to true for a cron or process. Only an explicit `enabled: false` disables one. The daemon's parsers compare the raw string to `"false"`, and core's readers compare to the boolean.
- Two keys per cron or process. The file name (the slug) identifies it everywhere in memory, in trigger files and pid files, and in the HTTP, CLI and MCP surfaces. The display name (`name:` in the frontmatter, else the slug) keys `.last-fired.json`, `.running.json` and the activity log. Editing `name:` by hand therefore orphans a cron's history, and a catch-up-eligible cron fires again on the next tick.
- Disable pauses. Turning a vault's daemon off, or dropping it from `vaults.json`, stops its processes and watchers and deletes nothing.
- Memory has no index. The graph is recomputed from the markdown on every read. The daemon passes `<vault>/.daemon/memory` explicitly, and tools read it from `BISMUTH_MEMORY_DIR`.
- Core writes only control files. Bismuth writes `owner.json`, a cron or process's `enabled` frontmatter, trigger files, pages and their sidecars, and the vault registry. Every reader in core tolerates a missing or malformed file and returns an empty value.
- Writes to state files are queued. Writes to `.last-fired.json`, `.running.json` and the activity log go through a per-file queue in `daemon/src/lib/writeQueue.ts`, so concurrent runs do not lose updates.

Source: `daemon/src/lib/{config,device,owner,registry,activityLog,writeQueue}.ts`, `daemon/src/daemon/{index,cron,process,seeds,sessionIds,pages}.ts`, `core/src/{daemon,daemonState,daemonGraph,daemonActivity,daemonPages,backup,chatDaemonLegacy}.ts`
