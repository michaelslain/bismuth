# Crons and background processes

A cron is a markdown file that runs its body as a prompt in a fresh Claude session, on a schedule or when a vault file changes. A background process is a markdown file that keeps a long-lived command running and restarts it when it exits. Both live under `<vault>/.daemon/`, and the daemon page shows processes as "services". Read this page to write one, to schedule it, or to find out why it did not run.

A cron that summarizes the journal each weekday at 8:00:

```markdown
---
name: morning-digest
schedule: 0 8 * * 1-5
timeout: 600
notify: true
---

Read the notes I changed yesterday and write a five-line digest to the
memory graph with `remember`. Skip anything under `private/`.
```

A background process that serves a folder:

```markdown
---
name: preview-server
command: python3
args: ["-m", "http.server", "8090"]
cwd: /Users/me/site
restart: on-failure
---
```

[Set up the daemon](setup.md) shows how to create these from the CLI. Frontmatter is one `key: value` per line. Inline comments, multi-line values and YAML lists are not supported, and every value is a string.

## Cron keys

| Key | Values | Default | Effect |
|---|---|---|---|
| `name` | text | the file name | Display name. It keys the cron's history, so renaming it orphans that history |
| `schedule` | five-field cron expression | none | Required unless `on: file-change`. A missing or malformed value makes the daemon skip the file |
| `on` | `file-change` | schedule | Fire when a watched file changes instead |
| `watch` | path or glob, relative to the vault | none | Required with `on: file-change` |
| `enabled` | `false` to disable | on | Only the exact text `false` disables; `False` does not |
| `catchup` | `false` to turn off | on | Whether a missed schedule fires late. Schedule crons only |
| `notify` | `true` | off | An OS notification per run, with the result |
| `model` | model name | `haiku` | The session's model |
| `effort` | `low`, `high`, any other value | the SDK default | `low` and `high` pass through; any other value becomes `medium` |
| `tier` | `fast`, `balanced`, `deep` | none | Picks the model and effort for the vault's backend. An explicit `model` or `effort` in the same file wins over the tier |
| `timeout` | seconds, `none` or `0` | 300 | Aborts the session when exceeded; `none` or `0` means no limit |
| `waitFor` | a `pgrep -f` pattern | none | After the session ends, wait for matching processes to exit, within `timeout` |
| `incremental` | `true` | off | Skip runs when nothing relevant changed; see below |
| `checkpointDirs` | `vault`, `memory`, or both comma-separated | `vault` | Which areas an incremental cron checks. `checkpointDir` takes a single value |

The body of the file is the prompt. The daemon appends to it: the memory directory and a rule to write memory only through `remember`, an instruction to end with `[CRON_RESULT:SUCCESS]` or `[CRON_RESULT:FAILURE]`, and, with `notify: true`, an instruction to print one `[NOTIFY: …]` line. A session that prints neither marker records the result `unknown`.

A cron session cannot rewrite its own file or the process definitions. When the session ends, the daemon reverts a changed cron file, restores a deleted one, and removes any process file the session added.

## Schedule syntax

A schedule has exactly five space-separated fields, evaluated in the machine's local time: minute, hour, day of month, month, day of week. A cron fires in a minute when all five fields match, so a day-of-month and a day-of-week together require both.

| Syntax | Meaning |
|---|---|
| `*` | Every value |
| `*/N` | Values divisible by N. `*/15` in the minute field is 0, 15, 30, 45; `*/2` in the day-of-month field is the 2nd, 4th, 6th… |
| `A-B` | The range from A to B inclusive. `A-B-C` never matches, and a range inside a list is read as its first number: in `1-3,5` the `1-3` counts as `1` |
| `A,B,C` | Any listed number |
| `N` | That number |

Sunday is 0 and `7` never matches. Names (`MON`, `JAN`), macros (`@hourly`) and `1-10/2` are not supported, and a field the daemon cannot read, such as `*/0`, never matches, with no error. An unsupported field count is the one failure that hides the cron entirely: a schedule with six fields, such as one carrying a trailing comment, is skipped.

## Run a cron when a file changes

A cron with `on: file-change` and a `watch` pattern fires when a matching vault file changes. `watch` is a Bun glob matched against each changed path relative to the vault: `inbox.md` matches one file, `journal/**` matches everything under `journal/`, `*.md` matches notes in the vault root.

