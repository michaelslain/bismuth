# Task syntax

A task is a markdown checkbox list item, and its metadata (dates, priority, recurrence) is written as bracketed fields at the end of the line. The app's task views, calendar and editor all read the same line, so a task you type by hand behaves like one made in the UI.

```markdown
- [ ] Pay rent [due 2026-09-14] [high] [every month] #home
```

That line is one open task with a due date, high priority, a monthly recurrence and the tag `home`. Checking it off writes `[done <today>]` and adds the next month's copy above it.

## What makes a line a task

A line is a task when it is a bullet (`-`, `*` or `+`), one space, a checkbox holding exactly one character, one space, then the text.

```markdown
- [ ] buy milk
* [x] done thing
+ [/] work in progress
    - [ ] nested task
```

These lines are not tasks:

| Line | Why |
|---|---|
| `- bullet, no checkbox` | no `[ ]` |
| `- [ ]buy` | no space after the box |
| `-[ ] buy` | no space after the bullet |
| `- [  ] buy` or `- [] buy` | the box holds two characters or none |
| `1. [ ] buy` | numbered lists are not recognised |

Indented task lines are tasks, and a deeper-indented line under a task belongs to that task (a sub-task or a wrapped continuation).

## Checkbox status characters

The character inside the box sets the task's status.

| Character | Status | Meaning |
|---|---|---|
| space | `todo` | not started |
| `x` or `X` | `done` | completed |
| `/` | `in-progress` | started |
| `-` | `cancelled` | dropped |
| anything else | `other` | custom state, for example `[?]` or `[>]` |

An unknown character is still a task: its status is `other` and the character is kept. A task is resolved when its status is `done` or `cancelled`; every other status is open.

## Which fields can I put on a line?

A field is a bracket group, anywhere in the text, in any order, any number per line. There are three shapes.

| Shape | Example | Meaning |
|---|---|---|
| `[<date key> <date>]` | `[due 2026-09-14]` | one of six dates |
| `[<priority word>]` | `[high]` | priority |
| `[every <rule>]` | `[every 2 weeks]` | recurrence |

```markdown
- [ ] pay rent [due 2026-06-01] [scheduled 2026-05-28] [high] [every month]
```

The task's description is the text with its fields removed: `pay rent`. Tags stay in the description.

### Dates

Six date keys exist. Dates are always `YYYY-MM-DD`, and every write the app makes uses that form.

| Key | Meaning | Rolls forward when a recurring task completes |
|---|---|---|
| `due` | when it must be done | yes |
| `scheduled` | when you plan to work on it | yes |
| `start` | when it becomes available | yes |
| `done` | when it was completed | no |
| `created` | when it was created | no |
| `cancelled` | when it is cancelled | no |

### Priority

Five reserved words set the priority: `[highest]`, `[high]`, `[medium]`, `[low]`, `[lowest]`. A task without one has priority `none`.

```markdown
- [ ] file taxes [highest]
- [ ] tidy desk [medium]
- [ ] plain task
```

Any other word in brackets, such as `[urgent]` or `[priority]`, is plain text. The editor's autocomplete accepts `urgent` and `priority` as typing keywords that expand to one of the five (see [task metadata completion](../editor/autocomplete.md#task-metadata-completion)).

### Recurrence

`[every <rule>]` makes a task recur. The whole bracket content, `every` included, is the rule.

| Rule | Moves each date by | Example |
|---|---|---|
| `every day`, `every N days` | N days | `every 3 days` |
| `every week`, `every N weeks` | N × 7 days | `every 2 weeks` |
| `every month`, `every N months` | N calendar months, clamped to the month's last day | `every month` |
| `every year`, `every N years` | N calendar years | `every 3 years` |
| `every weekday` | the next Monday to Friday | `every weekday` |

Rules are case-insensitive, and `N` defaults to 1. Any other rule (`every other day`, `every 2nd tuesday`, `every blue moon`) still parses as the task's recurrence, but completing the task spawns no next copy, because there is no way to advance the date.

