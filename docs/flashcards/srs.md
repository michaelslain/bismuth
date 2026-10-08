# Flashcards and spaced repetition

Bismuth turns markdown into flashcards and schedules reviews with SM-2, a spaced-repetition algorithm that shows a card again after a longer gap each time you answer well. A note yields cards only if it carries the `flashcards` tag; an untagged note with perfect card syntax yields nothing.

Cards also live as rows of a base shown in the flashcards view, which is how the app reviews them. See [the flashcards view](../bases/views/flashcards.md) for that view's configuration and review screen.

```markdown
---
tags: [flashcards/spanish]
---

Capital of France::Paris

dog:::perro

What is the mitochondria?
?
The powerhouse of the cell

The ==sun== is a {{star}}
```

This note has four cards in the deck `spanish`: a basic card, a two-way card, a multi-line card and a cloze card with two deletions.

## How do I write a card?

A card is a block of consecutive lines; a blank line ends the block. Text that matches no card syntax is ignored, so a note can mix cards and prose.

| Type | Write | Cards made |
|---|---|---|
| Basic, one line | `front::back` | one |
| Two-way, one line | `front:::back` | two: front to back, back to front |
| Basic, multi-line | front lines, a line holding only `?`, back lines | one |
| Two-way, multi-line | front lines, a line holding only `??`, back lines | two |
| Cloze | text with `==hidden==`, `{{hidden}}` or `**hidden**` | one per marker |

Each cloze card hides one marker as `[...]` and reveals every marker, stripped of its delimiters, on the answer. `The ==sun== is a {{star}}` makes one card asking `The [...] is a star` and one asking `The sun is a [...]`. The three marker styles can be mixed in one block, and a cloze block may span several lines.

Each card of a two-way pair is scheduled on its own, so you can know one direction and still be drilled on the other.

## Which notes count, and what is a deck?

A note is a flashcard note when its tags include `flashcards` or a tag that starts with `flashcards/`. Write the tag in frontmatter (`tags: [flashcards/math]`) or inline in the body (`#flashcards/math`).

The deck is the tag's suffix.

| Tag | Deck |
|---|---|
| `flashcards` | the root deck, named with an empty string |
| `flashcards/math` | `math` |
| `flashcards/math/algebra` | `math/algebra` |

If a note carries several flashcard tags, all its cards go in the deck of the first one. A card in an untagged note is invisible to deck, due and all-cards listings. It is still reachable by naming the note directly, which is how per-note review works (see below).

## How do I review markdown cards?

Markdown cards are listed and reviewed with the `bismuth card` commands or the `/cards/*` HTTP routes; the app's flashcards view reviews base rows.

```bash
bismuth card decks --vault ~/vault --pretty
bismuth card due --deck math --vault ~/vault
bismuth card note "Notes/Biology.md" --vault ~/vault
bismuth card review "math.md::0::0" good --vault ~/vault
```

`card decks` lists each deck with its total and due counts, `card due` lists cards due today or never reviewed, `card all` lists every card, and `card note <path>` lists one note's cards even without the tag. The review response is `hard`, `good` or `easy`. The card id in `card review` comes from the `id` field of a listed card. Every command is documented in the [CLI reference](../cli/reference.md).

Cards from notes hidden from agents are left out of agent-run commands; see [visibility](../vault/visibility.md).

## What does cram mode do?

Cram mode reviews every card in a deck regardless of due date and writes nothing. Toggle it with the CRAM button in the flashcards view. A card graded good or hard comes back later in the session, and the session ends when every card has been graded easy. Cram applies to base-row decks; markdown cards have no cram mode. Details are on the [flashcards view page](../bases/views/flashcards.md).

## How do base-row cards schedule?

A row in a flashcards base keeps its schedule in its own columns: `due` (a date, empty for a new card), `ease` and `interval`. Grading rewrites those columns on the row and leaves every other column alone. The column names are configurable per view (`dueField`, `easeField`, `intervalField`), as set out on the [flashcards view page](../bases/views/flashcards.md).

With `bidirectional: true` each row is reviewed in both directions. The reverse direction schedules in a second set of columns named by adding `Back` to each: `dueBack`, `easeBack`, `intervalBack`. A row `{front: red, back: אדום, due: 2026-05-01, interval: 5, ease: 250}` with an empty `dueBack` shows the reverse as a new card, and grading it moves only the `*Back` columns.

An empty or missing `due` makes the card new. Non-numeric `ease` or `interval` values fall back to the defaults instead of breaking the review.

## How do I tune the scheduler?

Set the `srs` section in `.settings`; changes apply to the next review with no restart.

| Key | Default | Range | Effect |
|---|---|---|---|
| `srs.baseEase` | 250 | 130 to 400 | starting ease for a new card; 250 means a 2.5 times multiplier |
| `srs.easyBonus` | 1.3 | 1 to 2 | extra interval multiplier on an easy review |
| `srs.lapsesIntervalChange` | 0.5 | 0.1 to 1 | interval multiplier on a hard review |
| `srs.minEase` | 130 | 50 to 250 | ease never drops below this |
| `srs.easeStep` | 20 | 5 to 50 | ease change per hard or easy review |
| `srs.easyGraduatingInterval` | 4 | 1 to 14 | days until the next review of a new card graded easy |
| `srs.goodGraduatingInterval` | 1 | 1 to 3 | days until the next review of a new card graded good or hard |

Every `.settings` key is listed in the [settings reference](../settings/reference.md).

## What goes wrong with cards?

