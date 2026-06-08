# Flashcards View

The flashcards view is a spaced-repetition review UI built on top of a base's rows. It is one of the twelve `ViewType` values (`"flashcards"`) and renders via `FlashcardsView.tsx`. Each row in the underlying base represents one card: a prompt side (front), an answer side (back), and three SM-2 scheduling columns (due date, ease factor, interval). The view handles due-card filtering, queue management, grading, bidirectional review, cram mode, in-session editing, and bulk card creation — all through standard base row operations.

For the SM-2 scheduling algorithm and the markdown-card (`?`/`??`) code path see [../../../flashcards/srs.md](../../flashcards/srs.md).

---

## View Configuration

Add a flashcards view to a `type: base` file by setting `type: flashcards` in the `views` array:

```yaml
---
type: base
source: notes where #vocab
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

All fields below are defined in `ViewConfig` (`core/src/bases/types.ts`).

### `frontField` (string, default `"front"`)

The row column used as the card's prompt (the side shown first). Any string value is rendered as markdown.

### `backField` (string, default `"back"`)

The row column used as the answer (the side revealed after Space). Rendered as markdown.

### `dueField` (string, default `"due"`)

The ISO-8601 date string column (`YYYY-MM-DD`) that stores when the card is next due. A card is included in the queue when:

- the column is missing or null → treated as a new card (always due)
- the column value is `""` (empty string) → always due
- the string value is `<= today` → due

Cards with a future date string are excluded from the normal queue (but included in cram mode).

### `easeField` (string, default `"ease"`)

Integer percentage (e.g. `250` = 2.5×) tracking the card's difficulty multiplier in the SM-2 algorithm. Missing/empty on a new card; initialized on first review. Minimum value enforced by the scheduler is `130` (1.30×).

### `intervalField` (string, default `"interval"`)

Integer day count for the current review interval. Missing/empty on a new card.

### `bidirectional` (boolean, default `false`)

When `true`, every row produces **two** queue entries: a forward entry (front → back) and a reverse entry (back → front). Each direction is scheduled independently using separate companion columns — see [Bidirectional Mode](#bidirectional-mode) below.

---

## Column Schema for a Flashcards Base

A minimal base file whose rows are cards needs these frontmatter columns. Only `front` and `back` are required to create cards; the scheduling columns are written by the reviewer on first grade.

| Column | Type | Required | Description |
|---|---|---|---|
| `front` | text | yes | Prompt shown on card face. Markdown rendered. |
| `back` | text | yes | Answer revealed after Space. Markdown rendered. |
| `due` | date (`YYYY-MM-DD`) | no | Next review date. Empty = new card (always due). |
| `ease` | number | no | SM-2 ease factor (integer %). Empty = new card. |
| `interval` | number | no | SM-2 interval in days. Empty = new card. |
| `dueBack` | date | bidirectional only | Due date for the reverse direction. |
| `easeBack` | number | bidirectional only | Ease factor for the reverse direction. |
| `intervalBack` | number | bidirectional only | Interval for the reverse direction. |

The `*Back` column names are derived by appending `"Back"` to the configured field names via `backField(field)` in `flashcardsQueue.ts`. With defaults: `dueBack`, `easeBack`, `intervalBack`.

---

## Review Queue

### `buildQueue(rows, dueField, today, cram, bidirectional?)`

Defined in `app/src/bases/flashcardsQueue.ts`. Pure function — no side effects, fully unit-tested.

**Signature:**
```ts
buildQueue(
  rows: Row[],
  dueField: string,
  today: string,     // "YYYY-MM-DD"
  cram: boolean,
  bidirectional?: boolean,
): QueueItem[]
```

**`QueueItem` shape:**
```ts
type QueueItem = {
  r: Row;           // the full row object
  index: number;    // stable row index in the original rows array (NOT queue position)
  dir: CardDir;     // "fwd" | "rev"
  dueField: string; // which due column governs this entry's schedule
};
```

**Normal mode** (`cram: false`): includes only rows where `row.note[dueField]` is null, `""`, or `<= today`. In bidirectional mode each direction is filtered against its own due column independently — a row can be due forward but not reverse or vice versa.

**Cram mode** (`cram: true`): includes all rows in original order regardless of due date. Scheduling is never written in cram mode.

**Bidirectional mode**: each row contributes two entries, `{dir: "fwd", dueField: dueField}` and `{dir: "rev", dueField: dueField + "Back"}`. Both entries share the same `index` but are filtered and scheduled independently.

**Stable `index`**: the `index` field is the row's position in the original `rows` array, not its position in the queue. After a card is reviewed and dropped from the queue (its due date pushed forward), the queue shortens. The remaining cards keep their original indices, so callers can track a specific card across refetches without position arithmetic.

```ts
// From flashcardsQueue.test.ts — stable index survives queue shortening:
const before = buildQueue([card("a", TODAY), card("b", TODAY), card("c", TODAY)], "due", TODAY, false);
// before[0].index === 0, before[1].index === 1, before[2].index === 2

