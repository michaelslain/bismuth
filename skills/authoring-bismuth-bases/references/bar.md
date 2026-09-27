# bar

A character-grid bar chart — one row of monospace `#` fill per bucket, via `AsciiChart` (`app/src/ui/ascii/AsciiMeter.tsx`). **No SVG.** Shares its data pipeline (`buildChartData`) with `line`/`stat`/`heatmap`.

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
- **No tooltip on any bar** — no element carries a `title`. The raw numeric value is printed after the bar instead.
- **An all-zero or single-value dataset still renders** (max is floored to 1 to avoid divide-by-zero) — flat/short bars are not an error state, don't mistake them for missing data.
- **Category-axis buckets sort by value descending, not alphabetically** (ties broken alphabetically by key) — the bar order isn't insertion order or the order you wrote filters/categories in.

Full reference: `docs/bases/views/charts.md`
