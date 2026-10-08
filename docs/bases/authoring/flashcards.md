# flashcards

A spaced-repetition (SM-2) review screen over a base's rows. Each row stored in the base file's own body is one card.

## Working example

```markdown
---
type: base
view: flashcards
frontField: front
backField: back
bidirectional: false
---
- front: hola
  back: hello
- front: casa
  back: house
```

Write only `front` and `back`. The reviewer writes `due`, `ease` and `interval` onto each row when it is graded.

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `frontField` | `string` | `"front"` | Prompt column, rendered as markdown. |
| `backField` | `string` | `"back"` | Answer column, rendered as markdown. |
| `dueField` | `string` | `"due"` | `YYYY-MM-DD`. Missing or empty means a new card, due now. |
| `easeField` | `string` | `"ease"` | SM-2 ease, written by the reviewer. |
| `intervalField` | `string` | `"interval"` | Interval in days, written by the reviewer. |
| `bidirectional` | `boolean` | `false` | Review each row both ways; the reverse schedule lives in `<field>Back` columns (`dueBack`, `easeBack`, `intervalBack`). |

The `flashcards` tag is not needed. It only selects notes for markdown cards (see `docs/flashcards/srs.md`).

## Failure modes

- If the base has a `source:`, the view lists the resolved rows but writes grades and edits to the base file's own body by position: a grade fails with "row not found", or lands on a different row. Keep the cards in the base file's body and leave `source:` out.
- The view ignores `filters`, `sort` and `limit`. Every row is a card.
- In an embedded ` ```query ` block grades are not saved and the editing buttons are hidden. Use a saved base file.
- Cram never writes a schedule, so a deck reviewed only in cram stays due.
- A renamed scheduling column renames its companion too: `dueField: nextReview` pairs with `nextReviewBack`.

Full reference: [docs/bases/views/flashcards.md](../views/flashcards.md)
