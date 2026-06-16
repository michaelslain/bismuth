# Cards View

The Cards view renders each row in a base as a visual card: a book-cover style grid (`cardContent: properties`, the default), a Google-Keep-style **inline-editable** markdown note (`cardContent: body`), or a checklist-only editor (`cardContent: tasks`). All three are driven by `CardsView.tsx`, which inspects `view.cardContent` and delegates the `body`/`tasks` variants to `BodyCard.tsx`. Cards is a record-type view (alongside table, list, kanban, map) and shares the same column-visibility / sort / group-by settings panel as those view types.

In `body`/`tasks` mode the card body is **not a rendered preview — it is a live, always-editable CodeMirror editor** (`CardEditor.tsx`) over the note's actual markdown. It reuses the note editor's `livePreview` extension, so the same in-place markdown rendering, `#tag`/wikilink/link styling, checkbox glyphs (empty `[ ]`, checked `[x]`, in-progress `[/]`, cancelled `[-]`), and right-click task-status menu all apply — but here a click also places the cursor, a drag selects, and typing edits the note. Edits autosave (see "Inline Editing" below). Clicking a `[[wikilink]]`, `[text](url)`, or bare URL navigates instead of placing the cursor (`navigateOnLinkClick` in `CardEditor.tsx`, mirroring `Editor.tsx`'s filename-based wikilink open).

---

## Two Sub-modes

### Properties mode (default)

`cardContent: properties` (or omitted) renders a 5-column wrapping grid of book-style cards. Each card has:

1. A **cover** — either a generated text cover (gradient background + spine bar, with title and author text) or a real image when `image:` is configured.
2. A **body row** below the cover — status word on the left, star rating or page count on the right, plus the title and author when an image cover is used (they don't appear on the cover itself in that case).

The grid is a CSS `display: grid; grid-template-columns: repeat(5, 1fr)` — always 5 equal columns, wrapping naturally. There is no configurable column count.

### Body mode

`cardContent: body` renders a **3-column CSS masonry** (using `column-count: 3; column-gap: 14px`). Each card (`BodyCard.tsx`) shows:

- The first column value as the card title chip (`renderValue(firstCol, row)`).
- The **whole note body**, opened in a live `CardEditor` you can edit directly. The frontmatter and a leading `# Title` heading that merely repeats the card title are sliced off (`splitCard`, see "Inline Editing") so the title isn't shown twice and the YAML never appears in the card.
- Editor-style task glyphs via `livePreview`: left-click toggles, right-click sets an explicit status — but here the line is also fully editable as text.
- Clickable wikilinks/links that navigate (`oa-open` / external open).

Body cards take their natural height; the CSS masonry keeps short notes short rather than stretching them to fill rows.

### Tasks mode

`cardContent: tasks` renders the same masonry as body mode and through the same `CardEditor`, but the editable region is **narrowed to the note's checklist** — from its first task line to its last (`mode: "tasks"`, via `splitCard`/`taskRegion`). Prose, headings, and bullets before the first task join the hidden prefix; anything after the last task joins the hidden suffix; both are preserved verbatim and re-prepended/appended on save. The card thus stays a focused but fully-editable checklist — you can add, delete, or retype task lines as normal markdown — while the surrounding note content is left untouched. A note with **no** task lines falls back to editing the whole body, so the first task can still be typed. Use it for a task-board over notes whose bodies mix prose and checklists (e.g. a `#tasks`-tagged folder).

---

## Config Fields

All fields live inside a `views:` entry in the base's YAML frontmatter.

### `type`

```yaml
views:
  - type: cards
    name: My Cards
```

Required. Selects the cards renderer.

### `cardContent`

```yaml
cardContent: properties   # (default) book-cover grid
cardContent: body         # Google-Keep masonry with markdown body
cardContent: tasks        # like body, but filtered to the note's checklist lines only
```

Optional. Defaults to `"properties"` when omitted.

### `image`

```yaml
image: cover
```

Optional. The **property id** whose value is used as the card's cover image in properties mode. The value may be:

- A full URL: `https://...`, `data:...`, `blob:...` — used directly as the `<img src>`.
- A bare filename or vault-relative path (e.g. `covers/gatsby.jpg`) — served through the vault asset endpoint (`api.assetUrl(s)`).

When `image` is set but the property is empty or null for a given row, that card falls back to the generated text cover. When `image` is not set at all, all cards use the generated text cover.

The image cover replaces the text cover. With an image cover, the title and author text appear in the card body row below the image (they are not overlaid on the cover). With the text cover, title and author appear on the cover itself and are omitted from the body row.

If the image fails to load (`onError`), it is hidden (`visibility: hidden`) rather than showing a broken-image icon.

### `imageFit`

```yaml
imageFit: cover     # (default) fill the cover area, cropping if needed
imageFit: contain   # fit the whole image inside the cover area, letterboxing if needed
```

Optional. Maps directly to the CSS `object-fit` property on the `<img>`. Defaults to `"cover"`.

### `imageAspectRatio`

```yaml
imageAspectRatio: 0.667    # (default) portrait 2:3
imageAspectRatio: 1.0      # square
imageAspectRatio: 1.778    # 16:9 landscape
```

Optional. Width-divided-by-height ratio applied as the CSS `aspect-ratio` inline style on the image container. Defaults to `0.667` (a 2:3 portrait aspect ratio, appropriate for book covers). The cover area height adjusts automatically.

---

## Column Roles and Automatic Heuristics

Cards does not require you to explicitly label columns by role — it detects them from the column name using heuristics in `CardBody.tsx` and `renderValue.tsx`:

| Detected role | Detection rule (bare name, lowercased) | Rendering |
|---|---|---|
| **Title** | First column in `order:` (or first returned column) | Serif title text, 15px, `font-weight: 600` |
| **Author** | First column that is not title, status, rating, or pages | Small muted text beneath the title |
| **Status** | Bare name is exactly `status` | Colored-dot + word text (left side of meta row) |
| **Rating** | Bare name is `rating`, `stars`, or `score` | Five gold stars (right side of meta row) |
| **Pages** | Bare name is `pages`, `pagecount`, or `page_count` | "N pages" text (right side of meta row, only when no rating) |

"Bare name" strips any namespace prefix (`note.`, `file.`, `formula.`, `this.`) and lowercases. So `note.Rating`, `formula.stars`, and `note.score` all satisfy the rating heuristic.

The meta row (status + stars/pages) only renders when at least one of status, rating, or pages has a non-null value. The page-count shows only as an integer number (fractional values and non-finite numbers are silently omitted).

### Text cover: title and author from first two columns

In properties mode without an `image:` property, the generated text cover draws:
- `coverTitle` from the first column's value (falls back to `row.file.name` if null).
- `coverAuthor` from the **second** column's value (the `authorCol()` in `CardsView.tsx`, not `CardBody.tsx`'s heuristic). If the second column's value is an object (e.g. a Link), it is treated as absent.

This is a simpler rule than the `CardBody` heuristic: it always takes column index 1, not the first non-title/non-meta column.

### Cover spine colors

The generated text cover has a 4px colored spine bar on the left edge and a gradient background. These cycle through 7 accent palette colors (`--teal`, `--violet`, `--blue`, `--graph-1`, `--graph-4`, `--green`, `--gold`) based on the card's CSS `nth-child` position (1-indexed mod 7). This is purely cosmetic and not configurable.

---

## Click-to-Open

In **properties mode**, clicking anywhere on a card (or pressing Enter when the card has focus) opens the note in a **new tab**. The card dispatches `new CustomEvent("oa-open", { detail: { path, newTab: true } })`. The whole card is a `role="button"` with `tabindex={0}` for keyboard accessibility.

In **body/tasks mode**, the card body is an editor, not a click-to-open target — a click places the cursor. Navigation happens only through inline links (`navigateOnLinkClick`):
- Clicking a `[[wikilink]]` dispatches `oa-open` with the resolved path (`Note.md`, alias/`#heading` stripped via `m[1].split("|")[0].split("#")[0]`).
- Clicking a `[text](url)` markdown link or a bare URL opens it externally (`openExternalUrl`).
- Any other click falls through to `livePreview`, which places the cursor or toggles a task box.

---

## Inline Editing (Body / Tasks Mode)

Body and tasks cards are fully editable in place, with autosave and external-change reconciliation — there is no "edit mode" toggle and no rendered-then-replaced preview. This is `CardEditor.tsx`, a CodeMirror 6 editor configured to read like the note editor's live-preview (transparent, gutterless, auto-height, prose font, `livePreview` + markdown + code highlighting), not a boxed code block.

### Splitting prefix / body / suffix (`cardBodySplit.ts`)

To edit a card without ever corrupting the file, `splitCard(raw, title, mode)` slices the note into `{ prefix, body, suffix }` such that `prefix + body + suffix === raw` exactly:

- **`prefix`** (kept out of the editor, re-prepended on save): always the YAML frontmatter (`FRONTMATTER_RE`, BOM-tolerant), plus a leading `# Title` ATX heading whose text equals the card's own title (`splitCardBody` — `H1_LINE_RE` + the surrounding blank lines), so the title isn't shown twice. In **tasks** mode the prefix also absorbs everything before the first checklist line.
- **`body`**: the editable region. In **body** mode it's the whole note body after the prefix. In **tasks** mode it's narrowed to the checklist region — first task line to last (`taskRegion`, recognizing `- [.] ` lines via `TASK_LINE`).
- **`suffix`** (re-appended on save, empty in body mode): in tasks mode, the note content after the last task line.

Because the frontmatter and stripped surroundings live in `prefix`/`suffix` (literal substrings of the input) and are stitched back on every write, editing the card body can never reorder or drop YAML keys, and a tasks card can't clobber the prose around its checklist. `splitCardBody`/`splitCard`/`taskRegion` are pure and unit-tested in `cardBodySplit.test.ts`.

### Autosave + echo suppression

A CodeMirror `updateListener` flags `pendingSave` on any document change and debounces a save by `settings.editor.autoSaveDelay`. `save()` writes `prefix + body + suffix` via `api.write`, primes the shared note cache (`primeNoteCache`) so sibling cards / a reopened note paint warm, and records `lastSavedFull` **before** the `await` so a fast SSE echo of our own write is recognized. A failed write leaves `pendingSave` set so the next edit / flush retries. On teardown a still-pending edit is flushed before the view is destroyed.

### External-change reconciliation

`CardEditor` subscribes to `onServerChange`; when this note changes on disk (edited in a pane, a daemon write, an external sync), `reconcile()` re-reads it and:

- Re-derives `prefix`/`suffix` from disk **even mid-edit** (that text isn't shown, so refreshing it means our next `prefix + body + suffix` save merges in the new surroundings instead of overwriting them).
- No-ops if the on-disk text equals `lastSavedFull` (our own echo) or if `pendingSave` is set (our queued save wins) or if the body is already identical.
- Otherwise replaces the document, preserving the caret/selection by clamped character offset, and annotates the transaction with `ExternalReload` so the autosave listener skips it (avoids writing the reload back to itself).

If the very first read fails on mount, the card stays in "Loading…" rather than building an empty editor whose autosave would overwrite the note's frontmatter; a later `onServerChange` retries via `reconcile()` (which calls `buildView` on the first successful read).

---

## Group Headers

When a `groupBy:` property is set, a small all-caps label appears above each group's grid. The empty-string group key (ungrouped rows) renders no header. Group headers are styled at 11px uppercase with `--text-muted`.

---

## Settings Panel

The settings panel (opened via the gear icon on the view toolbar) for cards is the same as for all record-type views. It provides:

- **Columns section** — toggle individual columns visible/hidden. At least one column must remain visible (toggling the last visible column is blocked; the button shows "At least one column must stay visible").
- **Sort & group section** — pick a sort property + direction (ASC/DESC) and a group-by property + direction.

There is no UI in the settings panel for `image`, `imageFit`, `imageAspectRatio`, or `cardContent`. These must be set directly in the base file's YAML frontmatter. The settings panel saves via `api.setProperty` for `order`, `sort`, and `groupBy`.

---

## Full Example

```yaml
---
type: base
source:
  kind: notes
  where: "#book"
views:
  - type: cards
    name: Reading List
    cardContent: properties
    image: cover
    imageFit: cover
    imageAspectRatio: 0.667
    order:
      - file.name
      - note.author
      - note.status
      - note.rating
      - note.pages
    groupBy:
      property: note.status
      direction: ASC
    sort:
      - property: note.rating
        direction: DESC
---
```

With this config:
- Cards show cover images from the `cover` frontmatter property (vault path or URL). Cards without a cover fall back to the generated gradient cover.
- The text cover draws `file.name` as the title and `note.author` as the author.
- The meta row shows `note.status` as a colored-dot word on the left and `note.rating` as gold stars on the right (star rating wins over page count when both exist).
- Cards are grouped by status and sorted by rating descending within each group.

---

## Body Mode Example

```yaml
---
type: base
source:
  kind: notes
  where: "#todo"
views:
  - type: cards
    name: Todo Notes
    cardContent: body
    order:
      - file.name
---
```

- Each card is a live editor over the full note body — click to edit, autosaves.
- Frontmatter and a duplicate `# Title` heading are kept out of the editor (re-prepended on save).
- Task lines get editor-style glyphs: left-click toggles, right-click sets a status.
- `[[wikilinks]]` in the body are clickable in-app navigation links.

---

## Edge Cases and Gotchas

- **`image` accepts a property id, not a URL directly.** Setting `image: "https://example.com/cover.jpg"` would try to look up a property named `https://example.com/cover.jpg` on each row, which will always be null. Store the URL in a frontmatter property (e.g. `cover:`) and set `image: cover`.
- **Object-valued image properties are skipped.** If the property resolves to a non-string value (e.g. an array or a Link object), the card silently falls back to the text cover.
- **The 5-column grid is fixed.** There is no responsive column count and no config to change it. The grid always uses `repeat(5, 1fr)`.
- **Body/tasks cards read files on mount.** `CardEditor` reads the note (via the shared `noteCache` — `peekNoteCache`/`readNoteCached`) when it mounts. Until a successful read it shows "Loading…". A read **failure** keeps it in "Loading…" deliberately — building an empty editor whose autosave fired would overwrite the note's frontmatter — and `onServerChange` retries via `reconcile()`.
- **Editing the prefix/suffix externally is safe mid-edit.** Because `reconcile()` re-derives the hidden `prefix`/`suffix` from disk on every server change (even while you're typing in the body), an external edit to the frontmatter or the prose around a tasks checklist is merged into your next save rather than clobbered.
- **A tasks card with no task lines edits the whole body.** `splitCard`'s `taskRegion` returns null, so the editor falls back to the full note body — letting you type the first task line.
- **The `authorCol` logic differs between the cover and the body.** The cover uses the raw second column (index 1 from `cols()`). The `CardBody` component (properties mode) uses the first column that is not the title and is not a status/rating/pages column. These may produce different results if the columns are reordered.
- **Empty `cardBodyInner` is hidden via CSS.** If `CardBody` renders no content at all (no meta, title suppressed by `titleAsField`, no author), the `.cardBodyInner` div is hidden by `display: none` rather than showing as an empty padded block.
- **Wikilink alias syntax is supported in body/tasks mode.** Clicking `[[Note|Display text]]` navigates to `Note.md`; the `#heading` anchor fragment in a target (`[[Note#Section]]`) is stripped — only the file name is used for navigation.

Source: /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardsView.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardBody.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BodyCard.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardEditor.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/cardBodySplit.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseSettings.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.module.css, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/renderValue.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/markdown.ts
