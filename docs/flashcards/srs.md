# Flashcards / SRS — Deep Reference

This document covers Bismuth's spaced-repetition system end-to-end: the two card models (markdown cards embedded in notes, and row cards stored in base files), the SM-2 scheduler, the deck/tag convention, bidirectional and cram modes, and every HTTP endpoint that reads or writes card data. The frontend review UI (`FlashcardsView.tsx`) is described only as far as it determines API behavior and scheduling semantics.

---

## Table of Contents

1. [Two Card Models](#two-card-models)
2. [Markdown Card Syntax (parser)](#markdown-card-syntax-parser)
3. [Decks and the `#flashcards` Tag](#decks-and-the-flashcards-tag)
4. [SM-2 Scheduler](#sm-2-scheduler)
5. [Scheduling Persistence Format (`<!--SR:...-->`)](#scheduling-persistence-format-sr)
6. [Row Cards (Bases)](#row-cards-bases)
7. [Bidirectional Cards](#bidirectional-cards)
8. [Cram Mode](#cram-mode)
9. [HTTP Endpoints](#http-endpoints)
10. [Settings / Tunable Parameters](#settings--tunable-parameters)
11. [Edge Cases and Gotchas](#edge-cases-and-gotchas)

---

## Two Card Models

Bismuth has two independent card models that share the same SM-2 scheduler but differ in how content is stored and how scheduling is persisted:

| Feature | Markdown cards | Row cards |
|---|---|---|
| Content lives in | Any `.md` note body (special syntax) | Rows of a `type: base` file (frontmatter columns) |
| Tag required | Yes — note must carry `#flashcards` (or sub-deck) | No — any base with `views: [{type: flashcards}]` |
| Scheduling stored | Inline `<!--SR:...-->` HTML comment in the note | `due`/`ease`/`interval` frontmatter columns on the row |
| Card ID | `"notePath::cardIndex::subIndex"` string | `{file, index}` pair (row index in the `.md` base) |
| Review endpoint | `POST /cards/review` with `id` | `POST /cards/review` with `file` + `index` |
| Sub-cards | Yes (reversed cards = 2, cloze N deletions) | One card per row (bidirectional adds a reverse direction) |
| Bidirectional | Always: `:::` / `??` create 2 sub-cards with independent schedules | Optional: `bidirectional: true` on the view config; adds `*Back` columns |

Both models use `ReviewResponse = "hard" | "good" | "easy"` and the same `schedule()` function.

---

## Markdown Card Syntax (parser)

Source: `core/src/srs/parser.ts`, `core/src/srs/cards.ts`

### Block-level parsing

The parser (`parseCards(body)`) splits the note body into **blocks of consecutive non-blank lines** separated by blank lines. Each block is independently tested for card syntax. Non-card blocks (plain paragraphs, headings, etc.) are silently ignored.

```
Capital of France :: note prose here

France::Paris             ← one-card block (basic)

dog:::perro               ← one-card block (reversed, 2 sub-cards)

What is photosynthesis?   ← multi-line block start
?                         ← separator for basic card
The process by which...
```

### Card types

#### `single-basic` — `::` on a single line

```
Capital of France::Paris
```

- `front` = everything before the first `::`, trimmed
- `back` = everything after `::`, trimmed
- `subCount = 1`
- A `:::` on the same line takes priority and is detected first as `single-reversed` (see below)

#### `single-reversed` — `:::` on a single line

```
dog:::perro
```

- `front = "dog"`, `back = "perro"`
- `subCount = 2` — sub-card 0 asks dog→perro, sub-card 1 asks perro→dog
- `:::` is tested before `::` so `dog:::perro` is never misclassified as `dog:` / `:perro`

#### `multi-basic` — `?` separator on its own line

```
What is the mitochondria?
?
The powerhouse of the cell
```

- Everything before the `?` line = `front` (joined with `\n`, trimmed)
- Everything after = `back`
- `subCount = 1`

#### `multi-reversed` — `??` separator on its own line

```
Front line
??
Back line
```

- `subCount = 2`; sub-card 0 is front→back, sub-card 1 is back→front

#### `cloze` — deletion markers in line text

Three marker styles are supported; they may be mixed in one card:

| Marker | Example |
|---|---|
| `==text==` (highlight) | `The ==sun== is a star` |
| `{{text}}` (curly braces) | `The capital of {{France}} is Paris` |
| `**text**` (bold) | `The answer is **42**` |

- `subCount` = number of deletion markers in the text
- Sub-card N hides the Nth deletion with `[...]`; the answer reveals all deletions stripped of markers
- Example: `"The ==sun== is a {{star}}"` → sub-card 0 question `"The [...] is a star"`, sub-card 1 question `"The sun is a [...] "`, both answers `"The sun is a star"`
- Cloze cards work on both single lines and multi-line blocks

### Sub-card ordering

For reversed and multi-reversed cards: sub-card `0` is always forward (front→back), sub-card `1` is reverse (back→front). Their schedules are stored as two consecutive entries in the `<!--SR:...-->` comment.

### Line tracking fields on `ParsedCard`

```ts
interface ParsedCard {
  type: CardType;
  front: string;
  back: string;
  clozeText?: string;   // set only for cloze type; the raw marker text
  subCount: number;
  scheduling: SchedulingInfo[];  // one entry per sub-card; [] if never reviewed
  startLine: number;    // line index in body where the block starts (0-based)
  endLine: number;      // last content line of the block (before any SR comment line)
  inlineSchedule: boolean;  // true = SR comment is on startLine; false = standalone line below
  scheduleLine: number; // line index of standalone SR comment line; -1 if none yet
}
```

`rewriteCardSchedule` in `cards.ts` uses these to write back the updated SR comment in the correct place:
- `inlineSchedule = true` → replaces (or appends) the comment on `startLine`
- `scheduleLine >= 0` → overwrites that line
- Otherwise → splices a new line after `endLine`

---

## Decks and the `#flashcards` Tag

Source: `core/src/srs/parser.ts` (`deckPathsFromTags`), `core/src/srs/cards.ts` (`collectCards`)

A note is a flashcard note only if its tags include `flashcards` (exact) or a subtag starting with `flashcards/`. The tag can appear in YAML frontmatter or as an inline `#flashcards` tag in the body.

```
---
tags: [flashcards/math]
---
```

or inline:

```
#flashcards/math

2+2::4
```

The deck name is derived from the tag suffix:

| Tag | Deck name |
|---|---|
| `flashcards` | `""` (empty string, the root deck) |
| `flashcards/math` | `"math"` |
| `flashcards/math/algebra` | `"math/algebra"` |

`deckPathsFromTags` strips `"flashcards/"` and returns the remainder. Multiple flashcard tags on one note → multiple deck paths; `collectCards` uses the **first** deck path for all cards in that note (`noteDeck`).

Notes **without** a flashcard tag are completely invisible to `collectCards` and all `/cards/*` endpoints. They can still be reviewed via `GET /cards/note?path=` (which bypasses the tag requirement) — deck falls back to `""`.

---

## SM-2 Scheduler

Source: `core/src/srs/scheduler.ts`

### Overview

The scheduler is a variant of SM-2. It operates on a `SchedulingInfo` triple:

```ts
interface SchedulingInfo {
  due: string;      // "YYYY-MM-DD"
  interval: number; // whole days until next review
  ease: number;     // integer; 250 = 2.5× multiplier
}
```

The core function:

```ts
schedule(prev: SchedulingInfo | null, response: ReviewResponse, today: string, cfg?: SrsConfig): SchedulingInfo
```

- `prev = null` → new card (never reviewed before)
- `today` is always a `"YYYY-MM-DD"` string (the backend passes `todayISO()`)
- `cfg` defaults to `DEFAULT_SRS` if omitted; the server passes `appConfig.srs` from settings

### New card graduation

| Response | Interval | Ease |
|---|---|---|
| `"hard"` | `goodGraduatingInterval` (default 1) | `baseEase` (default 250) |
| `"good"` | `goodGraduatingInterval` (default 1) | `baseEase` (default 250) |
| `"easy"` | `easyGraduatingInterval` (default 4) | `baseEase + easeStep` (default 270) |

Concrete: new card rated "good" on 2026-05-27 → `{due: "2026-05-28", interval: 1, ease: 250}`.
New card rated "easy" on 2026-05-27 → `{due: "2026-05-31", interval: 4, ease: 270}`.

### Existing card scheduling

```
hard:  ease = max(minEase, ease - easeStep)
       interval = max(1, round(prev.interval × lapsesIntervalChange))

good:  ease unchanged
       interval = round(prev.interval × (ease / 100))

easy:  ease = ease + easeStep
       interval = round(prev.interval × (ease / 100) × easyBonus)
```

Concrete examples (defaults; `prev = {interval: 10, ease: 250}`):
- `"good"` → interval = `round(10 × 2.5)` = **25**, ease = 250
- `"easy"` → ease = 270, interval = `round(10 × 2.7 × 1.3)` = **35**
- `"hard"`, `ease = 140` → ease = 130 (floor), interval = `round(10 × 0.5)` = **5**

After calculation, interval is clamped: `max(1, min(interval, 36525))` (1 day minimum, 100 years maximum).

The resulting `due` date is `addDaysISO(today, clampedInterval)` from `core/src/dates.ts`.

### Constants and defaults

```ts
export const BASE_EASE = 250;
export const EASY_BONUS = 1.3;
export const LAPSES_INTERVAL_CHANGE = 0.5;
export const MAX_INTERVAL = 36525;  // 100 years
export const MIN_EASE = 130;
export const EASE_STEP = 20;

export const DEFAULT_SRS: SrsConfig = {
  baseEase: 250,
  easyBonus: 1.3,
  lapsesIntervalChange: 0.5,
  minEase: 130,
  easeStep: 20,
  easyGraduatingInterval: 4,
  goodGraduatingInterval: 1,
};
```

All of these are tunable via `settings.yaml` `srs:` section (see [Settings](#settings--tunable-parameters)).

---

## Scheduling Persistence Format (`<!--SR:...-->`)

Source: `core/src/srs/scheduler.ts` (`formatScheduling`, `parseScheduling`, `SR_COMMENT_RE`)

Scheduling data is stored as an HTML comment appended to the card text. The format encodes one entry per sub-card.

```
<!--SR:!YYYY-MM-DD,interval,ease-->               single sub-card
<!--SR:!YYYY-MM-DD,interval,ease!YYYY-MM-DD,interval,ease-->  two sub-cards (reversed)
```

Examples:
```
2+2::4 <!--SR:!2026-05-28,1,250-->
dog:::perro <!--SR:!2026-05-28,1,250!2026-06-01,4,270-->
```

For multi-line cards, the comment appears on a **standalone line** immediately after the card block:
```
What is the mitochondria?
?
The powerhouse of the cell
<!--SR:!2026-05-31,4,270-->
```

The regex `SR_COMMENT_RE = /<!--SR:(?:!\d{4}-\d{2}-\d{2},\d+,\d+)+-->/` matches the entire comment. `parseScheduling` extracts all `!date,interval,ease` entries. `formatScheduling` serializes them back.

**Inline vs standalone placement** is determined by `inlineSchedule` on `ParsedCard`:
- Single-line cards always use inline placement (comment on the same line as the card)
- Multi-line cards always use a standalone comment line

On re-review, the comment is **replaced in place** — never duplicated. If the card had no prior comment, a new one is inserted.

---

## Row Cards (Bases)

Source: `core/src/srs/reviewRow.ts`, `core/src/server.ts`

A flashcard base is any `type: base` markdown file with a view of type `flashcards`. Card content comes from the rows' frontmatter columns rather than special markdown syntax.

### Required columns

By default:
- `front` — prompt text (shown first)
- `back` — answer text (revealed on flip)
- `due` — scheduling due date (`"YYYY-MM-DD"` or empty/null for a new card)
- `ease` — ease factor (integer; 250 default)
- `interval` — interval in days (integer)

These defaults are configurable per-view (see [Bidirectional Cards](#bidirectional-cards) for the full set of view config fields).

### View config fields (in the base frontmatter)

```yaml
views:
  - type: flashcards
    frontField: front         # column for prompt (default: "front")
    backField: back           # column for answer (default: "back")
    dueField: due             # scheduling due column (default: "due")
    easeField: ease           # scheduling ease column (default: "ease")
    intervalField: interval   # scheduling interval column (default: "interval")
    bidirectional: false      # enable reverse direction (default: false)
```

### `applyReviewToRow`

```ts
applyReviewToRow(
  note: Record<string, unknown>,
  response: ReviewResponse,
  today: string,
  cfg?: SrsConfig,
  fields?: ScheduleFields,  // defaults to {due: "due", ease: "ease", interval: "interval"}
): Record<string, unknown>
```

- Reads the current scheduling from `note[fields.due]`, `note[fields.ease]`, `note[fields.interval]`
- If `note[fields.due]` is `null` or `""`, the card is treated as **new**
- String-typed numbers from YAML frontmatter are coerced via `toNumber()` before use — non-numeric strings fall back to 0/250 defaults rather than producing `NaN`
- Returns a **new object** with updated `due`/`ease`/`interval` columns; all other fields are preserved

---

## Bidirectional Cards

Source: `app/src/bases/flashcardsQueue.ts`, `core/src/srs/reviewRow.ts`, `app/src/bases/FlashcardsView.tsx`

Bidirectional mode applies only to **row cards** (base flashcard view). Setting `bidirectional: true` on a view makes each row yield two queue entries: a forward entry (front→back) and a reverse entry (back→front).

### Scheduling independence

Forward and reverse directions are scheduled **independently** using separate column triples:

| Direction | Due col | Ease col | Interval col |
|---|---|---|---|
| Forward | `dueField` (e.g. `"due"`) | `easeField` (e.g. `"ease"`) | `intervalField` (e.g. `"interval"`) |
| Reverse | `dueField + "Back"` (e.g. `"dueBack"`) | `easeField + "Back"` (e.g. `"easeBack"`) | `intervalField + "Back"` (e.g. `"intervalBack"`) |

The `backField(field: string)` helper in `flashcardsQueue.ts` computes these: `backField("due") === "dueBack"`.

When the user grades a reverse card, `FlashcardsView` passes the `*Back` column triple to `api.reviewCardRow(...)`, which in turn passes `dueField`/`easeField`/`intervalField` overrides to `POST /cards/review`. The server calls `applyReviewToRow` with a `ScheduleFields` override pointing at the `*Back` columns, so the forward schedule is untouched.

**Example**: a row `{front: "red", back: "אדום", due: "2026-05-01", interval: 5, ease: 250, dueBack: null, easeBack: 250, intervalBack: 0}`:
- Grading the forward direction advances `due`/`ease`/`interval`
- Grading the reverse direction advances `dueBack`/`easeBack`/`intervalBack` as a new card (because `dueBack` is null)

This is not available for markdown cards. Markdown reversed cards (`:::` / `??`) always have exactly 2 sub-cards and their schedules are stored as two entries in one `<!--SR:...-->` comment.

### Queue filtering for bidirectional

`buildQueue` emits a forward and reverse `QueueItem` per row. In normal (non-cram) mode, each item is filtered independently by its own `dueField`:
```ts
return all.filter((it) => {
  const d = it.r.note[it.dueField];
  return d == null || d === "" || String(d) <= today;
});
```

So a row where forward is due but reverse is not will show only the forward card today.

---

## Cram Mode

Source: `app/src/bases/flashcardsQueue.ts` (`buildQueue`), `app/src/bases/FlashcardsView.tsx`

Cram mode is a **frontend-only** state; no API calls differ. When `cram = true`:
- `buildQueue` returns ALL cards from the base (all rows, both directions if bidirectional), regardless of due dates
- `nextPosAfterGrade` always increments `pos + 1` (strict front-to-back traversal)
- `grade()` skips the `api.reviewCardRow` call entirely — `persisted = !cram() && !!props.basePath` is false — so no scheduling columns are written

Cram is toggled by the CRAM button in the deck header. Toggling resets the position and tally to zero. On completion, the UI shows "Cram complete" rather than "Deck complete".

**Important**: cram mode works only for row cards (base flashcard views). Markdown cards do not have a cram mode exposed by the API; all `/cards/due` calls always filter by due date.

---

## HTTP Endpoints

Source: `core/src/server.ts`

All `/cards/*` read endpoints are GET requests in the read-only route table and do not trigger cache invalidation. `POST /cards/review` goes through `mutatingHandler` and invalidates the vault cache for the file written.

### `GET /cards/decks`

Returns all decks derived from `#flashcards`-tagged notes, with total and due-today counts.

**Response** (`Deck[]`):
```json
[
  { "name": "math", "total": 5, "due": 2 },
  { "name": "spanish", "total": 12, "due": 0 }
]
```

Decks are sorted alphabetically by name. The root deck (`#flashcards` tag, no sub-path) has `name: ""`. `due` counts only cards with `due === null` (never reviewed) or `due <= today`.

### `GET /cards/all`

Returns every card from every flashcard-tagged note, regardless of due date or deck.

**Response** (`Card[]`): same shape as `/cards/due` — see below.

### `GET /cards/due`

Returns only cards that are due today or earlier (plus never-reviewed cards).

**Query parameter**: `deck` (optional) — filter to a single deck by name.

```
GET /cards/due
GET /cards/due?deck=math
```

**Response** (`Card[]`):
```json
[
  {
    "id": "math.md::0::0",
    "notePath": "math.md",
    "deck": "math",
    "type": "single-basic",
    "question": "2 + 2",
    "answer": "4",
    "due": null,
    "interval": 0,
    "ease": 250
  }
]
```

Fields:
- `id`: `"${notePath}::${cardIndex}::${subIndex}"` — used for markdown card reviews
- `due`: `null` if never reviewed, otherwise `"YYYY-MM-DD"`
- `interval`: 0 for new cards
- `ease`: `BASE_EASE` (250) for new cards
- `type`: one of `"single-basic" | "single-reversed" | "multi-basic" | "multi-reversed" | "cloze"`

### `GET /cards/note`

Returns all cards from a single note, regardless of tags or due dates. Used for per-note review (user explicitly opens a note's cards).

**Query parameter**: `path` (required, URL-encoded vault-relative path)

```
GET /cards/note?path=math.md
```

**Response** (`Card[]`): same shape as above. If the note has no flashcard tag, deck defaults to `""`.

### `POST /cards/review` — dual-mode

This is the single review endpoint; the request shape determines which code path executes.

#### Mode 1: Markdown card review (legacy inline)

Identify the card by its string `id`:

```json
{
  "id": "math.md::0::0",
  "response": "good",
  "question": "2 + 2"
}
```

Fields:
- `id` (required): `"${notePath}::${cardIndex}::${subIndex}"` from a `Card` object
- `response` (required): `"hard" | "good" | "easy"`
- `question` (optional): if supplied, the server verifies that the card's current question still matches; if not (note was edited since load), returns **409** with code `CARD_CONTENT_CHANGED`

Behavior:
1. Re-parses the note body to find card at `cardIndex`
2. Calls `schedule()` for sub-card `subIndex`; for cards with multiple sub-cards (reversed, cloze), unreviewed siblings get a fresh schedule mirroring this response
3. Serializes a new `<!--SR:...-->` comment and writes it into the note file in place
4. Triggers vault cache invalidation + SSE broadcast (paths left empty for legacy reviews — no path-keyed invalidation)

#### Mode 2: Row card review (flashcard base)

Identify the card by file path and row index:

```json
{
  "file": "decks/spanish.md",
  "index": 3,
  "response": "easy"
}
```

For a **bidirectional reverse** review, add the `*Back` column names:

```json
{
  "file": "decks/spanish.md",
  "index": 3,
  "response": "good",
  "dueField": "dueBack",
  "easeField": "easeBack",
  "intervalField": "intervalBack"
}
```

Fields:
- `file` (required if row mode): vault-relative path to the base file
- `index` (required if row mode): zero-based row index within the base
- `response` (required): `"hard" | "good" | "easy"`
- `dueField` / `easeField` / `intervalField` (optional): override which columns to advance; omit for forward direction (defaults to `"due"` / `"ease"` / `"interval"`)

Behavior:
1. Reads and parses the base file; locates row at `index`
2. Calls `applyReviewToRow` with the resolved `ScheduleFields`
3. Writes the updated row back into the base file via `upsertRow`
4. Triggers vault cache invalidation keyed to `body.file` → SSE broadcast

**Dispatch logic**: if `body.file != null && body.index != null`, the server takes the row-based path. Otherwise, if `body.id` is present, the markdown card path. If neither, returns 400.

---

## Settings / Tunable Parameters

Source: `core/src/schema/settingsSchema.ts`, `core/src/srs/scheduler.ts`

All SM-2 constants are configurable under `srs:` in `settings.yaml`. The backend passes `appConfig.srs` (a `SrsConfig`) to every `schedule()` / `applyReview()` / `applyReviewToRow()` call.

```yaml
srs:
  baseEase: 250           # Starting ease for a new card. Range: 130–400.
  easyBonus: 1.3          # Extra multiplier on "easy" reviews. Range: 1–2.
  lapsesIntervalChange: 0.5  # Interval multiplier on "hard" (lapse). Range: 0.1–1.
  minEase: 130            # Ease floor. Range: 50–250.
  easeStep: 20            # Ease delta per review. Range: 5–50.
  easyGraduatingInterval: 4  # Days for new card rated "easy". Range: 1–14.
  goodGraduatingInterval: 1  # Days for new card rated "good"/"hard". Range: 1–3.
```

Changes take effect immediately on the next review (no restart needed; `settings.yaml` is re-read per request).

---

## Edge Cases and Gotchas

### Card ID format

Markdown card IDs are position-based: `"notePath::cardIndex::subIndex"`. `cardIndex` is the zero-based index of the card in `parseCards(body)`'s output order. If the note is edited between when cards are loaded and when a review is submitted, the indices can shift, causing `applyReview` to address the wrong card. The optional `question` field in `POST /cards/review` guards against this — if supplied and mismatched, the server returns 409 instead of silently migrading the wrong card.

### Empty `due` treated as new card

`applyReviewToRow` treats `due = null` or `due = ""` as a new card. A `due` column that happens to contain an empty string (which YAML often produces for blank frontmatter values) will always schedule as new, never as an existing card.

### String-typed numbers from YAML frontmatter

YAML frontmatter values arrive as strings when the base row parser preserves raw types. `applyReviewToRow` uses `toNumber()` from `core/src/bases/values.ts` to coerce them. Non-numeric strings (`"oops"`, `"bad"`) fall back to defaults (0 for interval, 250 for ease) rather than producing `NaN` in the output.

### Cloze markers and bold

`**bold**` is a valid cloze deletion marker. This means bold text inside a cloze card body is treated as a deletion, not as markdown emphasis. If you want bold inside a cloze card without it becoming a deletion slot, avoid `**...**` inside that block.

### Multi-line blocks and SR comment lines

A standalone `<!--SR:...-->` line at the end of a multi-line block is stripped from the content lines before card type detection. A note with only an SR comment line (no card text) will not produce a card — the parser checks `front` and `back` for emptiness and returns `null`.

### Sub-card scheduling on partial review (reversed cards)

When one sub-card of a multi-sub-card markdown card is reviewed, `applyReview` iterates all sub-cards: the reviewed one gets the new schedule from `schedule(prev, response)`, and unreviewed siblings that have no prior schedule get `schedule(null, response)` (treated as new). This means reviewing only the forward direction of a `:::` card also schedules the reverse direction — with the same response as if it were new.

### `noteCards` bypasses the flashcard tag requirement

`GET /cards/note?path=` returns all cards found in the note body regardless of whether the note has `#flashcards`. Deck defaults to `""` for untagged notes. This is intentional for per-note review initiated by the user.

### Max interval is 100 years

`MAX_INTERVAL = 36525` days. Any computed interval (before or after the `round()`) that exceeds this is clamped. This prevents overflow from very large ease values on long-established cards.

### Cram mode never writes to disk

Cram mode is entirely client-side. No `POST /cards/review` calls are made during a cram session. Scheduling columns in the base file remain unchanged. The session tally (good/hard counts) resets when toggling cram or clicking "Review Again".

### Row card review invalidates the base file's cache

`POST /cards/review` in row mode passes `body.file` as the invalidation path. The vault graph cache and file tree cache are invalidated for that path, and an SSE event is broadcast so other open clients refresh. Markdown card reviews pass no path (empty invalidation) and do not broadcast changed paths.

---

Source: `core/src/srs/scheduler.ts`, `core/src/srs/cards.ts`, `core/src/srs/reviewRow.ts`, `core/src/srs/parser.ts`, `core/src/srs/types.ts`, `core/src/server.ts`, `core/src/schema/settingsSchema.ts`, `app/src/bases/flashcardsQueue.ts`, `app/src/bases/FlashcardsView.tsx`, `app/src/api.ts`, `core/test/srs/scheduler.test.ts`, `core/test/srs/parser.test.ts`, `core/test/srs/cards.test.ts`, `core/test/srs/reviewRow.test.ts`
