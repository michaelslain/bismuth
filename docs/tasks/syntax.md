# Task Syntax

Bismuth parses checkbox list items in markdown as **tasks**. Task metadata —
dates, priority, recurrence — is written as **bracketed fields** appended to
the line (`[due 2026-09-14]`, `[high]`, `[every week]`), continuing the same
`[key value]` grammar the app already uses elsewhere. **This is the only
spelling the parser reads.** The older
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) **emoji
signifiers** (📅 ⏳ 🛫 ✅ ➕ ❌ 🔺 ⏫ 🔼 🔽 ⏬ 🔁) are no longer a read path at
all — a checkbox line still carrying one is, to `core/src/tasks.ts`, a task
whose description happens to contain an emoji, nothing more. A vault written
in the old spelling is converted automatically the first time Bismuth opens
it (after taking a local git snapshot), or by hand with `bismuth task
migrate` — see [Migrating from the emoji syntax](#migrating-from-the-emoji-syntax)
below. Every task is one markdown checkbox line; the parser tracks its
source file and 0-indexed line number so the line can be toggled,
rescheduled, or rewritten back in place.

This document is the canonical reference for the exact task line shape,
checkbox status characters, the bracket-field grammar (and its disambiguation
rules against wikilinks/markdown links and plain bracketed text), recurrence
rules, tag handling, the completion/toggle behaviors, migrating a vault off
the old emoji spelling (automatic and manual), what the old emoji syntax
used to mean, and how resolved tasks sink/fold/archive within a block — all
drawn directly from `core/src/taskFields.ts`, `core/src/tasks.ts`,
`core/src/taskLegacy.ts`, `core/src/taskMigrate.ts`,
`core/src/taskMigrateRun.ts`, `core/src/taskReorder.ts`,
`app/src/editor/taskFold.ts`, and `app/src/editor/taskComplete.ts`.

Related docs: [Bases filters](../bases/filters.md) (task filtering is the same
filter language `source: notes` uses — there is no separate query DSL any
more; see [the legacy DSL migration note](./query-dsl.md) if you have an old
` ```query ` block), [bases overview](../bases/overview.md) (tasks are a base
source — `source: tasks` — and `mode: tasks` is what makes any other base
view render its rows as tasks), [calendar view](../bases/views/calendar.md)
(the tasks register places, drags, and creates tasks on a grid).

**What's in here**: the exact [task line](#the-task-line) shape and [checkbox
status characters](#checkbox-status-characters); the
[bracket-field grammar](#the-bracket-field-grammar) and its
[disambiguation rules](#disambiguation-a-bracket-group-is-not-always-a-field);
every [date](#date-fields), [priority](#priority), and
[recurrence](#recurrence) field; how [tags](#tags) and the
[description](#description) are derived; how [toggling a task](#toggling-tasks-completion)
and [rescheduling by drag](#rescheduling-a-date-field) write back — always in
bracket form, always ISO; [migrating a vault off the old emoji
syntax](#migrating-from-the-emoji-syntax), automatically and by hand with
[`bismuth task migrate`](#bismuth-task-migrate); [what the emoji syntax used
to mean](#history-the-emoji-signifiers), for anyone reading an un-migrated
note or an old export; how resolved items
[sink, fold, and archive](#task-blocks-sinking-folding-archiving) within a
block; and the full [`Task` object shape](#the-task-object-shape).

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
raw character is also kept as `statusChar`. Mapping (`statusFromChar`,
`core/src/taskReorder.ts`):

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
`statusToChar` (also `taskReorder.ts`) is the inverse for the four canonical
statuses — used to render a **stored** task row (one kept as a YAML row in a
base's own body rather than scanned from a checkbox line; see
[bases overview](../bases/overview.md)) with the same checkbox glyph a scanned
task gets for free from `statusChar`.

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
  content, `every` included, subject to the trailing-tag cut described under
  [Recurrence](#recurrence)).
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
rather than silently overriding what the reader sees first. A duplicate
`every` clause's own trailing tag (see [Recurrence](#recurrence)) still
reaches the description even though the clause itself is inert, so the tag is
never lost to a bracket that "lost" the first-wins race.

### Date fields

Six date keys are recognized:

| Bracket key | `Task` field | Recurs forward? |
| ----------- | ------------ | --------------- |
| `due`       | `due`        | yes             |
| `scheduled` | `scheduled`  | yes             |
| `start`     | `start`      | yes             |
| `done`      | `done`       | no              |
| `created`   | `created`    | no              |
| `cancelled` | `cancelled`  | no              |

**Dates are always ISO (`YYYY-MM-DD`) on disk** — nothing in this app ever
writes a localized or relative date string into a task line. The "Recurs
forward?" column matters for recurrence rollover (see below): on completing a
recurring task, only `due`, `scheduled`, and `start` advance;
`done`/`created`/`cancelled` never recur.

### Priority

Five **reserved priority words**, each a bare bracket with no value:
`[highest]`, `[high]`, `[medium]`, `[low]`, `[lowest]`. `Task.priority` is
`"highest" | "high" | "medium" | "low" | "lowest" | "none"`; a task with no
priority bracket is `"none"`.

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
keywords** that expand to one of the five — see
[Task Metadata Completion](../editor/autocomplete.md#task-metadata-completion)).

### Recurrence

`[every <rule>]` — the whole bracket content, `every` included, becomes
`Task.recurrence` verbatim (`[every 2 weeks]` → `recurrence: "every 2 weeks"`).

```markdown
- [ ] standup [every weekday] [due 2026-05-28]
```

parses to `recurrence: "every weekday"`, `due: "2026-05-28"`,
`description: "standup"`.

**A `#tag` written right after the rule is a tag, not part of the rule.**
`splitRecurrence` (`core/src/taskFields.ts`) cuts the bracket's content at the
first `#tag` boundary, so the rule handed to `advanceDateByRecurrence` is
always just the rule, and the tag lands back in the description where the
tag extractor (below) can still see it:

```markdown
- [ ] pay rent [due 2026-09-12] [every month] #home
```

parses to `recurrence: "every month"`, `tags: ["home"]`,
`description: "pay rent #home"` — and, because the rule text handed to the
recurrence engine is the clean `"every month"` rather than
`"every month #home"` (which the engine's rule regex would not match at all),
completing this task actually rolls the due date forward. Without the cut, a
recurrence followed by a tag would silently never advance — a real bug this
grammar closes, not a hypothetical one.

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
parse. (This is also true of `advanceDateByRecurrence`'s companion in
`app/src/bases/taskWrite.ts`, which advances a **stored** task row's own
dates the same way — see [bases overview](../bases/overview.md).)

#### Recurrence keyword autocomplete

Typing `repeat`, `recurring`, `recur`, or `every` offers the **recurrence**
field, inserting `[every ` and re-opening the popup with these rule choices:

```
every day, every week, every weekday, every month, every year, every 2 weeks
```

Picking one closes the bracket, so the inserted text is a complete
`[every <rule>]`.

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
recurrence fields, which are stripped):

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
fields removed** (tags retained), with internal runs of whitespace collapsed
to a single space and trimmed. Order of stripping in `parseTaskLine`:

1. Bracket fields parsed (`parseFields`, `core/src/taskFields.ts`) — dates,
   priority, recurrence all extracted and removed from the body in one pass,
   guarded against wikilinks/links as above (a recurrence field's trailing
   tag is put back rather than dropped — see [Recurrence](#recurrence)).
2. Tags collected (but left in place).
3. Whitespace collapsed and trimmed → `description`.

So `- [ ] pay rent [due 2026-06-01] [highest] #bills [every month]` yields
`description: "pay rent #bills"`, `due: "2026-06-01"`, `priority:
"highest"`, `tags: ["bills"]`, `recurrence: "every month"`.

## Toggling tasks (completion)

`toggleTaskLine(line, today)` flips a task between done and not-done and is
the write-back used by `POST /tasks/toggle`. **Every writer emits the bracket
form** — this is the one rule to remember: nothing this app writes to disk is
ever an emoji.

- **Completing** (box was not `x`/`X`): set the box to `x`; append
  `[done <today>]` **unless** a done date is already present, in **either**
  spelling (`✅ YYYY-MM-DD` or `[done YYYY-MM-DD]` — no duplicate, and an
  existing emoji done-date is respected rather than doubled up). This is the
  one place an emoji signifier is still recognized at all: un-completing a
  task must clear whatever done-marker sits on the line, including one a
  user typed by hand or that migration hasn't reached yet, so the done-date
  cleanup alone keeps both spellings in its pattern. It is a **cleanup path,
  not a read path** — no other field is recognized this way. Bullet is
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

A **stored** task row (a YAML row kept in a base's own body rather than
scanned from a checkbox line) is toggled by the analogous
`toggleStoredTask`/`setStoredTaskStatus` in `app/src/bases/taskWrite.ts` —
same rules, expressed over the row's fields instead of a line's text, because
there is no line to rewrite. See [bases overview](../bases/overview.md).

### Rescheduling a date field

The calendar's tasks register (see [calendar view](../bases/views/calendar.md))
drags a chip to another day to reschedule it. The write-back,
`setTaskLineDate(line, field, iso)` behind `POST /tasks/reschedule`, rewrites
**one** date field — whichever one placed the task, `scheduled` or `due` —
to the dropped-on day, always in bracket form. It does **not** recognize or
strip an emoji date — in practice it never has to: since the parser doesn't
read an emoji date at all, a task carrying only an emoji date has no `due`/
`scheduled` value, so it is never placed on the calendar in the first place
and there is no chip to drag. Once a line is migrated (automatically or via
`bismuth task migrate`), every date is in bracket form and rescheduling works
as described. Only the ONE field that placed the task is touched; a second
date field on the same line is left exactly as it was.

## Migrating from the emoji syntax

The parser reads bracket fields only, so a vault written before this syntax
existed needs converting, or every date, priority, and recurrence it holds
becomes invisible to the app (still there as literal text, but no longer a
field). There are two ways this happens, sharing the same conversion logic
(`core/src/taskMigrate.ts`, reading through the legacy reader in
`core/src/taskLegacy.ts` — see [History](#history-the-emoji-signifiers)
below):

- **Automatically**, the first time Bismuth opens the vault after this
  feature shipped — no prompt, no dialog. See
  [Automatic migration on vault open](#automatic-migration-on-vault-open).
- **By hand**, with [`bismuth task migrate`](#bismuth-task-migrate) — for
  scripted maintenance, a `--dry-run` preview, or re-running after fixing
  whatever left a note un-migrated the first time.

Both rebuild each convertible line with every field in bracket form, in a
fixed, deterministic order — dates in `due, scheduled, start, done, created,
cancelled` order, then priority, then recurrence:

```markdown
- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week
```

becomes:

```markdown
- [ ] buy milk [due 2026-09-14] [high] [every week]
```

**The gate is per LINE, not per file.** A whole-file pre-filter
(`hasLegacySignifier`) skips a file with no emoji at all, but within a file
that DOES have one, every OTHER line is checked again individually and left
byte-for-byte untouched if it carries no legacy signifier of its own — so a
note holding one un-migrated task beside nine already-bracket ones gets only
that one line rewritten, never a wholesale reformat of lines that were
already correct.

**It always rewrites, and separately reports what didn't round-trip.**
Earlier, a line the conversion couldn't safely reproduce was left in its
original spelling — safe, because the emoji reader still worked forever.
With the reader gone, a skipped line would silently stop being a task the
app understands at all, which is worse than a visibly wrong rewrite. So
every legacy line is rewritten, and `flagged` names the ones where
re-parsing the rebuilt bracket form did not reproduce every field of the
original (status, description, priority, recurrence, tags, all six dates).
In practice the one case that flags is a **calendar-impossible emoji date**
(`📅 2026-02-30`): the old emoji reader accepted it by shape alone, but the
bracket grammar's real-date check rejects it, so it becomes `[due
2026-02-30]` sitting in the description as inert text — the user finally
SEES the typo instead of silently carrying a date that could never match a
real day, and the migration report names the file and line.

**Two lines are deliberately held back, untouched, and NOT flagged —
these are limits by design, not bugs:**

- **A task line inside a fenced code block is left alone.** A fence opener is
  up to three leading spaces then three-or-more `` ` `` or `~` (CommonMark's
  own rule); a note documenting the OLD syntax in an example keeps that
  example intact rather than having it silently rewritten.
- **A 4-space-indented fence is NOT recognized as a fence**, so a task line
  inside a 4-space-indented code block IS migrated. This is deliberate: a
  4-space-indented `- [ ] x` is overwhelmingly a nested subtask, not an
  example inside code, and treating it as a fence would leave real subtasks
  un-migrated by mistake.
- **A line whose signifier sits BOTH inside an inline code span and outside
  it is held back WHOLE, silently.** For example
  `` - [ ] fix the `📅` parser 📅 2026-01-01 `` — the code span quotes the
  glyph itself (documenting the syntax), and a real, convertible field sits
  outside it. Rebuilding this line would rip the code span open around the
  in-span occurrence, so migration skips the whole line instead — which means
  the real field outside the span stays un-migrated too, and this case is
  **not** named in `flagged` (the line never reaches the per-line rewrite at
  all). This is rare in practice — it requires a signifier glyph inside a
  code span on the same line as a real field — but worth knowing if a task's
  date doesn't convert and the line contains backticks.

Other properties, true of both the automatic pass and the manual command:

- **Idempotent** — migrating an already-migrated line returns the identical
  string (`changed: 0` the second time; a vault with nothing left to convert
  changes nothing and takes no snapshot).
- **Line-by-line, not file-wide** — every non-task line (headings, prose,
  blank lines) passes through byte-for-byte untouched, and each line keeps
  its OWN original EOL (a file mixing CRLF and LF keeps every line's own
  terminator).
- **Per-file fault isolation** — one unreadable file (permissions, a broken
  symlink) is skipped and reported; it does not abort the run or leave the
  rest of the vault unmigrated.

### Automatic migration on vault open

Decided behaviour, not a default that might change: **automatic, with a
local git snapshot taken first, and a report afterward** — never a
confirmation dialog. `core/src/taskMigrateRun.ts`'s `runTaskMigration(root)`
runs once, fire-and-forget, right after the vault opens (desktop/dev only —
see below), and its report is served from `GET /tasks/migration`, which
`app/src/App.tsx` polls once on mount (retrying after 2 seconds if the pass
is still running).

The pass, in order:

1. **Scan** every markdown file once, pre-filtered by `hasLegacySignifier`,
   computing the migrated content in memory. Nothing is written yet.
2. **Gate on actual changes, not on the scan finding a signifier.**
   `hasLegacySignifier` also matches a bare `✅` — an ordinary emoji someone
   typed in prose ("shipped it ✅") with no legacy task line anywhere in the
   vault. Keying the run off the scan alone would git-commit a user's whole
   vault to snapshot a rewrite that never happens. The gate is `changed > 0`.
3. **Snapshot** — a local git commit, message `before task syntax
   migration`, vault-only, never pushed (`commitVault`, `core/src/backup.ts`).
   **If the snapshot throws, the WHOLE migration is aborted** — nothing is
   rewritten, and the report says `blocked: true` with the error — because a
   rewrite the user cannot undo is not an acceptable trade for convenience.
4. **Verify** that git actually tracks each file about to be rewritten
   (`.gitignore`d or nested-repo files can't be captured by the snapshot);
   anything git doesn't track is left un-migrated and reported as skipped
   rather than silently overwritten with no undo.
5. **Write**, re-reading each file first to confirm nothing changed since the
   scan (a daemon, another window, or an external sync client could have
   written to it in the meantime); a file that changed underneath the
   migration is left alone and reported as skipped rather than clobbered.

Toasted outcomes (`app/src/App.tsx`), by example:

| Outcome | Toast |
| --- | --- |
| Converted | `Converted 34 task lines in 9 notes to the bracket syntax · snapshot taken` (the `· snapshot taken` suffix is omitted when the vault's git repo was already clean, so no new commit was needed — HEAD is just as recoverable) |
| Blocked (snapshot failed) | `Task syntax could not be converted — a vault snapshot failed, so nothing was changed` |
| Some lines flagged | `2 lines could not be converted — see the console` (plus one `task migration: could not convert <file>:<line> — <text>` console warning per line) |
| Some notes skipped | `3 notes were left un-migrated — see the console` (plus one console warning per file, naming the reason: `not-snapshotted`, `unreadable`, `modified-during-migration`, or `write-failed`) |

- **`BISMUTH_NO_TASK_MIGRATE=1`** skips the whole pass — used by tests, and
  available to anyone who wants their files left exactly alone.
- **Desktop and dev only.** The snapshot shells out to `git`, and there is no
  git on iPad, so a mobile-side migration would be an un-undoable mass
  rewrite with nothing to fall back on — the one thing the snapshot exists to
  prevent. An iPad-only vault is migrated the next time it is opened on a
  desktop.
- **Idempotent by construction, and re-checked on every boot** — after a
  successful run nothing left in the vault carries a signifier that migration
  would act on (what remains — a fenced example, an in-code-span occurrence,
  a stray `✅` in prose — is content the pass deliberately never touches), so
  the next boot's scan finds nothing to do. There is no marker file; the
  vault's own content is the state.

## `bismuth task migrate`

The manual command runs the identical conversion by hand — for scripted
maintenance, previewing with `--dry-run`, or re-running after resolving
whatever left a note un-migrated (a file `git add`-ed since the automatic
pass last ran, say).

```bash
bismuth task migrate --vault <vault>              # rewrites every convertible line
bismuth task migrate --vault <vault> --dry-run     # reports per-file counts, writes nothing
```

Output shape: `{ changed, files: [{ file, changed }], flagged: [{ file, line,
text }], skipped: [{ file, error }] }` — `flagged` and `skipped` carry the
same meanings as the automatic pass (see above); `skipped` here is populated
only by a per-file read/write failure, since the CLI has no git snapshot step
of its own to fail.

## History: the emoji signifiers

Before this syntax existed, Bismuth read the
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/)'s **emoji
signifiers** directly. **That reading is gone.** `core/src/tasks.ts` never
looks for these glyphs; they survive only in `core/src/taskLegacy.ts`, a
migration-only module (see [Migrating from the emoji syntax](#migrating-from-the-emoji-syntax)
above) that nothing else may import — a second reader anywhere else would put
both spellings back in play, which is exactly what this removal undoes. This
section exists so that anyone reading an un-migrated note, an old export, or
an old screenshot can still decode what they're looking at:

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
| 🔁    | recurrence rule (text after it, up to the first `#tag` — see [Recurrence](#recurrence)) | — |

```markdown
- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week
```

is the pre-migration spelling of `- [ ] buy milk [due 2026-09-14] [high]
[every week]` — converting one to the other is exactly what
[migration](#migrating-from-the-emoji-syntax) does.

**An emoji signifier left in a note today is not read, not stripped, and not
special in any way — it is literal description text**, exactly like any
other character the parser doesn't understand. The one exception is the
done-date marker, which toggling still recognizes as a cleanup target (see
[Toggling tasks](#toggling-tasks-completion)) so that un-completing a task
clears a stale hand-typed `✅` instead of leaving the line internally
contradictory.

**Nothing in the app writes emoji any more.** The editor autocomplete
(`app/src/editor/taskComplete.ts`) inserts bracket fields only — Bismuth's
design system rule is "no emoji, ever," and that includes the completion
menu itself, which shows plain labels ("due date", "high priority", …) with
no emoji glyph anywhere. Toggling, setting a status, and recurrence rollover
all write `[done 2026-09-08]`, never `✅ 2026-09-08`.

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
  due?: string;        // ISO date — from [due ...]
  scheduled?: string;  // ISO date — from [scheduled ...]
  start?: string;      // ISO date — from [start ...]
  done?: string;       // ISO date — from [done ...]
  created?: string;    // ISO date — from [created ...]
  cancelled?: string;  // ISO date — from [cancelled ...]
  recurrence?: string; // rule text, e.g. "every week" — from [every ...]
}
```

The date fields are **optional** — only present when a matching bracket field
is in the line. `path` and `line` together identify the line for write-back
(the toggle and reschedule endpoints rely on them, so scoped extraction via
`collectTasksFromPaths` keeps them identical to a full vault scan).

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
[bases overview](../bases/overview.md). A checkbox task scanned this way and a
task **stored** as a row in a base's own body project to the same `Row` shape
downstream (`core/src/bases/taskRow.ts`), so `mode: tasks` on any base view
renders and writes both origins identically — see
[bases overview](../bases/overview.md) for the kind/mode/origin model. If you
have an old ` ```query ` block still holding the legacy `tasks: |- not done /
sort by priority` DSL text, see [the migration note](./query-dsl.md) — it
keeps working un-migrated, and `bismuth base migrate-queries` rewrites it in
place.

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

The pre-migration spelling of the same task —

```markdown
- [ ] submit report #work #q3 🔺 🔁 every weekday 📅 2026-06-10 ⏳ 2026-06-08 🛫 2026-06-05
```

— converts to the bracket form above via
[migration](#migrating-from-the-emoji-syntax), automatically the first time
the vault is opened, or by running `bismuth task migrate` by hand; the
parser itself no longer reads it.

Source: `core/src/taskFields.ts`, `core/src/tasks.ts`, `core/src/taskLegacy.ts`, `core/src/taskMigrate.ts`, `core/src/taskMigrateRun.ts`, `core/src/taskReorder.ts`, `app/src/editor/taskFold.ts`, `app/src/editor/livePreview.ts`, `app/src/editor/taskComplete.ts`, `app/src/bases/taskCardMarkup.ts`, `app/src/bases/taskWrite.ts`, `core/src/bases/taskRow.ts`, `core/src/commands.ts`, `app/src/commands.ts`, `app/src/api.ts`, `app/src/App.tsx`, `core/test/tasks.test.ts`, `core/test/taskFields.test.ts`, `core/test/taskLegacy.test.ts`, `core/test/taskMigrate.test.ts`, `core/test/taskMigrateRun.test.ts`, `app/src/editor/taskComplete.test.ts`, `core/src/dates.ts`, `cli/src/commands/task.ts`
