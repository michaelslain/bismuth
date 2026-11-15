# Converting an Obsidian vault to Bismuth

`bismuth import obsidian <folder>` turns an Obsidian vault into a Bismuth vault in a new folder: it applies every fixed rewrite, checks the result, and writes a report that lists what it converted, lost, defaulted and could not decide. You run the command, read the report, and handle the items under **Needs a decision**. For the reverse direction, read [converting a Bismuth vault to Obsidian](converting-bismuth-to-obsidian.md).

```bash
bismuth import obsidian ~/vaults/notes --pretty
```

```json
{
  "out": "/Users/me/vaults/notes-bismuth",
  "reportPath": "/Users/me/vaults/notes-bismuth.conversion-report.md",
  "counts": { "converted": 42, "decide": 3, "lossy": 5, "defaults": 1, "left": 2 },
  "validation": { "ok": true, "failures": 0 }
}
```

`counts` holds the number of report items in each section. The command exits `0` whenever the conversion ran, with decide items or without, so read `counts.decide` and `validation.ok` rather than the exit code.

## Run the import

Run the command against the Obsidian vault's folder. It copies the folder to `<folder>-bismuth` (or the `--out` folder), rewrites the copy and prints the JSON above.

- The source folder is never written, and a symbolic link in it is never followed.
- The top-level `.obsidian/`, `.trash/` and `.git/` folders are never copied; `.obsidian/` is read where needed. Every other file and folder, hidden ones included, is copied.
- Each copied or written file keeps its source modified date. Creation dates are the import time.
- The command refuses an output folder that is not empty and an output folder inside the source. Pick another `--out`, or ask the user before emptying the folder.
- `--out` may be a vault that holds only Bismuth's own `.settings`, `.daemon`, `.git` or `.DS_Store`, which is what the app's first-run import creates; the command copies into it and writes settings onto its `.settings`.
- Notes and bases with CRLF line endings are written with LF, and each is listed under Defaults taken.
- `--dry-run` computes the same report and writes nothing; `reportPath` is `null` and the report text comes back as `report` in the JSON.
- The report is written beside the new vault as `<out>.conversion-report.md`, not inside it.

