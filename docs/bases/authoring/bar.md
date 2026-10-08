# bar

A `bar` view draws one full-width row of `#` fill per bucket, with the value printed at the right. Use it to compare categories or a handful of periods.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("reading")
view: bar
x: date
y: pages
aggregate: sum
bin: week
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | property id | auto-detected | the bucket axis: a date column or a category column; a bare name means `note.<name>` |
| `y` | property id | auto-detected | the numeric value; ignored when `aggregate: count` |
| `aggregate` | `sum` \| `avg` \| `count` \| `min` \| `max` | `sum` when `y` resolves, else `count` | how a bucket's values combine |
| `bin` | `day` \| `week` \| `month` | `day` | bucket size on a date axis; no effect on a category axis |
| `limit` | number | none | charts only the first N rows |

## Failure modes

- If `x` or `y` is unset, the chart guesses: the first column that is mostly ISO dates for `x`, the first other mostly-numeric column for `y`. On mixed data it can pick the wrong column silently; set both.
- If `aggregate` or `bin` holds any other value, it is dropped without an error and the default applies; `bismuth base validate` does not catch it.
- If no column is numeric, the chart counts rows instead of summing; `true`/`false` columns never count as numeric.
- Category buckets sort by value, highest first (ties alphabetical), not in the order the values appear.
- On a date axis, a row with an empty or non-date `x` is skipped, not charted as zero.
- A negative value draws an empty bar.

Full reference: [docs/bases/views/charts.md](../views/charts.md#bar-view)
