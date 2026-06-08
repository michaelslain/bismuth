# Task Syntax (Obsidian-Tasks-compatible)

Bismuth parses checkbox list items in markdown as **tasks**, mirroring the
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) emoji-signifier
format. Every task is one markdown checkbox line; the parser tracks its source
file and 0-indexed line number so the line can be toggled back in place. This
document is the canonical reference for the exact task line shape, checkbox
status characters, the full date/priority/recurrence signifier set (both the
emoji form the parser reads and the keyword form the editor autocompletes),
recurrence rules, tag handling, and the completion/toggle behaviors — all drawn
directly from `core/src/tasks.ts` and `app/src/editor/taskComplete.ts`.

Related docs: [tasks query DSL](./query-dsl.md), [bases overview](../bases/overview.md)
(tasks are a base source — `source: tasks`).

## The task line

A task line is matched by this regex (`core/src/tasks.ts`):

```
/^(\s*)[-*+] \[(.)\] (.*)\r?$/
```

Breaking that down, a line is a task **iff** it is:

1. **Leading whitespace** (`\s*`) — captured as `indent`. Indentation is
   preserved; nested tasks are still tasks.
2. A **bullet marker**: one of `-`, `*`, or `+`, followed by exactly one space.
3. A **checkbox**: `[` then **exactly one character** then `]` — that character
   is the `statusChar`.
4. **One space**, then the **body** (everything to end of line; an optional
   trailing `\r` for CRLF files is allowed and stripped).

Examples that ARE tasks:

```markdown
- [ ] buy milk
* [x] done thing
+ [/] work in progress
    - [ ] nested task
```

Examples that are NOT tasks (return `null` from `parseTaskLine`):

```markdown
just text
# heading
- bullet, no checkbox
```

Notes / gotchas:

- The bullet **must** be followed by a single space, then `[`, then one char,
  then `]`, then a single space, then the body. `- [ ]buy` (no space after the
  box) does not match; `-[ ] x` (no space after the bullet) does not match.
- The checkbox holds **exactly one** character. `[ ]` (space), `[x]`, `[/]`,
  `[-]`, or any other single char all match; `[  ]` (two spaces) or `[]` (empty)
  do not.
- Ordered-list markers (`1.`) are NOT recognized — only `-`, `*`, `+`.
- `extractTasks(content, path)` splits on `\r?\n` and runs the matcher per line,
  emitting one `Task` per matching line with its 0-indexed `line` number. Lines
  that don't match (headings, prose, blank lines) are skipped. So for:

  ```
  # Title

  - [ ] one
  some prose
  - [x] two
    - [ ] three
  ```

  the tasks parse to lines `[2, 4, 5]` with descriptions `["one", "two", "three"]`.

- CRLF (`\r\n`) line endings are handled: descriptions are clean of the trailing
  `\r`, and line numbers stay correct.

## Checkbox status characters

The single character inside `[ ]` determines the task's `status`
(`TaskStatus = "todo" | "done" | "in-progress" | "cancelled" | "other"`). The
raw character is also kept as `statusChar`. Mapping (`statusFromChar`):

| Char in box | `status`        | Meaning      |
| ----------- | --------------- | ------------ |
| ` ` (space) | `"todo"`        | Not started  |
| `x`         | `"done"`        | Completed    |
| `X`         | `"done"`        | Completed    |
| `/`         | `"in-progress"` | In progress  |
| `-`         | `"cancelled"`   | Cancelled    |
| any other   | `"other"`       | Custom state |

Both lowercase `x` and uppercase `X` count as done. Any single character not in
the table above (e.g. `[?]`, `[>]`, `[!]`) still parses as a valid task with
`status: "other"` and `statusChar` set to that character — Bismuth does not
reject unknown checkbox states, it just classifies them as `other`.

Examples:

```markdown
- [ ] todo          → status "todo"
- [x] done          → status "done"
- [X] also done     → status "done"
- [/] wip           → status "in-progress"
- [-] cancelled     → status "cancelled"
- [?] unknown       → status "other", statusChar "?"
```

