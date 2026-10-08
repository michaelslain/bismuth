# line

A `line` view draws the series as an ASCII line plot with a y-axis gutter and a least-squares trend. Use it to read a trend over time.

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
| `x` | property id | auto-detected | the time axis; a category column also plots, without a trend |
| `y` | property id | auto-detected | the numeric value; ignored when `aggregate: count` |
| `aggregate` | `sum` \| `avg` \| `count` \| `min` \| `max` | `sum` when `y` resolves, else `count` | how a bucket's values combine |
| `bin` | `day` \| `week` \| `month` | `day` | bucket size on a date axis |
| `limit` | number | none | charts only the first N rows |

## Failure modes

- If `x` or `y` is unset, the chart guesses from the data (mostly-ISO-date column for `x`, mostly-numeric column for `y`) and can pick the wrong one silently; set both.
- If `aggregate` or `bin` holds any other value, it is dropped without an error and the default applies.
- The trend line and its math appear only on a date axis with at least 3 points that do not share one bucket; otherwise they are absent, with no error.
- On a date axis, a row with an empty or non-date `x` is skipped, so a missing day is a gap in the buckets, not a dip to zero.
- When more points exist than fit the pane, the plot shows only the most recent ones and the readout adds `last K of N`.
- Values are not shown on hover tooltips; hovering a point updates the readout line above the plot.

Full reference: [docs/bases/views/charts.md](../views/charts.md#line-view)
