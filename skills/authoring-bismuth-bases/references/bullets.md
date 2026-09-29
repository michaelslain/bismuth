# bullets

A plain `<ul>` list in editor prose style — no table chrome, no icons, no borders. Intended for reading-quote-style lists where a table is overkill.

## Working example

```yaml
---
type: base
source: notes where "#quote"
view: bullets
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
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | With `mode: tasks`, every `<li>` renders the shared `<TaskRow>` (checkbox, description, field chips) instead of the plain first-column text. Gates on the **declared mode only**, never on row shape — unlike `list`, an un-migrated `source: tasks` bullets base with no `mode:` key keeps rendering plain `renderValue` text. |
| `sort`, `limit`, `filters` | — | — | Standard fields. |

## Failure modes

- **Every column past the first is ignored** in normal mode. If you need a second/third field visible per row, use `list` (up to 3 columns) or `table` instead.
- **Task-row rendering requires `mode: tasks` explicitly** — a `source: tasks` bullets view with no `mode:` key silently stays plain text (no checkbox, no toggle), which is easy to mistake for a bug when the identical base as `list` would auto-detect the shape and render checkboxes.
- **No interactivity in normal mode beyond `renderValue`'s built-ins** (wikilinks and `file.name` open the note; everything else is static text) — there is no `onChange` callback for anything but the tasks-mode checkbox toggle/status handlers.

Full reference: `docs/bases/views/list-bullets.md`