## Signifiers: emoji vs. keyword forms

Task metadata is attached with **emoji signifiers** appended to the body. The
**parser** (`core/src/tasks.ts`) only reads the emoji form. The **editor
autocomplete** (`app/src/editor/taskComplete.ts`) lets you type a plain English
**keyword** which expands into the matching emoji — keywords are an authoring
convenience, not stored in the file. What ends up in the markdown is always the
emoji.

There are three signifier families: **date fields**, **priority**, and
**recurrence**.

## Date fields

Six date signifiers are recognized. Each is an emoji immediately followed
(optionally with surrounding whitespace) by an ISO date `YYYY-MM-DD`. The
matching regex per field is `<emoji>\s*(\d{4}-\d{2}-\d{2})`.

| Emoji | `Task` field | Keyword(s) to autocomplete         | Recurs forward? |
| ----- | ------------ | ---------------------------------- | --------------- |
| 📅    | `due`        | `due`                              | yes             |
| ⏳    | `scheduled`  | `scheduled`                        | yes             |
| 🛫    | `start`      | `start`, `starts`                  | yes             |
| ✅    | `done`       | `done`, `completed`                | no              |
| ➕    | `created`    | `created`                          | no              |
| ❌    | `cancelled`  | `cancelled`, `canceled`            | no              |

The date format is strictly `YYYY-MM-DD` (4-digit year, 2-digit month, 2-digit
day). Each emoji's date is matched and then **stripped** from the description, so
the resulting `description` is the task text with all signifiers removed.

Example — due, scheduled, and start together:

```markdown
- [ ] pay rent 📅 2026-06-01 ⏳ 2026-05-28 🛫 2026-05-20
```

parses to `due: "2026-06-01"`, `scheduled: "2026-05-28"`, `start: "2026-05-20"`,
and `description: "pay rent"`.

Example — done and created on a completed task:

```markdown
- [x] thing ✅ 2026-05-27 ➕ 2026-05-01
```

parses to `done: "2026-05-27"`, `created: "2026-05-01"`.

Order and spacing are flexible: the parser finds each emoji's date anywhere in
the body (one per field), so `📅 2026-06-01 ⏳ 2026-05-28` and
`⏳ 2026-05-28 📅 2026-06-01` both work. The "Recurs forward?" column matters for
recurrence rollover (see below): on completing a recurring task, only `due`,
`scheduled`, and `start` get advanced; `done`/`created`/`cancelled` never recur.

### Date keyword autocomplete

In the editor, while typing inside a task description, typing a keyword (≥2
characters, or invoke explicitly) offers the matching signifier. Picking one of
the dated fields inserts the emoji and **re-opens** the popup with relative-date
choices that resolve to ISO against today:

| Choice label    | Offset from today |
| --------------- | ----------------- |
| `today`         | +0 days           |
| `tomorrow`      | +1 day            |
| `in 2 days`     | +2 days           |
| `in 3 days`     | +3 days           |
| `in a week`     | +7 days           |
| `in two weeks`  | +14 days          |

E.g. with today = `2026-06-07`, `today` → `2026-06-07`, `tomorrow` →
`2026-06-08`, `in a week` → `2026-06-14`. The inserted value is always the
resolved ISO date string, which is what the parser expects.

The keyword `due` autocompletes to `📅  due date` only; `start`/`starts` to
`🛫  start date`; `done`/`completed` to `✅  done date`; `cancelled`/`canceled`
to `❌  cancelled date`; `created` to `➕  created date`; `scheduled` to
`⏳  scheduled date`.

## Priority

Five priority signifiers. The `Task.priority` field is
`Priority = "highest" | "high" | "medium" | "low" | "lowest" | "none"`; a task
with no priority emoji is `"none"`.

| Emoji | `priority` | Keyword(s) to autocomplete             |
| ----- | ---------- | -------------------------------------- |
| 🔺    | `highest`  | `priority`, `highest`, `urgent`        |
| ⏫    | `high`     | `priority`, `high`                     |
| 🔼    | `medium`   | `priority`, `medium`                   |
| 🔽    | `low`      | `priority`, `low`                      |
| ⏬    | `lowest`   | `priority`, `lowest`                   |

