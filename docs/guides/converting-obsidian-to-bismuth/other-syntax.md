# Converting callouts, math, templates and plugin syntax

Callouts, math and core template tokens work in Bismuth as written; Dataview, Templater and Mermaid do not run. `bismuth import obsidian` leaves all of this text untouched and lists each plugin construct in the report, so nothing is silently lost. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/editor/markdown.md` (callouts, math, what renders), `docs/templates/syntax.md` (template tokens, daily notes), `docs/settings/reference.md` (`editor.mathMacros`, `templates`, `dailyNotes`), `docs/bases/query-block.md` (the only embedded query block), `docs/export/overview.md` (page breaks).
- Obsidian: https://obsidian.md/help/callouts, https://obsidian.md/help/advanced-syntax, https://obsidian.md/help/syntax, https://obsidian.md/help/plugins/templates, https://obsidian.md/help/plugins/daily-notes
- Plugins: Dataview https://blacksmithgu.github.io/obsidian-dataview/ , Templater https://silentvoid13.github.io/Templater/

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Feature | Obsidian | Bismuth | The command |
|---|---|---|---|
| callouts `> [!type]+ Title` | built-in types, foldable with `+`/`-`, custom types via CSS | same syntax; an unmapped type renders as `note` (the text is kept); aliases such as `info`, `hint`, `caution`, `summary` map to canonical types | lists a custom type under Left as is |
| math `$..$`, `$$..$$` | MathJax | KaTeX, macros from `editor.mathMacros`, mhchem included | none; math macros are a hand step ([vault-and-settings.md](vault-and-settings.md)) |
| templates `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` (Moment tokens) | core plugin | same tokens, plus `{{cursor}}` and offsets like `{{date+1w}}`; a limited format vocabulary | none; Moment tokens such as `Do`, `W`, `Q`, `[literal]` stay verbatim |
| Templater `<% tp.* %>` | plugin | not expanded; stays verbatim | lists each block |
| daily notes | plugin settings | `dailyNotes:` list | maps them ([vault-and-settings.md](vault-and-settings.md)) |
| ` ```dataview `, ` ```dataviewjs `, inline `` `= x` `` | plugin | no handler; an ordinary code block | lists each one |
| ` ```mermaid ` | rendered | no handler; an ordinary code block | lists each one under Left as is |
| `%%comment%%`, footnotes `[^1]`, `==highlight==` outside cards | built-in | unverified: not documented in `docs/editor/markdown.md` | none; rendering is unverified |
| `<!-- pagebreak -->` | invisible HTML comment | the PDF/PNG/HTML export slices a page at it | none |
| `.yaml`, `.yml` files | not shown | listed in the tree | none |
| ` ```graph `, ` ```query ` blocks | none | Bismuth-only | none |

## What the command reports

| Section | Item |
|---|---|
| Needs a decision | a ` ```dataview ` query that is not a simple list, a ` ```dataviewjs ` block, an inline `` `= x` `` expression, a Templater `<% %>` block, a community plugin the command does not know |
| Left as is | a simple Dataview `LIST` or `TABLE ... FROM` query, a Mermaid diagram, a custom callout type, one line per template file in the Templater or core Templates folder (its tags stay code until Templater runs it) |

The command knows `obsidian-tasks-plugin`, `obsidian-spaced-repetition`, `dataview`, `templater-obsidian`, `obsidian-excalidraw-plugin` and `obsidian-icon-folder`; every other plugin in `community-plugins.json` is listed under the area `plugins`.

## Resolve a Needs a decision item

Never delete plugin syntax. Each item quotes the first line of what it found.

- **`dataview query is not live in Bismuth`**: the text stays as an ordinary code block. Offer the user a ` ```query ` block (`docs/bases/query-block.md`) only when the query is a plain list of notes; otherwise leave it.
- **`dataviewjs block does not run in Bismuth`** and **`inline dataview expression`**: no translation exists. Leave the text and tell the user which notes stop being live.
- **`templater code is not expanded`**: a note outside the templates folder holds Templater code Obsidian expanded and Bismuth shows raw. Replace it with the text it produced, or tell the user which notes hold it.
- **`plugin <id>: its syntax and data were left as is`**: tell the user that the plugin's syntax and data stay in the notes and do nothing in Bismuth.

## Lossy

- Dataview queries stop being live, Templater code stops expanding, and Mermaid diagrams show as code.
- Custom callout styling, CSS snippets and plugin-provided syntax.

## Validate

- `grep -rlE --include='*.md' '^[[:space:]]*```(dataview|dataviewjs|mermaid)' "$OUT"` lists the files the report names under `queries` and Left as is.
- The report has an entry for every plugin in `community-plugins.json` that the command does not know.