A `#tag` written right after the rule belongs to the tag list, not the rule:

```markdown
- [ ] pay rent [due 2026-09-12] [every month] #home
```

This task recurs monthly and carries the tag `home`.

### When does a bracket group stay plain text?

A bracket group is a field only if it matches one of the three shapes exactly. Everything else stays in the description unchanged, so a mistyped date stays visible.

```markdown
read [chapter 3] tonight              plain text: not a field
about [[due 2026-09-14]] here         a wikilink: untouched
see [due 2026-09-14](http://x) now    a markdown link: untouched
pay rent [due sept 14]                not an ISO date: plain text
buy milk [due 2026-02-30]             not a real calendar day: plain text
```

A wrong date value never raises an error; the bracket just stops being a field, and the task has no due date.

If a line repeats a field, the first one counts and the later ones are dropped from the description. `x [due 2026-09-14] [due 2026-10-01]` has `due` 2026-09-14 and the description `x`.

## Tags

A `#tag` in the task text becomes one of the task's tags, without the `#`. Tags may contain letters, digits, `_`, `/` and `-`, so `#work/urgent` is the tag `work/urgent`. Duplicates collapse to one entry.

```markdown
- [ ] email boss #work #urgent
```

The tags are `urgent` and `work`, and the description is still `email boss #work #urgent`.

## How do I complete, reopen or change a task?

Check the box in the editor, click a task row in a tasks view, or run `bismuth task toggle <file> <line>`.

| Action | What the line becomes |
|---|---|
| Complete | box set to `x`, `[done <today>]` appended unless a done date is already present |
| Complete a recurring task | the above, plus a fresh open copy inserted above with `due`, `scheduled` and `start` moved forward one period |
| Reopen | box set to a space, any done date removed |
| Pick a status from the right-click menu | box set to that character; a done date is added for `x` and removed for any other status |

```markdown
- [ ] buy milk                       becomes   - [x] buy milk [done 2026-05-27]
- [x] buy milk [done 2026-05-27]     becomes   - [ ] buy milk
```

The bullet is always rewritten to `-`, indentation and CRLF line endings are kept, and an `in-progress` or `cancelled` task counts as not done, so toggling it completes it.

A recurring task spawns its next copy only when at least one of `due`, `scheduled` or `start` moves forward. A recurring task with no such date, or with an unrecognised rule, just completes. Completing this line on 2026-06-10:

```markdown
- [ ] submit report #work [highest] [every weekday] [due 2026-06-10] [scheduled 2026-06-08] [start 2026-06-05]
```

produces

```markdown
- [ ] submit report #work [highest] [every weekday] [due 2026-06-11] [scheduled 2026-06-09] [start 2026-06-08]
- [x] submit report #work [highest] [every weekday] [due 2026-06-10] [scheduled 2026-06-08] [start 2026-06-05] [done 2026-06-10]
```

### Rescheduling a date field

