# Chart views: bar, line, stat, heatmap

The four chart view kinds turn a base's rows into an aggregated series: `bar` and `line` plot one value per bucket, `stat` shows big-number tiles, and `heatmap` lays days out on a calendar grid. Every chart is typed on a character grid, not drawn; for how a base and its one view are declared, start with the [Bases overview](../overview.md).

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

That base sums the `pages` frontmatter value of every `#reading` note into one bar per week of its `date`.

## Pick a chart kind

All four kinds read the same keys and bucket rows the same way; they differ in what they draw.

| kind | draws | reach for it when |
|---|---|---|
| `bar` | one full-width row of `#` fill per bucket, value printed at the right | comparing categories, or a handful of periods |
| `line` | an ASCII line plot with a y-axis gutter and a least-squares trend | reading a trend over time |
| `stat` | one tile per metric: the number, a this-period/last-period split, a 12-bin sparkline | headline numbers |
| `heatmap` | a week-column grid of days, intensity as a glyph, plus streak counts | a daily habit or log |

## Chart config keys shared by every kind

A chart reads these keys from the base's frontmatter, beside `view:`. Every key is optional.

| key | type | allowed values | default | effect |
|---|---|---|---|---|
| `x` | property id | any column, such as `date` or `note.status` | auto-detected | the bucket axis: a date column or a category column |
| `y` | property id | any column with numeric values | auto-detected | the value aggregated inside each bucket |
| `aggregate` | string | `sum` `avg` `count` `min` `max` | `sum` when `y` resolves, else `count` | how a bucket's values combine |
| `bin` | string | `day` `week` `month` | `day` (`week` for `stat`); `heatmap` always `day` | the bucket size on a date axis; no effect on a category axis |
| `limit` | number | any positive integer | none | charts only the first N rows |
| `stats` | list | see [Write a stat metric](#write-a-stat-metric) | one metric synthesized from `x`/`y`/`aggregate` | `stat` only: the tiles to show |

A bare property name (`date`) means the frontmatter key, the same as `note.date`.
An `aggregate` or `bin` outside its allowed values is dropped without an error, and the default applies; `bismuth base validate` does not check either key.

### How a chart picks x and y when they are unset

A chart with no `x` takes the first frontmatter column in which at least half the non-empty values start with an ISO date (`YYYY-MM-DD`), else the first column it finds.
A chart with no `y` takes the first other column in which at least half the non-empty values are numbers or numeric strings; `true`/`false` columns never qualify.
If no column qualifies for `y`, the chart counts rows.
On mixed or sparse data the guess can land on the wrong column, so set `x` and `y` whenever the chart looks wrong.

### How a chart buckets dates and categories

A chart's `x` is a date axis when at least half its values parse as ISO dates; otherwise it is a category axis.

| axis | bucket key | label | order |
|---|---|---|---|
| date, `bin: day` | the date | `May 27` | oldest first |
| date, `bin: week` | the Monday of that week | `May 25` (the Monday) | oldest first |
| date, `bin: month` | the 1st of the month | `May 2026` | oldest first |
| category | the value as text | the value | highest value first, ties alphabetical |

On a date axis, a row whose `x` is empty or not a date is skipped: it adds no bucket and no value, so a missing day is a gap, not a zero.

### What each aggregate computes

An aggregate combines the `y` values that land in one bucket; values that are not numbers are skipped.

| aggregate | bucket value |
|---|---|
| `count` | the number of rows in the bucket; `y` is ignored even when set |
| `sum` | the total of the numeric `y` values |
| `avg` | their mean |
| `min` / `max` | their smallest / largest |

A bucket whose rows have no numeric `y` at all gets `0`.

## Bar view

The `bar` view draws one row per bucket across the full width of the pane: the label, a run of `#` fill in the accent colour, a `.` track out to a shared right edge, and the value right-aligned.

```yaml
---
type: base
view: bar
x: status
---
```

That base counts notes per `status` value, highest count first.
A header row names both axes, for example `due (week)` over the labels and `sum priority` over the values (`notes` for a count).

- Every bucket gets a row and a full label; bar charts never thin or truncate labels.
- Bar length is the value as a share of the largest value; a negative value draws an empty bar.
- All bars use one colour. Hovering a row brightens its fill; clicking it marks the label with `>`, dims every other row and opens the [drill list](#see-the-notes-behind-a-bucket).

## Line view

The `line` view draws the series as an ASCII plot that fills the pane: data points as `o`, connected by `-` `/` `\` `|`, with a y-axis gutter of three ticks (the maximum, the midpoint and `0`) and x labels under the baseline.

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

- When x labels would collide, the plot shows every k-th label instead of overlapping them.
- When more points exist than fit the width, the plot keeps the most recent ones and the readout adds `last K of N`.
- A least-squares trend is drawn as `.` in the cells the data line leaves empty.
- Pointing anywhere over the plot selects the nearest point (drawn `@`); clicking opens the [drill list](#see-the-notes-behind-a-bucket). With the plot focused, the arrow keys, Home and End move between points, and Enter or Space opens the drill.

Under the plot, two lines of math say what each point is and what the trend is:

```latex
y(t) = \sum_{n \in B_t} n.\text{priority} \qquad B_t = \{\, n : \operatorname{week}(n.\text{due}) = t \,\}
\hat{y} = -0.40\,t + 3.10 \qquad R^2 = 0.82 \qquad t = \text{weeks since Jun 29}
```

When `y` is a `formula.*` column, the definition line also shows that formula as math.
The trend line and its math appear only on a date axis with at least 3 points that do not all share one bucket.

## Stat view

The `stat` view shows one tile per metric. Each tile has the number, its label, the current bin against the previous one (`3 this week // 1 last week`, or `today`/`yesterday` for day bins), a 12-bin sparkline (`▁▂▃▄▅▆▇█`) and the metric written as math. The first tile's number is in the accent colour.

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

- Without `stats:`, the view shows one tile: `count()` labelled `notes` when the aggregate is `count` or no `y` resolves, otherwise `<aggregate>(<y>)` labelled `<aggregate> of <y>` (`average of` for `avg`).
- The period split and the sparkline appear only when `x` is a date axis; with a category `x`, tiles show the number, label and math only.
- The sparkline names its window under the glyphs (`last 12 weeks // Jul 6 – Sep 21`), and hovering a glyph replaces the period line with that bin's value (`week of Sep 14 // 3`).
- A `stat` view's `bin` defaults to `week`, unlike the other kinds, so the same base with no `bin` buckets differently as a `bar`.

### Write a stat metric

A stat metric (each `stats:` entry's `value`) is an expression built from five aggregate functions evaluated over all the base's rows.
An entry is either a bare string, used as both label and value, or `{label, value}`; `label` defaults to `value`.

| form | result |
|---|---|
| `count()` | the number of rows |
| `count(<expr>)` | the number of rows where `<expr>` is true, such as `count(status == "done")` |
| `sum(<expr>)` | the total of `<expr>` over rows where it is a number; `0` when none are |
| `avg(<expr>)` | the mean of those numbers; empty when there are none |
| `min(<expr>)` / `max(<expr>)` | the smallest / largest of those numbers; empty when there are none |

Around the aggregate calls you can use numbers, unary `-`, and `+ - * / %`, as in `sum(price) / sum(units)` or `max(priority) - min(priority)`.
Dividing by zero gives an empty result, and an empty result stays empty through the rest of the arithmetic.

A property name outside an aggregate call, such as a bare `priority`, fails: a metric has no single row to read, so the tile shows `—` and `cannot read: priority must be inside sum, avg, min, max or count`.
`bismuth base validate` only checks that each metric parses, so it passes this mistake; read the `metrics` entry from `bismuth base render` to see it.
A failing metric affects only its own tile.

## Heatmap view

The `heatmap` view lays days out GitHub-style: one column per week (Monday at the top), a month label over the column holding each month's 1st, and a glyph per day for its intensity.

```yaml
---
type: base
view: heatmap
x: date
y: words
aggregate: sum
---
- date: 2026-09-14
  words: 420
- date: 2026-09-15
  words: 610
```

That base owns its rows (it has no `source:`), so clicking a day logs a value straight into the file; no daily notes are needed.

- The grid is always one cell per day: `bin` is ignored and the view bar has no `bin` picker.
- `x` must be a date column. With a category `x`, or no dated rows yet, the view shows `no data to chart` and no grid.
- The grid shows as many weeks as fit the pane, up to 53, and ends at today or the latest dated row, whichever is later.
- Under the grid, one line counts days with a value above 0 and the current and longest runs of consecutive days: `18 days logged // current streak 0 days // longest streak 18 days`. The current streak is 0 unless the latest logged day is today or yesterday.

A day's glyph comes from where its value falls between the series minimum and maximum, split into thirds. A legend under the grid prints each glyph's value range and what is plotted, such as `. none  - 50–149  + 150–248  # 249–347 // words per day`.

| glyph | meaning |
|---|---|
| `.` | no row, or a value of 0 or less |
| `-` | the lowest third |
| `+` | the middle third |
| `#` | the top third, and any day when every value is equal |

### Log a day by clicking the heatmap

Left-clicking a heatmap day edits it, and what it writes depends on where the base's rows come from. Right-clicking any day always opens its [drill list](#see-the-notes-behind-a-bucket).

| rows come from | chart | left-click |
|---|---|---|
| the base file itself (no `source:`) | a numeric `y` | opens a number field on the day; Enter or blur saves |
| the base file itself | a count | toggles the day: adds a row `{date}` or deletes that day's rows |
| a notes or tasks source | a numeric `y`, exactly one note that day | opens the number field; saving sets `y` in that note's frontmatter |
| a notes or tasks source | anything else | opens the drill and says why: `no note on Sep 14`, `2 notes — open one to edit` |

In the number field on an own-rows base, a value on an empty day adds a row with `x` and `y`, a value on a filled day updates that row, and an empty field or `0` deletes it.
A day that already holds several rows opens the drill with `N entries — edit in the table`.
A heatmap inside a ```` ```query ```` block has no file to write to, so a click only opens the drill.

## See the notes behind a bucket

A bar, line or heatmap chart has a readout line above it and a drill list below it.
At rest the readout gives the chart's caption and its peak, such as `sum of priority by week of due // peak 3 (Jul 1)`; while you hover a bucket it shows that bucket, such as `Jul 20 // 3 // 2 notes`.

Clicking a bucket opens the drill list: a `<label> // N notes` header with a `[ clear ]` button, then one link per note behind the bucket. Clicking the same bucket again or `[ clear ]` closes it, and the list scrolls past 12 rows.

## Change a chart's axes from the view bar

A chart's view bar carries pickers that write straight to the base file's frontmatter: `x`, `y`, `agg` and `bin`.

- Choosing `(count rows)` for `y` deletes the `y` key and sets `aggregate: count`; choosing a column while counting also sets `aggregate: sum`.
- A `heatmap` has no `bin` picker. A `stat` view with `stats:` shows only `x` and `bin`.
- A chart in a ```` ```query ```` block shows no pickers, because there is no file to write.

The gear's settings panel offers the same columns under **column mapping** (**X axis** and **Value**), plus **aggregate**, **date bucket** (not for a heatmap) and **row limit**, which writes `limit`.

## Inspect a chart from the CLI

`bismuth base render <path>` returns a chart view's computed series instead of raw rows: a `chart` object with every bucket and the rows behind it, plus `heatmapWeeks` for a heatmap and `metrics` (each tile's value, period split, sparkline and any error) for a stat view.
Without a pane width, the CLI's heatmap weeks run from the Monday before the first dated row to the last one.

`bismuth base validate <path>` reports a `stats:` entry that does not parse as `stats[<j>].value: "<expr>" failed to parse — <reason>`.

## How it works

`buildChartData(rows, view)` in `core/src/bases/chart.ts` is the one bucketing pass every chart runs: it resolves `x`/`y` (`autoX`/`autoY`, property lookup through `resolveProperty` in `query.ts`), detects a date axis, buckets with `binKey`/`binLabel` from `core/src/dates.ts`, aggregates, and sorts. Each `ChartPoint` carries `rows`, the indices of the rows behind it, which is what the drill list and the heatmap writes use. The resolved `x`, `y`, `aggregate` and `bin` come back on `ChartData` and feed the view bar's fallback values.

The views are `BarView.tsx` (row layout in `barRows.ts`), `LineView.tsx` (plot layout in `asciiLine.ts`), `StatView.tsx` with `StatTiles.tsx`/`StatTile.tsx`/`SparklineChart.tsx`, and `HeatmapView.tsx` with `heatmapLayout.ts` (`heatmapRange`, `levelOf`/`levelEdges`, `legendRanges`, `monthLabels`, `streaks`). `ChartFrame.tsx` lays out the readout, body, footer and drill around each view, measures the body's character grid, and shows the shared empty state. `ChartDrill.tsx` is the drill list.

`HeatmapView` calls `buildChartData` with `bin: 'day'`, then `buildHeatmapWeeks(points, range)` snaps the range to whole Monday–Sunday columns. What a click does is `dayAction` in `heatmapWrites.ts`, and what it writes is `planSetValue`/`planToggle`; `BaseView.tsx` builds the `HeatmapWriteSeam` (origin `base` when the base has no `source:`) and runs the writes with `api.rowCreate`/`rowUpdate`/`rowDelete` or `api.setProperty`.

Stat metrics are `metricResults(rows, view, today)` in `core/src/bases/metrics.ts`; `defaultMetric` synthesizes the fallback tile. Trend fitting is `fitTrend` in `trend.ts`. The math comes from `chartDefinitionLatex`, `trendLatex` and `metricToLatex` in `chartLatex.ts`, rendered by `ui/Tex.tsx`; captions and readouts come from `chartCaption`, `bucketReadout` and `formatValue` in `chartText.ts`.

The view bar's pickers are `ChartConfigBar.tsx`, wired by `BaseView`'s chart config slot to `api.setProperty`/`api.deleteProperty`. The settings panel's chart fields are `ChartFields.tsx` and the `x`/`y` entries of `baseSettingsPlan.ts`. Keys are parsed by `normalizeView` in `parse.ts`. The CLI payloads come from `base render` and `base validate` in `cli/src/commands/base.ts`.

Source: `core/src/bases/chart.ts`, `core/src/bases/metrics.ts`, `core/src/bases/trend.ts`, `core/src/bases/chartLatex.ts`, `core/src/bases/chartText.ts`, `core/src/bases/parse.ts`, `app/src/bases/BarView.tsx`, `app/src/bases/LineView.tsx`, `app/src/bases/StatView.tsx`, `app/src/bases/HeatmapView.tsx`, `app/src/bases/heatmapLayout.ts`, `app/src/bases/heatmapWrites.ts`, `app/src/bases/ChartFrame.tsx`, `app/src/bases/ChartDrill.tsx`, `app/src/bases/ChartConfigBar.tsx`, `app/src/bases/BaseView.tsx`, `cli/src/commands/base.ts`
