# heatmap

A GitHub-style contribution grid (week columns, Mon–Sun) plus streak stats. Shares its data pipeline (`buildChartData`) with `bar`/`line`/`stat`, but with one hard override — see below.

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
- **`x` behaves unlike the other charts: it must be a date column, full stop.** A category `x` (that works fine for `bar`) produces heatmap's own distinct empty-state message ("No dated rows to chart...") rather than any grid.
- **The grid always starts on the Monday on/before your earliest data point** — a dataset starting mid-week shows leading empty (null) cells in the first column; this is expected ISO-week alignment, not missing data.

Full reference: `docs/bases/views/charts.md`
