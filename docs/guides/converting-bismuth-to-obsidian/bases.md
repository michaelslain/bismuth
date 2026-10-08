# Converting Bismuth bases to Obsidian `.base` files

A Bismuth base is a `<name>.base.jsonl` file or a `type: base` markdown note, with one view; an Obsidian base is a `.base` YAML file with a list of views. This page converts each base file, its inbound links, its stored rows and its query blocks, and lists the view kinds and keys Obsidian cannot hold.

## Sources

Bismuth:
- `docs/bases/overview.md`: the base format (`type: base`, `source`, `filters`, `formulas`, `properties`, the one flat view, the view kinds, composition).
- `docs/bases/sources.md`: `source: notes | tasks | base`, `ref`, `from`, and exactly what composition passes along.
- `docs/bases/query-block.md`: the ` ```query ` fence (flat spec vs full inline config).
- `docs/bases/filters.md` and `docs/bases/query-syntax.md`: the filter and sort expression language.
- `docs/bases/functions.md`: Bismuth's function list.
- `docs/bases/views/`: one page per view kind.
- `docs/cli/reference.md`: `base read`, `base render`, `base validate`, `rows`.

Obsidian:
- https://help.obsidian.md/bases/syntax (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Bases%20syntax.md): the `.base` file format (YAML, no frontmatter fence).
- https://help.obsidian.md/bases/views (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Views.md): the view list, with the Obsidian version each layout needs.
- https://help.obsidian.md/bases/views/table, https://help.obsidian.md/bases/views/cards, https://help.obsidian.md/bases/views/list, https://help.obsidian.md/bases/views/kanban, https://help.obsidian.md/bases/views/map (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Table%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Cards%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/List%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Kanban%20view.md, https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Layouts/Map%20view.md): per-layout settings.
- https://help.obsidian.md/bases/create-base (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Create%20a%20base.md): embedding a base (`![[File.base]]`, ` ```base ` blocks).
- https://help.obsidian.md/bases/functions (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Functions.md): the function list.
- https://github.com/obsidianmd/obsidian-maps/blob/master/examples/Places.base (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-maps/master/examples/Places.base): a real `.base` with map views, the only place the map keys are written down.

## Format differences

The tables orient you; where a linked live page disagrees, follow the live page and note the difference in the report.

A Bismuth base is one of two files, never an Obsidian `.base`. A `.base.jsonl` file holds the config as a JSON object on line 1 and one row per later line; it has no prose body. A `.md` note with `type: base` in its frontmatter holds the config there. Obsidian opens neither: its `.base` is YAML, a different format that shares only the word `base`. Both Bismuth forms carry the same keys, so the conversion below applies to either, and each section says where the two differ.

In a markdown base the frontmatter holds the config: `source`, `filters`, `formulas`, `properties`, `view: <kind>`, and that kind's keys flat at the top level. A base has one view. A `views:` list (several entries, each `{type, name, ...}`) can still be on disk, and `bismuth base read` returns only its first entry. A second view of the same rows is a second base with `source: base` + `ref: "[[First]]"`, which receives rows only: the referenced base's `filters`, `formulas`, sort and grouping are not inherited. The body is optional. It holds the base's own rows (a YAML list or a table) when the base has no `source`, and may also hold plain prose (a heading, a paragraph).

An Obsidian base is a `.base` file: pure YAML, with no `---` fences and no `type: base`. Top-level keys are `filters` (global, `and`/`or`/`not` trees of expression strings), `formulas`, `properties` (id to `displayName`), `summaries` (custom summary formulas) and `views:`, a list. Each view has `type`, `name`, optional `filters`, `order`, `groupBy` (`{property, direction}`), `limit` and `summaries` (property to summary name), plus view-specific keys. The layouts on the live Views page are table, cards, list, kanban (the page names the Obsidian version it needs) and map (needs the Maps plugin). Property ids are `file.*`, `note.*` and `formula.*`; a bare name in a filter or formula is a note property.

