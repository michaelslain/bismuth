# cards

A visual card grid. Three sub-modes via `cardContent`: `properties` (book-cover grid, default), `body` (inline-editable Google-Keep-style masonry over the note body), `tasks` (same masonry, narrowed to the note's checklist lines).

## Working example

```yaml
---
type: base
source: notes where "#book"
views:
  - type: cards
    name: Reading List
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
| `cardContent` | `"properties"` \| `"body"` \| `"tasks"` | `"properties"` | Which sub-mode renders. |
| `image` | `string` (property id) | none | Property whose value is the cover image (properties mode only). |
| `imageFit` | `"cover"` \| `"contain"` | `"cover"` | CSS `object-fit` on the cover `<img>`. |
| `imageAspectRatio` | `number` | `0.667` | Width÷height for the cover container. |
| `order`, `sort`, `groupBy`, `limit`, `filters` | — | — | Standard fields; `order`'s first two columns drive the generated text-cover title/author. |

## Failure modes

- **`image` must be a property id, not a literal URL.** `image: "https://example.com/cover.jpg"` looks up a property *named* that URL on every row (always null). Put the URL in a frontmatter field (e.g. `cover:`) and set `image: cover`.
- **A non-string `image` value (array, Link object) silently falls back to the generated text cover** — no error, no broken-image icon.
- **The grid is a fixed 5 columns** (properties mode) — there is no config to change the column count.
- **`body`/`tasks` mode is a live editor, not a preview.** Clicking a card places the cursor and typing edits the actual note (autosaved) — it does not open the note or navigate, except via an inline `[[wikilink]]` or URL.

Full reference: `docs/bases/views/cards.md`