Flags, refusals and the output shape are in the [CLI reference](../cli/reference.md#import). With no shell, call the MCP tool `bismuth_cli` with the same arguments. From a Bismuth checkout, run the CLI as `bun run cli/src/index.ts`; on an installed machine the binary is `~/.bismuth/bin/bismuth` when `bismuth` is not on PATH.

## What the command converts

Every rewrite skips fenced code blocks and inline code spans, so a `[[x.md]]` shown as an example stays as written. A step that cannot decide leaves the text alone and adds a Needs a decision item that quotes it.

| Area | What the command does | Topic page |
|---|---|---|
| Settings | Maps attachments, editor flags, templates, daily notes and folder icons into `.settings`, and reports the settings that have no Bismuth key | [vault-and-settings.md](converting-obsidian-to-bismuth/vault-and-settings.md) |
| Tags | Writes tags that differ only by case in one spelling, and turns `tags: a b` into a list; a comma-separated `tags:` string is left as written | [tags-and-properties.md](converting-obsidian-to-bismuth/tags-and-properties.md) |
| Links | Strips `.md` from wikilinks, rewrites alias, case-mismatched and markdown links to wikilinks; a markdown link resolves relative to its note, then from the vault root, then by file name | [links-and-embeds.md](converting-obsidian-to-bismuth/links-and-embeds.md) |
| Bases | Converts `.base` files, ` ```base ` fences and base embeds and links | [bases.md](converting-obsidian-to-bismuth/bases.md) |
| Tasks | Rewrites Tasks-plugin emoji to bracket fields and ` ```tasks ` blocks to ` ```query ` blocks | [tasks.md](converting-obsidian-to-bismuth/tasks.md) |
| Flashcards | Moves scheduling comments onto single-line cards and maps custom deck tags | [flashcards.md](converting-obsidian-to-bismuth/flashcards.md) |
| Everything else | Reports Dataview, Templater, canvas, Excalidraw and unknown plugins without touching them | [other-syntax.md](converting-obsidian-to-bismuth/other-syntax.md), [drawings-and-canvas.md](converting-obsidian-to-bismuth/drawings-and-canvas.md) |

Wikilinks, embeds, frontmatter properties, callouts, math and `::` flashcards work unchanged and need no rewrite.

## Read the report

The report has these sections, in this order. Under each, items are grouped by area as `### <area>` and written as `- <path>: <detail>`; an empty section says `none`.

| Section | What it holds | Your work |
|---|---|---|
| Needs a decision | Text the command left as written because it cannot decide | Handle each item (next section) |
| Converted | Each rewrite that was applied | None |
| Lossy | Converted, but something Obsidian had does not carry over | Tell the user; fix only what they ask for |
| Defaults taken | A choice the command made without asking | Tell the user |
| Left as is | Plugin syntax that shows as code, and links that were already unresolved in the source vault; neither needs anything | None |
| Validation | The result of the checks the command ran on the written vault | One line when every check passed; a failing check also appears under Needs a decision |
| Inventory | What the source vault used, as counts | None |

## Handle each Needs a decision area

Open `<out>.conversion-report.md`, read `## Needs a decision`, and for each `### <area>` follow the page that owns it. Edit only the item named; never edit a note's own content to make a check pass.

| Area | What lands here | Resolve in |
|---|---|---|
| `bases` | Multi-view bases that were split, a layout with no Bismuth equivalent, Obsidian-only functions, a base that does not parse, a base embed inside a list item | [bases.md](converting-obsidian-to-bismuth/bases.md#resolve-a-needs-a-decision-item) |
| `links` | Alias links that belong to several notes, and links that match several notes by case | [links-and-embeds.md](converting-obsidian-to-bismuth/links-and-embeds.md#resolve-a-needs-a-decision-item) |
| `tasks`, `queries` | A task that did not round-trip, a ` ```tasks ` query with no translation or with filters that did not translate, Dataview and dataviewjs | [tasks.md](converting-obsidian-to-bismuth/tasks.md#resolve-a-needs-a-decision-item), [other-syntax.md](converting-obsidian-to-bismuth/other-syntax.md#resolve-a-needs-a-decision-item) |
| `drawings` | Canvas files, canvas embeds and Excalidraw notes | [drawings-and-canvas.md](converting-obsidian-to-bismuth/drawings-and-canvas.md#resolve-a-needs-a-decision-item) |
| `syntax`, `plugins` | Templater code, symbolic links, and community plugins the command does not know | [other-syntax.md](converting-obsidian-to-bismuth/other-syntax.md#resolve-a-needs-a-decision-item), [vault-and-settings.md](converting-obsidian-to-bismuth/vault-and-settings.md#resolve-a-needs-a-decision-item) |
| `validation` | A check that failed on the written vault: a base that does not validate, a task line or query block that still migrates, a link that resolved in the source and does not resolve in the new vault, a changed task count | [Resolve a validation item](#resolve-a-validation-item) |

Read a topic page by running `bismuth docs read guides/converting-obsidian-to-bismuth/<name>.md`. When a live Obsidian or plugin page disagrees with a topic page's format table, follow the live page and tell the user about the difference.

## Resolve a validation item

A failing check names a path and what failed. `base validate: …` means a converted base is invalid: run `bismuth base validate "P/Name" --vault "$OUT"` and fix the config in [bases.md](converting-obsidian-to-bismuth/bases.md). `unresolved link [[x]]` means a link that resolved in Obsidian matches no note or file in the new vault (a link already broken in the source is listed under Left as is instead): fix the case or path in [links-and-embeds.md](converting-obsidian-to-bismuth/links-and-embeds.md), or tell the user the target never existed. `task count changed` names the source and the copy counts; compare them with `bismuth task list --vault "$OUT" --pretty`. A failure caused by the note's own text, such as a stray `[[`, stays failing and goes to the user as a known item; never edit the note to make the check pass.

## Verify

After handling the items, confirm the new vault from the shell. Every command takes `--vault "$OUT"`, where `$OUT` is the `out` path from the JSON.

```bash
bismuth task migrate --dry-run --vault "$OUT"            # "changed":0
bismuth base migrate-queries --dry-run --vault "$OUT"    # "changed":0
bismuth base validate "P/Name" --vault "$OUT"            # "ok":true, for each base you edited
bismuth card decks --vault "$OUT" --pretty               # one deck per flashcard tag
```

`.settings` need not exist yet: the app creates it the first time it opens the vault, and until then the CLI reads defaults. Summarise the report to the user, naming each item you resolved and each one that remains.

## Failure modes

- If you treat exit code `0` as a clean conversion, decide items go unread; they are listed only in the report.
- If a base filters on `#x`, it matches nothing. The tag filter is `file.hasTag("x")`, and tags are case-sensitive in Bismuth (`#Foo` is not `#foo`).
- If a filter calls a function Bismuth does not define, `bismuth base validate` still passes and the function evaluates to nothing, so a filter on it matches no rows. Check names against `docs/bases/functions.md`.
- If a base is left as a `.base` file, Bismuth never reads it. The command converts every `.base` file that parses; one that does not is listed under Needs a decision.
- If a ` ```query ` fence has no `source:`, it renders empty. The command writes `source: notes` in every converted fence.
- If an image or PDF's tags are written to a `<file>.md` that embeds the file, that note is a duplicate. Tags for an image or PDF live in its companion note `<file>.<ext>.md` (`photo.png.md`).
- If a ` ```tasks ` fence stays as written, Bismuth renders nothing for it; the item is under Needs a decision.
