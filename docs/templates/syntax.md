# Template Token Syntax

This document is the canonical reference for Bismuth's template token syntax — the `{{...}}` tokens that get expanded when you insert a template (via the template palette / Option+T) or create a daily note. It covers every recognised token (`{{date}}`, `{{time}}`, `{{title}}`, `{{cursor}}`), their optional date/time **offset** modifiers (`+1d`, `-30m`, …) and moment-style **format** modifiers (`:YYYY-MM`, `:h:mm A`, …), the exact `expandTemplate` algorithm (including how unknown/malformed tokens are handled and how the cursor offset is computed), the moment-style format token vocabulary, and the daily-note configuration (`folder`/`fileName`/`template`) that drives `dailyNotePath` and `dailyNoteContent`. Everything here is verified against `core/src/templates.ts`, `core/src/dailyNote.ts`, `core/src/files.ts` and their tests.

## Where templates are used

There are two consumers of template expansion in the codebase, both calling the same pure `expandTemplate(raw, ctx)`:

1. **Template insertion** (`app/src/palette/TemplatePalette.tsx`, Option+T) — a fuzzy picker of the vault's template `.md` files. Selecting one reads the file, calls `expandTemplate(raw, { now: new Date(), title })`, and inserts the result into the last-focused editor with the caret landing at `cursorOffset` (where `{{cursor}}` was). The template list comes from `GET /templates`, which lists `.md` files under the `templates.folder` setting (default `"Templates"` — see `core/src/files.ts` `listTemplates`).
2. **Daily notes** (`core/src/dailyNote.ts`, `POST /daily-note`) — a configured daily-note type produces a filename via `expandTemplate(cfg.fileName, …)` and an initial body via `expandTemplate(templateRaw, …)`. See [Daily notes](#daily-notes) below.

The shared autocomplete catalog `TEMPLATE_TOKENS` (in `core/src/templates.ts`) drives the editor's `{{`-token completion (`app/src/editor/autocomplete.ts`) and the daily-note `fileName` settings field completion (`app/src/editor/settingsComplete.ts`). The catalog and the parser are kept in sync by a test asserting that every catalog token is recognised (i.e. never survives verbatim).

## Token grammar

A token is `{{` … `}}`. The inner content follows this grammar (from `parseToken` in `core/src/templates.ts`):

```
{{ <name> [<offset>] [<format>] }}

<name>   = date | time | title | cursor   (must be the literal prefix)
<offset> = (+|-) <N> <unit>               (date units: d w m y; time units: h m)
<format> = : <moment-style format string> (non-empty)
```

Key parsing rules, verified in code:

- The inner content **must start with** one of the four names: `date`, `time`, `title`, `cursor` (matched by `/^(date|time|title|cursor)/`). Anything else (e.g. `{{foo}}`) is unrecognised → emitted verbatim.
- The **offset** is matched by `/^([+-])(\d+)([a-z])/` immediately after the name. Sign is required (`+` or `-`), amount is one-or-more digits, unit is exactly one lowercase letter.
- The **format** is everything after a `:`, and must be non-empty. `{{date:}}` (colon with empty format) is **malformed** → left verbatim.
- After consuming name + optional offset + optional format, the entire inner string must be consumed. Any leftover characters → `parseToken` returns `null` → the token is emitted verbatim. (E.g. `{{date foo}}`, `{{datex}}` are not recognised because the trailing text is not a valid offset/format.)
- Offset and format may be combined, in that order: `{{date+1w:YYYY-MM-DD}}`.
- `title` and `cursor` take **no** offset or format. Attaching one makes the whole token unparseable (leftover content) → verbatim. Only `date` and `time` honour offset/format.

The token-matching regex is `/\{\{([^}]*(?:\}(?!\})[^}]*)*)\}\}/g`, which captures inner content allowing a lone `}` that is not followed by another `}`.

## Exhaustive token table

The four base tokens (from `TEMPLATE_TOKENS`):

| Token        | Expands to                                              | Default format | Offset support | Format support |
|--------------|--------------------------------------------------------|----------------|----------------|----------------|
| `{{date}}`   | Current date                                            | `YYYY-MM-DD`   | yes (`d w m y`)| yes            |
| `{{time}}`   | Current time                                            | `HH:mm`        | yes (`h m`)    | yes            |
| `{{title}}`  | `ctx.title` verbatim (the note's title)                | n/a            | no             | no             |
| `{{cursor}}` | Empty string; records caret position                   | n/a            | no             | no             |

`TEMPLATE_TOKENS` one-line docs (used in autocomplete):

- `{{date}}` — "Current date (YYYY-MM-DD). Offset/format: `{{date+1d}}`, `{{date:YYYY-MM}}`."
- `{{time}}` — "Current time (HH:mm). Offset/format: `{{time+1h}}`, `{{time:h:mm A}}`."
- `{{title}}` — "The note's title (its filename without .md)."
- `{{cursor}}` — "Where the caret lands after the template is inserted."

### `{{date}}`

Current date, default format `YYYY-MM-DD`. With a fixed clock of local **Sunday May 31, 2026, 14:09:05** (the test clock, `new Date(2026, 4, 31, 14, 9, 5)`):

```
{{date}}            → 2026-05-31
{{date:YYYY/MM/DD}} → 2026/05/31
{{date:dddd, MMMM D}} → Sunday, May 31
{{date:MMMM}}       → May
{{date:MM}}         → 05
```

### `{{time}}`

Current time, default format `HH:mm`. Same test clock (14:09:05):

```
{{time}}            → 14:09
{{time:h:mm A}}     → 2:09 PM
{{time:HH:mm:ss}}   → 14:09:05
```

### `{{title}}`

Expands to `ctx.title` verbatim — no offset/format. In the editor template palette, `title` is the focused note's title. For daily notes, `title` is set to the **filename base** (the expanded `fileName` without `.md`), so `{{title}}` inside a daily-note template echoes the generated filename.

```
{{title}}                       → My Note          (ctx.title = "My Note")
Note: {{title}} created on {{date}}  → Note: My Note created on 2026-05-31
```

### `{{cursor}}`

Expands to the empty string and records a **zero-based character index** in the output (`cursorOffset`), where the caret should land after insertion. Rules (verified in tests):

- The **first** `{{cursor}}` sets `cursorOffset`. Any additional `{{cursor}}` tokens are silently stripped (emit nothing) and do **not** move the offset.
- If there is no `{{cursor}}`, `cursorOffset` defaults to `text.length` (caret at end).

```
a{{cursor}}b              → text "ab",  cursorOffset 1
end{{cursor}}             → text "end", cursorOffset 3 (== text.length)
{{cursor}}x{{cursor}}y    → text "xy",  cursorOffset 0 (first wins, second stripped)
hello                     → text "hello", cursorOffset 5 (no cursor → end)
```

## Offset modifiers (`+N<unit>` / `-N<unit>`)

Only `date` and `time` accept offsets. The offset is applied to a **clone** of `ctx.now` (the original is never mutated) via `applyOffset`.

### Date units

| Unit | Meaning | JS operation                         |
|------|---------|--------------------------------------|
| `d`  | days    | `setDate(getDate() + n)`             |
| `w`  | weeks   | `setDate(getDate() + 7*n)`           |
| `m`  | months  | `setMonth(getMonth() + n)`           |
| `y`  | years   | `setFullYear(getFullYear() + n)`     |

### Time units

| Unit | Meaning | JS operation                         |
|------|---------|--------------------------------------|
| `h`  | hours   | `setHours(getHours() + n)`           |
| `m`  | minutes | `setMinutes(getMinutes() + n)`       |

Note that `m` means **months** for `date` but **minutes** for `time`. The valid unit set depends on the name; an out-of-set unit makes the offset invalid (see gotchas).

Examples (test clock = 2026-05-31 14:09:05):

```
{{date+7d}}   → 2026-06-07   (add 7 days)
{{date-1w}}   → 2026-05-24   (subtract 1 week)
{{date+1y}}   → 2027-05-31   (add 1 year)
{{date+1m}}   → 2026-07-01   (see month-rollover gotcha)
{{time+2h}}   → 16:09        (add 2 hours)
{{time-30m}}  → 13:39        (subtract 30 minutes)
```

### Offset + format together

The format follows the offset (offset first, then `:format`):

```
{{date+1w:YYYY-MM-DD}}  → 2026-06-07
```

## Format modifiers (moment-style)

A `:` after the name (and after any offset) introduces a moment-style format string. Formatting is done by `formatDate`, which scans the pattern **left-to-right, matching the longest known token at each position**. Unrecognised characters in the pattern (separators, spaces, literal text like commas) are copied through verbatim.

The locale is a **fixed en-US** for month/weekday names — there is no localization.

### Full format token vocabulary

Ordered by descending length (longest match wins). Values shown for the test clock 2026-05-31 (Sunday) 14:09:05.

| Token  | Meaning                          | Example output |
|--------|----------------------------------|----------------|
| `YYYY` | 4-digit year (zero-padded to 4)  | `2026`         |
| `YY`   | last 2 digits of year            | `26`           |
| `MMMM` | full month name                  | `May`          |
| `MMM`  | short month name                 | `May`          |
| `MM`   | 2-digit month (01–12)            | `05`           |
| `M`    | month, no padding (1–12)         | `5`            |
| `DD`   | 2-digit day of month (01–31)     | `31`           |
| `D`    | day of month, no padding (1–31)  | `31`           |
| `dddd` | full weekday name                | `Sunday`       |
| `ddd`  | short weekday name               | `Sun`          |
| `HH`   | 2-digit 24-hour (00–23)          | `14`           |
| `H`    | 24-hour, no padding (0–23)       | `14`           |
| `hh`   | 2-digit 12-hour (01–12)          | `02`           |
| `h`    | 12-hour, no padding (1–12)       | `2`            |
| `mm`   | 2-digit minutes (00–59)          | `09`           |
| `m`    | minutes, no padding (0–59)       | `9`            |
| `ss`   | 2-digit seconds (00–59)          | `05`           |
| `s`    | seconds, no padding (0–59)       | `5`            |
| `A`    | uppercase AM/PM                  | `PM`           |
| `a`    | lowercase am/pm                  | `pm`           |

Notes from the implementation:

- **Month names** come from fixed arrays. `MMMM` = January…December; `MMM` = Jan…Dec. (For May both are `May`.)
- **Weekday names**: `dddd` = Sunday…Saturday; `ddd` = Sun…Sat. `getDay()` is used (0 = Sunday).
- **12-hour** values use `getHours() % 12 || 12` (midnight/noon → 12).
- **AM/PM** boundary: `getHours() < 12` → AM/am, otherwise PM/pm.
- **`YYYY`** is `String(getFullYear()).padStart(4, "0")`.
- **Longest-match** means there is no escape syntax for literals: if you want a literal `M` you cannot, since `M` is a token. Plain separators (`-`, `/`, `:`, `,`, spaces, and any char that isn't the start of a known token) pass through unchanged.

### Format examples

```
{{date:YYYY-MM-DD}}    → 2026-05-31
{{date:YYYY/MM/DD}}    → 2026/05/31
{{date:dddd, MMMM D}}  → Sunday, May 31
{{date:MMMM}}          → May
{{date:MM}}            → 05
{{time:h:mm A}}        → 2:09 PM
{{time:HH:mm:ss}}      → 14:09:05
```

The default formats when no `:format` is given: `date` → `YYYY-MM-DD`, `time` → `HH:mm`.

## `expandTemplate` behavior

`expandTemplate(raw: string, ctx: { now: Date; title: string }): { text: string; cursorOffset: number }`.

Algorithm (from `core/src/templates.ts`):

1. Empty input short-circuits: `expandTemplate("", ctx)` → `{ text: "", cursorOffset: 0 }`.
2. The token regex is scanned across the whole input. For each match, the literal text before it is appended, then the token is processed.
3. `parseToken(inner)` is run. If it returns `null` (unknown name, malformed offset/format, leftover content, or empty format after `:`), the **raw matched token** (`{{...}}` literally) is appended.
4. Otherwise:
   - `cursor` → records `cursorOffset` (first only) and emits nothing.
   - `title` → appends `ctx.title`.
   - `date`/`time` → clones `ctx.now`, applies the offset if present (an invalid unit aborts and the raw token is emitted verbatim), then formats with the given or default format.
5. Trailing literal text after the last token is appended.
6. Returns `{ text, cursorOffset }` where `cursorOffset` is the recorded value or `text.length` if no `{{cursor}}` was seen.

Multiple tokens and surrounding text are handled in one pass:

```
expandTemplate("# {{title}}\nCreated: {{date}}\nTime: {{time}}", ctx)
→ "# My Note\nCreated: 2026-05-31\nTime: 14:09"
```

### Unknown / malformed handling

Unrecognised or malformed tokens are emitted **verbatim** (the literal `{{...}}` survives), never dropped:

```
{{foo}}              → {{foo}}            (unknown name)
{{date:}}            → {{date:}}          (empty format after colon)
{{foo}} and {{date}} → {{foo}} and 2026-05-31   (unknown left intact, valid expanded)
```

An **invalid offset unit** for the name (e.g. `{{date+1h}}` — `h` is a time unit, not a date unit; or `{{time+1d}}` — `d` is a date unit, not a time unit) makes `applyOffset` return `null`, and the raw token is emitted verbatim (it is not silently treated as a no-op).

## Daily notes

Daily notes are configured under the `dailyNotes:` list in `settings.yaml`. Each entry registers a `daily-note:<id>` command you can put on the toolbar / use from the palette; pressing it opens today's note for that type, creating it from `template` the first time. The pure computation lives in `core/src/dailyNote.ts`; IO (existence check, reading the template, writing the note) is in `POST /daily-note` (`core/src/server.ts`).

### `DailyNoteConfig`

```ts
interface DailyNoteConfig {
  id: string;        // stable id → forms the command id daily-note:<id>
  label: string;     // command-palette label and default button tooltip
  icon: string;      // Lucide icon name (e.g. "BookOpen") or an emoji
  folder: string;    // vault folder for entries ("" = vault root)
  fileName: string;  // filename via {{...}} tokens, NO .md (e.g. "{{date}} journal")
  template: string;  // vault path to a template .md to pre-fill (optional)
}
```

Schema defaults (`core/src/schema/settingsSchema.ts`) seed a single `journal` type:

```yaml
dailyNotes:
  - id: journal
    label: Journal
    icon: BookOpen
    folder: Journal
    fileName: "{{date}} journal"
    template: Templates/Journal.md
```

How the settings reader (`readDailyNotesFrom` in `core/src/settings.ts`) normalizes entries:

- `id` and `fileName` are **required, non-empty strings**; malformed items (missing either) are dropped.
- Defaults for the rest: `label` → `id`, `icon` → `CalendarDays`, `folder` → `""`, `template` → `""`.
- A missing or non-array `dailyNotes` value falls back to the seeded default; an explicit empty array is honored (no daily notes).

### `dailyNotePath(cfg, now)`

Computes the vault-relative `.md` path. It expands `cfg.fileName` with `{ now, title: "" }`, **trims** the result, appends `.md`, and joins with `folder` (a trailing slash on the folder is stripped; empty folder = vault root).

```ts
const NOON = new Date("2026-05-31T12:00:00"); // local noon, never tz-shifts the date

dailyNotePath({ ...cfg, folder: "Journal",  fileName: "{{date}} journal" }, NOON)
  → "Journal/2026-05-31 journal.md"
dailyNotePath({ ...cfg, folder: "",         fileName: "{{date}} journal" }, NOON)
  → "2026-05-31 journal.md"
dailyNotePath({ ...cfg, folder: "Journal/", fileName: "{{date}} journal" }, NOON)
  → "Journal/2026-05-31 journal.md"   (trailing slash tolerated)
```

The `fileName` field accepts the same `{{...}}` token syntax as templates (offsets/formats included). Note that during `fileName` expansion the `title` context is empty (`""`), so a `{{title}}` token inside `fileName` would expand to nothing — `fileName` is meant for date/time tokens.

### `dailyNoteContent(cfg, now, templateRaw)`

Computes the initial body:

- If `templateRaw === null` → returns `""` (no template).
- Otherwise expands `templateRaw` with `{ now, title: fileBase }`, where `fileBase` is the expanded, trimmed `fileName` (no extension). So inside the daily-note template, `{{title}}` echoes the note's generated filename base.

```ts
dailyNoteContent(cfg, NOON, null) → ""
dailyNoteContent({ ...cfg, fileName: "{{date}} journal" }, NOON, "# {{title}}\n{{date}}\n")
  → "# 2026-05-31 journal\n2026-05-31\n"
```

### `POST /daily-note` flow

From `core/src/server.ts`:

1. Look up the `DailyNoteConfig` by `id` (400 if unknown).
2. `now = new Date()`; `path = dailyNotePath(config, now)`.
3. If the file already exists → return `{ path, created: false }` (does not overwrite).
4. Else, if `config.template` is set **and that file exists**, read it as `templateRaw`; otherwise `templateRaw = null`.
5. Write `dailyNoteContent(config, now, templateRaw)` to `path`, return `{ path, created: true }`.

So a missing/blank `template`, or a `template` path that doesn't exist, yields an empty new note (no error).

## Template files & the templates folder

- `GET /templates` (server) lists `.md` files under the `templates.folder` setting (default `"Templates"`) via `listTemplates(root, folder)`.
- `listTemplates` (`core/src/files.ts`) recursively walks the folder, **skips dotfiles**, includes only `*.md`, strips the `.md` from `name`, and returns `{ name, path }` entries sorted by `path`. A missing folder returns `[]`.
- The template palette (Option+T) reads the selected template's raw text and runs `expandTemplate` with the current time and the focused note's title, then inserts at the caret (landing where `{{cursor}}` was).

## Gotchas & edge cases

- **`{{date+1m}}` month rollover**: from May 31, `setMonth(getMonth()+1)` lands on June 31, which JS rolls over to **July 1** (`2026-07-01`). This is native JS `setMonth` rollover, not special handling. Same caveat applies to any `+Nm` / `+Ny` on a day that doesn't exist in the target month (e.g. Jan 31 + 1 month).
- **`m` is overloaded**: `m` = months for `{{date}}`, minutes for `{{time}}`. There is no minutes unit for `date`, no months unit for `time`.
- **Invalid unit ≠ no-op**: an offset whose unit isn't valid for the name (e.g. `{{date+1h}}`, `{{time+1d}}`) leaves the whole token verbatim.
- **Empty format is malformed**: `{{date:}}` survives verbatim; a colon must be followed by a non-empty format string.
- **`title`/`cursor` reject modifiers**: `{{title+1d}}` or `{{cursor:YYYY}}` won't parse (leftover/invalid content) → verbatim.
- **No literal escaping in formats**: every recognised letter token is always interpreted; you can't emit a literal `D`, `M`, `Y`, `H`, `h`, `m`, `s`, `A`, `a`, or `d` inside a `:format`. Use other separators around them.
- **Fixed en-US locale**: month/weekday names are hard-coded English; there is no locale setting.
- **`fileName` is trimmed**: leading/trailing whitespace from `fileName` expansion is stripped before the `.md` is appended (`dailyNotePath`).
- **`fileName` has no `title`**: `{{title}}` in `fileName` expands to empty (the path computation uses `title: ""`); only the *body* template gets `title = fileBase`.
- **Unknown daily-note id → 400**; **existing daily note → not overwritten** (`created: false`); **missing/absent template → empty body**.
- **Day-precision tz note**: tests use a local-noon `Date` (`2026-05-31T12:00:00`) so the date never shifts across a timezone boundary; live use calls `new Date()` (local time), so the produced date/time reflect the server's local clock.

## Related docs

- [Daily notes configuration](#daily-notes) (if present) — the `dailyNotes:` settings list and toolbar wiring.
- [Settings schema](../settings/reference.md) — the `templates.folder` and `dailyNotes` schema entries.
- [Commands & toolbar](../settings/toolbar-commands.md) — how `daily-note:<id>` commands surface on the toolbar.

Source: core/src/templates.ts, core/src/dailyNote.ts, core/src/files.ts, core/test/templates.test.ts, core/test/dailyNote.test.ts, core/src/server.ts, core/src/settings.ts, core/src/schema/settingsSchema.ts, app/src/palette/TemplatePalette.tsx, app/src/editor/autocomplete.ts