An Obsidian `.base` is embedded with `![[File.base]]` or `![[File.base#View name]]`, or inline as a ` ```base ` code block holding the same YAML.

| Bismuth | `.base` |
|---|---|
| file `Name.md` + `type: base`, or file `Name.base.jsonl` | file `Name.base` (same folder, same basename) |
| `filters` | top-level `filters` (same tree, same expression strings) |
| `formulas` | `formulas` |
| `properties` entry `displayName` | `properties` `<id>: {displayName}` (other Bismuth property options have no `.base` key) |
| `view: table` / `cards` / `list` / `map` | `views: [{type: table / cards / list / map}]` |
| `view: kanban` | `type: kanban` if the live Views page lists it for the user's Obsidian version, else `table` grouped by the same property |
| `bullets` | `type: list` with `order` of one field |
| `calendar flashcards bar line stat heatmap` | no layout; see Lossy |
| `order`, `limit`, `groupBy`, `sort` | same keys inside the view (`sort` is `[{property, direction}]`) |
| `summaries` | view `summaries`; keep only names on the live Summaries table (`Average Min Max Sum Range Median Stddev Earliest Latest Checked Unchecked Empty Filled Unique`) |
| `columnWidths` | `columnSize` (key name unverified); omit unless you confirmed it |
| `lat`, `lng` (two property ids) | map `coordinates`: Obsidian wants one property holding `"lat, lng"` or a two-item list; the Maps example also uses `markerIcon`, `markerColor`, `defaultZoom` |
| cards `image`, `imageFit`, `imageAspectRatio` | the same words appear as Cards settings on the live page; the YAML key names are unverified, so omit unless confirmed |

## Before you convert a base

Work one base at a time, and run these first.

1. Run `bismuth base validate "<rel path>" --vault "$SRC"`. It exits 1 with `{ok: false, errors: [...]}` on a problem, and it finds the silent hazards the other commands hide: an invalid `view:` kind that the parser downgrades to `table`, a `views:` list with more than one entry, a filter a YAML `#` comment truncated (item B3), a `source` or `ref` that resolves to no file (item B1), and filters or formulas that fail to parse. Report every error, and fix the ones that are the conversion's to fix (a truncated filter, item B3).
2. Read the raw config for `views:`. This prints `null` for an ordinary base and the full entry list for a multi-view one (`view:` greps never find those). For a markdown base:
   ```bash
   bun -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); console.log(JSON.stringify(Bun.YAML.parse(t.split(/^---$/m)[1]).views ?? null))' "$SRC/<rel path>"
   ```
   For a `.base.jsonl` base, read line 1:
   ```bash
   head -n 1 "$SRC/<rel path>" | jq -c '.views // null'
   ```
3. Get the normalised config with `bismuth base read "<rel path>" --vault "$SRC"`. It accepts both forms and prints `{config: {filters, formulas, properties, view: {type, order, groupBy, ...}}, rows}`. `config.view` is the first `views:` entry only, with that entry's own `source` and `filters` already merged in, and `rows` is only the base's own stored rows (the body of a markdown base, the later lines of a `.base.jsonl` file).
4. For the rows of a body-row base, use `base read`'s `rows`, not `base render`. A base that spells `source: base` with no `ref:` is read by the app from its own body rows, but the CLI's source resolver returns `[]` for it, so `base render` and `bismuth rows --of "[[Name]]"` print zero rows (a one-row `source: base` note gives 1 row from `base read` and 0 from both others). A base with no `source:` at all is fine in both commands: with body rows they are its rows, and with none it resolves to every vault note. `base render` is right for a base that has a `ref` or a `notes` or `tasks` source.
5. To measure what a filter selects, use `bismuth rows --where '<expression>' --vault "$SRC"`.

## Convert

### B0. Is it really a base?

