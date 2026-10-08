# Authoring Bismuth bases

Read this page every time you create, edit or debug a Bismuth base: a `.base.jsonl` file, or a `type: base` markdown note, whose config declares a source, filters, formulas and one view over the vault, or a ` ```query ` block in a note. It covers what every view kind shares. Then read one page for the kind you are writing, `bases/authoring/<kind>.md` (for example `bismuth_docs_read {path: "bases/authoring/kanban.md"}`). Each kind page has the same three sections, `## Working example`, `## Config keys` and `## Failure modes`, so you can fetch just one.

## The model

A base is one file in one of two formats, told apart by content: a JSON Lines file (`<name>.base.jsonl`, the format `bismuth base create` and the app write) or a markdown note with `type: base` in its YAML frontmatter. The config is line 1 of a JSONL base, or the frontmatter of a markdown base; the keys are the same flat set in both. `source` says where rows come from (vault notes, checkbox tasks or another base), `filters` and `formulas` shape the rows, and `view: <kind>` picks how they render, with that kind's keys beside it at the top level. A config holding only `type: base` renders every vault note as a table. [Bases overview](./overview.md) owns the format; the YAML examples on this page and on the kind pages show the config keys, and a JSONL base stores the same keys as one JSON object.

## Write a JSONL base

A JSONL base is a text file where line 1 is the config as one JSON object and every later line is one row object. Prefer a command to hand-editing the file.

```bash
bismuth base create Books --view table --source 'notes where file.hasTag("book")'
bismuth prop set Books.base.jsonl groupBy status
bismuth row add Library --json '{"title":"Capital","rating":4}'
```

`base create <name>` writes `<name>.base.jsonl`; give an explicit `.md` path to get a markdown base. `prop set` and `prop delete` change only line 1 and leave every row byte-identical, and `row add`, `row update`, `row delete` and `row reorder` change only the row lines they touch. The `base` and `row` subcommands accept a base name without an extension and use `<name>.base.jsonl` when it exists, otherwise `<name>.md`.

If you write the file yourself, keep to these rules:

1. Line 1 is a single-line JSON object that includes `"type":"base"`. It is JSON, not YAML, and it does not wrap across lines.
2. Each later line is one complete JSON object, a row's properties. Blank lines are ignored.
3. A base with a recognised `source:` reads that source's rows, not the rows in its own file. Omit `source:` for a base that owns its rows.
4. Validate afterwards with `bismuth base validate <path>`.

A line that is not a JSON object is skipped without an error, so a malformed row disappears from the view silently. If line 1 does not parse as an object, the file has no config and is not recognised as a base. Check the row count with `bismuth base read <path>`.

## One base, one view

A base has exactly one view. Write it flat: `type: base`, `view: <kind>` (the kind key is `view`, never `type`), and every view key (`sort`, `groupBy`, `order`, `columns`, `limit`, `x`, `y`, `mode` and the rest) at the top level beside the base keys `filters`, `source`, `formulas` and `properties`. There is no view name and no per-view `filters` or `source`.

For another view of the same rows, make a second base that composes the first.

```json
{"type":"base","source":"notes where file.hasTag(\"book\")","view":"kanban","groupBy":{"property":"note.status"}}
```

Saved as `Board.base.jsonl`. A second base, `Book Table.base.jsonl`, composes it:

```json
{"type":"base","source":"base","ref":"[[Board]]","view":"table","order":["note.title","note.status"]}
```

The referenced base contributes its rows only: its own `source` rows, or its inline table rows when it declares no source. Its `filters`, `formulas`, `properties`, sort, group and limit are not applied, so restate any filter you want in the composing base. A cycle resolves to zero rows, and so does `source: base` without a `ref:`. A referenced base with no `source:` and no inline rows resolves to every vault note.

## Filters, formulas, properties

Three base-level keys shape the rows. References: [`docs/bases/filters.md`](./filters.md), [`docs/bases/functions.md`](./functions.md), [`docs/bases/properties.md`](./properties.md), and the expression grammar in [`docs/bases/query-syntax.md`](./query-syntax.md).

`filters` is one expression string, or an `and`/`or`/`not` tree whose values are lists of expressions. `not` passes only when every child fails. A filter that fails to parse counts as false, so you get zero rows and no error. Run `bismuth base validate`.

```yaml
filters:
  and:
    - file.hasTag("book")
    - note.rating >= 4
    - file.inFolder("reading")
```

