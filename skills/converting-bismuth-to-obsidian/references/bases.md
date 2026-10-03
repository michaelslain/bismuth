# Bases → `.base` files

## Sources

Bismuth:
- `docs/bases/overview.md` — the base format: `type: base`, `source`, `filters`, `formulas`, `properties`, the one flat view, the 12 view kinds, composition.
- `docs/bases/sources.md` — `source: notes | tasks | base`, `ref`, `from`, and exactly what composition passes along.
- `docs/bases/query-block.md` — the ` ```query ` fence (flat spec vs full inline config).
- `docs/bases/filters.md` and `docs/bases/query-syntax.md` — the filter/sort expression language.
- `docs/bases/functions.md` — Bismuth's function list.
- `docs/bases/views/` — one page per view kind (`table`, `cards`, `list-bullets`, `kanban`, `map`, `calendar`, `flashcards`, `charts`).
- `docs/cli/reference.md` — `base read`, `base render`, `rows`.

Obsidian:
- https://help.obsidian.md/bases/syntax (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Bases%20syntax.md) — the `.base` file format (YAML, no frontmatter fence).
- https://help.obsidian.md/bases/views (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Views.md) — the view list, with the Obsidian version each layout needs.
- https://help.obsidian.md/bases/views/table, https://help.obsidian.md/bases/views/cards, https://help.obsidian.md/bases/views/list, https://help.obsidian.md/bases/views/kanban, https://help.obsidian.md/bases/views/map (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Table%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Cards%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/List%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Kanban%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Map%20view.md) — per-layout settings.
- https://help.obsidian.md/bases/create-base (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Create%20a%20base.md) — embedding a base (`![[File.base]]`, ` ```base ` blocks).
- https://help.obsidian.md/bases/functions (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Functions.md) — the function list.
- https://github.com/obsidianmd/obsidian-maps/blob/master/examples/Places.base (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-maps/master/examples/Places.base) — a real `.base` with map views, the only place the map keys are written down.

## Snapshot
Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

**Bismuth.** A base is a `.md` note with `type: base` in its frontmatter — never a `.base` file. The frontmatter holds the config: `source`, `filters`, `formulas`, `properties`, `view: <kind>`, and that kind's keys flat at the top level. A base has **one view** in the current format; a legacy `views:` list (several entries, each `{type, name, ...}`) may still be on disk, and `bismuth base read` returns only its first entry. The 12 kinds: `table cards list bullets kanban map calendar flashcards bar line stat heatmap`. A second view of the same rows is a second base with `source: base` + `ref: "[[First]]"`, which receives **rows only** — the referenced base's `filters`, `formulas`, sort and grouping are not inherited. The body is optional: it holds the base's own rows (a YAML list or a table) when it has no `source`, and may also hold plain prose (a heading, a paragraph).

**Obsidian.** A base is a `.base` file: pure YAML, **no `---` fences, no `type: base`**. Top-level keys: `filters` (global, `and`/`or`/`not` trees of expression strings), `formulas`, `properties` (id → `displayName`), `summaries` (custom summary formulas), and `views:` — a list. Each view has `type`, `name`, optional `filters`, `order`, `groupBy` (`{property, direction}`), `limit`, `summaries` (property → summary name), plus view-specific keys. Layouts listed on the live Views page: table, cards, list, kanban (Obsidian 1.14, early access at snapshot time), map (needs the Maps plugin). Property ids are `file.*`, `note.*`, `formula.*`; a bare name in a filter or formula is a note property.

