# Converting Obsidian links and embeds

Most Obsidian links and embeds work in Bismuth unchanged. `bismuth import obsidian` rewrites the wikilink and markdown-link forms that do not: links with a `.md` suffix, links by alias, links that differ from the file name by case, and markdown links to notes. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/vault/wikilinks-tags.md` (link forms and resolution), `docs/vault/attachments.md` (embeds, sizes, media kinds), `docs/editor/markdown.md` (what the editor renders).
- Obsidian: https://obsidian.md/help/links, https://obsidian.md/help/aliases, https://obsidian.md/help/embeds, https://obsidian.md/help/attachments

## Format differences

Bismuth resolves `[[Target]]` by exact vault path first, then by file name, case-sensitively. A missing target gives no edge, and only `[[ ]]` links produce graph edges. The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Obsidian form | In Bismuth | The command |
|---|---|---|
| `[[Note]]`, `[[folder/Note]]`, `[[Note\|Alias]]`, `[[Note#Heading]]` | works | leaves it |
| `[[Note.md]]` | does not resolve (target stays `Note.md`) | strips the `.md` |
| `[[alias]]` where `alias` is in one note's frontmatter `aliases` | does not resolve; `aliases` is lint-only | rewrites to `[[Real Name\|alias]]`, path-qualified when the file name is not unique |
| `[[note]]` with different case, matching one note | does not resolve (case-sensitive) | rewrites to the real file name |
| `[t](Other%20Note.md)` | clickable, but no graph edge | rewrites to `[[Other Note\|t]]`; the file is found relative to the note, then from the vault root, then by file name; a link that names no note in the vault stays a markdown link, as written |
| two notes with the same file name | resolves to one of them | leaves it; path-qualify by hand: `[[folder/Note]]` |
| `[[Note#^blockid]]`, `^blockid` anchors | edge goes to `Note`; no block anchor handling | leaves the text, lists it as Lossy |
| `![[Note]]` | embeds the whole note body | leaves it |
| `![[Note#Heading]]`, `![[Note#^id]]` | embeds the whole note (the fragment is dropped) | leaves it, lists it as Lossy |
| `![[x.png]]`, `![[x.png\|300]]`, `![[x.png\|300x200]]`, `![[x.pdf#page=3]]`, audio, video | works; embeds resolve by file name anywhere in the vault | leaves it |
| `![[X.base]]`, `![[X.canvas]]`, `![[x.excalidraw]]` | shows a "note not found" widget | bases are converted ([bases.md](bases.md)); canvas and Excalidraw are listed ([drawings-and-canvas.md](drawings-and-canvas.md)) |
| `[[Note\|Alias]]` inside a markdown table | the escaped pipe `\|` yields target `Note\` and breaks the link | leaves it and lists it under Needs a decision |

## What the command reports

| Section | Item |
|---|---|
| Converted | `N link(s) rewritten to Bismuth wikilinks` per note |
| Needs a decision | alias and markdown links that could not be rewritten safely (next section) |
| Lossy | block references and anchors, and partial embeds that show the whole note |
| Left as is | per note, the links that were already unresolved in the source vault |
| Validation | `unresolved link [[x]]` for each link that resolved in the source and matches no note or file in the written vault |

## Resolve a Needs a decision item

Each item quotes the link it left.

- **`alias "A" belongs to N notes, left as [[A]]`**: pick the owning note with the user and rewrite the link to `[[Owner|A]]`.
- **`alias link in a table row needs a pipe` and `markdown link in a table row needs a pipe`**: a raw `|` splits a table cell, so the command left the link. Move the link out of the table, or link to the note without an alias text.
- **a `[[Note\|Alias]]` link in a table row**: Bismuth reads the escaped pipe as part of the target `Note\`, so the link does not resolve. Move the link out of the table, or link to the note without an alias text.
- **`[[x]] matches N notes by case, left as written`**: pick the right note and write its path, such as `[[folder/Note]]`.

## Resolve a validation item

An `unresolved link [[x]]` item means a link that resolved in Obsidian matches no note or file in the new vault. Fix the case or add a path when the note exists. When the target never existed in Obsidian either, tell the user and leave the link. A target caused by the note's own text, such as a stray `[[`, stays failing; never edit the note to make the check pass.

## Lossy

- Block references and `![[Note#Heading]]` partial embeds.
- Obsidian's case-insensitive link matching: a mismatch the command cannot pair with exactly one note stays.
- Links whose target does not exist in the source vault stay unresolved; the report lists them per note under Left as is, and they do not fail validation.

## Validate

- The report's Validation section says `all checks passed`, or each failing link is under Needs a decision.
- Spot check: `bismuth graph --vault "$OUT"` lists the notes as nodes and the rewritten links as edges (add `--pretty` for reading).