`formulas` maps a name to an expression string, read as `formula.<name>`. A formula column appears only when listed in `order`; formulas are never added to the columns automatically.

```yaml
formulas:
  ppu: "note.price / note.units"
order: [file.name, note.price, formula.ppu]
```

`properties` as a map adds labels and hide flags over the auto-derived properties. As a list it declares the base's own property set, with bare names or entries holding `name`, `type`, `options`, `default`, `hidden` and `displayName`:

```yaml
properties:
  - status
  - name: priority
    type: number
    default: 1
  - name: worktree
    displayName: Worktree
```

A `views:` list in an existing file is read through its first entry only and is flattened on the app's next write. Do not author one.

## Which view kind to use

| If you want to show... | Use |
|---|---|
| Many rows with several properties as a spreadsheet grid; the default for browsing | `table` |
| Rows with a visual identity (covers, images) or an editable note body or checklist | `cards` |
| A compact clickable list (title plus up to two fields); the default for a `tasks:` query | `list` |
| A plain bullet list of one field, with no table chrome (quotes, one-liners) | `bullets` |
| One field bucketed into a few values that you drag rows between (a status board) | `kanban` |
| Rows with `lat` and `lng` plotted on a map | `map` |
| A date field, with optional time and recurrence, on a month, week or day grid | `calendar` |
| Front and back pairs reviewed with spaced repetition | `flashcards` |
| A category or time axis against a numeric value, as bars | `bar` |
| A numeric value over time, as a trend | `line` |
| One aggregated number (sum, average, count) as a tile | `stat` |
| Daily activity over a long span, as a contribution grid | `heatmap` |

## Create a base

1. Pick a kind from the table above.
2. Read `bases/authoring/<kind>.md` for that kind's keys, a working example and its failure modes. Do not guess a key name from memory or from another kind's shape.
3. Write the base: any path and name, `type: base`, a `source:` unless you want the whole vault, `view: <kind>`, and that kind's keys at the top level. Or scaffold it:
   ```
   bismuth base create <path> --view <kind> [--source <spec>] [--group-by <property>] [--lat <property>] [--lng <property>] [--x <property>]
   ```
   It writes `<path>.base.jsonl` (an explicit `.md` path makes a markdown base) with `source: notes` unless `--source` is given, so delete that key with `bismuth prop delete` for a base that owns its rows (calendar, inline table rows). Its result lists any `missing` key the kind still needs: kanban `groupBy`, map `lat` and `lng`, chart `x`.
4. Validate with `bismuth base validate <path>`. It prints `{"ok":true,"errors":[]}` and exits 0 when the base is sound; otherwise it lists each problem and exits 1. It catches:
   - an invalid `view:` kind, which the app would render as `table`
   - a `views:` list with more than one entry
   - an expression truncated by a YAML comment (a space then `#` inside an unquoted value, such as `filters: tags.contains(" #book")`); quote the whole value
   - an unresolvable `source`, and `filters`, `formulas` and `stats` that fail to parse
   - a `taskFile` outside the `from:` scope, and invalid `properties` defaults
5. Render with `bismuth base render <path>` to preview the rows headlessly. Validate does not catch a mistyped view key (any top-level key outside the base-level set is read as a view key) or an invalid enum value (`aggregate`, `bin`, `mode`, `cardContent`, `imageFit`, `calendarContent`); both silently fall back to the default. Check the rendered rows, and check that `source:` produced the rows you meant.

## Edit an existing base

1. Read it first: open the file, or run `bismuth base read <path>` for the parsed config and rows. Do not rewrite the config from memory.
2. Change only the keys you mean to, with `bismuth prop set <path> <key> <value>` (the value is parsed as JSON, else read as a string) or `bismuth prop delete <path> <key>`; on a JSONL base they rewrite line 1 only. Edit rows with `bismuth row add`, `bismuth row update`, `bismuth row delete` and `bismuth row reorder`. The app writes some keys back into the base, and a rewrite that drops them throws away the user's arrangement:

   | kind | keys the app writes into the base |
   |---|---|
   | `table` | `order` (dragged column order), `columnWidths` |
   | `kanban` | `columns` (column order), `groupColors` |
   | `bar`, `line`, `stat`, `heatmap` | `x`, `y`, `aggregate`, `bin` (the chart pickers) |
   | `calendar` | `googleCalendarId`, `googleCalendarSync` |
   | any | `properties` |

   Kanban card order is not here: it lives in each card note's own frontmatter.
