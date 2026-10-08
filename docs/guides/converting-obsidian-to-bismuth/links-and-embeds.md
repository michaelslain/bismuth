# Converting Obsidian links and embeds

Most Obsidian links and embeds work in Bismuth unchanged. This page rewrites the forms that do not: links with a `.md` suffix, links by alias, links that differ from the file name by case, and markdown links to notes.

## Sources

- Bismuth: `docs/vault/wikilinks-tags.md` (link forms and resolution), `docs/vault/attachments.md` (embeds, sizes, media kinds), `docs/editor/markdown.md` (what the editor renders).
- Obsidian: https://obsidian.md/help/links, https://obsidian.md/help/aliases, https://obsidian.md/help/embeds, https://obsidian.md/help/attachments

## Format differences

Bismuth resolves `[[Target]]` by exact vault path first, then by file name, case-sensitively. A missing target gives no edge, and only `[[ ]]` links produce graph edges. The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Obsidian form | In Bismuth | Action |
|---|---|---|
| `[[Note]]`, `[[folder/Note]]`, `[[Note\|Alias]]`, `[[Note#Heading]]` | works | none |
| `[[Note.md]]` | does not resolve (target stays `Note.md`) | strip the `.md` |
| `[[alias]]` where `alias` is in a note's frontmatter `aliases` | does not resolve; `aliases` is lint-only | rewrite to `[[Real Name\|alias]]` |
| `[[note]]` with different case | does not resolve (case-sensitive) | rewrite to the real file name |
| two notes with the same file name | resolves to one of them | path-qualify: `[[folder/Note]]` |
| `[t](Other%20Note.md)` | clickable, but no graph edge | rewrite to `[[Other Note\|t]]` |
| `[[Note#^blockid]]`, `^blockid` anchors | edge goes to `Note`; no block anchor handling | keep the text (harmless), report |
| `![[Note]]` | embeds the whole note body | none |
| `![[Note#Heading]]`, `![[Note#^id]]` | embeds the whole note (the fragment is dropped) | report; inline the section if it matters |
| `![[x.png]]`, `![[x.png\|300]]`, `![[x.png\|300x200]]`, `![[x.pdf#page=3]]`, audio, video | works; embeds resolve by file name anywhere in the vault | none |
| `![[X.base]]`, `![[X.canvas]]`, `![[x.excalidraw]]` | shows a "note not found" widget | see `bases.md` and `drawings-and-canvas.md` |
| plain link `[[X.base]]` (no `!`) | dangles once the `.base` is converted and deleted | strip `.base`: `[[X]]`, see `bases.md` step 3 |
| `[[Note\|Alias]]` inside a markdown table | the escaped pipe `\|` yields target `Note\` and breaks the link | unverified fix; leave and report each one |

## Convert

Run each rewrite over `$OUT` only. All use perl, in place, with no backup files.

1. Strip `.md` from wikilinks:
   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's/\[\[([^\]|#]+)\.md([\]|#])/[[$1$2/g'
   ```
2. Aliases. First find alias links inside markdown tables, where a raw `|` splits the cell and `\|` does not resolve:
   ```bash
   grep -nE '^\s*\|.*\[\[' -r --include='*.md' "$OUT"
   ```
   Do not run the alias rewrite on those lines; convert each by hand (or leave it) and list every one in the report. Then list the notes with aliases (`grep -rl --include='*.md' '^aliases:' "$OUT"`) and read each one's `aliases` list. For every alias `A` of the note `N` (file name without `.md`, path-qualified if the name is not unique), run both lines, replacing `A` and `N` with the literal text and escaping regex characters:
   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's/\[\[A\]\]/[[N|A]]/g'
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's/\[\[A([|#])/[[N$1/g'
   ```
   These rewrites do not skip fenced code, so a `[[A]]` shown as an example inside a code fence is rewritten too. Afterwards review `diff -r "$SRC" "$OUT"` for hits inside code fences and restore any that were examples. The same applies to steps 1 and 3.
3. Markdown links to notes (only when the inventory's `md links to .md` is not 0):
   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 's{(?<!!)\[([^\]]+)\]\(((?!https?:)[^)#]+?)\.md(#[^)]*)?\)}{my($t,$p)=($1,$2); $p=~s/%20/ /g; "[[$p|$t]]"}ge'
   ```
4. Re-run the unresolved-links check from [the conversion guide](../converting-obsidian-to-bismuth.md) (step 5). For each remaining line, fix the case, add a path, or report it as lost.

## Lossy

- Block references and `![[Note#Heading]]` partial embeds.
- Obsidian's case-insensitive link matching: every mismatch must be rewritten.
- Links whose target does not exist in the vault stay unresolved; they were unresolved in Obsidian too.

## Validate

- The unresolved-links check in [the conversion guide](../converting-obsidian-to-bismuth.md) (step 5) prints nothing. It skips code spans and fences, so a `[[x]]` example inside code is correctly not reported.
- Spot check: `bismuth graph --vault "$OUT"` lists the notes as nodes and the rewritten links as edges (add `--pretty` for reading).