A `.base` is embedded with `![[File.base]]` or `![[File.base#View name]]`, or inline as a ` ```base ` code block holding the same YAML.

| Bismuth | `.base` |
|---|---|
| file `Name.md` + `type: base` | file `Name.base` (same folder, same basename) |
| `filters` | top-level `filters` (same tree, same expression strings) |
| `formulas` | `formulas` |
| `properties` entry `displayName` | `properties` `<id>: {displayName}` (other Bismuth property options have no `.base` key) |
| `view: table` / `cards` / `list` / `map` | `views: [{type: table / cards / list / map}]` |
| `view: kanban` | `type: kanban` if the live Views page lists it for the user's Obsidian version, else `table` grouped by the same property |
| `bullets` | `type: list` with `order` of one field |
| `calendar flashcards bar line stat heatmap` | no layout — see **Lossy** |
| `order`, `limit`, `groupBy`, `sort` | same keys inside the view (`sort` is `[{property, direction}]`) |
| `summaries` | view `summaries`; keep only names on the live Summaries table (`Average Min Max Sum Range Median Stddev Earliest Latest Checked Unchecked Empty Filled Unique`) |
| `columnWidths` | `columnSize` (**unverified** key name) — omit unless you confirmed it |
| `lat`, `lng` (two property ids) | map `coordinates` — Obsidian wants ONE property holding `"lat, lng"` or a two-item list; the Maps example also uses `markerIcon`, `markerColor`, `defaultZoom` |
| cards `image`, `imageFit`, `imageAspectRatio` | the same words appear as Cards settings on the live page; the **YAML key names are unverified** — omit unless confirmed |

## Convert

Work one base at a time. **First read the raw frontmatter for `views:`** — `bun -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); console.log(JSON.stringify(Bun.YAML.parse(t.split(/^---$/m)[1]).views ?? null))' "$SRC/<rel path>"` prints `null` for an ordinary base and the full entry list for a legacy multi-view one (`view:` greps never find those). Then get the **normalised** config for everything else: `bismuth base read "<rel path>" --vault "$SRC"` (its `config.view` is the first `views:` entry only) prints `{config: {filters, formulas, properties, view: {type, order, groupBy, ...}}, rows}`; `rows` there is only the base's own body rows. For the rows a **body-row** base renders, use `bismuth base render "<rel path>" --vault "$SRC"`. **Do not trust `base render` or `bismuth rows --of "[[Name]]"` for a base with no `source:`** — in the 2026-10-03 trial both returned zero rows for a source-less base that the docs say shows the whole vault. To measure what a filter selects, use `bismuth rows --where '<expression>' --vault "$SRC"` (it printed the right count).

