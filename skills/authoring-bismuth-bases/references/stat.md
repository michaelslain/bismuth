# stat

A single big-number tile, or a 4-card grid when there's more than one bucket. **No sparkline anywhere in this view** — "the one view with no ASCII chart at all" (`StatView.tsx`'s own comment). Shares its data pipeline (`buildChartData`) with `bar`/`line`/`heatmap`.

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
| `bin` | `"day"\|"week"\|"month"` | `"day"` | Bucket size — indirectly controls single-tile vs. 4-card mode (see below). |

## Failure modes

- **Tile count is driven purely by bucket count, not a config switch.** 0 points → empty state; exactly 1 point → one tile (same big-number styling as the 4-card case, just one); ≥2 points → the 4-card grid (total/average/buckets/peak). To force the 4-card view, widen `bin` (e.g. `month`) or broaden the source so more than one bucket exists — there is no field to pick the mode directly.
- **The "+N/-N latest" delta on the total tile shows on ANY nonzero change between the last two buckets — including a decrease** (`"-3 latest"`). Only a flat (zero) change shows no delta. It never gets red/negative styling or an arrow — always the same faint color regardless of sign.
- **`aggregate: count` ignores `y` entirely**, even if you set one — the tile(s) show row counts, not a sum/average of `y`.

Full reference: `docs/bases/views/charts.md`
