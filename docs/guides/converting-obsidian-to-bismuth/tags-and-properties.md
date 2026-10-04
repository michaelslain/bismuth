# Tags and properties

## Sources

- Bismuth: `docs/vault/wikilinks-tags.md` (tag extraction rules), `docs/vault/frontmatter.md` (parsing, built-in properties, companion notes for images and PDFs), `docs/cli/reference.md` (`prop set`).
- Obsidian: https://obsidian.md/help/tags, https://obsidian.md/help/properties

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

| Aspect | Obsidian | Bismuth |
|---|---|---|
| frontmatter `tags` | a YAML list | YAML list, flow list or a comma-separated string; a leading `#` is stripped; `tags: a b` is ONE tag `a b` |
| inline `#tag` | letters, numbers, `_`, `-`, `/`, and Unicode (including emoji) | ASCII only: `A-Za-z0-9_` then `A-Za-z0-9_/-`; a non-ASCII tag is not a graph tag |
| purely numeric tag (`#1984`) | not a tag | `#123` IS a tag |
| case | case-insensitive | case-sensitive: `#Foo` and `#foo` are two tags |
| nested `#a/b` | works; `hasTag("a")` matches `a/b` | works, but `file.hasTag("a")` does NOT match `a/b` |
| tags in code spans and fences | ignored | ignored |
| legacy `tag:` key | n/a | not read; only `tags` |
| `aliases`, `cssclasses` | functional | lint-only: not used for link resolution or styling |
| `icon:` | via plugins | a Lucide name or emoji shown in the tree; Obsidian `Li*` names resolve |
| dates | text or date type | an unquoted ISO date parses as a date |

## Convert

1. Find tag collisions by case, over the tag list Bismuth itself extracts (inline AND frontmatter): `bismuth graph --vault "$OUT" | jq -r '.nodes[] | select(.kind=="tag") | .label | ltrimstr("#")' | sort -u | awk '{k=tolower($0); if (k in s && s[k]!=$0) print s[k], $0; s[k]=$0}'`. Pick one spelling per pair and rewrite with `perl -pi` across `$OUT` (frontmatter `tags:` and inline). Tags that differ only by case become distinct in Bismuth.
2. Space-separated `tags: a b` becomes `tags: [a, b]`.
3. Non-ASCII inline tags: leave them (they still show in the editor) and report them; they will not appear in the tag graph or `file.hasTag`.
4. Properties need no conversion; Bismuth keeps unknown frontmatter keys. Add an `icon:` only if the user wants tree icons.
5. Tags on images and PDFs: Obsidian has none. A note named `x.png.md` in the source would become a companion note in Bismuth; rename it if that was not intended. To tag a binary, run `bismuth prop set "Papers/paper.pdf" tags '["reading"]' --vault "$OUT"` (creates the companion note `paper.pdf.md`; refuses when the binary does not exist).

## Lossy

- Case-insensitivity, numeric-tag exclusion, and Unicode inline tags.
- Parent-tag matching: `file.hasTag("a")` stops matching `a/b`. `bases.md` Convert step 7 rewrites each filter to list the subtags (`file.hasTag("a", "a/b", …)`), so a subtag created later is not matched.
- `aliases` stop doing anything for links (see `links-and-embeds.md`, which rewrites them).

## Validate

- Rerun the case-collision command from Convert step 1; it prints nothing. It reads the graph's tag list, so frontmatter tags are covered.
- Check every `hasTag("x")` string in the converted bases against that tag list (`bismuth graph --vault "$OUT" | jq -r '.nodes[] | select(.kind=="tag") | .label'`); a string with no match returns no rows.
- Spot check: a base filtered with `file.hasTag("book")` returns every note you tagged (`bismuth base render "<base>.md" --vault "$OUT" --pretty | grep -c '"basename"'`).
