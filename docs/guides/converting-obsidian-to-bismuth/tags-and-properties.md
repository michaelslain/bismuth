# Converting Obsidian tags and properties

Frontmatter properties copy unchanged, but Bismuth's tag rules are stricter than Obsidian's: case-sensitive, ASCII-only inline tags, and no parent-tag matching in `file.hasTag`. `bismuth import obsidian` fixes the tag problems that have one right answer and lists the rest. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/vault/wikilinks-tags.md` (tag extraction rules), `docs/vault/frontmatter.md` (parsing, built-in properties, companion notes for images and PDFs), `docs/cli/reference.md` (`prop set`).
- Obsidian: https://obsidian.md/help/tags, https://obsidian.md/help/properties

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Aspect | Obsidian | Bismuth |
|---|---|---|
| frontmatter `tags` | a YAML list; `tags: a b` also reads as two tags | YAML list, flow list or a comma-separated string (`tags: a, b` is two tags); a leading `#` is stripped; `tags: a b` is one tag `a b` |
| inline `#tag` | letters, numbers, `_`, `-`, `/`, and Unicode (including emoji) | letters (any script), numbers, `_`, then also `/` and `-`; emoji end the tag |
| purely numeric tag (`#1984`) | not a tag | not a tag; the name needs a letter |
| case | case-insensitive | case-sensitive: `#Foo` and `#foo` are two tags |
| nested `#a/b` | works; `hasTag("a")` matches `a/b` | works, but `file.hasTag("a")` does not match `a/b` |
| tags in code spans and fences | ignored | ignored |
| `tag:` key | n/a | not read; only `tags` |
| `aliases`, `cssclasses` | functional | lint-only: not used for link resolution or styling |
| `icon:` | via plugins | a Lucide name or emoji shown in the tree; Obsidian `Li*` names resolve |
| dates | text or date type | an unquoted ISO date parses as a date |

## What the command converts

- Tags that differ only by case are written in one spelling across frontmatter and inline: the most frequent spelling, and on a tie the all-lowercase one, else the first in sort order.
- A frontmatter `tags:` of whitespace-separated words with no comma (`tags: a b`) is rewritten to a flow list (`tags: [a, b]`). A comma-separated string (`tags: a, b`) is left as written, because Bismuth reads it.
- Properties are not touched; Bismuth keeps unknown frontmatter keys.
- `file.hasTag("a")` in a converted base lists the subtags present; see [bases.md](bases.md).

## What the command reports

| Section | Item |
|---|---|
| Converted | `frontmatter tags written as [...]` and `inline tags rewritten to the vault spelling`, per note |
| Defaults taken | `tags #A, #a differ only by case, all written as #a`, once per group of spellings |
| Lossy | `inline tag #x is not a Bismuth tag, left as written`, only for a tag Obsidian reads and Bismuth does not, such as `#📚books` |
| Defaults taken | under `### syntax`, one vault-wide line for the notes named `x.png.md` that sit beside `x.png`: each becomes the companion note of that image; the line gives the count and the first five paths |

Nothing from this area lands under Needs a decision.

## Resolve a Lossy or Defaults item by hand

- **A tag spelling you disagree with**: rewrite it across the vault, frontmatter `tags:` and inline, with the spelling the user wants. Tags that differ only by case are distinct in Bismuth.
- **A non-ASCII inline tag**: it still shows in the editor but does not appear in the tag graph or in `file.hasTag`. Leave it, or rename the tag with ASCII letters.
- **An `x.png.md` companion note you did not intend**: rename it. To tag an image or PDF on purpose, run the command below. It creates the companion note `paper.pdf.md` and refuses when the binary does not exist:
  ```bash
  bismuth prop set "Papers/paper.pdf" tags '["reading"]' --vault "$OUT"
  ```
- **Tree icons**: add an `icon:` property only if the user wants them.

## Lossy

- Case-insensitivity, the numeric-tag exclusion, and Unicode inline tags.
- Parent-tag matching: a converted base lists the subtags present when it was converted, so a subtag created later is not matched.
- `aliases` stop doing anything for links; the command rewrites the links that used them ([links-and-embeds.md](links-and-embeds.md)).

## Validate

- Tags that differed only by case are already written in one spelling; the report lists each group under Defaults taken.
- Check every `hasTag("x")` string in the converted bases against that tag list (`bismuth graph --vault "$OUT" | jq -r '.nodes[] | select(.kind=="tag") | .label'`). A string with no match returns no rows.
