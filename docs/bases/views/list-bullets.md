# List and Bullets Views

This document covers two closely related but intentionally distinct Bases view kinds: **`list`** and **`bullets`**. Both render rows as a vertical sequence rather than a table grid, but they serve different purposes and have different rendering rules. `list` is a structured, clickable, optionally-grouped view that also handles task rows natively (checkbox items with priority, dates, and recurrence). `bullets` is a plain prose-style `<ul>` that mirrors how a note's own `- item` content looks — no row chrome, no icons, no borders.

---

## List View (`type: list`)

### What It Is

`list` renders each row as a compact horizontal strip: a book icon on the left, a title in the middle (first column), an optional secondary label (second column, rendered dimmed), and an optional right-side value (third column, rendered in small muted text). Rows are separated by thin soft borders. Clicking a row opens that note. When the source is a task query (`source: tasks`), each row renders instead as an interactive checkbox line that matches the editor's own `- [ ]` glyph — no row border, no book icon, full inline markdown in the description.

This is the **default view type for `tasks:` query blocks** in embedded `\`\`\`query` blocks. When a task query block has an unknown or missing `view:`, it falls back to `list`.

### Base File Configuration

```yaml
---
type: base
source: notes where #book
views:
  - type: list
    name: My Books
    groupBy:
      property: note.status
    sort:
      - property: note.title
        direction: ASC
---
```

Minimal shorthand (top-level `view:` folds into the default `views[0]`):

```yaml
---
type: base
view: list
groupBy:
  property: formula.urgency
columns: [Overdue, This week, Later]
---
```

### Column Roles

`ListView` reads `result.columns` (the resolved property-id list computed by the query engine) and uses positional slots:

| Position | Variable | Used for |
|---|---|---|
| `columns[0]` (first) | `firstCol` | Primary title text. Falls back to `file.name` if the resolved value is `null`. |
| `columns[1]` (second) | `authorCol` | Dimmed secondary label appended after an em-dash: `Title — Author`. Only shown when the value is not `null` and not an object. |
| `columns[2]` (third) | `rightCol` | Right-aligned small text (11 px, muted). Rendered via `renderValue`. |

Only the first column is used to determine what text to display as the row title. Extra columns beyond index 2 are silently ignored by the renderer (they are still resolved by the query engine but not displayed).

For **task rows** (rows where `note.line` is a number, `note.status` is a string, and `note.raw` is present — the signature of `taskToRow`), the column-slot logic is bypassed entirely and the task-specific `TaskRow` component renders instead.

### Grouping

When `groupBy` is set, rows are split into named sections. Each non-empty group renders a header bar containing:

- A small filled circle dot (7 px, `currentColor`)
- The group key (uppercase, 10.5 px, letter-spaced)
- A faint row count (`· N`)

The header's text color comes from `groupColor(key)` — this resolves the known status palette (see below) and falls back to `var(--accent)` for unrecognized keys. This means standard status group names get their canonical color automatically without any configuration.

**Group ordering**: when `columns` is set on the view, groups appear in that declared order; data-only groups not in the list are appended sorted by value. Empty declared groups are **omitted** (unlike `kanban`, which keeps them as drop targets).

```yaml
# Explicit group order
views:
  - type: list
    groupBy:
      property: note.bucket
    columns: [Overdue, This week, Later]
    # "Mystery" bucket (not declared) will be appended after "Later"
```

When `groupBy` is absent, `result.groups` has a single group with `key: ""` and the group header is not rendered.

### Status Color Palette (group headers)

`groupColor` from `app/src/ui/StatusDot.tsx` maps lowercase trimmed group keys to CSS variables:

| Key(s) | Color |
|---|---|
| `reading` | `var(--teal)` |
| `to read`, `toread` | `var(--blue)` |
| `finished`, `done`, `complete` | `var(--green)` |
| `abandoned`, `dropped` | `var(--rose)` |
| anything else | `var(--accent)` |

This palette is shared with `Table`, `Kanban`, and `StatusDot`/`StatusText` components.

### Task Row Rendering

When a row is a task row (detected by `isTaskRow(row)` — checks `note.line: number`, `note.status: string`, `"raw" in note`), it renders as a native checkbox line instead of the standard `lrow` strip. The following fields from `row.note` are used:

| Field | Type | Display |
|---|---|---|
| `description` | string | Main task text (falls back to `row.file.name`). Rendered with inline markdown. |
| `status` | `"done"` \| `"in-progress"` \| `"cancelled"` \| anything else | Checkbox glyph state: `done` → filled accent check; `in-progress` → accent-purple border; `cancelled` → dim; `todo` → plain border. |
| `priority` | `"highest"` \| `"high"` \| `"medium"` \| `"low"` \| `"lowest"` \| `"none"` | Priority emoji appended inline (`🔺⏫🔼🔽⏬`). `"none"` or missing → not shown. |
| `start` | string | Start date signifier: `🛫 <value>` |
| `scheduled` | string | Scheduled date: `⏳ <value>` |
| `due` | string | Due date: `📅 <value>`. Highlighted overdue when `due < today()` and status is not `done`. |
| `recurrence` | string | Recurrence expression: `🔁 <value>` |
| `line` | number | The markdown line number in the source file — used by `POST /tasks/toggle` to rewrite the checkbox. |