3. When you switch `view:` to another kind, read the new kind's page, add its required keys, and delete the old kind's keys. Leftovers raise no error, because every unknown top-level key is read as a view key, so they sit there, and one the new kind also reads keeps applying.
4. A `views:` list with one entry is flattened on the app's next write. With more than one entry every write fails; move each extra view into its own base with `source: base` and `ref:` (see [One base, one view](#one-base-one-view)), then remove it from `views:`.
5. Validate and render as in steps 4 and 5 of [Create a base](#create-a-base).

## Debug a base

| symptom | likely cause | confirm |
|---|---|---|
| zero rows | a filter that fails to parse counts as false; `where: "#book"` is a parse error; `source: base` with no `ref:`; a composition cycle | `bismuth base validate <path>` |
| zero rows from a tag filter | `file.hasTag("book")` matches the exact tag only, not `book/x` | list the subtags: `file.hasTag("book", "book/x")` |
| the whole vault shows | an unquoted `#tag` is a YAML comment (`source: notes where #book` is every note); `notes where "#book"` is a non-empty string, true for every note; a mistyped `source` falls back to `notes` or the base's own rows | `bismuth base read <path>` and look at `source` |
| a composed base ignores the other base's filters | `source: base` with `ref:` takes the referenced base's rows only | restate the filters in the composing base |
| it renders as a table | the `view:` kind is invalid and was downgraded | `bismuth base validate <path>` |
| a key does nothing | a mistyped view key or an invalid enum value; both use the default silently | `bismuth base render <path>` and compare the config |
| a formula column is missing | a formula appears only when listed in `order` | add `formula.<name>` to `order` |
| the app cannot save changes | a `views:` list with more than one entry | `bismuth base validate <path>` |
| something specific to one kind (a hint instead of a board, a `—` tile, an empty map) | that kind's own rules | `## Failure modes` in `bases/authoring/<kind>.md` |

## Query blocks

A ` ```query ` fence is the only embedded block; there is no ` ```base `, ` ```view ` or ` ```tasks `. Its body takes one of two forms, and one config key flips the whole block to the second.

- A flat query spec is `of: [[Base]]` or a bare `tasks:`, plus `from:`, `view:`, `where:`, `sort:`, `group:` and `limit:`. Write task queries with `where:` and `sort:`:
  ```query
  tasks:
  from: [[Projects]]
  where: !note.resolved && note.priority == "high"
  sort: note.due
  ```
- A full inline base config applies the moment the body declares any of `filters:`, `formulas:`, `properties:`, `schema:`, `source:` or `views:`. The whole block is then parsed as a base's frontmatter and the flat keys above stop meaning anything. Do not mix the two.

A `tasks:` value holding Tasks-style text such as `tasks: not done` is translated when read, but write the `where:` form. `bismuth base migrate-queries [--dry-run]` rewrites old blocks. Full reference: [`docs/bases/query-block.md`](./query-block.md).

## Cross-cutting gotchas

- `source:` accepts a string or an object. `source: notes where file.hasTag("book")` and `source: { kind: notes, where: 'file.hasTag("book")' }` are equivalent. A bare `#tag` is not a filter: unquoted it is a YAML comment (`source: notes where #book` becomes the whole vault); inside the string form (`notes where "#book"`) it is a non-empty string, true for every note; as `where: "#book"` it is a parse error and gives zero rows. Write `file.hasTag("book")`, with no `#`, matching the exact tag only (not `book/x`).
- An unrecognised `source` (a bad `kind`, a typo) raises no error. It is ignored, and the base falls back to every vault note, or to its own body rows when it has them, which is rarely what you wanted. Check that `source:` renders the rows you expect.
- A `[[X]]` in `from:`, `ref:` or `of:` finds its base by one rule: an exact path first (`X.base.jsonl`, then `X.md`), then by name, where the path with the fewest segments wins and `.base.jsonl` beats `.md` on a tie. A clicked `[[X]]` in a note resolves the same way. Details: [Base sources](./sources.md#how-are-wikilinks-in-from-and-ref-found).
- A base named by `from:` resolves its own source recursively. `from: "[[Keep]]"` re-runs Keep's declared `source`, which may itself be notes, tasks or another base. A cycle or symlink loop returns no rows instead of failing, and changing an upstream base's `source:` changes what every base composing it shows.

Full reference (the complete `BaseConfig` and view-key shape, worked examples): [`docs/bases/overview.md`](./overview.md). Sources and composition: [`docs/bases/sources.md`](./sources.md). First base, step by step: [`docs/bases/first-base.md`](./first-base.md).