- **Bold text in a flashcards note makes a cloze card.** `**text**` is a deletion marker, so any block that contains bold text and no `::`, `?` or `??` separator becomes a cloze card, and its bold text is hidden when you review. Avoid bold in tagged notes, and note that `==text==` and `{{text}}` are deletion markers too.
- **Editing a note shifts card ids.** A markdown card id is `notePath::cardIndex::subIndex`, where `cardIndex` is the card's position in the note. Inserting or removing a card changes the index of every card after it. `POST /cards/review` accepts an optional `question`; if it differs from the card now at that position, the review fails with `409` `CARD_CONTENT_CHANGED` instead of scheduling the wrong card.
- **Reviewing one direction schedules the other.** Reviewing one sub-card of a two-way or cloze card gives its unreviewed siblings a first schedule using the same response, as if each were new.
- **A block with only a schedule comment is not a card.** A card needs non-empty front and back text.

## How it works

The parser, the scheduler and the persistence format are separate pure modules in `core/src/srs/`; `cards.ts` joins them to the vault.

### Parsing

`parseCards(body)` in `parser.ts` splits a note body into blocks of consecutive non-blank lines and tests each block independently. A one-line block is tested for `:::` first, then `::`, then cloze markers; testing `:::` first keeps `dog:::perro` from reading as `dog:` and `:perro`. A multi-line block is tested for a `??` line, then a `?` line, then cloze markers. The front is everything before the separator line and the back everything after it. Cloze markers are matched by `CLOZE_RE`.

`collectCards` reads every markdown note, takes its tags from frontmatter and body, and skips notes with no flashcard tag. `deckPathsFromTags` strips the `flashcards/` prefix to get deck names. `noteCards` skips the tag check and uses the deck `""` when the note has none.

Each parsed card records its start line, end line and where its schedule comment sits, which `rewriteCardSchedule` uses to write a review back in place.

### The SM-2 scheduler

`schedule(prev, response, today, cfg)` in `scheduler.ts` takes the previous `{due, interval, ease}` (null for a new card) and returns the next. `ease` is an integer where 250 means 2.5 times. The server passes `appConfig.srs` as `cfg`.

| Card | Response | Interval | Ease |
|---|---|---|---|
| New | hard or good | `goodGraduatingInterval` | `baseEase` |
| New | easy | `easyGraduatingInterval` | `baseEase + easeStep` |
| Existing | hard | `max(1, round(interval × lapsesIntervalChange))` | `max(minEase, ease − easeStep)` |
| Existing | good | `round(interval × ease / 100)` | unchanged |
| Existing | easy | `round(interval × newEase / 100 × easyBonus)` | `ease + easeStep` |

The interval is then clamped to between 1 and 36525 days (100 years), and `due` is `today` plus the interval. With defaults, a new card graded good on 2026-05-27 is due 2026-05-28 with ease 250, and graded easy it is due 2026-05-31 with ease 270. An existing card with interval 10 and ease 250 gets interval 25 on good and 35 on easy; with ease 140, hard gives ease 130 and interval 5.

### Where the schedule is stored

A markdown card's schedule is an HTML comment of one `!date,interval,ease` entry per sub-card. A one-line card carries it at the end of its line; a multi-line card carries it on its own line after the block.

```markdown
2+2::4 <!--SR:!2026-05-28,1,250-->
dog:::perro <!--SR:!2026-05-28,1,250!2026-06-01,4,270-->

What is the mitochondria?
?
The powerhouse of the cell
<!--SR:!2026-05-31,4,270-->
```

`SR_COMMENT_RE` matches the whole comment, `parseScheduling` reads the entries and `formatScheduling` writes them. A review replaces the comment in place and never adds a second one.

### HTTP routes

The `/cards/*` routes live in `core/src/routes/bases.ts`. Reads are `GET`s that never invalidate caches; every read drops cards from notes the caller may not see, and `GET /cards/note` returns `403` for a denied note.

| Route | Effect |
|---|---|
| `GET /cards/decks` | decks with `name`, `total` and `due`, sorted by name, computed from the visible cards |
| `GET /cards/all` | every card from every tagged note |
| `GET /cards/due?deck=<name>` | cards never reviewed or due today or earlier; `deck` is optional |
| `GET /cards/note?path=<path>` | all cards in one note, tagged or not |
| `POST /cards/review` | schedules one card; see below |

A `Card` has `id`, `notePath`, `deck`, `type` (`single-basic`, `single-reversed`, `multi-basic`, `multi-reversed` or `cloze`), `question`, `answer`, `due` (null if never reviewed), `interval` (0 if new) and `ease` (250 if new).

`POST /cards/review` takes a `response` of `hard`, `good` or `easy` and picks its path from the rest of the body. With `file` and `index`, it reviews a base row: `applyReviewToRow` advances the row's schedule columns, and `dueField`, `easeField` and `intervalField` override which columns to use (the reverse direction passes the `*Back` triple). With `id`, it reviews a markdown card: the sub-card gets a new schedule, its siblings keep theirs or get a first one, and the note is rewritten in place. With neither, it returns `400`. Row reviews invalidate the base file's caches; markdown reviews pass no path.

Source: `core/src/srs/parser.ts`, `core/src/srs/cards.ts`, `core/src/srs/scheduler.ts`, `core/src/srs/reviewRow.ts`, `core/src/srs/types.ts`, `core/src/routes/bases.ts`, `core/src/schema/settingsSchema.ts`, `cli/src/commands/card.ts`, `app/src/bases/flashcardsQueue.ts`, `app/src/bases/FlashcardsView.tsx`
