# heatmap

A GitHub-style contribution grid (week columns, Mon–Sun) plus a one-line streak readout below (`app/src/bases/HeatmapView.tsx` + `heatmapLayout.ts`). Intensity is drawn as a **glyph** (`.` `-` `+` `#`), not a colored/sized cell. Shares its data pipeline (`buildChartData`) with `bar`/`line`/`stat`, but with one hard override — see below.

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

- **`bin` is unconditionally forced to `"day"` regardless of what you set** — unlike the other three chart kinds, a `bin: week`/`bin: month` in a heatmap view is silently ignored. This is a real deviation from `bar`/`line`/`stat`, not an oversight to work around. The ViewBar also has no `bin` picker for a heatmap.
- **`x` behaves unlike the other charts: it must be a date column, full stop.** A category `x` (that works fine for `bar`) produces heatmap's own distinct empty-state message ("No dated rows to chart. Set an x date column in view settings.") rather than any grid.
- **The grid spans the pane and ends at the LATER of today and the latest data point** — it does not simply start at the earliest data point and run forward. `heatmapRange()` sizes the grid to as many week columns as fit (2 cells per column, up to 53 weeks/a year), so a small pane shows a shorter recent window, not the full history. Whatever range results, `buildHeatmapWeeks` then snaps its start back to the Monday on/before it and its end forward to the Sunday on/after it, so a range edge landing mid-week still gets a complete first/last week column with the extra days `value: null`.
- **There is no per-cell `title` tooltip** — hovering a cell drives the shared readout line above the grid (label/value/note count), the same mechanism `bar` and `line` use; clicking a cell with at least one note opens the drill list. The glyph itself only encodes 4 discrete intensity tiers, so exact numbers come from the readout, not a native tooltip.
- **Streaks are one readout line below the grid, not a tile grid** — `"18 days logged // current streak 0 days // longest 18 days"`. `entries` counts days with `value > 0`; `current` is the run ending at the most recent entry (0 if that entry isn't today or yesterday, i.e. the streak has lapsed); `longest` is the longest consecutive-day run in the data. A day with a zero or missing value breaks a streak the same as a day with no row at all.

Full reference: `docs/bases/views/charts.md`