B0. **Is it really a base?** Some `type: base` notes are ordinary notes with a query in the body (the example vault's `Tasks.md` is exactly `type: base` plus a ` ```query ` fence). If the note's **body holds ` ```query ` fences**, keep it as a note: delete the `type: base` line and any base config keys from its frontmatter (`perl -0pi -e 's/\A---\ntype: base\n---\n//' "<note>"` clears a frontmatter that held only that key), convert its fences in item B8, and write a `.base` beside it only if the frontmatter carried real config (`source`, `filters`, `formulas`, `properties`, a non-default `view`). A note that stays a note keeps its whole body (any prose too), so it never gets the separate prose note of B4, and needs no link rewriting (item B5 does not apply to it). Check this item first; B4's prose rule applies only to the notes that pass it.
B1. **Find the row scope** from `source`:
   - `bismuth base read` returns a non-empty `rows` and `config` has no `source` (or `source: base` without `ref`) → a **body-row base**: go to item B6. Check this first.
   - no `source` and an empty `rows`, or `notes` → no extra filter (all notes — an Obsidian base with no `filters` also shows every file).
   - `notes where EXPR` (or `{kind: notes, where: EXPR}`) → AND `EXPR` into `filters`.
   - `base` + `ref: "[[Other]]"` → **inline the referenced base's row scope**. A `ref` resolves like a wikilink (exact vault path first, then by file name via `pickByBase`), so `bismuth base render` on the composing base shows its real scope. Take its `source` scope only (steps above, recursively), and **do not** copy its `filters`, `formulas`, sort or grouping — Bismuth does not inherit them, so the faithful output does not either. Keep the composing base's own `filters`.
     - If `Other` is a **body-row base**, its rows now live in item B6's folder: the scope is `file.inFolder("<Other's folder>/<Other basename>")`, the full vault-relative path.
     - If `Other` declares no `source` and has no body rows, Bismuth resolves it to every note, so its scope is all notes; convert that scope plus the composing base's own filters. If the referent *did* carry filters that its sibling lacks, say in the report that the composed base shows more rows than its sibling; copy the filters across only if the user confirms that was the intent.
     - Cycles mean zero rows; report them.
   - `notes` or `tasks` with `from: "[[B]]"` → resolve B's scope as above and AND it into the filters (`file.inFolder("<B's generated folder>")` when B is a body-row base). `from` is a separate field from `ref`; it keeps only the notes B selects.
   - `tasks` (or `mode: tasks`) → not a `.base`: see item B7.
B2. **Canonicalise property ids.** Obsidian accepts a bare name as a note property ("If no prefix is specified, the property is assumed to be a `note` property"; `author` is shorthand for `note.author`), so a bare `status` is valid. The prefix is still the form to write in `order`, `sort`, `groupBy` and `properties` keys, because it is explicit and is what Obsidian's own examples use there: prefix every bare id with `note.` unless it already starts `file.`, `note.` or `formula.`. Bare names inside filter *expressions* stay as written (Obsidian's own example filters use bare `status` and `price`). Source, read 2026-10-03: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Bases%20syntax.md (sections "Properties" and "Note properties").
B3. **Rewrite `#tag` in a `where`/filter** as `file.hasTag("tag")` — Bismuth's expression language has no `#tag` literal (an unquoted `#` is a YAML comment, and `"#book"` is a string), so any `#tag` filter never filtered; the author's intent was a tag filter. Other expressions (`==`, `!=`, `&&`, `||`, `file.hasTag`, `file.inFolder`, `file.hasLink`) are written the same way in both languages. Quote the whole filter string in YAML — a `#` inside an unquoted scalar starts a comment.
B4. **Build the file.** For a single-view base, name the view after the base's basename so `![[Name.base#Name]]` is predictable. For a **legacy `views:` list** (the raw read in the intro), write **every entry** as one entry of the `.base`'s `views:` list, in order, **keeping each `name`** (an unnamed entry gets the basename; add a suffix on a duplicate), canonicalising each entry's own `order`/`sort`/`groupBy` (item B2) and mapping its `type` per the table; the base-level `filters`, `formulas` and `properties` stay top-level and apply to all views, and a filter inside an entry stays inside that view. Never keep only what `base read` returned. The example is one view:
   ```yaml
   filters:
     and:
       - 'type == "book"'
   properties:
     note.author:
       displayName: Author
   views:
     - type: cards
       name: Reading List
       order:
         - file.name
         - note.author
         - note.status
       groupBy:
         property: note.status
         direction: ASC
   ```
   Write it to `<same folder>/<basename>.base`, then handle the `.md`:
   - **Body empty, or holding nothing but rows** (body-row bases, item B6): delete the `.md`.
   - **Body holds anything else** (a heading, a paragraph): the prose cannot live in a `.base`, so keep it as a normal note. Drop the frontmatter and embed the base, after writing the `.base`: `perl -0pi -e 's/\A---\n.*?\n---\n//s' "<note>" && printf '\n![[<basename>.base]]\n' >> "<note>"` leaves `<basename>.md` as the body followed by `![[<basename>.base]]`, next to `<basename>.base`. Skip item B5 for this base: `[[<basename>]]` lands on this note, which embeds the base, so the link shows the base either way. **Unverified:** which of `X.md` and `X.base` an extensionless `[[X]]` resolves to when both exist. The Obsidian help does not say; its Internal links page only says links to non-Markdown formats "need to include a file extension" (https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Linking%20notes%20and%20files/Internal%20links.md). Where you need certainty, write `[[<basename>.base]]` explicitly, or rename the note. List the note in the report as "created: base prose note".
B5. **Rewrite inbound links.** Only for a base whose `.md` was deleted (not one that kept a prose note, and not a note that stayed a note). A link `[[Name]]` that targeted the base now needs the extension: `[[Name.base]]` (and `[[Name|alias]]` → `[[Name.base|alias]]`). **Skip code spans and fences** — a note that documents the link (`` `[[Name]]` ``) must keep its text, so a blanket `perl`/`sed` is wrong. Save this as `rewriteLinks.ts` in your scratch directory and run `bun run rewriteLinks.ts "$OUT" "Name"` once per deleted base (idempotent):
   ```ts
   // rewriteLinks.ts
   import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
   import { join } from 'node:path'

   const [root, name] = process.argv.slice(2)
   const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   const link = new RegExp(`\\[\\[${escaped}(?=[\\]|#])`, 'g')
   const walk = (dir: string) => {
       for (const entry of readdirSync(dir)) {
           if (entry.startsWith('.')) continue
           const path = join(dir, entry)
           if (statSync(path).isDirectory()) walk(path)
           else if (entry.endsWith('.md')) {
               const text = readFileSync(path, 'utf8')
               // the capture group makes odd indexes the code parts, which stay untouched
               const out = text
                   .split(/(```[\s\S]*?```|`[^`\n]*`)/)
                   .map((part, i) => (i % 2 ? part : part.replace(link, `[[${name}.base`)))
                   .join('')
               if (out !== text) writeFileSync(path, out)
           }
       }
   }
   walk(root)
   ```
   The base note's prose is kept by item B4, never dropped. The source is untouched.
B6. **Body-row bases.** An Obsidian base only queries notes. Turn each row into a note: `bismuth base read` gives the rows as objects; write one `<base's folder>/<base basename>/<title>.md` per row (the base's own vault-relative folder, so a base at the vault root gives `<base basename>/`) with the row's keys as frontmatter (title from a `title`/`name` column, else the first column; strip `/ \ : * ? " < > | # ^ [ ]` from filenames; add a numeric suffix on collision), then add `file.inFolder("<base's folder>/<base basename>")` (the full vault-relative path) to the `.base` filters. Say in the report that the data now lives in notes.
B7. **Task bases** (`source: tasks` or `mode: tasks`): Obsidian Bases cannot list checkbox tasks. Replace the base with a note of the same basename whose body is a ` ```tasks ` block built per `tasks` (query translation); drop kanban/calendar presentation and report it.
B8. **Query blocks** in notes:
   - ` ```query ` with only `of: [[Base]]` → `![[Base.base]]`.
   - ` ```query ` with `of: [[Base]]` plus `view:` (or the legacy `as:`) → the block renders the base in a different mode than the base's own view, so **add a second view** of that type to `Base.base` (named after the mode, e.g. `list`, with the base's `filters`/`order` carried over) and embed `![[Base.base#<View>]]`. Reuse the view if an earlier block already added one.
   - flat block with `of:` plus `where:`/`sort:`/`limit:`/`group:` → an inline ` ```base ` block holding the referenced base's translated YAML with those keys applied (`where` ANDed into `filters`, `sort`/`limit`/`group` as view keys).
   - a **full inline config** (the body has `filters:`, `formulas:`, `properties:`, `schema:`, `source:` or `views:`) → an inline ` ```base ` block with the same translation as a `.base` file.
   - `tasks:` blocks → ` ```tasks ` (see `tasks`).
B9. **Optional fold.** Bases that compose one another and resolve to the *same* row scope may become one `.base` with several `views` (one per Bismuth base, each named after it, each carrying its own `filters`). Never fold when the scopes differ; when unsure, leave them separate — separate files are always faithful.
B10. **Run unfamiliar view keys past the live docs.** For any view option this snapshot marks unverified, either confirm the key in a `.base` saved by Obsidian (ask the user to set it in the UI and send the file) or omit it and report it.

## Lossy

- `calendar`, `flashcards`, `bar`, `line`, `stat`, `heatmap` have no Obsidian layout. Default: write a `table` view with the same `filters` and `order`; say so per file. A **flashcards** base is the exception: it produces **only the cards note** (`flashcards`) and **no `.base`**, so delete its `.md` after the cards note is written and point inbound `[[Name]]` links at the cards note. `stat`/chart metrics and `calendar` field bindings are dropped.
- `columns:` (explicit group order), `columnWidths`, `cardContent`, `mode`, `schema`, property `type`/defaults and `hidden`: no `.base` key — dropped.
- Kanban group order and drag state; `source: base` composition itself (inlined, as above).
- Body rows become notes (the data now lives in notes). A base's prose body is **kept** as a `<Name>.md` note embedding the base (item B4); only the base note's own frontmatter, and any layout key with no `.base` equivalent, is lost.
- Bismuth-only filter functions: none are known beyond Obsidian's set, but an unknown function name evaluates to `undefined` **silently in Bismuth**, so a base that "worked" there may contain dead filters. Check each function name against https://help.obsidian.md/bases/functions.
- `this` inside an embedded base means the host note in Bismuth; Obsidian's meaning depends on how the base is opened (live docs: "Access properties with `this`").

## Validate

- Every base note with a non-empty body that is not rows has a `<Name>.md` next to its `.base` containing `![[<Name>.base]]`, and the report lists it. A legacy multi-view base has as many `views:` entries in its `.base` as the source `views:` list had.
- No `type: base` note remains, every `.base` parses as YAML and carries no `---` fence (SKILL step 5 a, b).
- Row parity where you can measure it: `bismuth rows --where '<the filter expression you wrote>' --vault "$SRC" | jq length` counts the notes your filter selects; compare with the count of notes the original base's scope selects (for a body-row base, the row count of `bismuth base render`). `rows --where` takes the same expression language, so `file.hasTag("x")` and `file.inFolder("x")` work there.
- Every inbound link resolves (SKILL step 5 c) — a `[[Name]]` left pointing at a deleted base is the usual miss.
- Open the result in Obsidian when possible; nothing headless validates a `.base` against Obsidian's own schema.
