# Flashcards (Spaced Repetition plugin)

Convert only when `obsidian-spaced-repetition` is in the source's `.obsidian/community-plugins.json`.

## Sources

- Bismuth: `docs/flashcards/srs.md` (card syntax, deck rules, SR comment, row cards), `docs/settings/reference.md` (the `srs` section), `docs/cli/reference.md` (the `card` commands).
- Obsidian Spaced Repetition: https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/q-and-a-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/cloze-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/decks/, https://www.stephenmwangi.com/obsidian-spaced-repetition/data-storage/, https://github.com/st3v3nmw/obsidian-spaced-repetition

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

| Aspect | Spaced Repetition plugin | Bismuth |
|---|---|---|
| single-line | `front::back`, reversed `front:::back` | the same |
| multi-line | `front` / `?` / `back`, reversed with `??` | the same |
| cloze | `==x==` by default; `**x**` and `{{x}}` are optional settings | `==x==`, `**x**` and `{{x}}` are ALL always on |
| decks | the configured tags (default `#flashcards`, nested `#flashcards/deck/sub`), or the folder structure | the tag must be exactly `flashcards` or `flashcards/<deck>` (frontmatter or inline); no folder decks |
| several deck tags in one note | each tag applies to the cards after it | the first deck path is used for every card in the note |
| scheduling | `<!--SR:!2024-08-16,51,230-->` on the line after the card (or the same line, by setting) | the same comment, same fields: `!date,interval,ease` (ease 250 = 2.5x) |
| note reviews | `sr-due`, `sr-interval`, `sr-ease` in frontmatter | not read; harmless, keep or drop |

A note is collected ONLY if its tags include `flashcards` or `flashcards/<deck>`; an untagged note with perfect card syntax yields nothing.

## Convert

1. Card text and SR comments copy unchanged. Nothing to do when the vault already uses `#flashcards` or `#flashcards/<deck>`.
2. Custom flashcard tag (read the plugin's `data.json` in `$SRC/.obsidian/plugins/obsidian-spaced-repetition/` for the configured tags): rewrite it in frontmatter `tags:` and inline, keeping nested suffixes. The example turns `review` into `flashcards`. It matches `#review`, `#review/deck` and `review` in `tags:` lines and `- review` list items inside the frontmatter, and leaves `#review-later` alone:
   ```bash
   find "$OUT" -name '*.md' -print0 | xargs -0 perl -pi -e 'if($ARGV ne $p){$p=$ARGV;$n=0;$fm=0} $n++; if($n==1&&/^---\s*$/){$fm=1} elsif($fm&&/^---\s*$/){$fm=0} if($fm){s/^(tags:.*?[\[\s,"])review(?=$|[\s\],"])/$1flashcards/; s/^(\s*-\s+)#?review[ \t]*$/$1flashcards/} s/(^|[\s\[,"])#review(?=$|[\s\],"\/])/$1#flashcards/g'
   ```
   Check the frontmatter lists by eye afterwards: a nested list item such as `- review/deck` is not rewritten.
3. Folder-based decks: add `tags: [flashcards/<folder name>]` frontmatter to each note in the folder (`bismuth prop set "Folder/Note.md" tags '["flashcards/Folder"]' --vault "$OUT"`; merge with existing tags first, `prop set` replaces the value).
4. A note with several deck tags: split it into one note per deck, or accept that every card lands in the first deck and report it.
5. If the vault disabled bold or curly clozes, search the card notes for `**` and `{{` inside card blocks; they are cloze markers in Bismuth now. Report each note.

## Lossy

- Folder-based decks, per-section deck tags, and per-question tags.
- Cloze-marker settings that were turned off.
- Plugin options (new-card limits, burying siblings): the SM-2 parameters live in the `srs` section of `.settings`.

## Validate

- `bismuth card decks --vault "$OUT" --pretty` lists one deck per flashcard tag with `total` and `due` (the bare `flashcards` tag is the deck with `name` `""`, not a failure); a missing deck means a tag mismatch.
- `bismuth card all --vault "$OUT" --pretty | grep -c '"question"'` roughly matches the cards you expect (a reversed card counts twice, a cloze counts once per marker).
