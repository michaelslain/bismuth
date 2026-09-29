# cards

A visual card grid. Three sub-modes via `cardContent`: `properties` (book-cover grid, default), `body` (inline-editable Google-Keep-style masonry over the note body), `tasks` (same masonry, narrowed to the note's checklist lines). Orthogonal to `cardContent` is the general `mode: normal|tasks` axis — `mode: tasks` renders one card per checkbox task instead.

## Working example

```yaml
---
type: base
source: notes where "#book"
view: cards
cardContent: properties
image: cover
imageFit: cover
imageAspectRatio: 0.667
order: [file.name, note.author, note.status, note.rating]
groupBy:
  property: note.status
  direction: ASC
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | The general mode axis, shared with every record view — `tasks` renders one card per TASK via the shared `<TaskRow>` (checkbox, description, field chips) instead of anything below. Independent of `cardContent`, which is not consulted for the card face while `mode: tasks` is active. |
| `cardContent` | `"properties"` \| `"body"` \| `"tasks"` | `"properties"` | Which sub-mode renders, when `mode` is `normal`/absent. |
| `image` | `string` (property id) | none | Property whose value is the cover image (properties mode only). |
| `imageFit` | `"cover"` \| `"contain"` | `"cover"` | CSS `object-fit` on the cover `<img>`. |
| `imageAspectRatio` | `number` | `0.667` | Width÷height for the cover container. |
| `order`, `sort`, `groupBy`, `limit`, `filters` | — | — | Standard fields; `order`'s first two columns drive the generated text-cover title/author. |

## Failure modes

- **`image` must be a property id, not a literal URL.** `image: "https://example.com/cover.jpg"` looks up a property *named* that URL on every row (always null). Put the URL in a frontmatter field (e.g. `cover:`) and set `image: cover`.
- **A non-string `image` value (array, Link object) silently falls back to the generated text cover** — no error, no broken-image icon (a failed image load is hidden via `visibility: hidden`, not a broken-image icon either).
- **The grid is NOT a fixed column count.** Properties mode is a responsive `repeat(auto-fill, minmax(var(--card-grid-min, 220px), 1fr))` — columns fit however many the pane width allows above `settings.ui.cardGridMinWidth` (default 220, range 150–360px, vault-wide, no per-base override). `mode: tasks` cards use a separate fixed 180px-minimum grid.
- **`cardContent: tasks` and `mode: tasks` are easy to conflate and are not the same setting** — `cardContent: tasks` is still one card per NOTE narrowed to its checklist; `mode: tasks` is one card per checkbox TASK, any origin.
- **`body`/`tasks` mode is a live editor, not a preview.** Clicking a card places the cursor and typing edits the actual note (autosaved) — it does not open the note or navigate, except via an inline `[[wikilink]]` or URL.

Full reference: `docs/bases/views/cards.md`