**Toggling a task**: clicking the checkbox calls `api.toggleTask(file.path, note.line)` and then calls `props.onChange()` (which triggers a refetch) regardless of whether the write succeeded, so the list always reflects disk truth.

**Toggling does not navigate**: `e.stopPropagation()` prevents the click from bubbling to the row's open handler. The full row is still clickable (cursor: text on task rows) — clicking the row body navigates to the note, clicking the checkbox widget only toggles.

### Inline Markdown in Task Descriptions

Task description text is parsed by `renderTaskText`, which handles a subset of inline markdown patterns (in regex priority order):

| Pattern | Rendered as |
|---|---|
| `[[Target]]` or `[[Target\|Alias]]` | Clickable wikilink (fires `bismuth-open` custom event with the `.md` path). Display = alias or last path segment. |
| `[Label](url)` | External `http(s)://` links open in `_blank`; bare paths open in-app via `bismuth-open`. |
| `#tag` (preceded by whitespace or start) | `<span class="taskTag">#tag</span>` (teal). Leading whitespace is preserved. |
| `**bold**` | `<strong>` |
| `*italic*` | `<em>` |

Text between matches is emitted as plain strings. The regex is global with sticky index tracking to avoid double-emitting.

### Open-On-Click

Non-task rows fire `window.dispatchEvent(new CustomEvent("bismuth-open", { detail: row.file.path }))` on click. This is the same mechanism used by wikilinks in the editor and all other note-opening interactions in the app.

### Embedded Query Block Usage

```
\`\`\`query
tasks: not done
view: list
\`\`\`
```

```
\`\`\`query
tasks: not done
from: [[My Project Base]]
view: list
\`\`\`
```

When `view:` is absent and the source is `tasks:`, `list` is the fallback. When `view:` names an unrecognized type and the source is `tasks:`, `list` is also the fallback. (For a `of:`/notes source, the fallback is `table` instead.)

### Full Example: Urgency-Bucketed Task List

```yaml
---
type: base
source: tasks
formulas:
  urgency: 'if(!due, "No date", if(date(due) < today(), "Overdue", if(date(due) <= today() + "7d", "This week", "Later")))'
views:
  - type: list
    name: Do Now
    groupBy:
      property: formula.urgency
    columns: [Overdue, This week, Later, No date]
---
```

This produces four sections (Overdue in red-ish accent, This week and Later in accent, No date in accent), each with a colored dot header and a count. Tasks in the "Overdue" group render with their due date highlighted in an overdue color.

### Gotchas

- **Columns beyond index 2 are not displayed.** The renderer only reads `columns[0]`, `columns[1]`, `columns[2]`. If you need more visible columns, use `table` instead.
- **Task rows bypass column ordering entirely.** The `TaskRow` component reads `row.note` fields directly; `columns` has no effect on which task signifiers appear.
- **`authorCol` (columns[1]) is suppressed for objects.** If a formula returns an array or object, the secondary label is silently hidden (`typeof author !== "object"` guard).
- **Empty declared groups are omitted.** If you declare `columns: [todo, done]` but no rows have `done`, the "done" group header does not appear (contrast with `kanban`, which keeps it as an empty drop target).
- **Group header color requires lowercase key match.** `groupColor("Done")` → `var(--accent)` (miss), `groupColor("done")` → `var(--green)` (hit). The key is `.trim().toLowerCase()` internally, so surrounding whitespace is stripped, but the value itself must be lowercase.

---

## Bullets View (`type: bullets`)

### What It Is

`bullets` is a plain `<ul>` list rendered in the editor font — it looks like the note's own `- item` prose. There is no table chrome: no column headers, no row borders, no per-row icons, no secondary label. Each row becomes a single `<li>` whose content is the first column rendered via `renderValue`. Group keys appear as small bold headings above each `<ul>`. The source comment in the code describes its intended use case: "reading-quote lists where the table UI is overkill."

### Base File Configuration

```yaml
---
type: base
source: notes where #quote
views:
  - type: bullets
    name: Reading Quotes
    groupBy:
      property: note.author
    sort:
      - property: note.author
        direction: ASC
---
```

Minimal (top-level shorthand):

```yaml
---
type: base
view: bullets
---
```

### Column Behavior

`BulletsView` reads only `result.columns[0]` (falls back to `"file.name"`). Every other column is ignored — bullets is a single-column view by design. The value is rendered by `renderValue(col, row)`.

`renderValue` behavior for the first column:

