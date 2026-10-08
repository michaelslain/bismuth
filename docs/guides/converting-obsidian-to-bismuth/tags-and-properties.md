# Converting Obsidian tags and properties

Frontmatter properties copy unchanged, but Bismuth's tag rules are stricter than Obsidian's: case-sensitive, ASCII-only inline tags, and no parent-tag matching in `file.hasTag`. This page finds the tags that change meaning and fixes the ones that can be fixed.

## Sources

- Bismuth: `docs/vault/wikilinks-tags.md` (tag extraction rules), `docs/vault/frontmatter.md` (parsing, built-in properties, companion notes for images and PDFs), `docs/cli/reference.md` (`prop set`).
- Obsidian: https://obsidian.md/help/tags, https://obsidian.md/help/properties

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Aspect | Obsidian | Bismuth |
|---|---|---|
| frontmatter `tags` | a YAML list | YAML list, flow list or a comma-separated string; a leading `#` is stripped; `tags: a b` is one tag `a b` |
| inline `#tag` | letters, numbers, `_`, `-`, `/`, and Unicode (including emoji) | ASCII only: `A-Za-z0-9_` then `A-Za-z0-9_/-`; a non-ASCII tag is not a graph tag |
| purely numeric tag (`#1984`) | not a tag | `#123` is a tag |
| case | case-insensitive | case-sensitive: `#Foo` and `#foo` are two tags |
| nested `#a/b` | works; `hasTag("a")` matches `a/b` | works, but `file.hasTag("a")` does not match `a/b` |
| tags in code spans and fences | ignored | ignored |
| `tag:` key | n/a | not read; only `tags` |
| `aliases`, `cssclasses` | functional | lint-only: not used for link resolution or styling |
| `icon:` | via plugins | a Lucide name or emoji shown in the tree; Obsidian `Li*` names resolve |
| dates | text or date type | an unquoted ISO date parses as a date |

## Convert

1. Find tag collisions by case, over the tag list Bismuth itself extracts (inline and frontmatter). Pick one spelling per pair and rewrite with `perl -pi` across `$OUT` (frontmatter `tags:` and inline). Tags that differ only by case become distinct in Bismuth.
   ```bash
   bismuth graph --vault "$OUT" | jq -r '.nodes[] | select(.kind=="tag") | .label | ltrimstr("#")' | sort -u | awk '{k=tolower($0); if (k in s && s[k]!=$0) print s[k], $0; s[k]=$0}'
   ```
2. Space-separated `tags: a b` becomes `tags: [a, b]`.
3. Non-ASCII inline tags: leave them (they still show in the editor) and report them. They do not appear in the tag graph or in `file.hasTag`.
4. Properties need no conversion; Bismuth keeps unknown frontmatter keys. Add an `icon:` only if the user wants tree icons.
5. Tags on images and PDFs: Obsidian has none. A note named `x.png.md` in the source becomes a companion note in Bismuth; rename it if that was not intended. To tag a binary, run the command below. It creates the companion note `paper.pdf.md` and refuses when the binary does not exist:
   ```bash
   bismuth prop set "Papers/paper.pdf" tags '["reading"]' --vault "$OUT"
   ```

## Lossy

- Case-insensitivity, the numeric-tag exclusion, and Unicode inline tags.
- Parent-tag matching: `file.hasTag("a")` stops matching `a/b`. `bases.md` Convert step 7 rewrites each filter to list the subtags (`file.hasTag("a", "a/b", …)`), so a subtag created later is not matched.
- `aliases` stop doing anything for links; `links-and-embeds.md` rewrites the links that used them.

## Validate

- Rerun the case-collision command from Convert step 1; it prints nothing. It reads the graph's tag list, so frontmatter tags are covered.
- Check every `hasTag("x")` string in the converted bases against that tag list (`bismuth graph --vault "$OUT" | jq -r '.nodes[] | select(.kind=="tag") | .label'`). A string with no match returns no rows.
- Spot check: a base filtered with `file.hasTag("book")` returns every note you tagged (`bismuth base render "<base>.md" --vault "$OUT" --pretty | grep -c '"basename"'`).
