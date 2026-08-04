# bullets

A plain `<ul>` list in editor prose style — no table chrome, no icons, no borders. Intended for reading-quote-style lists where a table is overkill.

## Working example

```yaml
---
type: base
source: notes where "#quote"
views:
  - type: bullets
    name: Reading Quotes
    groupBy:
      property: note.author
    sort:
      - property: note.author
        direction: ASC
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | auto-derived | Only `order`'s (or the resolved `result.columns`') **first** column is ever rendered — bullets is single-column by design. |
| `groupBy` | `{ property, direction? }` | none | Plain bold heading per group, no color/dot/count (contrast with `list`). |
| `columns` (→ `groupOrder`) | `string[]` | value-sorted | Group order only, same rules as `list`. |
| `sort`, `limit`, `filters` | — | — | Standard fields. |

## Failure modes

- **Every column past the first is ignored.** If you need a second/third field visible per row, use `list` (up to 3 columns) or `table` instead.
- **No task-row special-casing.** Unlike `list`, a `tasks:`-sourced `bullets` view does not render checkbox glyphs or toggle interactivity — it just stringifies `note.description` (or whatever the first column resolves to) as plain text.
- **No interactivity beyond `renderValue`'s built-ins** (wikilinks and `file.name` open the note; everything else is static text) — there is no `onChange` callback, so nothing here can trigger a refetch.

Full reference: `docs/bases/views/list-bullets.md`