```markdown
---
name: inbox-triage
on: file-change
watch: inbox.md
notify: true
---

Read inbox.md (it just changed). File each new item under the right
project note, or ask a question with a `> [!question]` callout below it.
```

The daemon appends `Triggered by change to: <paths>` to the prompt. It waits 2 seconds after the last change before firing, so a burst of autosaves fires once. A change while the cron is already running is dropped, not queued. A change made while the daemon was off does not fire anything: file-change crons have no catch-up.

Changes under `.daemon/` never trigger a cron, so the daemon's own writes cannot loop. A cron whose prompt edits a file that matches its own `watch` fires itself again on its own edit. Watch a different file than the one the cron writes, or make the edit idempotent.

## Skip runs when nothing changed

An incremental cron (`incremental: true`) asks git whether anything relevant changed since its last successful run, and skips the session when nothing did. A skipped run costs nothing and records the result `skipped` with a reason such as `skipped: no changes since 2026-07-20T10:00:00Z`.

The check compares each area in `checkpointDirs` (the vault root, the memory directory) against a bookmark at `refs/bismuth/cron-<file name>` (`cron-<file name>-vault` for the vault when both areas are listed). Only `.md` files outside `.daemon/` count. The cron skips only when every area is past its first run and has no changed file.

If the prompt contains `{{changedSinceLastRun}}`, the daemon replaces it with a block per area that lists the changed files, or a first-run line when an area has no bookmark yet. A prompt without the placeholder runs unchanged.

The daemon moves the bookmarks only when the session ends with `[CRON_RESULT:SUCCESS]`, never after a failure, a kill or an unknown result. The vault bookmark moves to a snapshot taken when the run started, so an edit made during the run is seen next time. The memory bookmark moves to a snapshot taken at the end, so the cron's own memory writes do not retrigger it.

An incremental cron needs a git repository with at least one commit in each area. An area with no repository or no commit reads as "nothing changed", so the cron is skipped without a warning. The vault's repository comes from Bismuth's local snapshots (`vault.backupOnSave`, on by default), and the memory repository comes from the snapshots core takes of that folder.

## Put the memory health report in a prompt

If a cron's prompt contains `{{brainReport}}`, the daemon replaces it with a ranked health report of the vault's memory graph before the session starts: oversized notes, dated or status-suffixed names, near-duplicate clusters, orphans, notes without a source, broken links, and a missing profile or hub. It works on every cron, incremental or not. The report checks links against the names of the vault's markdown notes, and a note hidden from the daemon by [visibility](../vault/visibility.md) contributes no name. When the report cannot be built, the placeholder becomes the single line `brain report unavailable: <reason>` and the run goes on. A prompt without the placeholder runs unchanged.

## Run, enable, disable and delete

- Run now. `bismuth daemon cron run <name> --vault <vault>`, or **Run now** in the cron's row menu, drops a trigger file. The owner device's daemon picks it up within 5 seconds and ignores it if the cron is already running. An unknown name fails with `Cron "<name>" not found`. A trigger works only for a file name made of letters, digits, `_`, `-` and `.` (up to 100 characters); the daemon ignores any other name, so give a hand-made cron file a plain name.
- Enable or disable. `bismuth daemon cron toggle <name> [--off] --vault <vault>` edits the cron's `enabled` line. The scheduler re-reads cron files every minute, and a file-change cron picks the change up at its next batch. Disabling does not stop a run in progress.
- Create. `bismuth daemon cron create "<name>" --vault <vault>` writes a disabled template at `crons/<slug>.md`, where the slug is the lowercase name with other characters turned into dashes, up to 100 characters. A name with no letters or digits, or an existing slug, is refused.
- Delete. `bismuth daemon cron delete <name> --vault <vault>` removes the file and refuses a cron that is running. A vault snapshot can restore it.

`<name>` accepts either the file name or the `name:` value. The daemon page has no create control; ask the daemon in its chat, which runs these commands and asks you to approve each one.

## What happens when a cron fails

Each run records one of these results in `crons/.last-fired.json`: `success`, `failed`, `unknown`, `killed` or `skipped`. A timeout is `killed` with cause `timeout`.

```json
{ "dream": { "timestamp": "2026-10-08T03:00:03.123Z", "result": "failed", "cause": "environment", "consecutiveFailures": 2 } }
```

