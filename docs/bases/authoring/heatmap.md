# heatmap

A `heatmap` view lays days out as a week-column grid with one glyph per day for its intensity, plus a streak line. Use it for a daily habit or log; a base that owns its rows lets the reader log a day by clicking it.

## Working example

```yaml
---
type: base
view: heatmap
x: date
y: words
aggregate: sum
---
- date: 2026-09-14
  words: 420
- date: 2026-09-15
  words: 610
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | property id | auto-detected | must be a date column |
| `y` | property id | auto-detected | the numeric value per day; ignored when `aggregate: count` |
| `aggregate` | `sum` \| `avg` \| `count` \| `min` \| `max` | `sum` when `y` resolves, else `count` | how a day's values combine |
| `limit` | number | none | charts only the first N rows |

`bin` does not apply: the heatmap is always one cell per day.

## Failure modes

- If `x` is not a date column, or the base has no dated rows yet, the view shows `no data to chart` and no grid, so there is no day to click. Seed a base that owns its rows with one dated row, as in the working example.
- A `bin:` key is ignored, with no error.
- Clicking writes only when the target is unambiguous. On a base with a `source:`, a click edits only a day with exactly one note and a numeric `y`, and writes that note's frontmatter; every other day opens the drill list instead.
- On a base that owns its rows, entering an empty value or `0` deletes that day's row, and a day holding several rows opens the drill list instead of editing.
- The current streak is 0 unless the latest logged day is today or yesterday; a day with a value of 0 or less breaks a streak.
- Inside a ```` ```query ```` block the heatmap is read-only.

Full reference: [docs/bases/views/charts.md](../views/charts.md#heatmap-view)
