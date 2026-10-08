# Bases overview

A base is a markdown note whose frontmatter declares `type: base`. It names where rows come from (a `source`), which rows to keep (`filters`), any computed columns (`formulas`) and exactly one view that renders them: a table, board, calendar, chart and so on. The app opens such a note as a live view instead of text.

This page is the map of a base file. To build one from scratch, follow [make your first base](./first-base.md). Agents writing a base start at [authoring bases](./authoring.md).

The smallest base is a note with only the type. It renders every note in the vault as a table:

```markdown
---
type: base
---
```

A fuller one lists the books that are not archived, adds a computed column and averages the page count:

```markdown
---
type: base
source: notes where file.hasTag("book")
filters:
  not:
    - file.hasTag("archived")
formulas:
  length: 'if(pages > 500, "long", "short")'
view: table
order: [file.name, note.author, formula.length, note.pages]
sort:
  - { property: file.name, direction: ASC }
summaries:
  note.pages: Average
---
```

## What keys does a base file have?

Every key sits at the top level of the frontmatter. The base-level keys below shape the rows; every other top-level key is read as a key of the one view.

| Key | Value | Effect |
|---|---|---|
| `type` | `base` | Makes the note a base. Required. |
| `view` | a view kind | How rows render. Defaults to `table`; an unknown kind also renders as `table`. |
| `source` | string or object | Where rows come from: `notes`, `tasks` or `base`. See [sources](./sources.md). |
| `from`, `where`, `ref` | string | Modifiers of a string-form `source`. |
| `filters` | expression or `and`/`or`/`not` tree | Keeps the rows where it is true. See [filters](./filters.md). |
| `formulas` | map of name to expression | Computed columns, read as `formula.<name>`. See [expression syntax](./query-syntax.md). |
| `properties` | map or list | Labels, hiding and declared fields. See [properties](./properties.md). |
| `schema` | map of column to type | Column types used by the row editors (`text`, `date`, `time`, `number`, `checkbox`, `list`, `link`). |
| `categories` | list of `{name, color}` | Declared calendar categories. See [calendar](../calendar/overview.md). |

`name` and `views` are reserved too and are never read as view keys.

## What view kinds are there?

A base's `view` is one of these kinds. Each links to the page that owns its config keys.

| Kind | Shows | Config |
|---|---|---|
| `table` | A spreadsheet grid with resizable columns and footer summaries. The default. | [table](./views/table.md) |
| `cards` | A grid of cards with optional cover images or note bodies. | [cards](./views/cards.md) |
| `list` | A compact list of rows, with checkboxes for tasks. | [list and bullets](./views/list-bullets.md) |
| `bullets` | A plain markdown bullet list. | [list and bullets](./views/list-bullets.md) |
| `kanban` | A board grouped by a property, with drag and drop between columns. | [kanban](./views/kanban.md) |
| `map` | Rows plotted by latitude and longitude. | [map](./views/map.md) |
| `calendar` | Events or tasks on a month, week or day grid. | [calendar](./views/calendar.md) |
| `flashcards` | Spaced-repetition review of front and back fields. | [flashcards](./views/flashcards.md) |
| `bar` | A bar chart of a value per category or time bin. | [charts](./views/charts.md) |
| `line` | A line chart of a value over time. | [charts](./views/charts.md) |
| `stat` | One or more aggregate numbers as tiles. | [charts](./views/charts.md) |
| `heatmap` | A calendar-style grid of daily values. | [charts](./views/charts.md) |

Agents writing a view read the matching `bases/authoring/<kind>.md` page first; [authoring bases](./authoring.md) explains the routing.

## How do I show the same rows in a second view?

A base has exactly one view, written flat: `view: <kind>` plus the view's keys at the top level, beside `filters`, `source` and `formulas`. There is no view name and no per-view `filters` or `source`.

For another view of the same rows, create a second base with `source: base` and `ref: "[[That Base]]"`. `Board.md`:

```markdown
---
type: base
source: notes where file.hasTag("task")
filters: 'note.status != "archived"'
view: kanban
groupBy: status
columns: [todo, doing, done]
---
```

`Task table.md`:

```markdown
---
type: base
source: base
ref: "[[Board]]"
filters: 'note.status != "archived"'
view: table
order: [file.name, note.status, note.due]
sort:
  - { property: note.due, direction: ASC }
---
```

