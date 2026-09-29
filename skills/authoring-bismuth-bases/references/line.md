# line

An ASCII line plot on a character grid (`/ - \ o` glyphs in a `<pre>` block, `app/src/bases/LineView.tsx` + `asciiLine.ts`) — for reading a trend over time. **No SVG.** Shares its data pipeline (`buildChartData`) with `bar`/`stat`/`heatmap`. Interactive: hovering maps the cursor to the nearest point and updates the readout; clicking a point opens the drill list.

## Working example

```yaml
---
type: base
view: line
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

- **There is a y-axis gutter (right-aligned, exactly three ticks: series max, midpoint, `0`) and an x-axis label row under the baseline — but there's no hard 16-point cutoff that hides them.** The plot fills the pane's measured width; when more labels would collide than fit, they're *thinned* (every k-th label shown), never dropped wholesale. `bar` never thins its labels since it has no shared axis to run out of room on.
- **No native `title` tooltip** — point values aren't exposed via `title`; hovering drives the shared readout line instead, so pair with `table` or `stat` alongside if the reader needs exact numbers at a glance.
- **A single data point still draws** (as a lone `o` marker in `--accent`, no connecting glyphs since there's nothing to connect) — don't expect a shaped line from a dataset with only one bucket.
- **Rows with an unparseable/missing `x` date are silently skipped**, not treated as a zero-value bucket — a gap in your data becomes a gap in the chart's bucket set, not a dip to zero.
- **When more points exist than fit the pane, the plot keeps the last K that fit** and the readout appends `// last K of N` — older points are dropped from view, not compressed or scrolled.
- **The trend line (KaTeX, below the plot) only appears with ≥3 points on a date axis with non-zero time variance** — fewer points, a non-date `x`, or every point sharing the same bucket means no trend line and no trend math, not an error.

Full reference: `docs/bases/views/charts.md`
