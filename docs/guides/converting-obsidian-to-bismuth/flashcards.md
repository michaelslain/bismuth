# Converting Spaced Repetition flashcards

Bismuth reads the Obsidian Spaced Repetition plugin's card syntax and its `<!--SR:...-->` scheduling comments directly, so most cards copy unchanged. Convert only when `obsidian-spaced-repetition` is in the source's `.obsidian/community-plugins.json`. This page covers the differences that silently drop cards or review history: deck tags, comment placement and cloze markers.

## Sources

- Bismuth: `docs/flashcards/srs.md` (card syntax, deck rules, SR comment, row cards), `docs/settings/reference.md` (the `srs` section), `docs/cli/reference.md` (the `card` commands).
- Obsidian Spaced Repetition: https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/q-and-a-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/cloze-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/decks/, https://www.stephenmwangi.com/obsidian-spaced-repetition/data-storage/, https://github.com/st3v3nmw/obsidian-spaced-repetition

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Aspect | Spaced Repetition plugin | Bismuth |
|---|---|---|
| single-line | `front::back`, reversed `front:::back` | the same |
| multi-line | `front` / `?` / `back`, reversed with `??` | the same |
| cloze | `==x==` by default; `**x**` and `{{x}}` are optional settings | `==x==`, `**x**` and `{{x}}` are always on |
| decks | the configured tags (default `#flashcards`, nested `#flashcards/deck/sub`), or the folder structure | the tag must be exactly `flashcards` or `flashcards/<deck>` (frontmatter or inline); no folder decks |
| several deck tags in one note | each tag applies to the cards after it | the first deck path is used for every card in the note |
| scheduling | `<!--SR:!2024-08-16,51,230-->` on the line after the card (or the same line, by setting) | the same comment and fields (`!date,interval,ease`, ease 250 = 2.5x), with placement fixed by card kind (see below) |
| note reviews | `sr-due`, `sr-interval`, `sr-ease` in frontmatter | not read; harmless, keep or drop |

A single-line card (`::`, `:::`, cloze) reads its SR comment only from the card's own line. A multi-line `?`/`??` card reads it only as a standalone trailing line. A comment on the line after a single-line card is ignored, and the card loads as new (`due` null, interval 0, ease 250).

A note is collected only if its tags include `flashcards` or `flashcards/<deck>`. An untagged note with perfect card syntax yields nothing.

## Convert

1. Card text copies unchanged, and so do SR comments on multi-line (`?`/`??`) cards and on single-line cards whose comment is already on the card line. When the vault already uses `#flashcards` or `#flashcards/<deck>`, there is nothing to do for tags.

   Single-line cards (`q::a`, `q:::a`, cloze) whose SR comment sits on its own next line must have it moved onto the card line, or the review history is silently dropped. This command joins a single-line card to a standalone comment that follows it. The card line must start a paragraph, so a multi-line card's last line is left alone, and a comment right after frontmatter is handled:

   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -0777 -pi -e 's/((?:\A|\n\n|\n---\n)[^\n]*(?:\S:::?\S|==[^=\n]+==)[^\n]*?)[ \t]*\n(<!--SR:(?:![0-9-]+,[0-9]+,[0-9]+)+-->)[ \t]*(?=\n|\z)/$1 $2/g'
   ```

   It recognises only `==x==` clozes. A `**x**` or `{{x}}` single-line cloze with a next-line comment is not moved; find those with the validation below and move them by hand.
2. Custom flashcard tag: read the plugin's `data.json` in `$SRC/.obsidian/plugins/obsidian-spaced-repetition/` for the configured tags, then rewrite the tag in frontmatter `tags:` and inline, keeping nested suffixes. This example turns `review` into `flashcards`. It matches `#review`, `#review/deck` and `review` in `tags:` lines and `- review` list items inside the frontmatter, and leaves `#review-later` alone:
   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 'if($ARGV ne $p){$p=$ARGV;$n=0;$fm=0} $n++; if($n==1&&/^---\s*$/){$fm=1} elsif($fm&&/^---\s*$/){$fm=0} if($fm){s/^(tags:.*?[\[\s,"])review(?=$|[\s\],"])/$1flashcards/; s/^(\s*-\s+)#?review[ \t]*$/$1flashcards/} s/(^|[\s\[,"])#review(?=$|[\s\],"\/])/$1#flashcards/g'
   ```
   Check the frontmatter lists by eye afterwards: a nested list item such as `- review/deck` is not rewritten.
3. Folder-based decks: add `tags: [flashcards/<folder name>]` frontmatter to each note in the folder, merging with existing tags first because `prop set` replaces the value:
   ```bash
   bismuth prop set "Folder/Note.md" tags '["flashcards/Folder"]' --vault "$OUT"
   ```
4. A note with several deck tags: split it into one note per deck, or accept that every card lands in the first deck, and report it.
5. If the vault turned bold or curly clozes off, search the card notes for `**` and `{{` inside card blocks. They are cloze markers in Bismuth. Report each note.

## Lossy

- Folder-based decks, per-section deck tags and per-question tags.
- Cloze-marker settings that were turned off.
- Plugin options such as new-card limits and burying siblings; the SM-2 parameters live in the `srs` section of `.settings`.
- Review history on any single-line card whose SR comment is not on the card line after step 1, for example a card that is not at the start of a paragraph: it loads as new.

## Validate

- `bismuth card decks --vault "$OUT" --pretty` lists one deck per flashcard tag with `total` and `due`. The bare `flashcards` tag is the deck with `name` `""`, which is not a failure; a missing deck means a tag mismatch.
- `bismuth card all --vault "$OUT" --pretty | grep -c '"question"'` roughly matches the cards you expect. A reversed card counts twice, and a cloze counts once per marker.
- Review history survived: count the cards that had an SR comment in the source (`grep -rc '<!--SR:' "$SRC" --include='*.md'` per note) and compare with `bismuth card all --vault "$OUT" --pretty | grep -c '"due": "'`. Cards with `"due": null` have no schedule. A single-line card that had a comment in the source but shows `"due": null`, `"interval": 0`, `"ease": 250` still has its comment on a separate line; move it onto the card line. A reversed card or multi-marker cloze has one schedule entry per sub-card, so one comment can account for several `due` values.
