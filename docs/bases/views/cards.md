# Cards View

The Cards view renders each row in a base as a visual card: a book-cover style grid (`cardContent: properties`, the default), a Google-Keep-style markdown note preview (`cardContent: body`), or a checklist-only preview (`cardContent: tasks`). All three are driven by `CardsView.tsx`, which inspects `view.cardContent` and delegates the `body`/`tasks` variants to `BodyCard.tsx`. Cards is a record-type view (alongside table, list, kanban, map) and shares the same column-visibility / sort / group-by settings panel as those view types.

The `body`/`tasks` markdown is rendered to match the note editor (`renderNoteBody` + the `.cardMd` rules mirror live-preview): task checkboxes use the editor's glyph (bordered box → accent fill + white check) rather than a raw browser checkbox, `#tags` render as teal mono chips, wikilinks/links get the soft underline, headings use the graduated `.cm-h1`..`.cm-h6` scale, and plain lists get markers. (Known gap: `[/]`/`[-]` render as raw text since marked only treats `[ ]`/`[x]` as task checkboxes.)

---

## Two Sub-modes

### Properties mode (default)

`cardContent: properties` (or omitted) renders a 5-column wrapping grid of book-style cards. Each card has:

1. A **cover** — either a generated text cover (gradient background + spine bar, with title and author text) or a real image when `image:` is configured.
2. A **body row** below the cover — status word on the left, star rating or page count on the right, plus the title and author when an image cover is used (they don't appear on the cover itself in that case).

The grid is a CSS `display: grid; grid-template-columns: repeat(5, 1fr)` — always 5 equal columns, wrapping naturally. There is no configurable column count.

### Body mode

`cardContent: body` renders a **3-column CSS masonry** (using `column-count: 3; column-gap: 14px`). Each card shows:

- The first column value as the card title.
- The full note body read live from the vault, rendered as sanitized GFM markdown with Obsidian `[[wikilinks]]` resolved to clickable anchors.
- Completed tasks (any checkbox line where the box is not `[ ]`, e.g. `[x]`, `[-]`, `[/]`) hidden behind a collapsible "N completed" expander. Uncompleted tasks and all other content appear immediately.
- Interactive checkboxes that toggle the underlying task via `api.toggleTask` and reload the card.
- Clickable wikilinks that open the linked note via the `oa-open` event.

Body cards take their natural height; the CSS masonry keeps short notes short rather than stretching them to fill rows.

### Tasks mode

`cardContent: tasks` renders the same masonry as body mode and through the same renderer, but the note body is first **filtered to only its checklist lines** (`/^\s*- \[.\]/`) — as if the file contained only its todo list. Headings, prose, and non-task bullets are dropped. The open/completed split is identical to body mode: incomplete tasks (`- [ ]`) show up top, completed ones (`- [x]`, etc.) collapse behind the "N completed" expander. There is no task-signifier reformatting — a task line renders as raw markdown (its priority/date emoji stay inline), just with the editor-consistent checkbox. Use it for a task-board over notes whose bodies mix prose and checklists (e.g. a `#tasks`-tagged folder).

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

In **body mode**, the card itself is not a click target. Instead:
- Clicking a `[[wikilink]]` dispatches `oa-open` with the resolved path (no `newTab: true` — opens in the current tab or default behavior).
- Clicking an external `https://` link opens it in a new tab via `window.open(..., "_blank", "noopener")`.
- Clicking a relative link (not a wikilink, not https) dispatches `oa-open` appending `.md` if not already present.
- Clicking a checkbox toggles the task at that line in the note and re-reads the file.

---

## Collapse-Completed in Body Mode

`BodyCard.tsx` partitions the note body line-by-line:

- Lines matching `/^\s*- \[[^ \]]\]/` (any non-space, non-`]` character in the box) are "done" tasks.
- All other lines remain in the open section.

After splitting, headings that have no remaining content lines beneath them (because all their tasks moved to done) are pruned from the open section so an all-done card collapses cleanly to just its title and the "N completed" badge.

The completed section is hidden by default. A `▸ N completed` button appears at the bottom of the card whenever there is at least one done task; clicking it expands to show those lines at 62% opacity with strikethrough text. Clicking it again collapses.

Frontmatter (`---\n...\n---`) is stripped before rendering — the card shows only the note body.

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

- Each card renders the full note body as markdown.
- `- [x]` and `- [-]` lines are hidden behind the "N completed" expander.
- `- [ ]` lines are interactive checkboxes.
- `[[wikilinks]]` in the body are clickable in-app navigation links.

---

## Edge Cases and Gotchas

- **`image` accepts a property id, not a URL directly.** Setting `image: "https://example.com/cover.jpg"` would try to look up a property named `https://example.com/cover.jpg` on each row, which will always be null. Store the URL in a frontmatter property (e.g. `cover:`) and set `image: cover`.
- **Object-valued image properties are skipped.** If the property resolves to a non-string value (e.g. an array or a Link object), the card silently falls back to the text cover.
- **The 5-column grid is fixed.** There is no responsive column count and no config to change it. The grid always uses `repeat(5, 1fr)`.
- **Body mode reads files on mount.** Each `BodyCard` fetches its note via `api.read` when it first mounts. Until the read completes, it shows "Loading…". If the read fails, the card shows no body content.
- **Body mode task toggle is best-effort.** If `api.toggleTask` fails, the checkbox reverts visually (the card is not updated). No error is surfaced to the user.
- **Completed-task detection is line-based regex, not a full markdown parser.** A task inside a blockquote or code block could match `DONE_TASK_RE` and get incorrectly moved to the completed section.
- **The `authorCol` logic differs between the cover and the body.** The cover uses the raw second column (index 1 from `cols()`). The `CardBody` component uses the first column that is not the title and is not a status/rating/pages column. These may produce different results if the columns are reordered.
- **Empty `cardBodyInner` is hidden via CSS.** If `CardBody` renders no content at all (no meta, title suppressed by `titleAsField`, no author), the `.cardBodyInner` div is hidden by `display: none` rather than showing as an empty padded block.
- **Wikilink alias syntax is supported in body mode.** `[[Note|Display text]]` renders as "Display text" linking to `Note.md`. The `#heading` anchor fragment in a target (`[[Note#Section]]`) is stripped — only the file name is used for navigation.

Source: /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardsView.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardBody.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BodyCard.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseSettings.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.module.css, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/renderValue.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/markdown.ts
