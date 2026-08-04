# flashcards

A spaced-repetition (SM-2) review UI over a base's rows. Each row is one card.

## Working example

```yaml
---
type: base
source: notes where "#vocab"
views:
  - type: flashcards
    name: Vocabulary
    frontField: front
    backField: back
    dueField: due
    easeField: ease
    intervalField: interval
    bidirectional: false
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `frontField` | `string` | `"front"` | Prompt column, rendered as markdown. |
| `backField` | `string` | `"back"` | Answer column, rendered as markdown. |
| `dueField` | `string` | `"due"` | ISO date column. Missing/empty/`""` = always due (new card). |
| `easeField` | `string` | `"ease"` | SM-2 ease factor (integer %). Written by the scheduler on first grade. |
| `intervalField` | `string` | `"interval"` | SM-2 interval in days. Written by the scheduler on first grade. |
| `bidirectional` | `boolean` | `false` | Reviews each row both ways, with independent scheduling in `<field>Back` companion columns. |

Only `front`/`back` need real values to start — `due`/`ease`/`interval` are populated by the reviewer, not by you.

## Failure modes

- **The CARDS button and per-card edit modal require `basePath`** (a saved base file) — a `flashcards` view inside an embedded ` ```query ` block has no file path, so it cannot open the deck editor or persist grades at all.
- **Bidirectional companion columns are always `<fieldName> + "Back"` positionally, not independently configurable.** Rename `dueField` to `nextReview` and its companion becomes `nextReviewBack`; `easeField`/`intervalField` (still their own defaults) get `easeBack`/`intervalBack`. Declare all the columns your `schema:` needs if you use non-default field names.
- **Cram mode never writes scheduling** — reviewing a deck in cram mode and expecting due dates to advance is a no-op by design; only normal-mode grading calls `POST /cards/review`.

Full reference: `docs/bases/views/flashcards.md`