Examples:

```markdown
- [ ] file taxes 🔺      → priority "highest"
- [ ] reply to email ⏫  → priority "high"
- [ ] tidy desk 🔼       → priority "medium"
- [ ] read article 🔽    → priority "low"
- [ ] someday idea ⏬     → priority "lowest"
- [ ] plain task         → priority "none"
```

Gotchas:

- The parser scans the priority emoji list **in order** (highest → high → medium
  → low → lowest) and stops at the **first** one present. If a task contains more
  than one priority emoji, only the highest-precedence one in that list wins; all
  occurrences of that single emoji are then stripped from the description.
- Priority is detected with a plain substring `includes` check, so it can appear
  anywhere in the body.
- Autocomplete: typing `priority` matches **all five** priority fields; typing
  `high` surfaces both `🔺 highest priority` and `⏫ high priority` (prefix
  match), in that order; `urgent` maps specifically to highest.

## Recurrence

Recurrence is the trailing 🔁 signifier followed by a natural-language rule. The
text **after** 🔁 (up to end of body, after dates/priority are already stripped)
is the rule, stored in `Task.recurrence`. Anything before 🔁 stays in the
description.

```markdown
- [ ] standup 🔁 every weekday 📅 2026-05-28
```

parses to `recurrence: "every weekday"`, `due: "2026-05-28"`,
`description: "standup"`.

Because the parser strips date and priority signifiers **before** locating 🔁,
recurrence text and dates can be interleaved in any order. The recurrence rule
captures everything from just past 🔁 onward (after date/priority removal).

### Supported recurrence rules

`advanceDateByRecurrence(iso, rule)` recognizes these forms (case-insensitive,
trimmed). All rule matching is lowercased first.

| Rule pattern                  | Meaning                            | Example          |
| ----------------------------- | ---------------------------------- | ---------------- |
| `every day`                   | +1 day                             | `every day`      |
| `every N days`                | +N days                            | `every 3 days`   |
| `every week`                  | +7 days                            | `every week`     |
| `every N weeks`               | +N×7 days                          | `every 2 weeks`  |
| `every month`                 | +1 calendar month (overflow clamp) | `every month`    |
| `every N months`              | +N calendar months                 | `every 2 months` |
| `every year`                  | +1 calendar year                   | `every year`     |
| `every N years`               | +N calendar years                  | `every 3 years`  |
| `every weekday`               | next Monday–Friday (skips weekend) | `every weekday`  |

The day/week/month/year forms are matched by:

```
/^every\s+(?:(\d+)\s+)?(day|week|month|year)s?$/
```

so the count `N` is optional (defaults to 1), and the unit may be singular or
plural (`day`/`days`, `week`/`weeks`, `month`/`months`, `year`/`years`).
`every weekday` is a separate special case (`/^every\s+weekday$/`).

Anything else (e.g. `every blue moon`, `every 2nd tuesday`, `every other day`)
is **unrecognized** — `advanceDateByRecurrence` returns `null` and the date is
left untouched (no next occurrence is spawned on completion).

### Recurrence rollover semantics (on completion)

When you complete a task carrying a 🔁 rule, `toggleTaskLine` mimics Obsidian:
it inserts a fresh **not-done** copy of the line **above** the completed one,
with the schedulable dates advanced one period and no ✅ date. The returned
string then spans two lines (next occurrence first, completed line second).

```markdown
- [ ] water plants 🔁 every day 📅 2026-05-31
```

completing on `2026-05-31` becomes:

```markdown
- [ ] water plants 🔁 every day 📅 2026-06-01
- [x] water plants 🔁 every day 📅 2026-05-31 ✅ 2026-05-31
```

Rules for the rollover:

- Only `due` (📅), `scheduled` (⏳), and `start` (🛫) advance. `done` (✅),
  `created` (➕), and `cancelled` (❌) never recur forward. All schedulable dates
  present advance together by the same period:

  ```markdown
  - [ ] plan 🔁 every day 📅 2026-05-31 ⏳ 2026-05-30 🛫 2026-05-29
  ```

  → next occurrence `📅 2026-06-01 ⏳ 2026-05-31 🛫 2026-05-30`.

- Weekly: `every week` on `2026-05-31` → `2026-06-07` (+7 days).
- `every N days`: `every 3 days` on `2026-05-31` → `2026-06-03`.
- Monthly: `every month` on `2026-01-31` → `2026-02-28` — overflow days clamp to
  the target month's last day (Jan 31 + 1 month → Feb 28 in a non-leap year),
  matching moment/Obsidian.
- `every weekday`: advances to the next Mon–Fri, skipping Sat/Sun. From Friday
  `2026-05-29` → Monday `2026-06-01`.
- **No reference date** → no next occurrence. `- [ ] floss 🔁 every day`
  (no date) just completes to a single done line; nothing to roll.
- **Unrecognized rule** → no next occurrence. `- [ ] odd 🔁 every blue moon 📅 …`
  completes to a single line, date untouched.
- **Un-completing** a recurring task is always a single line — it never spawns a
  new occurrence; it just clears the box and strips the ✅ date.

### Recurrence keyword autocomplete

Typing `repeat`, `recurring`, `recur`, or `every` autocompletes to the
`🔁  recurrence` signifier, then re-opens the popup with these rule choices:

```
every day, every week, every weekday, every month, every year, every 2 weeks
```

## Tags

`#tags` in the body are collected into `Task.tags` (without the leading `#`),
de-duplicated, by the pattern `/#([A-Za-z0-9_\/-]+)/g`. Tag characters allowed
are letters, digits, underscore, forward slash, and hyphen (so nested tags like
`#work/urgent` are captured as `work/urgent`).

Key behavior — **tags are kept in the description** (unlike date/priority/
recurrence signifiers, which are stripped):

```markdown
- [ ] email boss #work #urgent
```

→ `tags: ["urgent", "work"]` and `description` still contains `#work #urgent`.

Other tag rules:

- **Dedup**: `- [ ] x #work #work` → `tags: ["work"]` (single entry).
- **On both sides of recurrence**: tags before and after 🔁 are both captured,
  because tag collection runs on the body before the recurrence text is split
  off. `- [ ] a #before 🔁 every week #after` → `tags: ["after", "before"]`,
  `recurrence` containing `every week`. (Note the `#after` tag lives inside the
  recurrence text region but is still collected into `tags`.)

## Description

`Task.description` is the body with **priority, date, and recurrence signifiers
removed** (tags retained), with internal runs of whitespace collapsed to a
single space and trimmed. Order of stripping in `parseTaskLine`:

1. Priority emoji removed (first match in precedence order, all occurrences of
   it replaced with a space).
2. Each date field's `<emoji> YYYY-MM-DD` match removed.
3. Tags collected (but left in place).
4. Trailing `🔁 <rule>` split off (rule → `recurrence`, text before → kept).
5. Whitespace collapsed and trimmed → `description`.

So `- [ ] pay rent 📅 2026-06-01 🔺 #bills 🔁 every month` yields
`description: "pay rent #bills"`, `due: "2026-06-01"`, `priority: "highest"`,
`tags: ["bills"]`, `recurrence: "every month"`.

## Toggling tasks (completion)

`toggleTaskLine(line, today)` flips a task between done and not-done and is the
write-back used by `POST /tasks/toggle`:

- **Completing** (box was not `x`/`X`): set the box to `x`; append `✅ <today>`
  **unless** a `✅ YYYY-MM-DD` is already present (no duplicate). Bullet is
  normalized to `-`. If recurring with an advanceable date, prepend the next
  occurrence line (see Recurrence rollover above).

  ```markdown
  - [ ] buy milk            → - [x] buy milk ✅ 2026-05-27
  - [ ] thing ✅ 2026-01-01  → - [x] thing ✅ 2026-01-01   (existing done date kept)
  ```