This item applies to markdown bases only, because a `.base.jsonl` file has no body and cannot hold a query fence; go to B1 for those. Some `type: base` notes are ordinary notes with a query in the body (the example vault's `Tasks.md` is `type: base` plus a ` ```query ` fence). If the note's body holds ` ```query ` fences, keep it as a note: delete the `type: base` line and any base config keys from its frontmatter, convert its fences in item B8, and write a `.base` beside it only if the frontmatter carried real config (`source`, `filters`, `formulas`, `properties`, a non-default `view`). This command clears a frontmatter that held only that key:

```bash
perl -0pi -e 's/\A---\ntype: base\n---\n//' "<note>"
```

A note that stays a note keeps its whole body (any prose too), so it never gets the separate prose note of B4, and needs no link rewriting (B5 does not apply to it). Check this item first; B4's prose rule applies only to the notes that pass it.

### B1. Find the row scope

Read the scope from `source`:

- `base read` returns a non-empty `rows` and `config` has no `source` (or `source: base` without `ref`): a body-row base. Go to B6, or to B7 when its view is `mode: tasks`. Check this first, and use `base read`'s rows, never `base render`'s.
- No `source` and an empty `rows`, or `notes`: no extra filter (all notes; an Obsidian base with no `filters` also shows every file).
- `notes where EXPR` (or `{kind: notes, where: EXPR}`): AND `EXPR` into `filters`.
- `base` + `ref: "[[Other]]"`: inline the referenced base's row scope. A `ref` resolves like a wikilink (exact vault path first, then by file name, fewest path segments first), so `bismuth base render` on the composing base shows its real scope. A `ref` that names no file is reported by `bismuth base validate` (`source: "[[Other]]" does not resolve to a file`). Take the referenced base's `source` scope only (recursively), and do not copy its `filters`, `formulas`, sort or grouping, because Bismuth does not inherit them and the faithful output does not either. Keep the composing base's own `filters`.
  - If `Other` is a body-row base, its rows live in B6's folder: the scope is `file.inFolder("<Other's folder>/<Other basename>")`, the full vault-relative path.
  - If `Other` declares no `source` and has no body rows, Bismuth resolves it to every note, so its scope is all notes; convert that scope plus the composing base's own filters. If the referent did carry filters that its sibling lacks, say in the report that the composed base shows more rows than its sibling, and copy the filters across only if the user confirms that was the intent.
  - A cycle means zero rows; report it.
- `notes` or `tasks` with `from: "[[B]]"`: resolve B's scope as above and AND it into the filters (`file.inFolder("<B's generated folder>")` when B is a body-row base). `from` is a separate field from `ref`; it keeps only the notes B selects.
- `tasks` (or `mode: tasks`): not a `.base`; see B7.
- A `views:` list whose entries carry their own `source:` (or `from`, `where`, `ref`): an entry's `source` overrides the base-level one for that entry, and `base read` applied only the first entry's. Read each entry's own scope from the raw `views:` list (the raw read above) and resolve it with the bullets here per entry. An entry with a different scope gets that scope ANDed into its own view `filters`, not the base-level ones (B4). Never resolve the scope once from `base read` and apply it to every entry.

### B2. Canonicalise property ids

Obsidian accepts a bare name as a note property ("If no prefix is specified, the property is assumed to be a `note` property"; `author` is shorthand for `note.author`), so a bare `status` is valid. The prefix is still the form to write in `order`, `sort`, `groupBy` and `properties` keys, because it is explicit and is what Obsidian's own examples use there. Prefix every bare id with `note.` unless it already starts `file.`, `note.` or `formula.`. Bare names inside filter expressions stay as written (Obsidian's own example filters use bare `status` and `price`). Source: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Bases%20syntax.md, sections "Properties" and "Note properties".

### B3. Rewrite `#tag` in a filter

Rewrite `#tag` in a `where` or filter as `file.hasTag("tag")`. Bismuth's expression language has no `#tag` literal (an unquoted `#` is a YAML comment, and `"#book"` is a string), so a `#tag` filter never filtered, and the author's intent was a tag filter. Other expressions (`==`, `!=`, `&&`, `||`, `file.hasTag`, `file.inFolder`, `file.hasLink`) are written the same way in both languages. Quote the whole filter string in YAML, because a `#` inside an unquoted scalar starts a comment.

The reverse hazard is already in the source: `filters: tags.contains(" #book")` parses as `tags.contains("` because the space before `#` starts a YAML comment, silently dropping the rest. `bismuth base validate` reports this (`a YAML comment truncated this value at "..."`) and prints the corrected quoted form. When it fires, convert the corrected expression, not what `base read` returned.

### B4. Build the file

For a single-view base, name the view after the base's basename so `![[Name.base#Name]]` is predictable. For a base with a `views:` list (the raw read above), write every entry as one entry of the `.base`'s `views:` list, in order, keeping each `name` (an unnamed entry gets the basename; add a suffix on a duplicate), canonicalising each entry's own `order`, `sort` and `groupBy` (B2) and mapping its `type` per the table. The base-level `filters`, `formulas` and `properties` stay top-level and apply to all views, and a filter inside an entry stays inside that view. An entry with its own `source:` (B1, last bullet) puts that entry's row scope in that view's `filters`, so two entries with different scopes stay different.

A `properties:` given as a list (`properties: [title, author]`, Bismuth's declared properties) makes that list drive the view's default columns when no `order` is set. An Obsidian view with no `order` shows its own default columns, so write the list as the view's `order` (each name canonicalised per B2, `file.name` first when the list starts with the title) whenever the view has no `order` of its own. Never keep only what `base read` returned. The example is one view:

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

Write it to `<same folder>/<basename>.base`, then handle the source file in `$OUT`:

- A `.base.jsonl` base: delete the `.base.jsonl`. It has no prose to keep, and Obsidian does not open it. Its stored rows are handled by B6.
- Markdown base, body empty, or holding nothing but rows (body-row bases, B6): delete the `.md`. A `mode: tasks` base is the exception; B7 keeps its `.md` as the note that holds the task lines.
- Body holds anything else (a heading, a paragraph): the prose cannot live in a `.base`, so keep it as a normal note. Drop the frontmatter and embed the base, after writing the `.base`. The command leaves `<basename>.md` as the body followed by `![[<basename>.base]]`, next to `<basename>.base`:
  ```bash
  perl -0pi -e 's/\A---\n.*?\n---\n//s' "<note>" && printf '\n![[<basename>.base]]\n' >> "<note>"
  ```
  Skip B5 for this base: `[[<basename>]]` lands on this note, which embeds the base, so the link shows the base either way. It is unverified which of `X.md` and `X.base` an extensionless `[[X]]` resolves to when both exist; the Obsidian help does not say (its Internal links page says only that links to non-Markdown formats "need to include a file extension": https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Linking%20notes%20and%20files/Internal%20links.md). Where you need certainty, write `[[<basename>.base]]` explicitly, or rename the note. List the note in the report as "created: base prose note".

### B5. Rewrite inbound links

This applies only to a base whose `.md` or `.base.jsonl` you deleted (not one that kept a prose note, and not a note that stayed a note). A link `[[Name]]` that targeted the base needs the extension: `[[Name.base]]`, and `[[Name|alias]]` becomes `[[Name.base|alias]]`. A blanket `perl` or `sed` is wrong, because it must skip code spans and fences: a note that documents the link (`` `[[Name]]` ``) keeps its text. Save this as `rewriteLinks.ts` in your scratch directory and run `bun run rewriteLinks.ts "$OUT" "Name"` once per deleted base (it is idempotent):

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

The base note's prose is kept by B4, never dropped. The source is untouched.

### B6. Body-row bases

This applies to every body-row base except `mode: tasks` (B7: its rows are tasks, not notes). An Obsidian base queries only notes, so turn each row into a note. `bismuth base read` gives the rows as objects (use its `rows` even when `base render` shows none).

1. Write one `<base's folder>/<base basename>/<title>.md` per row, where the folder is the base's own vault-relative folder (a base at the vault root gives `<base basename>/`).
2. Put the row's keys in frontmatter. Take the title from a `title` or `name` column, else the first column; strip `/ \ : * ? " < > | # ^ [ ]` from filenames; add a numeric suffix on collision.
3. Add `file.inFolder("<base's folder>/<base basename>")` (the full vault-relative path) to the `.base` filters.
4. Say in the report that the data lives in notes.

### B7. Task bases

Obsidian Bases cannot list checkbox tasks, so a task base is never a `.base`. Two shapes convert differently:

- `source: tasks` (tasks scanned from vault checkboxes): replace the base with a note of the same basename whose body is a ` ```tasks ` block built per `tasks` (query translation). Drop the kanban or calendar presentation and report it. The tasks themselves are already checkbox lines in other notes.
- `mode: tasks` with no `source:` (and body rows): the tasks are stored as YAML rows in the base's own body, in `description`, `status`, `due`, `scheduled`, `start`, `done`, `created`, `cancelled`, `priority` and `recurrence` columns. A ` ```tasks ` block queries vault checkbox lines only, so replacing the base with one would drop every stored task. Convert the rows instead:
  1. Keep `<basename>.md` as a normal note (drop the frontmatter as in B4, keep any prose).
  2. Write one checkbox line per row under the prose, in Bismuth's bracket syntax, which the `tasks` script then rewrites to emoji: `- [<char>] <description> [<priority>] [due D] [scheduled D] [start D] [created D] [done D] [cancelled D] [every <recurrence>]`, omitting empty columns.
  3. Map the status to the char: `todo` or missing is a space, `done` is `x`, `in-progress` is `/`, `cancelled` is `-`.
  4. Any other column has no checkbox-line form: append it as plain text after the description, or report it.
  5. Run this item before the `tasks` conversion (guide step 4) so the new lines are rewritten with the rest. Add no ` ```tasks ` block unless the user wants a query note. Report the base's kanban or calendar presentation as dropped, and count the stored rows (guide step 5d).

### B8. Query blocks in notes

- ` ```query ` with only `of: [[Base]]` becomes `![[Base.base]]`.
- ` ```query ` with `of: [[Base]]` plus `view:` (or its alias `as:`): the block renders the base in a different mode than the base's own view, so add a second view of that type to `Base.base` (named after the mode, for example `list`, with the base's `filters` and `order` carried over) and embed `![[Base.base#<View>]]`. Reuse the view if an earlier block already added one.
- A flat block with `of:` plus `where:`, `sort:`, `limit:` or `group:` becomes an inline ` ```base ` block holding the referenced base's translated YAML with those keys applied (`where` ANDed into `filters`, `sort`, `limit` and `group` as view keys).
- A full inline config (the body has `filters:`, `formulas:`, `properties:`, `schema:`, `source:` or `views:`) becomes an inline ` ```base ` block with the same translation as a `.base` file.
- `tasks:` blocks become ` ```tasks ` (see `tasks`).

### B9. Optional fold

Bases that compose one another and resolve to the same row scope may become one `.base` with several `views` (one per Bismuth base, each named after it, each carrying its own `filters`). Never fold when the scopes differ. When unsure, leave them separate: separate files are always faithful.

### B10. Check unfamiliar view keys

For any view option this page marks unverified, either confirm the key in a `.base` saved by Obsidian (ask the user to set it in the UI and send the file) or omit it and report it.

## Lossy

- `calendar`, `flashcards`, `bar`, `line`, `stat` and `heatmap` have no Obsidian layout. The default is a `table` view with the same `filters` and `order`; say so per file. A flashcards base is the exception: it produces only the cards note (`flashcards`) and no `.base`, so delete its `.md` after the cards note is written and point inbound `[[Name]]` links at the cards note. `stat` and chart metrics and `calendar` field bindings are dropped.
- `columns:` (explicit group order), `columnWidths`, `cardContent`, `mode`, `schema`, and property `type`, defaults and `hidden` have no `.base` key and are dropped.
- These further base and view keys have no `.base` key and are dropped: `groupColors` (kanban group colours), `hideLabels`, map `zoom` and `center`, the `categories:` list (calendar), `taskFile` and `defaultCategory` (where a "+ task" lands), and the declared-column meaning of a `properties:` list when you could not carry it into an `order` (B4).
- Kanban group order and drag state; `source: base` composition itself (inlined, as above).
- Body rows become notes, so the data lives in notes. A base's prose body is kept as a `<Name>.md` note embedding the base (B4); only the base note's own frontmatter, and any layout key with no `.base` equivalent, is lost.
- An unknown function name evaluates to `undefined` silently in Bismuth, so a base that worked there may contain dead filters. Check each function name against https://help.obsidian.md/bases/functions.
- `this` inside an embedded base means the host note in Bismuth; Obsidian's meaning depends on how the base is opened (live docs: "Access properties with `this`").

## Validate

- Every base note with a non-empty body that is not rows has a `<Name>.md` next to its `.base` containing `![[<Name>.base]]`, and the report lists it. A base with a multi-entry `views:` list has as many `views:` entries in its `.base` as the source list had.
- No `type: base` note and no `.base.jsonl` file remains, and every `.base` parses as YAML and carries no `---` fence (guide step 5 a, b).
- Row parity, where you can measure it: `bismuth rows --where '<the filter expression you wrote>' --vault "$SRC" | jq length` counts the notes your filter selects. Compare it with the count of notes the original base's scope selects (for a body-row base, the length of `rows` from `bismuth base read`, not `base render`, which returns 0 for a `source: base` body-row base). `rows --where` takes the same expression language, so `file.hasTag("x")` and `file.inFolder("x")` work there.
- Every inbound link resolves (guide step 5 c). A `[[Name]]` left pointing at a deleted base is the usual miss.
- Open the result in Obsidian when possible; nothing headless validates a `.base` against Obsidian's own schema.
