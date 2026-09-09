# Task Syntax

Bismuth parses checkbox list items in markdown as **tasks**. Task metadata —
dates, priority, recurrence — is written as **bracketed fields** appended to
the line, Bismuth's own drawing (`[due 2026-09-14]`, `[high]`,
`[every week]`), continuing the same `[key value]` grammar the app already
uses elsewhere. The parser also reads the older
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) **emoji
signifiers** (📅 ⏳ 🛫 ✅ ➕ ❌ 🔺 ⏫ 🔼 🔽 ⏬ 🔁) — **forever**, with no migration
required — but nothing in the app writes them any more. Every task is one
markdown checkbox line; the parser tracks its source file and 0-indexed line
number so the line can be toggled, rescheduled, or rewritten back in place.

This document is the canonical reference for the exact task line shape,
checkbox status characters, the bracket-field grammar (and its disambiguation
rules against wikilinks/markdown links and plain bracketed text), the legacy
emoji signifiers still read on input, recurrence rules, tag handling, the
completion/toggle behaviors, `bismuth task migrate`, and how resolved tasks
sink/fold/archive within a block — all drawn directly from
`core/src/taskFields.ts`, `core/src/tasks.ts`, `core/src/taskMigrate.ts`,
`core/src/taskReorder.ts`, `app/src/editor/taskFold.ts`, and
`app/src/editor/taskComplete.ts`.