The referencing base receives the referenced base's rows only. Its `filters`, `formulas`, `properties`, `sort`, `groupBy`, `limit`, `columns` and other view keys are not applied, so `Task table` restates the `archived` filter and chooses its own sort. If the referenced base has no `source`, its rows are its own body rows, or every note in the vault when it has none. A cycle (A refs B refs A) resolves to zero rows.

A file with a `views:` list is read through its first entry only: that entry's `type` is the kind, its `filters` combine with the base's, and its `source` replaces the base's. The first write from the app rewrites the file flat. A list with more than one entry cannot be rewritten, so writes fail with `BASE_VIEWS_FORMAT_ERROR` and `bismuth base validate` reports it. Give each extra view its own base as above.

## Three axes: kind, mode, and origin

A base's rendering is the product of three independent choices. Mixing them up is the commonest way to misread a base.

| Axis | Question | Values | Key |
|---|---|---|---|
| Kind | What does it look like? | any kind from the table above | `view` |
| Mode | What are the rows? | `normal` (anything) or `tasks` (every row is a task) | `mode` |
| Origin | Where do the rows come from? | a query over notes, tasks or another base, or rows stored in the base | `source`, or no `source` plus body rows |

`mode: tasks` makes every row render as a task, with a checkbox, status menu, field chips and overdue styling, in any kind. It is independent of `cardContent: tasks`, a cards setting that shows a note's body filtered to its checklist lines. The origin decides where a tick is written back: to the source checkbox line for a scanned task, or to the stored row for a base that owns its tasks.

A kanban board of tasks scanned out of the vault:

```yaml
---
type: base
source: tasks where not resolved
view: kanban
mode: tasks
groupBy: status
---
```

The same board with tasks the base stores itself:

```markdown
---
type: base
view: kanban
mode: tasks
groupBy: status
---

- description: ship the parser
  status: todo
  due: 2026-09-20
  priority: high
- description: fix the flake
  status: done
  done: 2026-09-09
```

The two boards look and behave the same. See [list and bullets](./views/list-bullets.md), [cards](./views/cards.md) and [the calendar view](./views/calendar.md) for what tasks mode adds in each kind, and [tasks](../tasks/syntax.md) for the task line syntax.

## Which view keys do all kinds share?

These keys work in every kind that groups or lists rows. Per-kind keys live on the kind's own page.

