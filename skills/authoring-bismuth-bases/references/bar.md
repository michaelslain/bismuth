# bar

A character-grid bar chart — one full-width row of monospace `#` fill per bucket (`app/src/bases/BarView.tsx` + `barRows.ts`). **No SVG, no `AsciiChart`/`AsciiMeter`.** Shares its data pipeline (`buildChartData`) with `line`/`stat`/`heatmap`. Interactive: hovering a row updates the readout, clicking opens a drill list of the notes behind that bucket, and the ViewBar exposes `x`/`y`/`agg`/`bin` pickers.

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
- **Every bucket's label always shows, at any count — there is no 16-bar cutoff.** (That gate belongs to `line`'s x-axis labels, not `bar`.) Rows just get longer as buckets grow; there's no rotation or truncation because there's no axis to run out of room on.
- **No `title` tooltip on any bar** — the raw numeric value is printed right-aligned after the bar instead, and hovering a row drives the shared readout line above the chart, not a native tooltip.
- **A negative value clamps to a zero-length fill** rather than drawing backwards or throwing; `fill = round(max(0, value) / max * width)`. An all-zero or single-value dataset still renders bars, just short or flat ones — that's not an error state.
- **Category-axis buckets sort by value descending, not alphabetically** (ties broken alphabetically by key) — the bar order isn't insertion order or the order you wrote filters/categories in.
- **Hover/select styling**: hovering a row turns its fill `--fg`; clicking selects it (fill stays `--fg`, every other row's fill drops to `--text-muted`) and opens the drill list — there is no per-bar color palette.

Full reference: `docs/bases/views/charts.md`
