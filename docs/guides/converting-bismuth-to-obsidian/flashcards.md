# Converting Bismuth flashcards to the Spaced Repetition plugin

Bismuth's markdown cards use the Obsidian Spaced Repetition plugin's syntax and its `<!--SR:...-->` scheduling comments, so they copy as is. Two things need work: cloze markers and comment placement need plugin settings, and row-card bases (a `view: flashcards` base whose rows are the cards) must become a cards note. Install the plugin in Obsidian to review the converted cards.

## Sources

Bismuth:
- `docs/flashcards/srs.md`: markdown card syntax, the deck-tag rule, the `<!--SR:...-->` scheduling comment, row cards, bidirectional bases.
- `docs/bases/views/flashcards.md`: the `view: flashcards` base and its field bindings.
- `docs/settings/reference.md`: the `srs:` section (SM-2 parameters).
- `docs/cli/reference.md`: `card all`.

Obsidian Spaced Repetition plugin (a community plugin, not core):
- https://stephenmwangi.com/obsidian-spaced-repetition/flashcards/q-and-a-cards/: `::`, `:::`, `?`, `??`.
- https://stephenmwangi.com/obsidian-spaced-repetition/flashcards/cloze-cards/: cloze delimiters and custom cloze patterns.
- https://stephenmwangi.com/obsidian-spaced-repetition/flashcards/decks/: deck tags (`#flashcards`, nested `#flashcards/deck`).
- https://stephenmwangi.com/obsidian-spaced-repetition/data-storage/: the `<!--SR:...-->` comment and where it is stored.

## Format differences

The comparison orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

Bismuth markdown cards live inline in a note. `front::back` is one way, `front:::back` is both ways (two sub-cards), `front` / `?` / `back` and `??` are the multi-line forms, and clozes are written `==x==`, `{{x}}` or `**x**` (all three always on, inside a card block). A note is collected only if its tags include exactly `flashcards` or `flashcards/<deck>`, in frontmatter or inline. Scheduling is `<!--SR:!YYYY-MM-DD,interval,ease-->`, with one `!date,interval,ease` entry per sub-card: inline on the card's line for single-line cards, and on its own line after the block for multi-line cards. Ease is an integer (250 = 2.5x).

Row cards are a different thing: a `type: base` note with `view: flashcards`, one card per row, with columns `front back due ease interval` (names set by `frontField`, `backField`, `dueField`, `easeField`, `intervalField`) and, when `bidirectional: true`, also `dueBack easeBack intervalBack`.

