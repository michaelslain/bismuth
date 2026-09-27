# line

An ASCII line plot on a character grid (`/ - \ o` glyphs in a `<pre>` block, `app/src/bases/asciiLine.ts`) — for reading a trend over time. **No SVG.** Shares its data pipeline (`buildChartData`) with `bar`/`stat`/`heatmap`.

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

- **There IS a y-axis gutter (top row = series max, bottom row = 0) and x-axis labels** — but only when `points.length <= 16`. With 17+ points, `axisLabels` is the empty string and the label row silently disappears (no rotation/truncation, it's a binary show/hide). `bar` has no such cutoff.
- **No tooltip** — point values aren't exposed via `title`; pair with `table` or `stat` alongside if the reader needs exact numbers.
- **A single data point still draws** (as a lone `o` marker, no connecting glyphs since there's nothing to connect) — don't expect a shaped line from a dataset with only one bucket.
- **Rows with an unparseable/missing `x` date are silently skipped**, not treated as a zero-value bucket — a gap in your data becomes a gap in the chart's bucket set, not a dip to zero.

Full reference: `docs/bases/views/charts.md`