- **Un-completing** (box was `x`/`X`): set the box to a space and strip any
  `✅ <date>` signifier (matched as `\s*✅\s*\d{4}-\d{2}-\d{2}`).

  ```markdown
  - [x] buy milk ✅ 2026-05-27 → - [ ] buy milk
  ```

- **Indentation** is preserved; a **trailing `\r`** (CRLF file) is preserved on
  every emitted line.
- The bullet is always normalized to `-` on toggle (so `* [ ]` becomes
  `- [x] …`).
- Throws `"not a task line"` if given a non-task line.

Note: only `x`/`X` count as "done" for un-completing. A task in `[/]`
(in-progress) or `[-]` (cancelled) state is treated by `toggleTaskLine` as
not-done, so toggling it **completes** it (box → `x`, ✅ appended).

## The `Task` object shape

`parseTaskLine` returns `null` for non-tasks, otherwise a `Task`:

```ts
interface Task {
  path: string;        // vault-relative file path
  line: number;        // 0-indexed line number within the file
  raw: string;         // the original full line (incl. indentation)
  indent: string;      // leading whitespace
  status: TaskStatus;  // "todo" | "done" | "in-progress" | "cancelled" | "other"
  statusChar: string;  // the raw character between the brackets
  description: string; // task text with signifiers stripped, trimmed (tags kept)
  priority: Priority;  // "highest" | "high" | "medium" | "low" | "lowest" | "none"
  tags: string[];      // #tags found in the description (without leading #)
  due?: string;        // 📅 YYYY-MM-DD
  scheduled?: string;  // ⏳ YYYY-MM-DD
  start?: string;      // 🛫 YYYY-MM-DD
  done?: string;       // ✅ YYYY-MM-DD
  created?: string;    // ➕ YYYY-MM-DD
  cancelled?: string;  // ❌ YYYY-MM-DD
  recurrence?: string; // 🔁 text
}
```

The date fields are **optional** — only present when the matching emoji+date is
in the line. `path` and `line` together identify the line for write-back (the
toggle endpoint relies on them, so scoped extraction via `collectTasksFromPaths`
keeps them identical to a full vault scan).

## Where tasks come from

- `extractTasks(content, path)` — pure per-file extraction (parses one Task per
  matching line).
- `collectVaultTasks(root)` — scans every markdown file in the vault.
- `collectTasksFromPaths(root, paths)` — scans only an explicit set of
  vault-relative paths (the basis for **scoped** tasks: `source: tasks from
  [[Base]]`); unreadable paths are silently skipped.

Tasks are surfaced as a **base source** (`source: tasks`, optionally `from:
[[Base]]`) and queried with the task DSL inside a ` ```query ` block — see
[tasks query DSL](./query-dsl.md) and [bases overview](../bases/overview.md).

## Complete worked example

```markdown
- [ ] submit report #work #q3 🔺 🔁 every weekday 📅 2026-06-10 ⏳ 2026-06-08 🛫 2026-06-05
```

parses to:

- `status`: `"todo"`, `statusChar`: `" "`
- `priority`: `"highest"`
- `tags`: `["work", "q3"]`
- `due`: `"2026-06-10"`, `scheduled`: `"2026-06-08"`, `start`: `"2026-06-05"`
- `recurrence`: `"every weekday"`
- `description`: `"submit report #work #q3"`

Completing it on `2026-06-10` (a Wednesday) produces a next occurrence with all
three schedulable dates advanced to the next weekday plus the completed line:

```markdown
- [ ] submit report #work #q3 🔺 🔁 every weekday 📅 2026-06-11 ⏳ 2026-06-09 🛫 2026-06-08
- [x] submit report #work #q3 🔺 🔁 every weekday 📅 2026-06-10 ⏳ 2026-06-08 🛫 2026-06-05 ✅ 2026-06-10
```

Source: core/src/tasks.ts, app/src/editor/taskComplete.ts, core/test/tasks.test.ts, app/src/editor/taskComplete.test.ts, core/src/dates.ts
