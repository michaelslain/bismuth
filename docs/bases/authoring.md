# Authoring Bismuth bases

> **When to read this:** every time you create, edit or debug a Bismuth base — a `type: base` markdown note whose frontmatter declares a source, filters/formulas and one view over the vault — or a ` ```query ` block in a note. This page is what every kind shares; then read **one** page for the kind you are writing, `bases/authoring/<kind>.md` (`bismuth_docs_read {path: "bases/authoring/kanban.md"}`). Every kind page has the same three sections — `## Working example`, `## Config keys`, `## Failure modes` — so `section` can fetch just one.

**Jump to:** [create](#create-a-base) · [edit](#edit-an-existing-base) · [debug](#debug-a-base) · [query blocks](#query-blocks) · [gotchas](#cross-cutting-gotchas-apply-to-every-kind)

## The model

A **base** is an ordinary `.md` file with `type: base` in its YAML frontmatter — there is **no `.base` extension**. The frontmatter *is* the config: `source` says where rows come from (vault notes, checkbox tasks, or another base), `filters`/`formulas` shape and compute over those rows, and `view: <kind>` (one of the 12 kinds below) picks how they render, with that kind's own keys alongside at the top level. A minimal `---\ntype: base\n---` alone renders every vault note as a table — the safe default.

## One base, one view

A base has exactly ONE view. Write it flat: `type: base`, `view: <kind>` (the kind key is `view`, never `type`), and every view key (`sort`, `groupBy`, `order`, `columns`, `limit`, `x`, `y`, `mode`, ...) at the top level beside the base keys `filters`, `source`, `formulas`, `properties`. There is no view name and no per-view `filters`/`source`.

For another view of the same rows, make a second base file that composes the first:

```yaml
# Board.md
---
type: base
source: notes where file.hasTag("book")
view: kanban
groupBy:
  property: note.status
---
```

```yaml
# Book Table.md
---
type: base
source: base
ref: "[[Board]]"
view: table
order: [note.title, note.status]
---
```

Composition semantics: the referenced base contributes its ROWS ONLY (its own `source` rows, or its inline table rows if it declares none). Its `filters`, `formulas`, `properties`, sort, group and limit are NOT applied, so restate any filter you want in the composing base. Cycles resolve to zero rows. A referenced base with no `source:` and no inline table rows resolves to EVERY vault note, not zero; `source: base` without a `ref:` resolves to zero rows.

## Filters, formulas, properties

Three base-level keys shape the rows. Reference: `docs/bases/filters.md`, `docs/bases/functions.md`, `docs/bases/properties.md`.

**`filters`** — one expression string, or an `and`/`or`/`not` tree whose values are lists of expression strings. `not` passes only when EVERY child fails. A filter that fails to parse acts as `false` (zero rows, no error), so run `bismuth base validate`.

```yaml
filters:
  and:
    - file.hasTag("book")
    - note.rating >= 4
    - file.inFolder("reading")
```

**`formulas`** — name to expression string, read as `formula.<name>`. A formula column appears only when listed in `order` (never auto-derived).

```yaml
formulas:
  ppu: "note.price / note.units"
order: [file.name, note.price, formula.ppu]
```

**`properties`** — map form adds metadata over auto-derived properties; list form DECLARES the base's own property set (bare names, or entries with `name`, `type`, `options`, `default`, `hidden`, `displayName`):

```yaml
properties:
  - status
  - name: priority
    type: number
    default: 1
  - name: worktree
    displayName: Worktree
```


Legacy `views:` lists still read (first entry only; extra entries are ignored) and are flattened on the app's first write. Do not author them.

## Which view kind to use

| If you want to show... | Use |
|---|---|
| Many rows with several properties as a spreadsheet grid — the default/fallback for browsing and scanning | `table` |
| Rows with a visual identity (book covers, images) or an inline-editable Google-Keep-style note body/checklist | `cards` |
| A compact clickable list (title + up to 2 more fields) — this is the automatic fallback for a `tasks:` query | `list` |
| A plain prose-style bullet list of one field, no table chrome (quotes, one-liners) | `bullets` |
| One field bucketed into a handful of distinct values you drag rows between (a status/stage board) | `kanban` |
| Rows with `lat`/`lng` coordinates plotted on a world map | `map` |
| A date field (+ optional time/recurrence) on a month/week/day grid | `calendar` |
| Front/back Q&A pairs reviewed with spaced repetition | `flashcards` |
| A category or time axis vs. a numeric value, compared as bars | `bar` |
| A numeric value over time, read as a trend | `line` |
| A single aggregated number (sum/avg/count) as one big tile — no breakdown | `stat` |
| Daily activity over a long span (a year), as a GitHub-style contribution grid | `heatmap` |

## Create a base

1. **Pick a kind** from the table above.
2. **Read `bases/authoring/<kind>.md`** for that kind's exact keys, a working example and its failure modes. Do not guess a key name from memory or from another kind's shape.
3. **Write the note**: any path and name, `type: base`, `source:` unless you want the whole vault, `view: <kind>`, and that kind's keys at the top level. Or scaffold it:
   ```
   bismuth base create <path> --view <kind> [--source <spec>] [--group-by <property>] [--lat <property>] [--lng <property>] [--x <property>]
   ```
   It always writes `source: notes` unless `--source` is given, so delete that line for an own-rows base (calendar, inline table rows). Its result lists any `missing` key the kind still needs (kanban `groupBy`, map `lat`/`lng`, chart `x`).
4. **Validate**: `bismuth base validate <path>`. It catches:
   - a bad `view:` kind (which the app would otherwise quietly render as `table`)
   - a legacy `views:` list with more than one entry
   - an expression truncated by a YAML comment — a space then `#` inside an unquoted scalar, e.g. `filters: tags.contains(" #book")`; quote the whole value
   - an unresolvable `source`, and `filters`, `formulas` and `stats` that fail to parse
   - a `taskFile` outside the `from:` scope, and invalid `properties` defaults
5. **Render it**: `bismuth base render <path>` previews the rows headlessly. Validate does **not** catch a typo'd view key (any top-level key outside the base-level set is read as a view key) or an invalid enum value (`aggregate`, `bin`, `mode`, `cardContent`, `imageFit`, `calendarContent`); both silently fall back to the default. Check the render, especially that `source:` produced the rows you meant.

## Edit an existing base

1. **Read it first**: open the file, or `bismuth base read <path>` for the parsed config. Never rewrite the frontmatter from memory.
2. **Change only the keys you mean to.** The app writes some keys back into the base itself, and a hand rewrite that drops them throws away the user's arrangement:

   | kind | keys the app writes into the base |
   |---|---|
   | `table` | `order` (dragged column order), `columnWidths` |
   | `kanban` | `columns` (column order), `groupColors` |
   | `bar` / `line` / `stat` / `heatmap` | `x`, `y`, `aggregate`, `bin` (the chart pickers) |
   | `calendar` | `googleCalendarId`, `googleCalendarSync` |
   | any | `properties` |

   Kanban card order is NOT here: it lives in each card note's own frontmatter.
3. **Switching `view:` to another kind**: read the new kind's page, add its required keys, and **delete the old kind's keys**. Leftovers do not error — every unknown top-level key is read as a view key — so they just sit there, and one the new kind also reads keeps applying.
4. **A legacy `views:` list**: one entry is flattened on the app's next write. More than one entry makes every write fail; move each extra view into its own base with `source: base` + `ref:` (see [One base, one view](#one-base-one-view)), then remove it from `views:`.
5. **Validate and render** as in steps 4–5 of [create](#create-a-base).

## Debug a base

| symptom | likely cause | confirm |
|---|---|---|
| zero rows | a filter that fails to parse acts as `false`; `where: "#book"` is a parse error; `source: base` with no `ref:`; a composition cycle | `bismuth base validate <path>` |
| zero rows from a tag filter | `file.hasTag("book")` matches the exact tag only, not `book/x` | list the subtags: `file.hasTag("book", "book/x")` |
| the whole vault shows | an unquoted `#tag` is a YAML comment (`source: notes where #book` = every note); `notes where "#book"` is a non-empty string, true for every note; a typo'd `source` silently falls back to `notes` (or to the base's own rows) | `bismuth base read <path>` and look at `source` |
| a composed base ignores the other base's filters | `source: base` + `ref:` takes the referenced base's ROWS only, never its filters, formulas, sort or limit | restate the filters in the composing base |
| it renders as a table | the `view:` kind is invalid and was downgraded | `bismuth base validate <path>` |
| a key does nothing | a typo'd view key, or an invalid enum value — both silently use the default | `bismuth base render <path>` and compare the config |
| a formula column is missing | a formula appears only when listed in `order` | add `formula.<name>` to `order` |
| the app cannot save changes | a legacy `views:` list with more than one entry | `bismuth base validate <path>` |
| something specific to one kind (a hint instead of a board, a `—` tile, an empty map) | that kind's own rules | `## Failure modes` in `bases/authoring/<kind>.md` |

## Query blocks

A ` ```query ` fence is the **only** embedded block — there is no ` ```base `, ` ```view ` or ` ```tasks `. Its body is one of two forms:

- **Flat query spec** — `of: [[Base]]` or bare `tasks:`, plus `from:`, `view:`, `where:`, `sort:`, `group:`, `limit:`. Write task queries in the modern form:
  ```query
  tasks:
  from: [[Projects]]
  where: !note.resolved && note.priority == "high"
  sort: note.due
  ```
- **Full inline base config** — the moment the body declares any of `filters:`, `formulas:`, `properties:`, `schema:` or `source:` (or a legacy `views:`), the WHOLE block is parsed as a base's frontmatter instead, and the flat keys above stop meaning anything. Do not mix the two.

A legacy `tasks: not done` (Tasks-DSL text) still reads, but do not author it; `bismuth base migrate-queries [--dry-run]` rewrites old blocks. Full reference: `docs/bases/query-block.md`.

## Cross-cutting gotchas (apply to every kind)

- **`source:` accepts a string or an object** — `source: notes where file.hasTag("book")` and `source: { kind: notes, where: 'file.hasTag("book")' }` are equivalent (`normalizeSource()` coerces both). A bare `#tag` is not a filter: unquoted it is a YAML comment (`source: notes where #book` silently becomes the whole vault); inside the string form (`notes where "#book"`) it is a non-empty string, true for every note; as `where: "#book"` it is a parse error (zero rows). Write `file.hasTag("book")` — no `#`, exact tag only (not `book/x`). An unrecognized `source` (bad `kind`, a typo) doesn't error — it silently becomes `undefined`, and the caller falls back to `{ kind: "notes" }` (whole vault) or `{ kind: "base" }` (own body rows), which is rarely what you wanted. Double-check `source:` renders the row set you expect.
- **A base referenced by `from:` resolves its OWN source recursively.** `from: "[[Keep]]"` doesn't just intersect against Keep's static rows — it re-runs Keep's declared `source` (which may itself be `notes`/`tasks`/another `base`). This composition is cycle-guarded (a config loop or a symlink loop returns `[]`, never throws), but it means changing an upstream base's `source:` can silently change what every base composing it shows.

Full reference (routing, caching, the complete `BaseConfig`/`ViewConfig` shape, worked examples): `docs/bases/overview.md`. Sources & composition: `docs/bases/sources.md`. The `\`\`\`query` block: `docs/bases/query-block.md`.
