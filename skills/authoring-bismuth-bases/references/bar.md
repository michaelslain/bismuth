# bar

A vertical bar chart (inline SVG) — one bar per bucket. Shares its data pipeline (`buildChartData`) with `line`/`stat`/`heatmap`.

## Working example

```yaml
---
type: base
views:
  - type: bar
    name: Glasses of Water
    x: date
    y: glasses
    aggregate: sum
    bin: week
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | `string` (property id) | auto-detected | Category/time axis. Bare names resolve to `note.<name>`. |
| `y` | `string` (property id) | auto-detected | Numeric value axis. Ignored entirely when `aggregate: count`. |
| `aggregate` | `"sum"\|"avg"\|"count"\|"min"\|"max"` | `"sum"` if `y` resolves, else `"count"` | How values in a bucket combine. |
| `bin` | `"day"\|"week"\|"month"` | `"day"` | Time-bucket size for date axes; no effect on category axes. |

## Failure modes

- **Auto-detection has a ≥50%-of-rows heuristic and excludes booleans from `y`.** If your data is ambiguous (mixed types, sparse values), omitting `x`/`y` can silently pick the wrong columns — set them explicitly when the chart looks wrong.
- **X-axis labels vanish entirely above 16 bars** — no rotation, no truncation, just gone. If you need to read individual bar labels with many buckets, use `table` or narrow with `filters`/`limit` instead.
- **An all-zero or single-value dataset still renders** (max is floored to 1 to avoid divide-by-zero) — flat bars are not an error state, don't mistake them for missing data.

Full reference: `docs/bases/views/charts.md`
