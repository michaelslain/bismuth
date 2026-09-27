# heatmap

A GitHub-style contribution grid (week columns, Mon–Sun) plus streak stats below. Intensity is drawn as a **glyph** (`.` `-` `+` `#`), not a colored/sized cell. Shares its data pipeline (`buildChartData`) with `bar`/`line`/`stat`, but with one hard override — see below.

## Working example

```yaml
---
type: base
views:
  - type: heatmap
    name: Writing Activity
    x: date
    y: words
    aggregate: sum
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | `string` (property id) | auto-detected | **Required to resolve to ISO date strings** — a non-date `x` produces the empty state, not an error. |
| `y` | `string` (property id) | auto-detected | Numeric value axis. Ignored when `aggregate: count`. |
| `aggregate` | `"sum"\|"avg"\|"count"\|"min"\|"max"` | `"sum"` if `y` resolves, else `"count"` | Per-day aggregation. |
| `bin` | — | forced `"day"` | **Not actually configurable** — see below. |

## Failure modes

- **`bin` is unconditionally forced to `"day"` regardless of what you set** — unlike the other three chart kinds, a `bin: week`/`bin: month` in a heatmap view is silently ignored. This is a real deviation from `bar`/`line`/`stat`, not an oversight to work around.
- **`x` behaves unlike the other charts: it must be a date column, full stop.** A category `x` (that works fine for `bar`) produces heatmap's own distinct empty-state message ("No dated rows to chart. Set an x date column in view settings.") rather than any grid.
- **The grid always starts on the Monday on/before your earliest data point** — a dataset starting mid-week shows leading empty (null) cells in the first column; this is expected ISO-week alignment, not missing data.
- **Each cell DOES carry a tooltip** (`title="<date>: <value>"`) even though the glyph itself only encodes 4 discrete tiers — hover for the exact number.
- **The streak tiles below the grid ("entries"/"current streak"/"longest streak") only count days with `value > 0`** — a day with a zero or missing value breaks a streak, same as a day with no row at all.

Full reference: `docs/bases/views/charts.md`
