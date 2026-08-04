# stat

A single-number summary tile, or a 4-card grid when there's more than one bucket. Shares its data pipeline (`buildChartData`) with `bar`/`line`/`heatmap`.

## Working example

```yaml
---
type: base
views:
  - type: stat
    name: Reading Stats
    x: date
    y: pages
    aggregate: sum
    bin: month
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | `string` (property id) | auto-detected | Bucketing axis. |
| `y` | `string` (property id) | auto-detected | Value axis. Ignored when `aggregate: count`. |
| `aggregate` | `"sum"\|"avg"\|"count"\|"min"\|"max"` | `"sum"` if `y` resolves, else `"count"` | Per-bucket aggregation, then further combined for the tile(s). |
| `bin` | `"day"\|"week"\|"month"` | `"day"` | Bucket size — directly controls single-tile vs. 4-card mode (see below). |

## Failure modes

- **Display mode is entirely data-driven, not a config switch.** ≤1 bucket → one big number + sparkline; ≥2 buckets → a 4-card grid (total/average/buckets/peak). To force the 4-card view, widen `bin` (e.g. `month`) or broaden the source so more than one bucket exists — there is no field to pick the mode directly.
- **The "+N ↑ latest" delta only shows on a strictly positive change** between the last two buckets — a decrease or flat value shows no delta at all (not a red/negative indicator).
- **`aggregate: count` ignores `y` entirely**, even if you set one — the tile(s) show row counts, not a sum/average of `y`.

Full reference: `docs/bases/views/charts.md`
