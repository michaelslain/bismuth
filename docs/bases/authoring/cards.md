# cards

A card grid. `cardContent` picks the card face for a note row: `properties` (a book-style cover plus a few properties, the default), `body` (a live editor over the whole note body), or `tasks` (a live editor over the note's checklist only). `mode: tasks` is a separate setting: one card per task.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("book")
view: cards
cardContent: properties
image: cover
imageFit: cover
imageAspectRatio: 0.667
order: [file.name, note.author, note.status, note.rating]
groupBy:
  property: note.status
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `cardContent` | `"properties"` \| `"body"` \| `"tasks"` | `"properties"` | The card face for a note row, in `mode: normal`. |
| `image` | property id | none | The property whose value is the cover: a URL (`https:`, `data:`, `blob:`) or a vault path. `properties` face only. |
| `imageFit` | `"cover"` \| `"contain"` | `"cover"` | Crop to fill, or fit the whole image. |
| `imageAspectRatio` | number | `0.667` | Cover width ÷ height (2:3). |
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | `tasks` renders each row as one task card (checkbox, description, field chips); `cardContent` is then ignored. |
| `order` | `string[]` | derived | First column = title, second = author on the generated cover. |
| `sort`, `groupBy`, `columns`, `limit` | | | As for a table. Grouping also colours the generated covers. |

## Failure modes

- If `image` holds a URL instead of a property name, every card shows the text cover: the URL is read as a property id that no row has. Store the URL in a property (`cover:`) and write `image: cover`.
- If a row's image value is a list or a link object, that card silently shows the text cover.
- `cardContent: tasks` is one card per note, narrowed to its checklist; `mode: tasks` is one card per task. They are different settings, and `mode: tasks` overrides the card face.
- A `body` or `tasks` card is a live editor: a click places the cursor and typing edits the note. Only links inside it navigate.
- There is no column-count key. The grid fits columns at or above the `.settings` key `ui.cardGridMinWidth` (default 220 px), vault-wide.

Full reference: [docs/bases/views/cards.md](../views/cards.md)