A failed or killed cron with `catchup` on is retried before its next scheduled time, after a cooldown that grows with each consecutive failure:

- The base cooldown is the larger of 5 minutes and a twelfth of the cron's period. An hourly cron waits 5 minutes, a daily one 2 hours.
- The cooldown doubles with each consecutive failure and never exceeds the cron's period.
- A failure with cause `environment` (offline, API unreachable, rate or usage limit, provider overloaded) starts two doublings in, so an hourly cron waits 20 minutes after the first one.
- Any other failure has cause `job`, and a timeout has cause `timeout`; both start at the base cooldown.

The cooldown holds back only the extra retry. A scheduled fire is never suppressed, so a failing hourly cron still fires every hour. A success, an unknown result or a skip resets the count.

A schedule cron is overdue, and fires late, when it has never run or its last non-failed run is more than 1.01 periods old. The period is estimated from the schedule's shape: `*/N` minutes or hours, then weekly, monthly, daily and hourly patterns. A laptop that sleeps through a daily 3:00 cron therefore runs it on wake.

If the daemon dies while a cron runs, the cron stays in `.running.json` and the next boot re-fires it.

## Seeded crons and files

A vault's brain starts by writing any default file that is missing, so a new vault gets the full set and an older vault gets only what it lacks. The defaults are `identity.md`, `PAGES.md` and one cron, `dream`. A file that exists is never overwritten, except that a stock `dream.md` is upgraded in place: the daemon hashes the file, and when the hash matches any earlier stock version of `dream`, it replaces the file with the current one. A `dream.md` you edited, even by one character, is left alone for good. To turn `dream` off, set `enabled: false` in it; a deleted `dream.md` is written again at the next brain start.

`dream` runs hourly with a 30-minute timeout at `tier: balanced`, is incremental over both the vault and the memory directory, and has no `notify`. In one session it:

1. Reads the vault notes and memory notes that changed, and every session transcript note (`auto-*`) in the memory graph.
2. Works the `{{brainReport}}` agenda worst first and fixes at most 12 items per run; the rest wait for the next run. That covers collapsing dated snapshot notes into one note that carries its history inside it, merging duplicates, linking orphans, adding sources and splitting oversized notes.
3. Folds what matters into a small set of canonical memory notes (`user-profile`, `user-beliefs`, `user-reading`, `user-writing`, `user-projects`, `user-routine`, `user-context`, or one note named for a topic) with `remember`, and deletes each transcript note after extracting from it.
4. Keeps `user-profile` (a `type: profile` note of at most 1,500 characters: who you are, what you do, how you work) current. Every session starts with it.
5. Writes atomic notes of at most 2,000 characters, gives a topic with four or more notes one `type: hub` note, links each fact to its vault note or ends it with `(session YYYY-MM-DD)`, and moves a replaced fact to a dated line under `## History`.
6. Files an inbox page only for something that needs you, with `source: "cron:dream"`.

It writes memory and pages only. Its prompt forbids it from editing crons, processes, `identity.md` or your notes, and from writing a memory note about its own runs. It ends by printing one report line, which the activity log stores as the `summary` of its `finished` event:

```
vault=3 memory=1 transcripts=2 snapshots-collapsed=0 merged=1 pages=0 notes=48 size=212KB profile=unchanged hubs=1 agenda=5/5
```

Read the last reports with `bismuth daemon logs --vault <vault> --kind cron --name dream --limit 5 --pretty`. [Memory](memory.md) covers the graph `dream` maintains.

## Background process keys

| Key | Values | Default | Effect |
|---|---|---|---|
| `command` | an executable | none | Required. Without it the daemon skips the file |
| `name` | text | the file name | Display name |
| `args` | a JSON array, or words separated by spaces | none | Arguments. A JSON array must be on one line |
| `cwd` | a directory | your home directory | Working directory. It is not the vault |
| `env` | a JSON object on one line | none | Variables added to the daemon's environment |
| `restart` | `always`, `on-failure`, `never` | `on-failure` | When to restart after an exit. Any other value behaves like `never` |
| `restartDelay` | milliseconds | 1000 | The base wait before a restart |
| `enabled` | `false` to disable | on | Whether the daemon starts it |