const after = buildQueue([card("a", "2026-06-10"), card("b", TODAY), card("c", TODAY)], "due", TODAY, false);
// after[0].index === 1  ← 'b' now at queue pos 0 but carries index 1
// after[1].index === 2
```

### `nextPosAfterGrade(pos, opts)`

Pure helper that returns the next queue position after grading. Avoids a subtle skip-one bug (regression B5) when the queue shrinks on refetch.

```ts
nextPosAfterGrade(pos: number, opts: { cram: boolean; persisted: boolean }): number
```

| Scenario | Behavior | Reason |
|---|---|---|
| `cram: true` | `pos + 1` | Queue never changes membership; step forward. |
| `cram: false, persisted: true` | stay at `pos` | Graded card drops out on refetch; next card shifts into `pos`. |
| `cram: false, persisted: false` | `pos + 1` | Card stays due (no write); must advance to avoid showing it again. |

```ts
// The skip-one regression (fixed): grading card at pos 0 in a persisted queue
// must NOT increment to 1, or the queue shift (a → future) would land on 'c',
// skipping 'b' entirely.
nextPosAfterGrade(0, { cram: false, persisted: true })  // → 0
nextPosAfterGrade(0, { cram: true, persisted: false })   // → 1
```

---

## Grading

After revealing a card the user grades it with one of three responses:

| Grade | Key | Behavior |
|---|---|---|
| `"hard"` | `1` | Decreases ease by `easeStep` (20 pts), multiplies interval by `lapsesIntervalChange` (0.5) |
| `"good"` | `2` | Keeps ease, multiplies interval by `ease / 100` |
| `"easy"` | `3` | Increases ease by `easeStep`, multiplies interval by `ease / 100 * easyBonus` (1.3) |

Grades are posted to `POST /cards/review` via `api.reviewCardRow()`. The backend applies SM-2 via `applyReviewToRow` in `core/src/srs/reviewRow.ts` and writes the updated `due`, `ease`, and `interval` columns back to the base row. See [../../../flashcards/srs.md](../../flashcards/srs.md) for full scheduler details.

**Cram mode never writes scheduling.** When `cram` is `true`, the grade is tracked in the session tally (GOOD/HARD counts) but no API call is made and no row is updated.

### Keyboard Shortcuts

While the flashcards view is active (and no modal or text field has focus):

- **Space** — reveal the answer (flip the card)
- **1** — grade Hard
- **2** — grade Good
- **3** — grade Easy

Keys `1`/`2`/`3` are ignored until the card is revealed.

---

## Bidirectional Mode

When `bidirectional: true`, each row's card is reviewed in both directions:

- **Forward** (`"fwd"`): prompt = `frontField`, answer = `backField`
- **Reverse** (`"rev"`): prompt = `backField`, answer = `frontField`

The two directions are scheduled **independently** using separate column triples:

| Direction | Due column | Ease column | Interval column |
|---|---|---|---|
| Forward | `dueField` (e.g. `due`) | `easeField` (e.g. `ease`) | `intervalField` (e.g. `interval`) |
| Reverse | `dueField + "Back"` = `dueBack` | `easeField + "Back"` = `easeBack` | `intervalField + "Back"` = `intervalBack` |

The `backField(field)` function (exported from `flashcardsQueue.ts`) computes the companion column name:

```ts
backField("due")         // → "dueBack"
backField("nextReview")  // → "nextReviewBack"
```

When a reverse card is reviewed, `api.reviewCardRow()` receives the `*Back` field names as the `fields` override so the scheduler writes to `dueBack`/`easeBack`/`intervalBack` rather than the forward triple.

A **new row with no scheduling columns** is due in both directions immediately:
```ts
// From flashcardsQueue.test.ts:
const rows = [row({ front: "a", back: "b" })];  // no due / dueBack
buildQueue(rows, "due", "2026-05-30", false, true);
// → [{dir: "fwd", …}, {dir: "rev", …}]  — both directions due
```

A row can be due in one direction only:
```ts
// From flashcardsQueue.test.ts:
const rows = [row({ front: "a", back: "b", due: "2026-12-01", dueBack: "2026-01-01" })];
buildQueue(rows, "due", "2026-05-30", false, true);
// → [{dir: "rev", …}]  — only reverse is due (dueBack is past, due is future)
```

The header strip shows a direction indicator (`"front → back"` / `"back → front"`) when `bidirectional` is on and a card is being reviewed.

---

## Cram Mode

Cram mode reviews every card in the deck regardless of due date and never modifies scheduling state. Activated by the CRAM button (Zap icon) in the header. The button shows as "selected" when cram is active.

Toggling cram resets the session position to 0 and clears the GOOD/HARD tally.

When cram is active:
- `buildQueue` returns all rows in original order
- `nextPosAfterGrade` always steps to `pos + 1`
- no `api.reviewCardRow()` call is made on grade
- `onReviewed()` is NOT called (no refetch needed)
- the completion screen reads "Cram complete" instead of "Deck complete"

The empty-state message in cram mode changes to "No cards in this deck" (as opposed to "No cards due" in normal mode), with a hint to add rows.

---

## Session Progress Bar

The header strip shows a gradient progress bar and a GOOD/HARD tally.

- **Progress**: `graded / total` where `graded = goodCount + hardCount` and `total = graded + queue.length` (anchored to the starting size rather than using the shrinking queue)
- **GOOD** counter: increments on `"good"` and `"easy"` responses
- **HARD** counter: increments on `"hard"` responses

---

## Card Rendering

Both the front and back of a card render their content as markdown (Lora serif font; inline `code` in monospace). The rendering is done by `renderMarkdown()` from `./markdown`.

### Flip Animation

The card uses a CSS 3D flip (`rotateY` transition):

- **Same card, reveal**: clicking the card or pressing Space triggers the flip from front to back. The card element persists so the transition plays.
- **New card**: the card element is keyed by `{index}:{dir}`. When the current card changes (different index or different direction), the old element is unmounted and a fresh one is created. The fresh element plays a scale+fade entrance animation (`card-appear`) instead of an unwanted backward flip.

### Edit / Delete on Card Face

Pencil and Trash2 icon buttons appear on both the front and back faces. Clicking them opens the single-card edit modal or deletes the card immediately (without a confirmation prompt). `stopPropagation` prevents these clicks from also triggering the reveal flip.

---

## Single-Card Edit Modal

Accessible via the Pencil icon on the card face (not the deck-wide Cards modal). Provides two multiline `TextInput` fields labeled Front and Back. Saving calls `api.rowUpdate()` with the updated note and triggers `onReviewed()` to refresh the queue.

---

## EditCardsModal

The deck-wide card manager, opened by the CARDS button (Layers icon) in the header. It is only available when `basePath` is provided (i.e., the view is rendering a saved base file, not an inline query block). It has two modes toggled by a `SegmentedToggle`:

### Cards (List) Mode

A scrollable list of all cards in the deck. Each row shows a row number handle, an editable Front cell, an editable Back cell, and a delete button.

**Inline editing**: each cell (`CardCell`) renders a markdown preview (driven by a `<div class="cell-md">`) with a transparent `<textarea>` layered over it. The preview drives the cell's height so there is no font-load or auto-grow race. Editing reveals the raw markdown on `:focus-within`; the textarea commits to the backend on `blur` via `api.rowUpdate()`.

**Inline add (draft row)**: a fixed row at the bottom with `+` as the row number. Pressing Enter in the Front field moves focus to the Back field; pressing Enter in the Back field (or clicking ADD CARD) calls `api.rowCreate()` (which POSTs `POST /row/update` with `index: null`). After creation, the draft fields clear for fast successive entry.

**Drag-to-reorder**: the row-number `#` handle is `draggable`. Dragging it and dropping onto another row calls `api.rowReorder(basePath, from, to)` (`POST /row/reorder`). A drop-indicator line (`dropbefore` CSS class) appears on the target row during drag.