Dragging a task chip to another day in the calendar's tasks register rewrites exactly one date field to the day you dropped it on: the field that placed the chip, `scheduled` or `due`. Any other date on the line is left alone. A task with no `due` or `scheduled` date is not placed on the grid, so it has no chip to drag. See [the calendar view's tasks register](../bases/views/calendar.md#tasks-register).

### Edit, delete and move a task

Task rows in the app edit through the HTTP task routes, which rewrite only the targeted line or item:

| Route | Effect |
|---|---|
| `POST /tasks/update` | sets or clears the description, `due`, `scheduled`, `start` and priority; `done`, `created`, `cancelled`, `[every ...]` and tags are kept |
| `POST /tasks/delete` | removes the task and its deeper-indented lines |
| `POST /tasks/move` | removes the task from its note and appends it, unchanged, to another note |
| `POST /tasks/create` | appends `- [ ] <text>` to a note, creating the note if it does not exist |

Request and response shapes are in the [HTTP API reference](../api/http-reference.md).

## Where do completed tasks go?

Completed tasks sink, fold and can be archived, per block. A block is a run of consecutive task lines at the same indent; a blank line, prose, a heading or a different indent ends it.

- **Sink.** Checking a task moves resolved items below the open ones in the same block, keeping the relative order of each group. A resolved parent moves with its children.
- **Fold.** In the editor's live preview, a block that has both open and resolved items shows a `▾ N completed` toggle above the trailing run of resolved items. Collapsing hides that run as `▸ N completed`. The run never hides while the caret is inside it, and folding never changes the file.
- **Archive.** Two commands permanently remove resolved items (and their children): "Archive completed tasks (this note)" and "Archive completed tasks (all notes)". The same is available as `bismuth task archive [<file>]`. Git history keeps the removed lines.

```markdown
- [ ] a                          - [ ] a
- [x] b                          - [ ] c
- [ ] c            sinks to      - [ ] e
- [-] d                          - [x] b
- [ ] e                          - [-] d
```

## How do tasks appear in bases?

Tasks are a base source. A base with `source: tasks` produces one row per checkbox line in the vault, and `source: tasks` with `from: [[Some Base]]` scopes it to the notes that base reads. `mode: tasks` makes any view kind render its rows as tasks, whether they came from a checkbox line or from a task stored as a row in the base itself.

```yaml
---
type: base
source: tasks
mode: tasks
view: table
filters: '!note.resolved && note.priority == "high"'
---
```

Each task row exposes its fields under `note.`: `description`, `status`, `statusChar`, `priority`, `tags`, `line`, `raw`, the six date keys and `recurrence`, plus three derived values.

| Key | Value |
|---|---|
| `note.resolved` | `true` when the status is `done` or `cancelled`; distinct from `note.done`, which is the done date |
| `note.placed` | `scheduled`, falling back to `due`; the date the calendar places the task on |
| `note.recurring` | `true` when the task has a recurrence rule |

Filtering uses the same filter language as every other base; see [Bases filters](../bases/filters.md). The source and mode axes are explained in [Bases overview](../bases/overview.md#three-axes-kind-mode-and-origin), and the calendar's tasks register in [the calendar view](../bases/views/calendar.md#tasks-register). To list tasks from the shell, run `bismuth task list [--query <expr>]`, where the query is a Bases filter expression.

## Migrating from the emoji syntax

Task lines written with emoji signifiers (such as `📅 2026-09-14` or `⏫`) are plain description text to the parser, so their dates and priorities do not show up in task views. Preview the conversion with `bismuth task migrate --dry-run`, then run `bismuth task migrate`. The app also converts a vault on first open, after taking a local git snapshot. See [Migrating](../overview/migrating.md) for the full steps.

## How it works

The task grammar is split across small pure modules that the backend, the editor and the app's task rows all import, so a line means the same thing everywhere.

| Module | Owns |
|---|---|
| `core/src/taskParse.ts` | `TASK_LINE` (`/^(\s*)[-*+] \[(.)\] (.*)\r?$/`), `parseTaskLine`, `extractTasks` and the `Task` shape |
| `core/src/taskFields.ts` | the bracket-field grammar (`FIELD_SCAN`, `parseFields`, `splitRecurrence`) and `advanceDateByRecurrence` |
| `core/src/taskReorder.ts` | status mapping (`statusFromChar`, `statusToChar`), block detection (`collectBlock`) and `reorderTaskBlocks` |
| `core/src/tasks.ts` | the write-backs (`toggleTaskLine`, `setTaskLineStatus`, `setTaskLineDate`, `archiveResolvedTasks`) and the vault scans |
| `core/src/taskEdit.ts`, `core/src/taskCreate.ts` | line edit, item removal, and appending a new task |
| `app/src/editor/taskFold.ts` | the `N completed` fold |
| `app/src/bases/taskWrite.ts` | the same toggle and rollover rules for a task stored as a base row |

### Field matching

`parseFields` scans the body with `FIELD_SCAN`, `/(?<!\[)\[([^[\]]+)\](?!\()/g`. The lookbehind skips the second `[` of a wikilink and the lookahead skips a markdown link, so neither is ever a candidate. Each candidate then passes `classify`: a bare priority word, `every <rule>`, or a date key whose value is a real calendar day. The real-day check goes through `isRealISODate`, which round-trips the date through UTC because `Date.UTC` silently normalises `2026-02-30` to 2 March.

The editor marks each recognised field as a chip over the literal bracket text, using the same `isFieldText` test, so what you see is exactly what is on disk and a non-field bracket never becomes a chip.

### Recurrence and tags

`splitRecurrence` cuts a recurrence at the first `#tag`, because `advanceDateByRecurrence` matches `/^every\s+(?:(\d+)\s+)?(day|week|month|year)s?$/` and `/^every\s+weekday$/` anchored at both ends. Without the cut, `every month #home` would match neither and the task would silently never roll forward. The trailing tag is put back into the description so the tag scan still finds it, even when the recurrence itself loses to an earlier `every` bracket.

### Toggle write-back

`POST /tasks/toggle` runs `applyTaskToggle`: it toggles or sets the target line, then runs `reorderTaskBlocks` over the whole note. The in-process mobile backend calls the same `applyTaskToggle`; `bismuth task toggle` composes the same pure helpers. A task line also loses a hand-typed `✅ YYYY-MM-DD` done marker when it is reopened, and completing a line that already carries one does not add a second done date.

The in-editor checkbox edits the box character directly in the buffer rather than calling the route, so `reorderAroundLine` in `taskFold.ts` repeats the sink for the block containing the edited line.

### The Task shape

`parseTaskLine` returns `null` for a non-task line and otherwise a `Task`.

| Field | Type | Value |
|---|---|---|
| `path` | string | vault-relative file path |
| `line` | number | 0-indexed line number |
| `raw`, `indent` | string | the full line, its leading whitespace |
| `status`, `statusChar` | string | the status and the raw box character |
| `description` | string | text with fields removed, whitespace collapsed, tags kept |
| `priority` | string | `highest`, `high`, `medium`, `low`, `lowest` or `none` |
| `tags` | string[] | tags without the `#` |
| `due`, `scheduled`, `start`, `done`, `created`, `cancelled` | string, optional | ISO dates, present only when the field is on the line |
| `recurrence` | string, optional | the rule, for example `every week` |

`path` and `line` together identify the line for write-back. `collectVaultTasks` scans every markdown file, and `collectTasksFromPaths` scans a set of paths for a scoped `source: tasks` with `from:`. A scanned checkbox task and a task stored in a base's body both project to the same `Row` shape in `core/src/bases/taskRow.ts`.

### Automatic conversion

`runTaskMigration` in `core/src/taskMigrateRun.ts` runs once after the vault opens in the desktop and dev app. It scans, takes a local git snapshot, then rewrites; if the snapshot fails, nothing is rewritten. The report is served at `GET /tasks/migration`. `BISMUTH_NO_TASK_MIGRATE=1` skips the pass. The conversion itself is `migrateContent` in `core/src/taskMigrate.ts`, the same function `bismuth task migrate` calls.

Source: `core/src/taskParse.ts`, `core/src/taskFields.ts`, `core/src/taskReorder.ts`, `core/src/tasks.ts`, `core/src/taskEdit.ts`, `core/src/taskCreate.ts`, `core/src/taskMigrate.ts`, `core/src/taskMigrateRun.ts`, `core/src/bases/taskRow.ts`, `app/src/editor/taskFold.ts`, `app/src/editor/taskComplete.ts`, `app/src/bases/taskWrite.ts`, `cli/src/commands/task.ts`