| Value type | Rendered as |
|---|---|
| `null` / `undefined` | `—` (faint em-dash) |
| `Link` object (from `file.asLink()`, `link()`, or link-typed schema) | Clickable `<a>` tag; display = `link.display` or path stem |
| `"file.name"` specifically | Clickable `<a>` that opens the note via `bismuth-open` |
| `Array` | Comma-joined string |
| `boolean` | Checkmark icon if true, empty if false |
| `Date` | ISO date string `YYYY-MM-DD` |
| anything else | `String(v)` |

### Grouping

When `groupBy` is set, each non-empty group renders a `<div class="bulletGroupHead">` heading (bold, 1.05em, full `--fg` color) followed by a `<ul>`. The heading style is plain text — no dot, no count, no color theming. The first group's heading gets `margin-top: 2px` instead of `14px`.

When `groupBy` is absent, a single group with `key: ""` is produced; the heading is suppressed (`Show when={group.key !== ""}`) and the `<ul>` renders directly.

**Group ordering**: same engine rules as `list` — declared `columns` order wins, then data-only keys appended, empty declared groups omitted.

### No Task Row Support

Unlike `ListView`, `BulletsView` does not check `isTaskRow` — task rows render as plain list items using `renderValue`, which will stringify `note.description` or whatever the first column resolves to. For interactive task lists with toggleable checkboxes use `list` instead.

### No `onChange` Prop

`BulletsView` receives `{ result, config }` only — there is no `onChange` callback and no interaction beyond what `renderValue` provides (wikilinks and `file.name` open notes; other values are static text).

### Styling Details

- Container: `padding: 6px 6px 14px`, editor font (`var(--editor-font)`), 15 px base size.
- Group heading: `font-weight: 600`, `font-size: 1.05em`, `color: var(--fg)`, `letter-spacing: -0.01em`, `margin: 14px 0 5px` (first heading: `margin-top: 2px`).
- List: real `<ul>` with `list-style: disc`, `padding-left: 1.5em`.
- Items: `margin: 3px 0`, `line-height: 1.55`. Marker color: `var(--text-muted)`.
- Links: `color: var(--accent)`, no underline; underline on hover.

### When to Use `bullets` vs `list`

| | `bullets` | `list` |
|---|---|---|
| Prose feel, matches editor note style | Yes | No |
| Row click navigates to note | Via `renderValue` for `file.name` / links | Yes, always |
| Grouped headers | Plain bold text, no color | Colored dot + uppercase + count |
| Status color in headers | No | Yes |
| Secondary / right columns | No (first column only) | Yes (up to 3 columns) |
| Task rows with toggleable checkboxes | No | Yes |
| Inline markdown in task descriptions | No | Yes |
| Suitable for notes/quote collections | Yes | Yes |
| Suitable for task lists | No | Yes |

---

## Shared Query Block Defaults

Both views can be targeted from an embedded `\`\`\`query` block using the `view:` key:

```
\`\`\`query
of: [[My Base]]
view: bullets
\`\`\`
```

```
\`\`\`query
tasks: not done
view: list
\`\`\`
```

`list` is the **automatic fallback for task queries** when `view:` is absent or unrecognized. `bullets` has no automatic fallback role — it must be requested explicitly.

---

## Common `ViewConfig` Fields (applicable to both)

Both `list` and `bullets` are valid `ViewConfig.type` values and support the standard `ViewConfig` fields:

| Field | Type | Notes |
|---|---|---|
| `type` | `"list"` \| `"bullets"` | Required |
| `name` | `string` | View tab label |
| `limit` | `number` | Max rows (applied before grouping) |
| `filters` | `FilterNode` | Per-view filter, ANDed with base-level `filters` |
| `sort` | `SortSpec[]` | Sort keys applied in order |
| `groupBy` | `{ property: string; direction?: "ASC" \| "DESC" }` | Groups rows into labeled sections |
| `columns` | `string[]` | For `list`: controls group ORDER (not displayed columns). For `bullets`: ignored (only `columns[0]` from the resolved query columns is used). |
| `source` | `SourceSpec` | Per-view source override (falls back to `BaseConfig.source`, then `{ kind: "base" }`) |
| `order` | `string[]` | Property ids to display — the query engine resolves these into `result.columns` |

Note: `columns` on a `ViewConfig` for non-kanban views like `list` and `bullets` controls **group ordering**, not which data columns appear. To control which data properties are shown and in what order, use `order`.

---

Source: /Users/michaelslain/Documents/dev/bismuth/app/src/bases/ListView.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BulletsView.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/ui/StatusDot.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/renderValue.tsx, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.module.css, /Users/michaelslain/Documents/dev/bismuth/core/test/bases/query.test.ts, /Users/michaelslain/Documents/dev/bismuth/core/test/bases/queryBlock.test.ts, /Users/michaelslain/Documents/dev/bismuth/core/test/bases/parseBaseFile.test.ts