**Deletion**: Trash2 button calls `api.rowDelete()` (`POST /row/delete`). The local `cards` array is updated immediately (no full refetch during editing). `onChanged()` fires on modal close if any mutation occurred.

**Local state mirroring**: the modal holds a local `cards: Note[]` array initialized from `props.rows`. Array position equals backend row index. All edits, additions, deletions, and reorders update this array in sync with the backend calls so the modal UI stays consistent without triggering a refetch per keystroke.

### Bulk Add Mode

Paste many cards at once. One card per line; front and back separated by a delimiter.

**Delimiter options** (shown as toggle chips):

| ID | Label | Separator character |
|---|---|---|
| `auto` | AUTO | First matching separator in each line (auto-detect order below) |
| `tab` | TAB | `\t` |
| `tripcolon` | `:::` | `:::` |
| `dblcolon` | `::` | `::` |
| `colon` | `:` | `:` |
| `pipe` | `\|` | `\|` |
| `comma` | `,` | `,` |
| `dash` | `–` | `–` (en dash) |

**Auto-detect order**: `tab`, `:::`, `::`, `|`, `–`, `:`, `,` — probed most-specific first so `::` is preferred over `:`.

**`parseBulk(text, delim)`** (exported from `EditCardsModal.tsx`): splits on `\r?\n`, strips blank lines, applies the chosen separator to produce `{front, back}[]`. Splitting takes the first occurrence of the separator:

```ts
parseBulk("hola : hello\ncasa :: house", "auto")
// → [{front: "hola", back: "hello"}, {front: "casa", back: "house"}]

parseBulk("What is hydrogen?\tH", "tab")
// → [{front: "What is hydrogen?", back: "H"}]
```

Lines with no separator produce `{front: <line>, back: ""}`. Cards with an empty front are excluded from the add operation (the ADD button label shows the count of valid cards only).

**Live preview**: a side-by-side preview pane renders parsed cards with markdown as they are typed, flagging cards with no back in red (`bad` class). The ADD button label updates live: `ADD {validCount} CARDS`.

Clicking ADD creates each card in sequence via `api.rowCreate()`, then switches back to list mode.

---

## API Calls Made by the Flashcards View

| Operation | API call | Endpoint |
|---|---|---|
| Grade a card (normal mode) | `api.reviewCardRow(basePath, index, response, fields?)` | `POST /cards/review` |
| Edit current card | `api.rowUpdate(basePath, index, note)` | `POST /row/update` |
| Delete current card | `api.rowDelete(basePath, index)` | `POST /row/delete` |
| Add card (inline/bulk) | `api.rowCreate(basePath, note)` | `POST /row/update` with `index: null` |
| Edit card in modal | `api.rowUpdate(basePath, index, note)` | `POST /row/update` |
| Delete card in modal | `api.rowDelete(basePath, index)` | `POST /row/delete` |
| Reorder cards | `api.rowReorder(basePath, from, to)` | `POST /row/reorder` |

For grading, the `fields` parameter overrides which due/ease/interval columns are written. Forward reviews use the default (`due`/`ease`/`interval`); reverse reviews in bidirectional mode pass `{due: "dueBack", ease: "easeBack", interval: "intervalBack"}`. The `fields` object maps to `dueField`/`easeField`/`intervalField` query parameters in the `POST /cards/review` payload.

---

## Empty States

| Condition | Message |
|---|---|
| Normal mode, queue empty | "No cards due" + hint to click CRAM to review everything anyway |
| Cram mode, no rows at all | "No cards in this deck" + hint to add rows with `front`/`back` columns |
| All cards reviewed | Completion screen: "Deck complete" (or "Cram complete"), graded count, REVIEW AGAIN button |

---

## Edge Cases and Gotchas

**Cards modal requires `basePath`**: the CARDS and edit-card buttons are only rendered when `basePath` is defined. An inline `FlashcardsView` embedded in a query block without a file path cannot open the modal or persist grades. In practice this means the view must be a full base file, not an embedded block, to support editing.

**Cram never persists**: forgetting this means you can "review" a deck in cram mode and find all cards still due afterward — by design.

**Bidirectional column naming is positional, not configurable**: the `*Back` columns are always `dueField + "Back"` etc. If you rename `dueField` to `nextReview`, the companion columns become `nextReviewBack`, `easeBack` → `easeBack` (unchanged, since `easeField` default is `"ease"`). Ensure your base's `schema:` section declares these columns if you use a non-default `dueField`.

**New card with null/empty due is always due**: this is intentional — when you add a card without scheduling columns it surfaces immediately for first review.

**Queue position stays put on grade (non-cram, persisted)**: after grading, `onReviewed()` triggers a refetch. The graded card's due date is now in the future so it drops out of the queue. The queue array shrinks by one, shifting all subsequent cards left. By keeping `pos` at the same integer the component automatically advances to what was previously `pos + 1` — without incrementing. This prevents a skip-one bug where `pos` would jump over the immediately next card.

**Drag-reorder uses native HTML5 drag-and-drop**: it fires on the row-number handle element only (`draggable={true}` on `.cards-num`). The row itself handles `onDragOver` + `onDrop`. `onDragEnd` clears state if the drop lands outside a valid target.

**`onChanged` is lazy**: `EditCardsModal` sets a `dirty` flag on any mutation but only calls `props.onChanged()` when the modal closes. This avoids a queue refetch per keypress during editing.

---

Source: `app/src/bases/FlashcardsView.tsx`, `app/src/bases/flashcardsQueue.ts`, `app/src/bases/EditCardsModal.tsx`, `app/src/bases/flashcardsQueue.test.ts`, `app/src/bases/FlashcardsView.queue.test.ts`, `core/src/bases/types.ts`, `core/src/srs/reviewRow.ts`, `core/src/srs/scheduler.ts`, `app/src/api.ts`
