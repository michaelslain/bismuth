# Converting Obsidian bases

`bismuth import obsidian` converts every Obsidian `.base` file, ` ```base ` fence, `![[X.base]]` embed and `[[X.base]]` link into Bismuth form. An Obsidian base is a `.base` YAML file with a list of views (Obsidian's word for a named rendering); a Bismuth base has exactly one layout, so each extra view becomes its own base. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/bases/overview.md` (format, one layout per base, composition), `docs/bases/filters.md`, `docs/bases/functions.md`, `docs/bases/query-syntax.md`, `docs/bases/query-block.md` (the ` ```query ` fence), `docs/bases/sources.md`, the per-layout pages under `docs/bases/views/`, and `docs/cli/reference.md` (the `base` commands).
- Obsidian: https://obsidian.md/help/bases/syntax (file format), https://obsidian.md/help/bases/views (layouts, embedding), https://obsidian.md/help/bases/functions, https://obsidian.md/help/bases/views/table, https://obsidian.md/help/bases/views/cards, https://obsidian.md/help/bases/views/list, https://obsidian.md/help/bases/views/kanban, https://obsidian.md/help/bases/views/map

## What the command converts

| In the Obsidian vault | In the new vault |
|---|---|
| `P/Name.base` | `P/Name.base.jsonl` holding view 1, with `source: notes` |
| each further view `V` | `P/Name - V.base.jsonl` with `source: base` and `ref: "[[P/Name]]"`, the merged filters restated, the formulas and property display names, and that view's own keys |
| `P/Name.base` next to a `P/Name.md` that embeds `![[Name.base]]` (the shape a Bismuth-to-Obsidian export leaves) | `P/Name.md` becomes a `type: base` note holding view 1 and keeping its prose; the embed line is removed |
| `P/Name.base` next to a `P/Name.md` that does not embed it | `P/Name - <view 1 name>.base.jsonl`, and the choice is listed under Defaults taken |
| ` ```base ` fence in a note | ` ```query ` fence holding view 1 as a flat config |
| `![[X.base]]`, `![[X.base#View]]` | a ` ```query ` fence holding the named view, or view 1 |
| `[[X.base]]` and `[[X.base\|text]]` | `[[X]]`; a link to a later view points at that view's own base |

`file.hasTag("a")` in a filter or formula becomes `file.hasTag("a", "a/b", …)` over the tags in the vault, because Obsidian's version matches subtags and Bismuth's matches the exact tag.

The commands that follow (`bismuth base validate`, `bismuth base render`) take a base path without its extension and find the `.base.jsonl` file.

## Format differences

The tables orient you; where a linked live page disagrees, follow the live page and tell the user about the difference.

An Obsidian base is a `.base` file of pure YAML with top-level `filters`, `formulas`, `properties`, `summaries` and a `views:` list. A Bismuth base writes one layout flat: `view: <layout>` plus the layout's keys at the top level, in a `.base.jsonl` file or the frontmatter of a `type: base` note. The Obsidian layouts are table, cards, list, kanban (the Views page names the Obsidian version it needs) and map (needs the Maps plugin).

| Obsidian `.base` | Bismuth base |
|---|---|
| `Name.base` | `Name.base.jsonl`, or `Name.md` with `type: base` |
| top-level `filters`, `formulas` | same keys, same `and`/`or`/`not` trees and leaf strings; `file.hasTag("a")` is expanded to the subtags present |
| top-level `properties: {id: {displayName}}` | `properties:` with the same shape, honoured when the key matches an id used in `order` |
| top-level `summaries` (custom formulas) | not read; dropped and reported |
| `views[0].type` | `view: <layout>`: `table`, `cards`, `list`, `kanban` and `map` all exist |
| `views[0].name` | dropped |
| `views[0].order`, `sort`, `groupBy`, `limit`, `summaries` | same key names, flattened to the top level; `summaries` values are limited to the names Bismuth computes (listed below) |
| `views[0].filters` | ANDed with the global `filters` |
| `views[1..]` | one new base each |
| map: a `coordinates` property holding `"lat, lng"` or `[lat, lng]` | `lat` and `lng` need two separate properties |
| kanban grouped by a property | `view: kanban` with `groupBy: {property: note.<name>}` (kanban requires `groupBy`) |
| table column widths | `columnWidths: {id: px}` |
| `this` (the base file, or the embedding note) | the host note's frontmatter when embedded |
| ` ```base ` fence | ` ```query ` fence holding a flat inline config |

The filter grammar is shared: operators `== != > < >= <= && || !` and `+ - * / %`; file fields `file.name path folder ext size ctime mtime tags links`; file methods `hasTag hasLink inFolder hasProperty asLink`. A bare name means `note.<name>`.

Obsidian function names that `docs/bases/functions.md` does not list include `asFile escapeHTML html icon image isType keys linksTo relative repeat time values`, plus the properties `file.backlinks`, `file.embeds` and `file.properties`. Recompute the list by diffing the function headings on https://obsidian.md/help/bases/functions against `docs/bases/functions.md`.

## What the command reports

| Section | Item |
|---|---|
| Converted | `<path> -> <new path>` per base, `<path> merged into <note>` for a merge, and `base fence -> query fence` or `![[X.base]] -> query fence` per note |
| Needs a decision | views that were split, the layout, function or parse problems listed in the next section |
| Lossy | custom `summaries` dropped, a summary name Bismuth does not compute, `file.hasTag` expansions, a map `coordinates` property |
| Defaults taken | a base written as `Name - <view 1 name>.base.jsonl` because `Name.md` exists |

Bismuth computes only the summaries `Sum`, `Average`, `Min`, `Max`, `Count`, `Empty`, `Filled` and `Unique`. Any other name (Median, Range, Stddev, Earliest, Latest, Checked, Unchecked) is dropped and listed under Lossy; kept in a base, it would render an empty string with no validation error.

## Resolve a Needs a decision item

Each item names the Obsidian base's path and quotes what it left.

- **`N views split into …; view names dropped: …`**: the split is deterministic, so the bases already work. Decide with the user whether to keep the separate bases or merge two of them. A split view reads its rows from the first base and carries the merged filters, the formulas, the property display names and its own keys. The dropped view names are in the item; a Bismuth base has no place to keep them.
- **`Obsidian-only <name> in <expression>`**: the expression evaluates to nothing, and inside `filters` it makes the base match zero rows. Rewrite it with the functions in `docs/bases/functions.md`: edit line 1 of the `.base.jsonl` file (the config object), or the frontmatter of a merged `type: base` note. A function with no equivalent stays as a known loss; tell the user.
- **`Obsidian layout "<type>" has no Bismuth equivalent, written as a table`**: pick one of the existing layouts and set `view:` in the base file.
- **`base file does not parse as YAML` or `base is not a YAML mapping`**: the `.base` file is still in the vault and Bismuth never reads it. Fix the YAML in the file, then write the base by hand with `bismuth base create "P/Name" --view <layout> --source notes` and delete the `.base` file.
- **`a base fence does not parse as YAML`**: the ` ```base ` fence is left as written and renders as code. Fix the YAML, then change the fence's info string to `query` and flatten its single view into `view:` plus that view's keys, with `source: notes`.
- **`a base fence with N views keeps only view 1`**: the fence became a ` ```query ` fence for view 1. Write each dropped view as its own ` ```query ` fence in the note.
- **`![[X.base]] sits inside a list item, left as written`**: a query fence cannot sit inside a list item, so the embed stays as text. Move the embed onto its own line outside the list, or replace it with a ` ```query ` fence.
- **`names a base that is not in the vault` or `names a view that does not exist`**: the embed is left as written and shows a "note not found" widget. Correct the name, or replace the embed with a ` ```query ` fence.

## Resolve a Lossy item by hand

- A map base needs numeric `lat` and `lng` frontmatter on each row note: `bismuth prop set "<note>.md" lat 48.85 --vault "$OUT"`, then the same for `lng`.
- A merged note's prose body stays on disk but Bismuth does not show it: a `type: base` note opens as the base only. The prose is reachable by editing the file or from another note.
- A converted ` ```query ` fence from an embed does not follow later edits to the base it came from.

## Validate

- `bismuth base validate "P/Name" --vault "$OUT"` prints `"ok":true` for every converted base. It also reports a multi-entry `views:` list and an unresolvable `ref`.
- `bismuth base render "P/Name" --vault "$OUT" --pretty | grep -c '"basename"'` is the row count; compare it with the row count Obsidian shows for that view.
- After a merge, a `Name.md` with `source: notes` and no filter counts itself and every other base note among its rows, so expect a row count one higher than a prose-notes-only count.
- For a converted ` ```query ` fence, copy its YAML between `---` lines into a scratch note under `$OUT` with `type: base`, run the two commands above on it, then delete the scratch note.
