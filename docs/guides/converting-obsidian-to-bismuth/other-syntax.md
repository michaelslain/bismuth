# Converting callouts, math, templates and plugin syntax

Callouts, math and core template tokens work in Bismuth as written; Dataview, Templater and Mermaid do not run. This page lists what to leave alone, what to report, and how to confirm nothing was lost.

## Sources

- Bismuth: `docs/editor/markdown.md` (callouts, math, what renders), `docs/templates/syntax.md` (template tokens, daily notes), `docs/settings/reference.md` (`editor.mathMacros`, `templates`, `dailyNotes`), `docs/bases/query-block.md` (the only embedded query block), `docs/export/overview.md` (page breaks).
- Obsidian: https://obsidian.md/help/callouts, https://obsidian.md/help/advanced-syntax, https://obsidian.md/help/syntax, https://obsidian.md/help/plugins/templates, https://obsidian.md/help/plugins/daily-notes
- Plugins: Dataview https://blacksmithgu.github.io/obsidian-dataview/ , Templater https://silentvoid13.github.io/Templater/

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Feature | Obsidian | Bismuth | Action |
|---|---|---|---|
| callouts `> [!type]+ Title` | built-in types, foldable with `+`/`-`, custom types via CSS | same syntax; an unmapped type renders as `note` (the text is kept); aliases such as `info`, `hint`, `caution`, `summary` map to canonical types | none; report custom types |
| math `$..$`, `$$..$$` | MathJax | KaTeX, macros from `editor.mathMacros`, mhchem included | see `vault-and-settings.md`; report any macro that KaTeX rejects |
| templates `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` (Moment tokens) | core plugin | same tokens, plus `{{cursor}}` and offsets like `{{date+1w}}`; a limited format vocabulary | none for core tokens; Moment tokens such as `Do`, `W`, `Q`, `[literal]` stay verbatim, report them |
| Templater `<% tp.* %>` | plugin | not expanded; stays verbatim | leave, report |
| daily notes | plugin settings | `dailyNotes:` list | `vault-and-settings.md` |
| ` ```dataview `, ` ```dataviewjs `, inline `` `= x` `` | plugin | no handler; an ordinary code block | leave as is, report each file; offer a ` ```query ` rewrite only for simple lists |
| ` ```mermaid ` | rendered | no handler; an ordinary code block | leave, report |
| `%%comment%%`, footnotes `[^1]`, `==highlight==` outside cards | built-in | unverified: not documented in `docs/editor/markdown.md` | leave the text as is; report that rendering is unverified |
| `<!-- pagebreak -->` | invisible HTML comment | the PDF/PNG/HTML export slices a page at it | none |
| `.yaml`, `.yml` files | not shown | listed in the tree | none |
| ` ```graph `, ` ```query ` blocks | none | Bismuth-only | none |

## Convert

1. Callouts and math need no change; list each custom callout type in the report.
2. Templates: the copy already brought `Templates/` across. Setting `templates.folder` is part of `vault-and-settings.md`.
3. Dataview and Templater: grep each flagged file, leave the text, and list the file path and the first line of each block in the report. Never delete plugin syntax.
4. For every plugin in `community-plugins.json` that the conversion guide does not cover, add one line to the report: "plugin X: its syntax and data were left as is".

## Lossy

- Dataview queries stop being live, Templater code stops expanding, and Mermaid diagrams show as code.
- Custom callout styling, CSS snippets and plugin-provided syntax.

## Validate

- `grep -rlE --include='*.md' '^[[:space:]]*```(dataview|dataviewjs|mermaid)' "$OUT"` lists exactly the files the report names.
- The report has an entry for every plugin in `community-plugins.json`.