Related docs: [Bases filters](../bases/filters.md) (task filtering is the same
filter language `source: notes` uses — there is no separate query DSL any
more; see [the legacy DSL migration note](./query-dsl.md) if you have an old
` ```query ` block), [bases overview](../bases/overview.md) (tasks are a base
source — `source: tasks`), [calendar view](../bases/views/calendar.md) (the
tasks register places, drags, and creates tasks on a grid).

**What's in here**: the exact [task line](#the-task-line) shape and [checkbox
status characters](#checkbox-status-characters); the
[bracket-field grammar](#the-bracket-field-grammar) and its
[disambiguation rules](#disambiguation-a-bracket-group-is-not-always-a-field);
every [date](#date-fields), [priority](#priority), and
[recurrence](#recurrence) field, plus the [legacy emoji forms](#legacy-emoji-signifiers)
still read forever; how [tags](#tags) and the [description](#description) are
derived; how [toggling a task](#toggling-tasks-completion) and
[rescheduling by drag](#rescheduling-a-date-field) write back — always in
bracket form, always ISO; [`bismuth task migrate`](#bismuth-task-migrate); how
resolved items [sink, fold, and archive](#task-blocks-sinking-folding-archiving)
within a block; and the full [`Task` object shape](#the-task-object-shape).

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

## The bracket-field grammar

Task metadata is a `[key value]` (or bare `[word]`) group appended to the
line — the same drawing Bismuth uses for wikilinks and other bracketed
constructs, continued here rather than inventing a second style. The whole
grammar is one pure module, `core/src/taskFields.ts`, so the parser, the
editor's chip decoration, and the cards-view chip renderer all share **one**
definition of what a field is instead of three that could drift apart.

There are three field shapes:

| Shape | Example | Meaning |
| --- | --- | --- |
| `[<date key> <ISO date>]` | `[due 2026-09-14]` | one of six date fields — see below |
| `[<priority word>]` | `[high]` | a bare, reserved priority word — see [Priority](#priority) |
| `[every <rule>]` | `[every 2 weeks]` | a recurrence rule — see [Recurrence](#recurrence) |

A field can appear anywhere in the body, in any order, any number of fields
per line:

```markdown
- [ ] pay rent [due 2026-06-01] [scheduled 2026-05-28] [high] [every month]
```

parses to `due: "2026-06-01"`, `scheduled: "2026-05-28"`, `priority: "high"`,
`recurrence: "every month"`, `description: "pay rent"`.

### Disambiguation: a bracket group is not always a field

Bismuth already uses `[...]` for wikilinks (`[[Some Note]]`) and markdown
links (`[text](url)`), and a task description can legitimately contain the
word "chapter" in brackets, or a mistyped date. The grammar is built to never
swallow any of those. The candidate matcher (`FIELD_SCAN` in
`core/src/taskFields.ts`):

```
/(?<!\[)\[([^[\]]+)\](?!\()/g
```

bakes in two guards **before** anything is classified:

- `(?<!\[)` — the **second** `[` of a `[[wikilink]]` never starts a candidate,
  so `[[due 2026-09-14]]` is never touched.
- `(?!\()` — `[text](url)` is a markdown **link**, not a field, so
  `[due 2026-09-14](http://x)` is never touched either.

A candidate that survives those two guards is still only a **candidate** — it
still has to pass `classify()` to count as a real field:

- A **bare word** matching one of the five reserved priority words
  (`highest`, `high`, `medium`, `low`, `lowest`) → a priority field.
- **`every <something>`** → a recurrence field (the rule is the whole bracket
  content, `every` included).
- **`<date key> <value>`**, where `<date key>` is one of the six known names
  (`due`, `scheduled`, `start`, `done`, `created`, `cancelled`) **and**
  `<value>` is a real, shape-valid ISO date (`YYYY-MM-DD` that also names an
  actual calendar day — `2026-13-45` and `2026-02-30` both fail the real-date
  check, not just the shape check) → a date field.
- **Anything else** — an unknown key, a known key with a malformed or
  calendar-impossible value, a bare word that isn't a reserved priority word —
  is **not** a field. The bracket stays in the description as ordinary text.

That last rule is deliberate, not a gap: a mistyped date should stay
**visible** to the person who wrote it, not vanish silently into a field that
can never resolve to a real day.

```markdown
read [chapter 3] tonight              → NOT a field; description unchanged
about [[due 2026-09-14]] here         → wikilink; description unchanged
see [due 2026-09-14](http://x) now    → markdown link; description unchanged
pay rent [due sept 14]                → not ISO; stays literal text
buy milk [due 2026-02-30]             → shape-valid, not a real day; stays literal text
```

**First occurrence of a key wins.** A duplicate date key, priority, or `every`
clause after the first is inert (left as literal text in the description)
rather than silently overriding what the reader sees first.

### Date fields

Six date keys are recognized, matching the emoji signifiers they replace:

| Bracket key | `Task` field | Legacy emoji | Recurs forward? |
| ----------- | ------------ | ------------ | --------------- |
| `due`       | `due`        | 📅           | yes             |
| `scheduled` | `scheduled`  | ⏳           | yes             |
| `start`     | `start`      | 🛫           | yes             |
| `done`      | `done`       | ✅           | no              |
| `created`   | `created`    | ➕           | no              |
| `cancelled` | `cancelled`  | ❌           | no              |

**Dates are always ISO (`YYYY-MM-DD`) on disk** — this was already true of the
emoji form and stays true of the bracket form; nothing in this app ever
writes a localized or relative date string into a task line. The "Recurs
forward?" column matters for recurrence rollover (see below): on completing a
recurring task, only `due`, `scheduled`, and `start` advance;
`done`/`created`/`cancelled` never recur.

### Priority

Five **reserved priority words**, each a bare bracket with no value:
`[highest]`, `[high]`, `[medium]`, `[low]`, `[lowest]`. `Task.priority` is
`"highest" | "high" | "medium" | "low" | "lowest" | "none"`; a task with
neither a priority bracket nor a priority emoji is `"none"`.

```markdown
- [ ] file taxes [highest]      → priority "highest"
- [ ] reply to email [high]     → priority "high"
- [ ] tidy desk [medium]        → priority "medium"
- [ ] read article [low]        → priority "low"
- [ ] someday idea [lowest]     → priority "lowest"
- [ ] plain task                → priority "none"
```

The five words are **reserved** — `classify()` checks the priority list
before it checks the date-key/recurrence shape, so `[high]` can never be
misread as anything else. A word that merely looks like a priority but isn't
exactly one of the five (`[urgent]`, `[priority]`) is not a field; it stays
literal text (though `urgent` and `priority` both work as **autocomplete
keywords** that expand to `[highest]`/one of the five — see below).

### Recurrence

`[every <rule>]` — the whole bracket content, `every` included, becomes
`Task.recurrence` verbatim (`[every 2 weeks]` → `recurrence: "every 2 weeks"`,
matching the legacy `🔁 every 2 weeks` spelling exactly, so the two forms
never disagree about what the stored rule string is).

```markdown
- [ ] standup [every weekday] [due 2026-05-28]
```

parses to `recurrence: "every weekday"`, `due: "2026-05-28"`,
`description: "standup"`.

#### Supported recurrence rules

`advanceDateByRecurrence(iso, rule)` recognizes these forms (case-insensitive,
trimmed). All rule matching is lowercased first.

| Rule pattern                  | Meaning                            | Example          |
| ----------------------------- | ----------------------------------- | ---------------- |
| `every day`                   | +1 day                              | `every day`      |
| `every N days`                | +N days                             | `every 3 days`   |
| `every week`                  | +7 days                             | `every week`     |
| `every N weeks`               | +N×7 days                           | `every 2 weeks`  |
| `every month`                 | +1 calendar month (overflow clamp)  | `every month`    |
| `every N months`              | +N calendar months                  | `every 2 months` |
| `every year`                  | +1 calendar year                    | `every year`     |
| `every N years`               | +N calendar years                   | `every 3 years`  |
| `every weekday`                | next Monday–Friday (skips weekend)  | `every weekday`  |

The day/week/month/year forms are matched by:

```
/^every\s+(?:(\d+)\s+)?(day|week|month|year)s?$/
```

so the count `N` is optional (defaults to 1), and the unit may be singular or
plural (`day`/`days`, `week`/`weeks`, `month`/`months`, `year`/`years`).
`every weekday` is a separate special case (`/^every\s+weekday$/`).

Anything else (e.g. `every blue moon`, `every 2nd tuesday`, `every other day`)
is **unrecognized** — `advanceDateByRecurrence` returns `null` and the date is
left untouched (no next occurrence is spawned on completion). An unrecognized
rule is still a **valid bracket field** (`[every blue moon]` parses fine,
`recurrence: "every blue moon"`); it's the *rollover* that's a no-op, not the
parse.

#### Recurrence keyword autocomplete

Typing `repeat`, `recurring`, `recur`, or `every` offers the **recurrence**
field, inserting `[every ` and re-opening the popup with these rule choices:

```
every day, every week, every weekday, every month, every year, every 2 weeks
```

Picking one closes the bracket, so the inserted text is a complete
`[every <rule>]`.

## Legacy emoji signifiers

Every note written before this syntax existed still parses, unchanged,
**forever** — no migration is required, and nothing about opening an
un-migrated vault is different from before. The parser
(`core/src/tasks.ts`) reads the bracket grammar **first**, then falls back to
the emoji signifiers for whatever the brackets left unset:

| Emoji | Field         | Recurs forward? |
| ----- | ------------- | ---------------- |
| 📅    | `due`         | yes               |
| ⏳    | `scheduled`   | yes               |
| 🛫    | `start`       | yes               |
| ✅    | `done`        | no                |
| ➕    | `created`     | no                |
| ❌    | `cancelled`   | no                |
| 🔺    | priority `highest` | — |
| ⏫    | priority `high`    | — |
| 🔼    | priority `medium`  | — |
| 🔽    | priority `low`     | — |
| ⏬    | priority `lowest`  | — |
| 🔁    | recurrence rule (text after it, to end of body) | — |

**Precedence: a bracket field always wins over an emoji for the same field.**
A line carrying both `[due 2026-09-14]` and `📅 2026-01-01` resolves to the
bracket value, because the bracket form is the one the app now writes. The
emoji is stripped from the description regardless — an emoji left dangling in
the text after its value was overridden by a bracket is the same visual bug
as a stray raw date, so it is always removed, not just when it supplied the
value.

```markdown
- [ ] x [due 2026-09-14] 📅 2026-01-01     → due "2026-09-14" (bracket wins), description "x"
- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week   → due "2026-09-14", priority "high", recurrence "every week"
```

**Nothing in the app writes emoji any more.** The editor autocomplete
(`app/src/editor/taskComplete.ts`) inserts bracket fields only — Bismuth's
design system rule is "no emoji, ever", and that now includes the completion
menu itself, which shows plain labels ("due date", "high priority", …) with
no emoji glyph. Toggling, setting a status, and recurrence rollover
(`core/src/tasks.ts`) all write `[done 2026-09-08]`, never `✅ 2026-09-08` —
see [Toggling tasks](#toggling-tasks-completion) below. Completing a value
inside an **existing** emoji field (e.g. typing after a `📅` on an
un-migrated line) still autocompletes correctly; only new insertions are
bracket-only.

### Rendering: chips, not raw brackets, but the SAME text

The editor (`app/src/editor/livePreview.ts`) and the cards-view task body
(`app/src/bases/taskCardMarkup.ts`) both draw a recognized bracket field as a
visually distinct **chip** (`.cm-task-field` in the editor,
`.bismuth-task-field` in card bodies) — but this is a **mark on the literal
text**, not a widget that replaces or hides it. There is nothing to reveal on
cursor-enter and nothing invented: what you see is exactly what's on disk.
Both renderers filter `FIELD_SCAN`'s candidates through the same
`isFieldText`/`classify` guard the parser uses, so a bracket group that is
NOT a real field (`[chapter 3]`, a malformed date) never gets chip styling —
it stays plain text, exactly as the parser treats it.

## Tags

`#tags` in the body are collected into `Task.tags` (without the leading `#`),
de-duplicated, by the pattern `/#([A-Za-z0-9_\/-]+)/g`. Tag characters allowed
are letters, digits, underscore, forward slash, and hyphen (so nested tags like
`#work/urgent` are captured as `work/urgent`).

Key behavior — **tags are kept in the description** (unlike date/priority/
recurrence fields, which are stripped, in either spelling):

```markdown
- [ ] email boss #work #urgent
```

→ `tags: ["urgent", "work"]` and `description` still contains `#work #urgent`.

Other tag rules:

- **Dedup**: `- [ ] x #work #work` → `tags: ["work"]` (single entry).
- **Alongside a bracket field**: `- [ ] read #books [due 2026-09-14]` →
  `tags: ["books"]`, `description: "read #books"`.
- **A wikilink in the description is untouched**: `- [ ] review [[Some Note]]
  [due 2026-09-14]` → `description: "review [[Some Note]]"`, `due:
  "2026-09-14"` — the wikilink guard in the field grammar means the two never
  interfere with each other.

## Description

`Task.description` is the body with **priority, date, and recurrence
fields removed** (bracket or emoji, tags retained), with internal runs of
whitespace collapsed to a single space and trimmed. Order of stripping in
`parseTaskLine`:

1. Bracket fields parsed first (`parseFields`, `core/src/taskFields.ts`) —
   dates, priority, recurrence all extracted and removed from the body in one
   pass, guarded against wikilinks/links as above.
2. Emoji signifiers second, filling **only** whatever the brackets left
   unset, and always stripped from the body regardless of whether they
   supplied a value.
3. Tags collected (but left in place).
4. Whitespace collapsed and trimmed → `description`.

So `- [ ] pay rent [due 2026-06-01] [highest] #bills [every month]` yields
`description: "pay rent #bills"`, `due: "2026-06-01"`, `priority:
"highest"`, `tags: ["bills"]`, `recurrence: "every month"`.

## Toggling tasks (completion)

`toggleTaskLine(line, today)` flips a task between done and not-done and is
the write-back used by `POST /tasks/toggle`. **Every writer emits the bracket
form** — this is the one rule to remember: nothing this app writes to disk is
ever an emoji, even on a task that currently uses emoji for everything else.

- **Completing** (box was not `x`/`X`): set the box to `x`; append
  `[done <today>]` **unless** a done date is already present, in **either**
  spelling (`✅ YYYY-MM-DD` or `[done YYYY-MM-DD]` — no duplicate, and an
  existing emoji done-date is respected rather than doubled up). Bullet is
  normalized to `-`. If recurring with an advanceable date, prepend the next
  occurrence line (see Recurrence rollover below).

  ```markdown
  - [ ] buy milk                 → - [x] buy milk [done 2026-05-27]
  - [ ] thing [done 2026-01-01]  → - [x] thing [done 2026-01-01]   (existing done date kept)
  - [ ] thing ✅ 2026-01-01      → - [x] thing ✅ 2026-01-01       (existing EMOJI done date kept, not converted)
  ```

- **Un-completing** (box was `x`/`X`): set the box to a space and strip any
  done-date field, in **either** spelling.

  ```markdown
  - [x] buy milk [done 2026-05-27] → - [ ] buy milk
  - [x] buy milk ✅ 2026-05-27     → - [ ] buy milk
  ```

- **Indentation** is preserved; a **trailing `\r`** (CRLF file) is preserved on
  every emitted line.
- The bullet is always normalized to `-` on toggle (so `* [ ]` becomes
  `- [x] …`).
- Throws `"not a task line"` if given a non-task line.

`setTaskLineStatus(line, status, today)` is the right-click status-menu
write-back (any status char, not just the done/not-done binary): identical
rules, targeting an explicit `statusChar` instead of the toggle's binary flip.

Note: only `x`/`X` count as "done" for un-completing. A task in `[/]`
(in-progress) or `[-]` (cancelled) state is treated by `toggleTaskLine` as
not-done, so toggling it **completes** it (box → `x`, a bracket done date
appended).

### Rescheduling a date field

The calendar's tasks register (see [calendar view](../bases/views/calendar.md))
drags a chip to another day to reschedule it. The write-back,
`setTaskLineDate(line, field, iso)` behind `POST /tasks/reschedule`, rewrites
**one** date field — whichever one placed the task, `scheduled` or `due` —
to the dropped-on day. Like every other writer, it always emits the bracket
form: dragging a chip that is still on the emoji spelling (`⏳ 2026-09-01`)
rewrites it to `[scheduled 2026-09-15]`, not `⏳ 2026-09-15`. Only the ONE
field that placed the task is touched; a second date field on the same line
is left exactly as it was.

## `bismuth task migrate`

Migration is **optional** — the parser reads both spellings forever, so no
vault ever *needs* this. It exists for someone who wants a whole vault
converted to the bracket spelling in one pass (for a clean grep, or just
consistency).

```bash
bismuth task migrate --vault <vault>              # rewrites every safely-convertible line
bismuth task migrate --vault <vault> --dry-run     # reports per-file counts, writes nothing
```

`migrateContent`/`migrateTaskLine` (`core/src/taskMigrate.ts`) rebuild each
task line with every field in bracket form, in a fixed, deterministic order —
dates in `due, scheduled, start, done, created, cancelled` order, then
priority, then recurrence:

```markdown
- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week
```

becomes:

```markdown
- [ ] buy milk [due 2026-09-14] [high] [every week]
```

**Safety, not best-effort.** A line is rewritten only when re-parsing the
rebuilt bracket form reproduces **every** field of the original — status,
description, priority, recurrence, tags, and all six dates
(`fieldsSurvived`). A line the migration cannot safely convert is left
untouched in its original spelling, which the parser will keep reading
correctly forever — nothing is ever lost or silently dropped. Two concrete
cases this catches:

- **A calendar-impossible emoji date** (`📅 2026-02-30`): the emoji parser
  accepts it by shape alone, but the bracket grammar's real-date check
  rejects it — rebuilding naively would drop the date and leave
  `[due 2026-02-30]` sitting in the description as inert text. Migration
  detects the mismatch and leaves the line alone.
- **A tag written after the `🔁` marker**: the emoji parser collects tags from
  the whole body before splitting off the recurrence tail, so a tag *after*
  `🔁` still counts — but folding that tail into one `[every …]` bracket
  would swallow the tag as part of the recurrence value on reparse. Migration
  catches this too.

Other properties:

- **Idempotent** — migrating an already-migrated line returns the identical
  string (`changed: 0` the second time).
- **Line-by-line, not file-wide** — every non-task line (headings, prose,
  blank lines) passes through byte-for-byte untouched, and each line keeps
  its OWN original EOL (a file mixing CRLF and LF keeps every line's own
  terminator).
- **Per-file fault isolation** — one unreadable file (permissions, a broken
  symlink) is skipped and reported; it does not abort the run or leave the
  rest of the vault unmigrated.
- Output: `{ changed, files: [{ file, changed }], skipped: [{ file, error }] }`.

## Task blocks: sinking, folding, archiving

These three behaviors operate on a **task block** — a *contiguous run* of
checkbox lines. The pure block logic lives in `core/src/taskReorder.ts`
(re-exported by `core/src/tasks.ts` so existing `from "./tasks"` importers keep
working), shared by the backend and the editor so both agree on what a block is.

### Resolved vs. open items

An item is **resolved** when its status is `done` (`[x]`/`[X]`) or `cancelled`
(`[-]`) — `isResolvedStatus(status)` is `true` only for those two. `todo`,
`in-progress` (`[/]`), and `other` are **open** (`isResolvedStatus` is false):

```ts
isResolvedStatus("done")        // true
isResolvedStatus("cancelled")   // true
isResolvedStatus("todo")        // false
isResolvedStatus("in-progress") // false
```

### What is a "block" and a "block item"

`collectBlock(lines, start)` reads a contiguous run starting at `lines[start]`,
whose head task lines share the **same base indent**, and splits it into
`TaskBlockItem`s (`{ status, lines }`). A line joins the run as follows:

- A **task line at the base indent** starts a new item.
- A **deeper-indented, non-blank** line (sub-task or wrapped continuation) is
  appended to the **current** item's `lines` — so a parent and its children
  stay glued together.
- Anything else (a blank line, prose, a heading, or a task at a *different* base
  indent) **ends the block**.

This is why blocks separated by prose or a blank line are treated independently,
and why reordering/archiving a parent carries its indented children with it.

### Sinking resolved tasks to the bottom

`reorderTaskBlocks(content)` rewrites the content so that within **each** task
block the resolved items sink below the open ones, **stable** (relative order
within the open group and within the resolved group is preserved). Non-task
regions pass through untouched, and it is **idempotent** (re-running on a sorted
block is a no-op). EOL style (`\n` vs `\r\n`) and a trailing newline are
preserved.

```markdown
- [ ] a
- [x] b
- [ ] c
- [-] d
- [ ] e
```

becomes (open `a, c, e` first, then resolved `b, d` in their original order):

```markdown
- [ ] a
- [ ] c
- [ ] e
- [x] b
- [-] d
```

A resolved parent sinks together with its (still-open) children:

```markdown
- [x] parent
  - [ ] child
- [ ] open
```

→

```markdown
- [ ] open
- [x] parent
  - [ ] child
```

Blocks split by prose are reordered independently:
`- [x] a / - [ ] b / (blank) / text / (blank) / - [x] c / - [ ] d`
→ `- [ ] b / - [x] a / (blank) / text / (blank) / - [ ] d / - [x] c`.

**Where it runs:**

- **`POST /tasks/toggle`** (`core/src/server.ts`) — after flipping the box (via
  `toggleTaskLine`, or `setTaskLineStatus` when an explicit `status` is sent
  from the right-click status menu), the whole note is written back through
  `reorderTaskBlocks(...)`. So checking off a task in any tasks view drops it
  below the still-open ones.
- **In-editor checkbox** (`app/src/editor/livePreview.ts`) — clicking a checkbox
  (or picking a status from its right-click menu) edits the box char *directly
  in the buffer* and **bypasses** `/tasks/toggle`, so the editor mirrors the
  reorder itself via `reorderAroundLine(state, lineNo)` (`taskFold.ts`). That
  helper finds the block containing the just-edited line, runs
  `reorderTaskBlocks` over just that block's text, and dispatches a single
  `ChangeSpec` replacing it (or `null` if already sorted).

### The "▾ N completed" fold (editor)

`app/src/editor/taskFold.ts` adds a collapsible "completed" section to markdown
todo lists in the live-preview editor, the same affordance the Cards/tasks view
has. After resolved tasks have sunk to the bottom of a block, the editor renders
a clickable **`▾ N completed`** toggle above that trailing run; collapsing it
replaces the run with a **`▸ N completed`** widget that hides those lines.

Rules:

- A block is **only foldable when it has both open and resolved items** — a
  block that is all-open or all-resolved shows no toggle (nothing to hide / no
  list context).
- Only a **contiguous trailing run** of resolved items folds (counted from the
  block's last item backward until the first open item). A manually-interleaved
  list — a resolved item with open items below it — keeps that run unfolded so
  it stays intact.
- `N` is the count of resolved items in that trailing run.
- The collapsed set is a **position-mapped `Set`** of anchor positions (the
  start of the first resolved line in the run), surviving edits by mapping each
  position through each transaction.
- The run is **never hidden while the caret is inside it** (`cursorInside`) — the
  user is editing those lines — even if that anchor is marked collapsed.

The fold is purely a display affordance; it does not modify the file. `taskFold()`
is wired into the editor's live-preview extension stack in `Editor.tsx`
(`...(ed.livePreview ? [livePreview, taskFold(), …] : [])`).

### Archiving resolved tasks (permanent removal)

`archiveResolvedTasks(content)` permanently **removes** every resolved item —
head line plus its indented children — from the content, returning
`{ content, removed }` where `removed` is the count of task items deleted. It is
pure; git retains the history. Open items (incl. `in-progress` `[/]`) and all
non-task regions are kept.

```markdown
# Todo
- [ ] keep
- [x] done
- [-] cancelled
- [/] doing
```

→ `removed: 2`, leaving:

```markdown
# Todo
- [ ] keep
- [/] doing
```

A resolved parent is removed together with its children
(`- [x] parent / "  - [ ] child" / - [ ] keep` → `removed: 1`, content
`- [ ] keep`); with nothing resolved it is a no-op (`removed: 0`, content
unchanged).

**Commands & endpoint:** two commands in `COMMAND_CATALOG` (`core/src/commands.ts`)
drive it, bound in `app/src/commands.ts`/`App.tsx`:

| Command id          | Label                                | Scope            |
| ------------------- | ------------------------------------ | ---------------- |
| `archive-tasks`     | Archive completed tasks (this note)  | active note only |
| `archive-all-tasks` | Archive completed tasks (all notes)  | whole vault      |

Both call `POST /tasks/archive` (`api.archiveTasks(path?)`): with a `path` it
archives that one note (returns `{ removed, files }`, `files` being `0` or `1`);
with no body it sweeps every markdown file in the vault, summing `removed` and
counting the `files` touched. The active-note command no-ops with a toast when
no note is open or nothing is resolved.

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
  description: string; // task text with fields stripped, trimmed (tags kept)
  priority: Priority;  // "highest" | "high" | "medium" | "low" | "lowest" | "none"
  tags: string[];      // #tags found in the description (without leading #)
  due?: string;        // ISO date — from [due ...] or the legacy 📅 emoji
  scheduled?: string;  // ISO date — from [scheduled ...] or the legacy ⏳ emoji
  start?: string;      // ISO date — from [start ...] or the legacy 🛫 emoji
  done?: string;       // ISO date — from [done ...] or the legacy ✅ emoji
  created?: string;    // ISO date — from [created ...] or the legacy ➕ emoji
  cancelled?: string;  // ISO date — from [cancelled ...] or the legacy ❌ emoji
  recurrence?: string; // rule text, e.g. "every week" — from [every ...] or the legacy 🔁 emoji
}
```

The date fields are **optional** — only present when a matching bracket field
or emoji is in the line. `path` and `line` together identify the line for
write-back (the toggle and reschedule endpoints rely on them, so scoped
extraction via `collectTasksFromPaths` keeps them identical to a full vault
scan).

## Where tasks come from

- `extractTasks(content, path)` — pure per-file extraction (parses one Task per
  matching line).
- `collectVaultTasks(root)` — scans every markdown file in the vault.
- `collectTasksFromPaths(root, paths)` — scans only an explicit set of
  vault-relative paths (the basis for **scoped** tasks: `source: tasks from
  [[Base]]`); unreadable paths are silently skipped.

Tasks are surfaced as a **base source** (`source: tasks`, optionally `from:
[[Base]]`) and filtered with the same Bases filter language `source: notes`
uses (a `note.resolved`/`note.due`-shaped expression, not a bespoke query
grammar) — see [Bases filters](../bases/filters.md) and
[bases overview](../bases/overview.md). If you have an old ` ```query ` block
still holding the legacy `tasks: |- not done / sort by priority` DSL text, see
[the migration note](./query-dsl.md) — it keeps working un-migrated, and
`bismuth base migrate-queries` rewrites it in place.

## Complete worked example

```markdown
- [ ] submit report #work #q3 [highest] [every weekday] [due 2026-06-10] [scheduled 2026-06-08] [start 2026-06-05]
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
- [ ] submit report #work #q3 [highest] [every weekday] [due 2026-06-11] [scheduled 2026-06-09] [start 2026-06-08]
- [x] submit report #work #q3 [highest] [every weekday] [due 2026-06-10] [scheduled 2026-06-08] [start 2026-06-05] [done 2026-06-10]
```

The equivalent **legacy** (emoji) line still parses identically and still
works — it just isn't what gets WRITTEN any more:

```markdown
- [ ] submit report #work #q3 🔺 🔁 every weekday 📅 2026-06-10 ⏳ 2026-06-08 🛫 2026-06-05
```

Source: `core/src/taskFields.ts`, `core/src/tasks.ts`, `core/src/taskMigrate.ts`, `core/src/taskReorder.ts`, `app/src/editor/taskFold.ts`, `app/src/editor/livePreview.ts`, `app/src/editor/taskComplete.ts`, `app/src/bases/taskCardMarkup.ts`, `core/src/commands.ts`, `app/src/commands.ts`, `app/src/api.ts`, `core/test/tasks.test.ts`, `core/test/taskFields.test.ts`, `core/test/taskMigrate.test.ts`, `app/src/editor/taskComplete.test.ts`, `core/src/dates.ts`, `cli/src/commands/task.ts`
