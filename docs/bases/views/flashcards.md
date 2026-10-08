# Flashcards view

A flashcards view reviews a base's rows as spaced-repetition cards: each row is one card with a front, a back and three scheduling columns the reviewer fills in. How grades change the schedule (SM-2), and the separate markdown-card syntax, live in [Flashcards and spaced repetition](../../flashcards/srs.md).

```markdown
---
type: base
view: flashcards
---
- front: hola
  back: hello
- front: casa
  back: house
```

The rows sit in the base file's own body, as a YAML list. Both cards are new, so both are due now. Grading one writes `due`, `ease` and `interval` onto its row.

## Flashcards config keys

Every key below is a top-level frontmatter key beside `view: flashcards`. Each names a row column; the base settings panel (the gear in the view bar) binds all of them without editing YAML.

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `frontField` | string | any column name | `front` | Column shown first; rendered as markdown |
| `backField` | string | any column name | `back` | Column revealed on flip; rendered as markdown |
| `dueField` | string | any column name | `due` | Next review date, `YYYY-MM-DD` |
| `easeField` | string | any column name | `ease` | Ease factor, written by the reviewer |
| `intervalField` | string | any column name | `interval` | Interval in days, written by the reviewer |
| `bidirectional` | boolean | `true`, `false` | `false` | Review every card both ways, each with its own schedule |

A card is due when its due column is missing, empty, or a date on or before today. A card with only `front` and `back` is new and due at once; you never write `due`, `ease` or `interval` yourself.

## Review both directions

`bidirectional: true` puts every row in the queue twice: front → back and back → front. The reverse direction keeps its own schedule in companion columns named by appending `Back` to each scheduling column:

| Direction | Due | Ease | Interval |
|---|---|---|---|
| front → back | `due` | `ease` | `interval` |
| back → front | `dueBack` | `easeBack` | `intervalBack` |

The companion name always follows the configured name: `dueField: nextReview` gives `nextReviewBack`. Each direction is due on its own, so a row can be due one way and not the other. The view bar shows **front → back** or **back → front** for the card in front of you.

## Review a deck

The stage shows one card at a time and a progress meter. Flip the card, then grade it.

| Key | Action |
|---|---|
| Space | Flip the card (also: click it) |
| 1 | Grade **hard** |
| 2 | Grade **good** |
| 3 | Grade **easy** |

The grade keys work only after the card is flipped. All four are rebindable keybindings (`flashcard-flip`, `flashcard-hard`, `flashcard-good`, `flashcard-easy`); see [Keybindings](../../settings/keybindings.md). The grade buttons show the current key under each label.

A grade moves the card out of the queue straight away and writes its new schedule to the row. The view bar shows your position (`n / total`) and a running **hard**, **good** and **easy** tally. When the queue empties, the stage shows **Deck complete**; **No cards due** means nothing is due today.

Your place in a deck (position, tally, cram state) survives switching tabs, but not reloading the app.

## Cram a deck

Click **cram** in the view bar to review every card regardless of due date. Cram never writes a schedule.

- Cards loop until each one is graded **easy**; **good** and **hard** bring the card back on a later pass.
- The progress meter and the position count show cards mastered so far.
- When every card is easy, the stage shows **Cram complete**. An empty deck shows **No cards in this deck**.
- Turning cram on or off restarts the session at the first card with an empty tally.

## Edit, reset and delete the current card

Three buttons sit on both faces of the card under review:

- **Edit this card** opens a modal with **front** and **back** fields; saving writes the row.
- **Reset this card's progress** removes its scheduling columns (and the `Back` companions on a bidirectional deck), so the card is new again. Front, back and every other column stay.
- **Delete this card** removes the row at once, with an **Undo** toast.

## Manage every card in the deck

Click **cards** in the view bar to open the **edit cards** modal. It has two tabs.

**cards** lists every card with editable front and back cells (markdown preview, raw text while focused). Drag the `#` handle, or use Up and Down on it, to reorder. Each row has reset and delete buttons, and a draft row at the bottom adds a card: Enter in front moves to back, Enter in back adds it. **reset all progress** in the footer resets every card after a second click within four seconds.

**bulk add** creates many cards from pasted text, one card per line, front and back split at the first separator:

| Separator | Splits on |
|---|---|
| auto | the first of tab, `:::`, `::`, `\|`, `–`, `:`, `,` found in the line |
| tab | a tab |
| `:::`, `::`, `:` | that run of colons |
| `\|` | a pipe |
| `,` | a comma |
| `–` | an en dash |

A line with no separator becomes a card with an empty back; a line with an empty front is skipped. A live preview marks cards with no back before you add them.

The modal saves each edit as you make it and refreshes the review queue when it closes.

## Silent failures

- The view grades and edits rows in the base file's own body, addressed by position. A base with a `source:` lists its resolved rows, but a grade or edit then targets the base file's own body instead of the card's note: it fails with "row not found" when the body is empty, or writes a different row when it is not. Keep a deck's cards in the base file.
- The view ignores the base's `filters`, `sort` and `limit`; every row is a card.
- In an embedded ` ```query ` block nothing is written: grades are not saved, and the edit, reset and delete buttons and **cards** are hidden.
- Cram never saves a schedule. A deck reviewed only in cram is still due afterwards.
- The `flashcards` tag plays no part here. It only selects notes for markdown cards, described in [Flashcards and spaced repetition](../../flashcards/srs.md).

## How it works

`BaseView` renders flashcards full-pane: it hands `FlashcardsView` the base's resolved rows (`data().rows`) and skips `runView`, which is why filters, sort and limit do not apply. Field names come from the `ViewConfig` that `parse.ts`'s `normalizeView` builds.

The queue is pure and unit-tested in `flashcardsQueue.ts`: `buildQueue` (due filter, cram, bidirectional), `backField` (the `Back` suffix), `nextPosAfterGrade`, `nextCramPos` and `itemKey` (`<rowIndex>:<dir>`, the cram retire key), the pending-grade overlay (`withoutPending`, `livePending`) that hides a graded card until the refetch brings its new due date, and the per-base-path session store (`loadSession`, `saveSession`). `flashcardsActions.ts` holds `scheduleColumns`, `resetKeys` and `stripSchedule`.

Writes go to the base file by row index: a grade is `POST /cards/review` with `file` and `index` (`api.reviewCardRow`, which runs `applyReviewToRow` in `core/src/srs/reviewRow.ts`); edits and resets are `api.rowUpdate`, reset all is `api.rowUpdateMany`, adds are `api.rowCreate`, deletes `api.rowDelete`, reorders `api.rowReorder`. The bulk parser is `parseBulk` in `cardsEdit.ts`.

Source: `app/src/bases/FlashcardsView.tsx`, `app/src/bases/flashcardsQueue.ts`, `app/src/bases/flashcardsActions.ts`, `app/src/bases/EditCardsModal.tsx`, `app/src/bases/CardsListEditor.tsx`, `app/src/bases/cardsEdit.ts`, `app/src/bases/BaseView.tsx`, `core/src/routes/bases.ts`, `core/src/srs/reviewRow.ts`
