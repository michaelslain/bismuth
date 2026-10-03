# Bases

## Sources

- Bismuth: `docs/bases/overview.md` (format, one view per base, composition), `docs/bases/filters.md`, `docs/bases/functions.md`, `docs/bases/query-syntax.md`, `docs/bases/query-block.md` (the ` ```query ` fence), `docs/bases/sources.md`, the per-kind pages under `docs/bases/views/`, and `docs/cli/reference.md` (the `base` commands).
- Obsidian: https://obsidian.md/help/bases/syntax (file format), https://obsidian.md/help/bases/views (layouts, embedding), https://obsidian.md/help/bases/functions, https://obsidian.md/help/bases/views/table, https://obsidian.md/help/bases/views/cards, https://obsidian.md/help/bases/views/list, https://obsidian.md/help/bases/views/kanban, https://obsidian.md/help/bases/views/map

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

An Obsidian base is a `.base` file of pure YAML: top-level `filters`, `formulas`, `properties`, `summaries`, and a `views:` list. A Bismuth base is a `.md` note with `type: base` in its frontmatter and exactly ONE view written flat (`view: <kind>` plus the view's keys at top level). Obsidian layouts: table, cards, list, kanban (needs Obsidian 1.14, early access at the snapshot date), map (needs the Maps plugin).

| Obsidian `.base` | Bismuth base note |
|---|---|
| `Name.base` | `Name.md` with `type: base` |
| top-level `filters`, `formulas` | same keys, same `and`/`or`/`not` trees and leaf strings; but `file.hasTag("a")` is an exact match and does NOT match `a/b` (see Convert step 7) |
| top-level `properties: {id: {displayName}}` | `properties:` (same shape; honoured when the key matches an id used in `order`) |
| top-level `summaries` (custom formulas) | not read; drop and report |
| `views[0].type` | `view: <kind>`: `table`, `cards`, `list`, `kanban`, `map` all exist |
| `views[0].name` | dropped |
| `views[0].order`, `sort`, `groupBy`, `limit`, `summaries` | same key names, flattened to top level |
| `views[0].filters` | AND them with the global `filters` |
| `views[1..]` | one new base each (see Convert) |
| map: a `coordinates` property holding `"lat, lng"` or `[lat, lng]` | `lat` and `lng` need two separate properties; add `zoom`/`center` if present |
| kanban grouped by a property | `view: kanban` with `groupBy: {property: note.<name>}` (kanban requires `groupBy`) |
| table column widths | `columnWidths: {id: px}`; the Obsidian key name is unverified, read it from the real `.base` |
| `this` (the base file, or the embedding note) | the host note's frontmatter when embedded |
| `![[X.base]]`, `![[X.base#View]]` | no embed support; use a ` ```query ` fence |
| ` ```base ` fence | ` ```query ` fence holding a flat inline config |

Filter grammar is shared: operators `== != > < >= <= && || !` and `+ - * / %`; file fields `file.name path folder ext size ctime mtime tags links`; file methods `hasTag hasLink inFolder hasProperty asLink`. A bare name means `note.<name>`.

Obsidian-only at the snapshot date (names in the Obsidian Functions page that `docs/bases/functions.md` does not list): `asFile containsAll containsAny escapeHTML html icon image isTruthy isType keys linksTo relative repeat time toString values`, plus the properties `file.backlinks`, `file.embeds`, `file.properties`. Recompute: list the function headings on https://obsidian.md/help/bases/functions and diff against `docs/bases/functions.md`.

## Convert

0. **Name collision.** If `P/Name.md` already exists in `$OUT` and its body contains `![[Name.base]]` (a Bismuth-to-Obsidian export has exactly this shape: `X.base` plus a prose note `X.md` ending in the embed), merge instead of creating:
   - Put `type: base`, `source: notes` and view 1's keys, flat as in step 1, into `Name.md`'s frontmatter, keeping any frontmatter it already has. Keep its prose body and delete the `![[Name.base]]` line. Do NOT also add a ` ```query ` copy (step 4 does not apply to this embed).
   - Each further view becomes `P/Name - V.md` per step 2, with `ref: "[[P/Name]]"` pointing at the merged note.
   - `[[Name]]` now opens the merged note (view 1). Then continue at step 3 (delete the `.base` and fix plain links).
   - If `Name.md` exists but does NOT embed the base, do not overwrite it: write the base as `P/Name - <view 1 name>.md` and report the choice under "Defaults taken".
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
   Always write `source: notes`: the app treats a source-less base as all notes, but the CLI (`base render`, `rows --of`) and any base that `ref`s it see only body rows (none). An Obsidian base with no filter shows every file; omit `filters` then. Quote any filter value containing `#` or `:`.
2. For each extra view `V` create `P/Name - V.md`: `type: base`, `source: base`, `ref: "[[P/Name]]"` (vault-relative path, no `.md`; drop `P/` only when the base is at the vault root), `filters:` restated (global AND this view's own), `view: <kind>`, that view's keys flattened. Only the referenced base's ROWS carry over, so the restated filters are required. A `ref` resolves as a path from the vault root, not by file name like a wikilink.
3. Delete `P/Name.base` from `$OUT`. A `.base` file is invisible in the Bismuth tree and never read. Then fix every plain link to it: `[[Name.base]]`, `[[P/Name.base]]`, `[[Name.base|text]]` (not only `![[...]]` embeds) now dangle. Rewrite each to `[[Name]]` (keep the path and alias), which opens the converted base note:
   ```bash
   grep -rnE --include='*.md' '(^|[^!])\[\[[^]|#]+\.base[]|#]' "$OUT"   # plain links to find
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's/(?<!!)\[\[([^\]|#]+)\.base([\]|#])/[[$1$2/g'
   ```
   When a base had several views, `[[Name]]` opens view 1; point the link at `[[P/Name - V]]` instead where the text means another view.
4. ` ```base ` fences in notes: change the info string to `query` and flatten the YAML the same way (add `source: notes`; single view: `view:` plus its keys; filters merged). `![[Name.base]]` embeds: replace with a ` ```query ` fence holding the same flat config as the converted base.
5. Replace `file.backlinks`, `file.embeds` and Obsidian-only functions (list above). If there is no equivalent, keep the base but write the item in the report.
6. Map bases: ensure each row note has numeric `lat` and `lng` frontmatter (`bismuth prop set "<note>.md" lat 48.85 --vault "$OUT"`).
7. Nested tags: for each `file.hasTag("X")`, list the tags in `$OUT` starting with `X/` (`bismuth graph --vault "$OUT"`, nodes with `kind: tag`) and rewrite to `file.hasTag("X", "X/sub", …)`.

## Lossy

- Views beyond the first become separate files; their relationship is only the `ref`.
- Every view `name` is dropped, including the first view's (there is no place to keep it). List each dropped name and its base path in the report.
- Custom `summaries`, `columnSize`/card sizing and image settings that Bismuth does not read.
- Obsidian-only functions: `bismuth base validate` still passes, and the function evaluates to nothing at render time. Inside `filters`, an unknown function makes the base match zero rows (checked with `bismuth base render`: 0 rows for `nosuchfn(file.name)`, 1 for a valid filter on the same vault).
- Nested tags: Obsidian's `file.hasTag("a")` also matches `a/b`; Bismuth's does not, so step 7 lists each subtag explicitly and a subtag created later is not matched.
- Embedded `![[X.base]]` becomes an inline query fence, so it no longer follows later edits to the base file.
- A merged note's prose body stays on disk, but Bismuth does not show it: a `type: base` note opens as the base view only, and the body is read as rows only when the source is `base` (`docs/bases/overview.md`, "Rows in the body"; `app/src/bases/BaseView.tsx` takes only the parsed config and rows). The prose is reachable only by editing the file or from another note. Report each merged note.

## Validate

- `bismuth base validate "P/Name.md" --vault "$OUT"` prints `"ok":true` for every converted base (it also reports multi-`views:` and unresolvable `ref`).
- `bismuth base render "P/Name.md" --vault "$OUT" --pretty | grep -c '"basename"'` is the row count; compare it with the row count Obsidian shows for that view.
- After a merge (step 0), run both commands on `Name.md` and each `Name - V.md`. `Name.md` rows exclude itself unless its filter matches it.
- For a converted ` ```base ` fence, copy its YAML between `---` lines into a scratch note under `$OUT` (with `type: base` and `source: notes` added, so the scope is explicit), run the two commands above, then delete the scratch note.
