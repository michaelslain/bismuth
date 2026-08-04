# line

A line + area-fill chart (inline SVG) — for reading a trend over time. Shares its data pipeline (`buildChartData`) with `bar`/`stat`/`heatmap`.

## Working example

```yaml
---
type: base
views:
  - type: line
    name: Weight Over Time
    x: date
    y: weight
    aggregate: avg
    bin: week
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | `string` (property id) | auto-detected | Time/category axis. |
| `y` | `string` (property id) | auto-detected | Numeric value axis. Ignored when `aggregate: count`. |
| `aggregate` | `"sum"\|"avg"\|"count"\|"min"\|"max"` | `"sum"` if `y` resolves, else `"count"` | Bucket aggregation. |
| `bin` | `"day"\|"week"\|"month"` | `"day"` | Time-bucket size for date axes. |

## Failure modes

- **There is no tooltip and no axis labels at all** (unlike `bar`) — the line view shows only the shape of a trend, never exact values. Pair it with `table` or `stat` alongside if the reader needs numbers.
- **A single data point renders as a centered dot, not a line** (`step` collapses to 0) — don't expect a line shape from a dataset with only one bucket.
- **Rows with an unparseable/missing `x` date are silently skipped**, not treated as a zero-value bucket — a gap in your data becomes a gap in the chart's bucket set, not a dip to zero.

Full reference: `docs/bases/views/charts.md`