| Key | Value | Effect |
|---|---|---|
| `limit` | number | Maximum rows shown. |
| `order` | list of property ids | Columns or fields to show, in order. An explicit `order` shows a property that `properties` marked `hidden`. |
| `sort` | list of `{property, direction}` | Sort keys applied in order; `direction` is `ASC` (default) or `DESC`. A bare string or `{column}` also works. A row missing the property sorts last in either direction. |
| `groupBy` | property id or `{property, direction}` | Groups rows by a property. |
| `columns` | list of group values | Group order. Listed groups come first; a kanban also shows every listed group as a column when it is empty. |
| `summaries` | map of property id to summary name | Footer aggregates. See [functions](./functions.md#which-summaries-can-a-view-show). |
| `mode` | `normal` or `tasks` | The mode axis above. Any other value is ignored. |

A property id is `file.<field>`, `note.<key>` or `formula.<name>`; a bare name such as `status` means `note.status`.

## Where are a base's own rows stored?

A base with a non-empty body stores its own rows there, and uses them when it has no `source`. The body is a YAML list of row objects, one per row:

```markdown
---
type: base
view: calendar
schema: { title: text, date: date }
---

- title: Dentist
  date: 2026-06-03
```

A GFM pipe table body (a header row followed by a `| --- | --- |` line) is read too, with numeric cells read as numbers. Row writes serialize the body as the YAML list. A row's `file.name` is empty because stored rows are not separate notes. Row commands such as `bismuth row update` address a row by its zero-based position; see [the CLI reference](../cli/reference.md).

## What happens when something is wrong?

Several mistakes fall back silently instead of raising an error.

| Mistake | Result |
|---|---|
| Unknown `view` kind | Renders as `table`. `bismuth base validate` reports it. |
| Invalid value for `cardContent`, `mode`, `imageFit`, `aggregate` or `bin` | The key is ignored and the default applies. |
| Unrecognised `source` | Falls back to the base's own rows, or to every note when it has none. |
| No `source` and no body rows | Every note in the vault. Set `source` to narrow it. |
| Body rows and no `source` | The base renders its own rows, not vault notes. |
| Unquoted `from: [[X]]` | Read as a nested list, then rebuilt to `"[[X]]"`. Quote it anyway. |
| Frontmatter that is not valid YAML | The config reads as an empty table base. |
| Mistyped view key | Read as a view key and ignored. Validate does not flag it. |
| `properties.<x>.hidden` with an explicit `order` | The column shows; `order` wins. |
| `sort`, `groupBy` or `summaries` on flashcards, or on a calendar outside tasks mode | Ignored: these are full-pane views with their own field bindings. |

## How it works

`FileView` (`app/src/FileView.tsx`) reads a note through the note-body cache, parses its frontmatter, and routes a note whose `type` is `base` to `BaseView` (`app/src/bases/BaseView.tsx`). It passes the already-read body only when `bodyForPath` proves the text belongs to that path; otherwise `BaseView` reads the file itself.

`BaseView` renders from one of three inputs: a flat query block (`props.view`), a base file (`props.path`, parsed by `parseBaseFile`), or inline query-block config (`props.source`, parsed by `parseBase`). Which source feeds the view is then decided by `activeSpec()`: the base's `source`, else its own rows when it has body rows, else every note. A flat query block with neither `of:` nor `tasks:` gets no rows.

The document (the file read and parsed) and the rows are cached separately, so a source change never re-reads the file. Everything except a base's own rows resolves server-side through `POST /rows`. Both caches are stale-while-revalidate `RowCache` instances (`app/src/bases/rowCache.ts`) invalidated by the SSE server version, and each fetch claims a token so a slow early fetch cannot overwrite a newer result.

`changeAffectsView` (`app/src/bases/changeRelevance.ts`) skips re-resolving when a change cannot affect the view: memory-only changes, and content-only edits to notes the view does not depend on when its filters are purely `file.*`. A scoped source (`from`, `ref`), a non-structural `where` or a property-value filter always re-resolves.

`reconcileViewResult` (`app/src/bases/reconcileRows.ts`) reuses the previous row and group objects when their values are unchanged, so Solid keeps their DOM. A task row is keyed by path plus description, not by line, because completing a task re-sorts the lines below it. Row comparison ignores `mtime`, `ctime` and `size`.

`runView(config, rows, hostThis)` in `core/src/bases/query.ts` computes the grouped, sorted result for every kind except the full-pane ones. `flashcards`, and `calendar` unless its mode is `tasks`, bypass `runView` and render straight from the rows.

### The `Row` model

Every origin projects to one `Row` shape before a view sees it: `taskToRow` for a scanned task line, `normalizeStoredTaskRow` for a stored one.

```ts
interface Row {
  file: FileMeta                     // name, path, folder, ext, size, ctime, mtime, tags, links
  note: Record<string, unknown>      // frontmatter, or the stored row object
  formula: Record<string, unknown>   // filled in by the query engine
  index?: number                     // write-back handle: position in its base file
  derived?: readonly string[]        // write-back handle: note keys a normalizer filled in
}
```

`index` and `derived` are write-back handles, not data, so they sit beside `note`. `POST /row/update` and `POST /row/delete` address a stored row by `index`; a row without one gets no write affordance. A write strips exactly the keys `derived` names, so a computed value such as `resolved` is never saved as a stale column, and a user column with the same name always wins.

`FileMeta.name` is the basename without extension, `path` is vault-relative, `folder` is empty at the root, `tags` have no leading `#`, and `links` are wikilink targets without `.md`, heading or alias.

Source: `core/src/bases/types.ts`, `core/src/bases/parse.ts`, `core/src/bases/flattenViews.ts`, `core/src/bases/sourceSpec.ts`, `core/src/bases/rows.ts`, `core/src/bases/taskRow.ts`, `core/src/bases/query.ts`, `app/src/FileView.tsx`, `app/src/bases/BaseView.tsx`, `app/src/bases/rowCache.ts`, `app/src/bases/changeRelevance.ts`, `app/src/bases/reconcileRows.ts`, `app/src/bases/prefetchedBody.ts`
