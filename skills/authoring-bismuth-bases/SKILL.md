---
name: authoring-bismuth-bases
description: Use when creating, editing, or debugging a Bismuth "base" — a `type: base` markdown note whose frontmatter declares filters/formulas and one view over the vault. Covers picking the right view kind (table, cards, list, bullets, kanban, map, calendar, flashcards, bar, line, stat, heatmap) and writing frontmatter that actually matches the code.
---

# Authoring Bismuth bases

## The model

A **base** is an ordinary `.md` file with `type: base` in its YAML frontmatter — there is **no `.base` extension**. The frontmatter *is* the config: `source` says where rows come from (vault notes, checkbox tasks, or another base), `filters`/`formulas` shape and compute over those rows, and `view: <kind>` (one of the 12 kinds below) picks how they render, with that kind's own keys alongside at the top level. A minimal `---\ntype: base\n---` alone renders every vault note as a table — the safe default.

## One base, one view

A base has exactly ONE view. Write it flat: `type: base`, `view: <kind>` (the kind key is `view`, never `type`), and every view key (`sort`, `groupBy`, `order`, `columns`, `limit`, `x`, `y`, `mode`, ...) at the top level beside the base keys `filters`, `source`, `formulas`, `properties`. There is no view name and no per-view `filters`/`source`.

For another view of the same rows, make a second base file that composes the first:

```yaml
# Board.md
---
type: base
source: notes where "#book"
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

Composition semantics: the referenced base contributes its ROWS ONLY (its own `source` rows, or its inline table rows if it declares none). Its `filters`, `formulas`, `properties`, sort, group and limit are NOT applied, so restate any filter you want in the composing base. Cycles resolve to zero rows.

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

### `stat` view: declared metrics (`stats:`)

A `stat` view renders one tile per entry in `stats:` — each entry is a bare string (label = value = that string) or `{ label?, value }` with `value` a metric expression: `count()`, `count(status == "done")`, `sum(priority)`, `avg(price)`, `sum(price) / sum(units)`. A bare property name outside `sum`/`avg`/`min`/`max`/`count` fails to parse — a metric has no single row to evaluate it against. With no `stats:` declared, the view synthesizes one metric from its own `x`/`y`/`aggregate`. Full semantics + the KaTeX/period-split/sparkline rendering: `docs/bases/views/charts.md`.

```yaml
type: base
view: stat
stats:
  - label: total pages
    value: sum(pages)
  - value: count()
```

## Workflow

1. **Pick a kind** from the table above.
2. **Read `references/<kind>.md`** in this skill for that kind's exact config keys, a working frontmatter example, and its specific failure modes — do not guess a key name from memory or from another kind's shape.
3. **Create the note**: a `.md` file (any path/name) with `type: base` frontmatter, `source:` if you don't want the whole vault, `view: <kind>`, and that kind's keys at the top level.
4. **Verify with `bismuth base validate <path>`** before opening it in the app — it catches a bad `view:` kind, a legacy `views:` list with more than one entry, unresolvable `source`/`filters`, and invalid `properties` defaults that `parseBaseFile` would otherwise silently downgrade/ignore (e.g. an unrecognized `view:` kind quietly renders as `table` instead of erroring, which `base validate` surfaces explicitly). Then re-read the file (or open it in the app / query it) and confirm the frontmatter parses the way you intended, especially `source:` (see gotcha below): a typo'd `source` silently falls back to a default rather than erroring. `bismuth base create` and `bismuth base render` are the companion CLI commands for scaffolding and previewing a base headlessly.

## Cross-cutting gotchas (apply to every kind)

- **`source:` accepts a string or an object** — `source: notes where #book` and `source: { kind: notes, where: '#book' }` are equivalent (`normalizeSource()` coerces both). An unrecognized `source` (bad `kind`, a typo) doesn't error — it silently becomes `undefined`, and the caller falls back to `{ kind: "notes" }` (whole vault) or `{ kind: "base" }` (own body rows), which is rarely what you wanted. Double-check `source:` renders the row set you expect.
- **A base referenced by `from:` resolves its OWN source recursively.** `from: "[[Keep]]"` doesn't just intersect against Keep's static rows — it re-runs Keep's declared `source` (which may itself be `notes`/`tasks`/another `base`). This composition is cycle-guarded (a config loop or a symlink loop returns `[]`, never throws), but it means changing an upstream base's `source:` can silently change what every base composing it shows.
- **The only embedded block is ` ```query ` — there is no ` ```base `, ` ```view `, or ` ```tasks `.** A base itself is always a `type: base` file; inside a note you reference or query it with a ` ```query ` fence (`of: [[Base]]` or `tasks: <dsl>`, plus `view:`/`where:`/`group:`/`limit:`), never a differently-named fence.

Full reference (routing, caching, the complete `BaseConfig`/`ViewConfig` shape, worked examples): `docs/bases/overview.md`. Sources & composition: `docs/bases/sources.md`. The `\`\`\`query` block: `docs/bases/query-block.md`.
