# stat

A `stat` view shows one tile per metric: the number, a this-period/last-period split, a 12-bin sparkline and the metric as math. Declare the tiles with `stats:`, or let the view build one tile from `x`/`y`/`aggregate`.

## Working example

```yaml
---
type: base
view: stat
x: date
bin: week
stats:
  - label: total pages
    value: sum(pages)
  - label: books
    value: count()
  - value: sum(pages) / sum(minutes)
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `stats` | list of `{label, value}` or bare strings | one synthesized tile | each `value` is a metric expression; `label` defaults to `value` |
| `x` | property id | auto-detected | a date column drives each tile's period split and sparkline |
| `bin` | `day` \| `week` \| `month` | `week` | the period and sparkline bucket size |
| `y` | property id | auto-detected | used only for the synthesized tile |
| `aggregate` | `sum` \| `avg` \| `count` \| `min` \| `max` | `sum` when `y` resolves, else `count` | used only for the synthesized tile |

A metric expression uses the aggregates `count()`, `count(<expr>)`, `sum(<expr>)`, `avg(<expr>)`, `min(<expr>)` and `max(<expr>)`, joined by numbers, unary `-` and `+ - * / %`.
`count(status == "done")` counts rows where the condition holds. Division by zero gives an empty value.

## Failure modes

- If a metric names a property outside an aggregate call (a bare `priority`), the tile shows `—` and `cannot read: priority must be inside sum, avg, min, max or count`. `bismuth base validate` only checks that the metric parses, so it passes; run `bismuth base render <path>` and read `metrics` to see the error.
- If `x` is not a date column, every tile silently drops its period split and sparkline.
- Without `stats:`, the view shows exactly one tile: `count()` labelled `notes` when the aggregate is `count` or no `y` resolves, else `<aggregate>(<y>)`.
- `bin` defaults to `week` here but to `day` in `bar`/`line`, so the same base buckets differently across kinds; set `bin` explicitly.
- A failing metric affects only its own tile; the other tiles still render.

Full reference: [docs/bases/views/charts.md](../views/charts.md#stat-view)