The daemon starts each enabled process when a vault's brain starts and appends its output to `logs/<name>.stdout.log` and `.stderr.log`. After an exit that `restart` covers, it restarts the process after a wait that doubles on each quick restart, up to 60 seconds. A process that stays up for 5 minutes resets the wait to `restartDelay`. A signal counts as a failing exit. A command that cannot start, such as a missing binary, is logged as `spawn-failed` and never restarted, because it will not fix itself.

When the daemon starts, it first kills processes left behind by a previous daemon instance, found by their pid files and then by a match on command line, so restarts do not pile up duplicates. Disabling a vault, or shutting the daemon down, stops its processes: `SIGTERM` to the process group, then `SIGKILL` after 3 seconds.

`bismuth daemon process toggle <name> [--off] --vault <vault>` edits `enabled` and tells the running daemon to start or stop the process. `daemon process create` and `daemon process delete` work like the cron commands; a created process is disabled and runs `echo` until you set `command`.

## How it works

### Frontmatter parsing

Crons and processes are read by `daemon/src/lib/frontmatter.ts`, which is not a YAML parser. It matches the `---` fence, splits each line at the first `:`, and keeps every value as a trimmed string. A value wrapped in `"…"` is JSON-decoded and one wrapped in `'…'` is unwrapped. The daemon therefore tests the text: `enabled !== "false"` for opt-out keys, `=== "true"` for opt-in keys. A line with no colon is ignored. Core writes names in quotes whenever a bare value would not survive this parser.

### Firing a job

`fireJob` in `daemon/src/daemon/cron.ts` runs these steps; the scheduler does not wait for the session:

1. For an incremental cron, resolve the checkpoint plan first. A skip records the result and returns before any bookkeeping.
2. Add the job to the in-memory running set, write it to `.running.json`, and log `started`.
3. Snapshot the cron's own file and the processes folder, and list the existing inbox pages.
4. Replace `{{brainReport}}` in the body (`daemon/src/daemon/brainReport.ts`), build the prompt with `buildCronPrompt`, and call `sendMessage` with `newSession: true`, the cron's `model`, `effort`, `tier` and `timeout`.
5. If `waitFor` is set, poll `pgrep -f` every 5 seconds until it stops matching or the time runs out.
6. Parse the last result marker, write `.last-fired.json`, log `finished` with the report line, advance the incremental bookmarks on success, and send the `notify` notification.
7. A timeout or shutdown abort records `killed`; any other error records `failed` with its classified cause.
8. In every case: announce new inbox pages ([pages](pages.md#how-you-are-told-a-page-exists)), run the file guards, remove the job from `.running.json` and the running set.

### Scheduler, triggers and keys

One scheduler tick every 60 seconds visits each enabled vault when this device is the owner. It skips a disabled or running job and a file-change job, and fires any other job whose schedule matches now or that is overdue. The same process polls trigger files every 5 seconds: it runs cron triggers, then page triggers, for each enabled vault. A device that is not the owner heartbeats but fires nothing, and deletes triggers unread.

In-memory state is keyed `<vault root>::<file slug>`, so two vaults can each have a cron of the same name. `.last-fired.json`, `.running.json` and the activity log are keyed by display name instead. Editing `name:` by hand changes the key and orphans the cron's history, which can make an overdue-looking cron fire again at the next tick.

### The file watcher

Each vault has one recursive `fs.watch` (`daemon/src/daemon/fileWatch.ts`), never one per cron. It debounces raw events for 2 seconds, drops any path under `.daemon/`, re-reads the cron files, and fires each enabled file-change cron whose `watch` matches a path in the batch.

### Changing a default cron

The upgrade rule depends on `PRIOR_SEED_HASHES` in `daemon/src/daemon/seeds.ts`, an append-only list of the SHA-256 of every earlier stock body of each default cron. A hash missing from the list does not raise an error: the daemon treats that stock file as customized and never upgrades it. To change `dream`, append the SHA-256 of the outgoing body to `PRIOR_SEED_HASHES.dream`, then edit `defaultCrons.ts`. Never list the current body. `bun test daemon` walks the git history of `defaultCrons.ts` and fails, naming the hash to add, if any shipped body is neither current nor listed.

Source: `daemon/src/daemon/{cron,fileWatch,incrementalCron,brainReport,process,defaultCrons,seeds,pages}.ts`, `daemon/src/lib/{frontmatter,checkpointRef,config,drainTriggers,activityLog}.ts`, `core/src/daemon.ts`
