# Converting Obsidian bases

An Obsidian base is a `.base` YAML file with a list of views; a Bismuth base is a `type: base` markdown note or a `<name>.base.jsonl` file, with exactly one view. Use this page to turn each `.base` file and each ` ```base ` fence into Bismuth form. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/bases/overview.md` (format, one view per base, composition), `docs/bases/filters.md`, `docs/bases/functions.md`, `docs/bases/query-syntax.md`, `docs/bases/query-block.md` (the ` ```query ` fence), `docs/bases/sources.md`, the per-kind pages under `docs/bases/views/`, and `docs/cli/reference.md` (the `base` commands).
- Obsidian: https://obsidian.md/help/bases/syntax (file format), https://obsidian.md/help/bases/views (layouts, embedding), https://obsidian.md/help/bases/functions, https://obsidian.md/help/bases/views/table, https://obsidian.md/help/bases/views/cards, https://obsidian.md/help/bases/views/list, https://obsidian.md/help/bases/views/kanban, https://obsidian.md/help/bases/views/map

## Format differences

The tables orient you; where a linked live page disagrees, follow the live page and note the difference in the report.

An Obsidian base is a `.base` file of pure YAML with top-level `filters`, `formulas`, `properties`, `summaries` and a `views:` list. A Bismuth markdown base is a `.md` note with `type: base` in its frontmatter and one view written flat: `view: <kind>` plus the view's keys at the top level. The Obsidian layouts are table, cards, list, kanban (the Views page names the Obsidian version it needs) and map (needs the Maps plugin).

| Obsidian `.base` | Bismuth base note |
|---|---|
| `Name.base` | `Name.md` with `type: base` |
| top-level `filters`, `formulas` | same keys, same `and`/`or`/`not` trees and leaf strings; `file.hasTag("a")` is an exact match and does not match `a/b` (Convert step 7) |
| top-level `properties: {id: {displayName}}` | `properties:` with the same shape, honoured when the key matches an id used in `order` |
| top-level `summaries` (custom formulas) | not read; drop and report |
| `views[0].type` | `view: <kind>`: `table`, `cards`, `list`, `kanban` and `map` all exist |
| `views[0].name` | dropped |
| `views[0].order`, `sort`, `groupBy`, `limit`, `summaries` | same key names, flattened to the top level; `summaries` values are limited to Bismuth's eight names (see Lossy) |
| `views[0].filters` | AND them with the global `filters` |
| `views[1..]` | one new base each (Convert step 2) |
| map: a `coordinates` property holding `"lat, lng"` or `[lat, lng]` | `lat` and `lng` need two separate properties; add `zoom` and `center` if present |
| kanban grouped by a property | `view: kanban` with `groupBy: {property: note.<name>}` (kanban requires `groupBy`) |
| table column widths | `columnWidths: {id: px}`; the Obsidian key name is unverified, so read it from the real `.base` |
| `this` (the base file, or the embedding note) | the host note's frontmatter when embedded |
| `![[X.base]]`, `![[X.base#View]]` | no embed support; use a ` ```query ` fence |
| ` ```base ` fence | ` ```query ` fence holding a flat inline config |

The filter grammar is shared: operators `== != > < >= <= && || !` and `+ - * / %`; file fields `file.name path folder ext size ctime mtime tags links`; file methods `hasTag hasLink inFolder hasProperty asLink`. A bare name means `note.<name>`.

Obsidian function names that `docs/bases/functions.md` does not list include `asFile containsAll containsAny escapeHTML html icon image isTruthy isType keys linksTo relative repeat time toString values`, plus the properties `file.backlinks`, `file.embeds` and `file.properties`. Recompute the list by diffing the function headings on https://obsidian.md/help/bases/functions against `docs/bases/functions.md`.

## Which file format do I write?

Write each converted base as a markdown note (`P/Name.md` with `type: base`), as the steps below show. A hand-written markdown base is read, rendered and edited like any other, and the steps can keep an Obsidian base's prose beside its config, which a `.base.jsonl` file cannot hold.

To store converted bases as `.base.jsonl` files, run `bismuth base migrate --all --dry-run --vault "$OUT"` after the Validate checks pass, review the plan, then run it without `--dry-run`. Each `.md` moves to the vault's `.trash`. The command refuses a merged note from step 0 whose prose body holds text but no rows, and skips it with `skipped <path>: <reason>` under `--all`; leave those as markdown. Links such as `[[Name]]` and a `ref: "[[P/Name]]"` keep resolving after the move. [The CLI reference](../../cli/reference.md) lists the command's output.

## Convert

0. Name collision. If `P/Name.md` already exists in `$OUT` and its body contains `![[Name.base]]` (a Bismuth-to-Obsidian export has exactly this shape: `X.base` plus a prose note `X.md` ending in the embed), merge instead of creating:
   - Put `type: base`, `source: notes` and view 1's keys, flat as in step 1, into `Name.md`'s frontmatter, keeping any frontmatter it already has. Keep its prose body and delete the `![[Name.base]]` line. Do not also add a ` ```query ` copy: step 4 does not apply to this embed.
   - Each further view becomes `P/Name - V.md` per step 2, with `ref: "[[P/Name]]"` pointing at the merged note.
   - `[[Name]]` opens the merged note (view 1). Continue at step 3 (delete the `.base` and fix plain links).
   - If `Name.md` exists but does not embed the base, do not overwrite it: write the base as `P/Name - <view 1 name>.md` and report the choice under "Defaults taken".
1. For each `Name.base` (path `P/Name.base`), create `P/Name.md` in `$OUT` from view 1:
   ```yaml
   ---
   type: base
   source: notes
   filters:            # global filters; if view 1 has its own, wrap both: and: [<global>, <view>]
     and:
       - file.hasTag("book")   # exact match: not book/sub (Convert step 7)
   formulas:           # copy as is; omit when the .base has none
     pages_left: "pages - read"
   properties:         # copy as is; omit when the .base has none
     status:
       displayName: Status
   view: table         # views[0].type
   limit: 20           # views[0] keys, flattened; drop name and type
   order:
     - file.name
   ---
   ```
   Always write `source: notes` to make the scope explicit. A source-less base note with no body rows resolves to every vault note anyway (app, `base render`, and a base that `ref`s it); only a source-less ` ```query ` fence is empty, so the fence always needs it. An Obsidian base with no filter shows every file; omit `filters` then. Quote any filter value containing `#` or `:`.
2. For each extra view `V`, create `P/Name - V.md` with `type: base`, `source: base`, `ref: "[[P/Name]]"` (vault-relative path, no `.md`; the plain `[[Name]]` also works), `filters:` restated (global AND this view's own), `view: <kind>`, and that view's keys flattened. Only the referenced base's rows carry over, so the restated filters are required. A `ref` resolves like a wikilink: an exact vault path wins, otherwise the target is found by file name (fewest path segments first), so the full path is the unambiguous spelling when two bases share a name in different folders.
3. Delete `P/Name.base` from `$OUT`; a `.base` file is invisible in the Bismuth tree and never read. Then fix every plain link to it: `[[Name.base]]`, `[[P/Name.base]]` and `[[Name.base|text]]` (not only `![[...]]` embeds) dangle. Rewrite each to `[[Name]]`, keeping the path and alias, which opens the converted base note:
   ```bash
   grep -rnE --include='*.md' '(^|[^!])\[\[[^]|#]+\.base[]|#]' "$OUT"   # plain links to find
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's/(?<!!)\[\[([^\]|#]+)\.base([\]|#])/[[$1$2/g'
   ```
   When a base had several views, `[[Name]]` opens view 1; point the link at `[[P/Name - V]]` where the text means another view.
4. ` ```base ` fences in notes: change the info string to `query` and flatten the YAML the same way (add `source: notes`; single view: `view:` plus its keys; filters merged). Replace each `![[Name.base]]` embed with a ` ```query ` fence holding the same flat config as the converted base.
5. Replace `file.backlinks`, `file.embeds` and the Obsidian-only functions listed above. If there is no equivalent, keep the base and write the item in the report.
6. Map bases: ensure each row note has numeric `lat` and `lng` frontmatter (`bismuth prop set "<note>.md" lat 48.85 --vault "$OUT"`).
7. Nested tags: for each `file.hasTag("X")`, list the tags in `$OUT` that start with `X/` (`bismuth graph --vault "$OUT"`, nodes with `kind: tag`) and rewrite the filter to `file.hasTag("X", "X/sub", …)`.

## Lossy

- Views beyond the first become separate files; their only relationship is the `ref`.
- Every view `name` is dropped, including the first view's, because a Bismuth base has no place to keep it. List each dropped name and its base path in the report.
- Summary names: Bismuth computes only `Sum`, `Average`, `Min`, `Max`, `Count`, `Empty`, `Filled` and `Unique`. Any other name (for example Median, Range, Stddev, Earliest, Latest, Checked, Unchecked) renders an empty string with no validation error. List each unsupported summary name per base in the report.
- Custom `summaries` and card sizing are not read. Cards image settings are partly read: the top-level view keys `image` (a property id), `imageFit` (`cover` or `contain`) and `imageAspectRatio` (a number) work (`docs/bases/views/cards.md`). The Obsidian-side key names are unverified, so read them from the real `.base` and map them by hand.
- Obsidian-only functions pass `bismuth base validate` and evaluate to nothing at render time. Inside `filters`, an unknown function makes the base match zero rows: `bismuth base render` shows 0 rows for `nosuchfn(file.name)` and 1 for a valid filter on the same vault.
- Nested tags: Obsidian's `file.hasTag("a")` also matches `a/b` and Bismuth's does not, so step 7 lists each subtag explicitly, and a subtag created later is not matched.
- An embedded `![[X.base]]` becomes an inline query fence, so it does not follow later edits to the base file.
- A merged note's prose body stays on disk but Bismuth does not show it: a `type: base` note opens as the base view only, and the body is read as rows only when the base has no `source` or a `source: base` (`docs/bases/overview.md`, "Where are a base's own rows stored?"). The prose is reachable by editing the file or from another note. Report each merged note.

## Validate

- `bismuth base validate "P/Name.md" --vault "$OUT"` (or `P/Name`, which also finds a migrated `.base.jsonl`) prints `"ok":true` for every converted base. It also reports a multi-entry `views:` list and an unresolvable `ref`.
- `bismuth base render "P/Name.md" --vault "$OUT" --pretty | grep -c '"basename"'` is the row count; compare it with the row count Obsidian shows for that view.
- After a merge (step 0), run both commands on `Name.md` and each `Name - V.md`. With `source: notes` and no filter, `Name.md`'s own rows include the base note itself and every other base note, and it drops out only if a filter rejects it. Expect a row count one higher than a prose-notes-only count, and report it.
- For a converted ` ```base ` fence, copy its YAML between `---` lines into a scratch note under `$OUT` (with `type: base` and `source: notes` added), run the two commands above, then delete the scratch note.