The Spaced Repetition plugin has the same `::`, `:::`, `?` and `??` forms. A deck is an Obsidian tag, default `#flashcards`, and nested `#flashcards/sub/sub` matches. Clozes are `==x==` by default; other delimiters are custom cloze patterns in the plugin settings (the docs' example `{{[123::]answer[::hint]}}` also matches a bare `{{x}}`). The scheduling comment is the identical `<!--SR:!2024-08-16,51,230-->`, stored by default on the line after the card, with a plugin option, "Save scheduling comment on the same line as the flashcard's last line", to keep it inline. Plugin options live in the plugin's own `data.json`, whose key names are not documented, so set options in the UI.

## Convert

1. Markdown cards copy as is. The text, the `flashcards` and `flashcards/<deck>` tags and the SR comments are already in the plugin's format. Nothing to rewrite unless step 2 or 3 applies.
2. Non-`==` clozes. Bismuth reads `{{x}}` and `**x**` as clozes, and the plugin reads only `==x==` until told otherwise. `card all` strips the cloze delimiters from `question`, so grep the source notes, not the JSON, to find affected notes:
   ```bash
   bismuth card all --vault "$SRC" | jq -r '.[].notePath' | sort -u | while read -r n; do grep -lE '\{\{[^}]+\}\}|\*\*[^*]+\*\*' "$SRC/$n"; done
   ```
   For each note listed, add to the report: "enable custom cloze patterns for `{{x}}` / `**x**` in the Spaced Repetition settings", with the cloze-cards page for the pattern syntax. The `{{...}}` pattern is on that page; the pattern for `**answer**` is unverified, so confirm it there. Do not rewrite the cards: a rewrite would corrupt cards that merely contain bold text.
3. Inline SR comments. Single-line Bismuth cards keep `<!--SR:...-->` on the same line. Report: "turn on Save scheduling comment on the same line as the flashcard's last line" (the option's name on the live page; re-check it) so the plugin reads them as written.
4. Row-card bases become markdown cards. The `bases` conversion deletes the base note, so its cards must become a note. For each `view: flashcards` base:
   - Read the field names and `bidirectional` from `bismuth base read "<rel path>" --vault "$SRC"` (`config.view`).
   - Read the rows. For a body-row base (its cards are YAML rows in the note: no `source:`, or `source: base` with no `ref:`), use the `rows` from the same `base read` call. For a base whose rows come from `source: notes` or a `ref`, use `bismuth base render "<rel path>" --vault "$SRC"` (`groups[].rows`) or `bismuth rows --where '<its filter>' --vault "$SRC"`. Do not use `base render` for a body-row base: it returns zero rows when the base spells `source: base` without a `ref:` (see `bases`, "Before you convert a base").
   - Write `<folder of the base>/<base basename> cards.md`:
     ```markdown
     ---
     tags: [flashcards/<base-basename-with-hyphens>]
     ---
     front text::back text <!--SR:!2026-09-01,4,270-->
     ```
     A row with an empty `due` is a new card and gets no comment. One-way rows use `::`.
   - `bidirectional: true` rows use `:::` and two comment entries, forward first and reverse second: `<!--SR:!due,interval,ease!dueBack,intervalBack,easeBack-->`. A row with no reverse schedule gets only the forward entry. Confirm on the Data Storage page that the plugin accepts a partial pair; if not, drop both and treat the card as new.
   - A front or back containing a newline needs the multi-line form (`?` one way, `??` both ways) with the comment on its own line after the block. Separate cards with a blank line.
   - Row cards whose rows come from `source: notes` (the data lives in other notes' frontmatter) follow the same procedure; `base render` returns the resolved rows for them.
5. Deck tags. Keep the Bismuth tags. If a note holds cards for several decks, Bismuth uses the first deck for all of them (one deck per note), while the plugin allows several tags per note. Nothing to do, but mention it if you see two `flashcards/...` tags in one note.
6. SM-2 settings. The `srs:` section of `.settings` (base ease, bonuses, graduating intervals) has no file to write. List each non-default value (`bismuth settings get --key srs --vault "$SRC"`) in the report as a setting to apply by hand in the plugin.
7. Prose lines that use a delimiter. A line like "`::` is a one-way card" is prose in Bismuth only because of how its parser reads it, and the plugin may read any line with `::` or `:::` as a card. List candidates and compare against `card all`'s questions. Do not edit them; report each as "may become an extra card (unverified)":
   ```bash
   bismuth card all --vault "$SRC" | jq -r '.[].notePath' | sort -u | while read -r n; do grep -nE ':{2,3}' "$SRC/$n"; done
   ```

## Lossy

- Cram mode writes nothing in Bismuth, so there is nothing to convert.
- The `srs:` parameters (step 6), and any difference between SM-2 in Bismuth and the plugin's algorithm: scheduled dates carry over, but future intervals follow the plugin's rules.
- The row-card base itself (its view and field bindings) is replaced by the generated cards note.
- Bismuth's "bold is always a cloze" behaviour (step 2), until the plugin is configured.
- Per-sub-card due dates are preserved only through the SR comment; a card that Bismuth reviewed in a way the comment cannot express (rare) restarts.

## Validate

- Every note from `bismuth card all --vault "$SRC" | jq -r '.[].notePath' | sort -u` exists in `$OUT` with a `flashcards` tag still present: run `grep -lE 'flashcards' "$OUT/<path>"` for each.
- For each generated cards note, `grep -cE '^.+:::?.+' "<note>"` equals the number of rows in the source base.
- No `view: flashcards` base remains (guide step 5 a).
- The report names the Spaced Repetition plugin and lists the settings to apply by hand (steps 2, 3 and 6).
