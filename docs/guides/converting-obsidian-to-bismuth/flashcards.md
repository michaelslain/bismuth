# Converting Spaced Repetition flashcards

Bismuth reads the Obsidian Spaced Repetition plugin's card syntax and its `<!--SR:...-->` scheduling comments directly, so card text copies unchanged. `bismuth import obsidian` handles the differences that silently drop review history or decks: scheduling comments on their own line, custom deck tags and folder decks. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/flashcards/srs.md` (card syntax, deck rules, SR comment, row cards), `docs/settings/reference.md` (the `srs` section), `docs/cli/reference.md` (the `card` commands).
- Obsidian Spaced Repetition: https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/q-and-a-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/cloze-cards/, https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/decks/, https://www.stephenmwangi.com/obsidian-spaced-repetition/data-storage/, https://github.com/st3v3nmw/obsidian-spaced-repetition

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

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

## What the command converts

- A scheduling comment that sits on its own line after a single-line card moves onto the card line. The card line must start a paragraph and the comment must end it; a multi-line card's last line is left alone.
- When the plugin's `data.json` lists custom flashcard tags, each one is rewritten to `flashcards` in frontmatter `tags:` and inline, keeping nested suffixes (`#review/deck` becomes `#flashcards/deck`).
- When the plugin's `convertFolderToDecks` setting is on, each note holding cards in a subfolder gains the tag `flashcards/<top-level folder>`, with spaces in the folder name written as `-`.

## What the command reports

| Section | Item |
|---|---|
| Converted | per note: `N SR comment(s) moved onto the card line`, `custom deck tag rewritten to flashcards`, `folder deck added as tag #flashcards/<folder>` |
| Lossy | `several deck tags in one note, every card uses the first` |

Nothing from this area lands under Needs a decision. The command does not report a cloze-marker setting that was turned off in the plugin, plugin options such as new-card limits and burying siblings (the SM-2 parameters live in the `srs` section of `.settings`), or a comment that could not be moved because its card does not start a paragraph.

## Resolve a Lossy item by hand

- **Several deck tags in one note**: split the note into one note per deck, or accept that every card lands in the first deck, and tell the user.
- **Cloze markers the plugin had turned off**: search the card notes for `**` and `{{` inside card blocks. They are cloze markers in Bismuth, so each such card becomes a cloze. Tell the user which notes.
- **A card whose comment stayed on its own line**: a card that is not at the start of a paragraph loads as new. Move its `<!--SR:...-->` comment onto the card line.

## Validate

- `bismuth card decks --vault "$OUT" --pretty` lists one deck per flashcard tag with `total` and `due`. The bare `flashcards` tag is the deck with `name` `""`, which is not a failure; a missing deck means a tag mismatch.
- `bismuth card all --vault "$OUT" --pretty | grep -c '"question"'` roughly matches the cards you expect. A reversed card counts twice, and a cloze counts once per marker.
- Review history survived: count the cards that had an SR comment in the source (`grep -rc '<!--SR:' "$SRC" --include='*.md'` per note) and compare with `bismuth card all --vault "$OUT" --pretty | grep -c '"due": "'`. A single-line card that had a comment in the source but shows `"due": null`, `"interval": 0`, `"ease": 250` still has its comment on a separate line. A reversed card or multi-marker cloze has one schedule entry per sub-card, so one comment can account for several `due` values.
