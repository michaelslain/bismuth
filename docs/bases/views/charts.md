# Chart views — bar, line, stat, heatmap

Bismuth provides four chart view types — `bar`, `line`, `stat`, and `heatmap` — all rendered from the same data-shaping pipeline in `core/src/bases/chart.ts`. Each is declared in a `type: base` file by setting `view:` to the corresponding string, with the view's keys at the top level of the frontmatter. All four are **interactive**: hovering a bucket updates a readout line, clicking one drills into the notes behind it, and the ViewBar exposes pickers that write the view's axis/aggregation config straight back into the base file. Every chart stays **typed, not drawn** — no SVG, no `<canvas>`, no chart library; the one exception is KaTeX, used to show the math behind a line's trend and a stat tile's metric.

**In this doc:** the shared bucketing/aggregation pipeline every chart view runs through → the config fields all four share, including `stats:` → per-view-type visual details, interaction and a minimal example each (bar, line, stat, heatmap) → the shared interaction chrome (readout, drill, ViewBar config pickers) → the stat metric expression language → the KaTeX definition/trend formats → the CLI's `base render`/`base validate` support → edge cases and gotchas.

---

## Shared pipeline: `buildChartData`

All four chart views call `buildChartData(rows, view)` (exported from `core/src/bases/chart.ts`) to transform a flat `Row[]` into a `ChartData` object.

### `ChartData` shape

```ts
interface ChartPoint {
  key:    string;      // bucket key (ISO date for date axes; raw string for category axes)
  label:  string;      // human-readable label shown on the chart
  value:  number;      // aggregated numeric value for this bucket
  date?:  string;      // ISO YYYY-MM-DD; present only when bin === "day" AND x is a date column
  rows:   number[];    // indices into the `rows` array passed to buildChartData — the notes behind this bucket
}

interface ChartData {
  points:     ChartPoint[];  // sorted; empty when there are no chartable rows
  min:        number;        // minimum point value (0 when no points)
  max:        number;        // maximum point value (0 when no points)
  isDate:     boolean;       // true when x resolved to a date column (>= 50% of rows parse as ISO date)
  valueLabel: string;        // "count" for count aggregate; otherwise the y field name
  x?:         string;        // the RESOLVED x property id, after auto-detection; undefined if nothing resolved
  y?:         string;        // the RESOLVED y property id, after auto-detection; undefined if nothing resolved
  aggregate:  Aggregate;     // the resolved aggregate (view.aggregate, or the default)
  bin:        Bin;           // the resolved bin (view.bin, or "day")
}
```

`ChartPoint.rows` is what lets a chart's click-to-drill list the actual notes behind a bucket — it is the same index list every view flattens `props.result.groups` against.

### `ViewConfig` fields consumed by chart views

All fields are optional; sensible defaults apply when omitted.

| Field | Type | Default | Description |
|---|---|---|---|
| `x` | `string` | auto-detected | Property id for the x-axis / category dimension. Bare names resolve to `note.<name>`; `file.` / `formula.` prefixes are also valid. |
| `y` | `string` | auto-detected | Property id whose numeric values are aggregated per bucket. Ignored when `aggregate: "count"`. |
| `aggregate` | `"sum" \| "avg" \| "count" \| "min" \| "max"` | `"sum"` if `y` resolves; `"count"` otherwise | How values within each bucket are combined. |
| `bin` | `"day" \| "week" \| "month"` | `"day"` | Time-granularity for date axes. Has no effect on category axes. The heatmap always forces `"day"` regardless of this setting. |
| `stats` | `{ label?: string; value: string }[]` or bare strings | none | **Stat view only.** Declared metrics — see [Stat metrics](#stat-view-declared-metrics) below. Absent or empty falls back to one metric synthesized from the view's own `x`/`y`/`aggregate`. |

### Auto-detection of `x` and `y`

When `x` is not specified, `buildChartData` iterates all columns present in any row and picks the **first column where ≥ 50% of non-null values parse as an ISO date** (`YYYY-MM-DD` prefix). If no date column exists, it falls back to `cols[0]` (the first column found).

When `y` is not specified, the code picks the **first column (other than `x`) where ≥ 50% of non-null values are numeric**. A boolean column is explicitly excluded from auto-detection — `toNumber(true) === 1` would otherwise mistakenly claim a `done: true/false` flag column as the y axis. If no numeric column is found, the aggregate falls back to `"count"`.

```ts
// Auto-detection example from chart.test.ts:
// rows = [{ date: "2026-05-01", glasses: 4 }, { date: "2026-05-02", glasses: 6 }]
// view = {} (no x/y specified)
// → isDate: true, points[0].value: 4, points[1].value: 6
// → data.x === "date", data.y === "glasses" (the RESOLVED fields on ChartData)
```

### Property resolution

`x` and `y` are resolved via `resolveProperty(id, row)` from `core/src/bases/query.ts`, which supports these namespaced forms:

- `file.<field>` — file metadata (e.g. `file.name`, `file.mtime`)
- `note.<field>` — frontmatter value (e.g. `note.date`)
- `formula.<field>` — computed formula value
- bare `<field>` — shorthand for `note.<field>`

### Aggregation functions

| Mode | Behavior |
|---|---|
| `"count"` | Counts the number of rows per bucket (ignores `y` entirely, even if set) |
| `"sum"` | Sums all numeric `y` values in the bucket (non-numeric values skipped) |
| `"avg"` | Arithmetic mean of numeric `y` values in the bucket |
| `"min"` | Minimum numeric `y` value in the bucket |
| `"max"` | Maximum numeric `y` value in the bucket |

When a bucket contains zero numeric `y` values and aggregate is not `"count"`, `aggregate()` returns `0`.

### Binning for date axes

When `isDate` is true, each row's `x` value is parsed to `YYYY-MM-DD` (handles both `Date` objects and ISO strings). The date is then snapped to a bucket key via `binKey(iso, bin)` from `core/src/dates.ts`:

| `bin` | `binKey` behavior | Example input → key |
|---|---|---|
| `"day"` | Returns the date unchanged | `"2026-05-27"` → `"2026-05-27"` |
| `"week"` | Snaps back to the Monday of that ISO week | `"2026-05-27"` (Wed) → `"2026-05-25"` (Mon) |
| `"month"` | Returns the first of the month | `"2026-05-27"` → `"2026-05-01"` |

Human labels are produced by `binLabel(key, bin)`:

| `bin` | Label format | Example |
|---|---|---|
| `"day"` | `"<Month> <day>"` | `"May 27"` |
| `"week"` | `"<Month> <day>"` (the Monday) | `"May 25"` |
| `"month"` | `"<Month> <year>"` | `"May 2026"` |

The `date` field on a `ChartPoint` is only populated when `bin === "day"` (exact-day keys). Week and month buckets do not carry a `date` because the key represents an interval, not a single calendar day.

### Sorting

- **Date axes**: sorted chronologically ascending by `key` (ISO string compare).
- **Category axes**: sorted by `value` descending; ties broken alphabetically by `key` for determinism.

```ts
// From chart.test.ts — category ties:
// rows = [{ cat: "b", g: 2 }, { cat: "a", g: 2 }]
// → sorted order: ["a", "b"]  (equal value → alphabetical)
```

### Rows missing the x value

For date axes, rows where the `x` property is `null`, `undefined`, or does not parse as a valid date are **silently skipped** (they do not create a bucket or contribute to any aggregate).

---

## View config fields summary (in a base frontmatter)

```yaml
view: bar       # or line | stat | heatmap
x: date         # property id for x-axis / category (auto-detected if omitted)
y: glasses      # property id for y-axis values (auto-detected if omitted)
aggregate: sum  # sum | avg | count | min | max  (default: sum when y exists, count otherwise)
bin: day        # day | week | month  (default: day; heatmap always forces day)
```

A stat view additionally accepts `stats:` in place of (or alongside) `x`/`y`/`aggregate` — see [Stat view](#stat-view-type-stat) below.

---

## Bar view (`view: bar`)

**File**: `app/src/bases/BarView.tsx` (row layout: `app/src/bases/barRows.ts`)

Renders each bucket as one full-width row of a character-grid meter — a text row per point, no SVG, no bar-color rainbow.

### Visual details

- **One row per bucket**, spanning the full measured width of the chart's body (via `ChartFrame`'s live character-grid measurement — see [Shared chrome](#shared-chart-chrome-readout-drill-viewbar-config)), not a fixed 32-column chart hugging one corner of a wide pane.
- **Header row** above the bars names both axes: the x property over the label column (`status`, or `due (week)` for a binned date axis) and the value over the value column (`notes` for a count, else e.g. `sum priority`) — `barHeader()` in `barRows.ts`.
- **Row layout**: `<label>  <fill><track>  <value>` — the label right-padded to the width of the longest label in the series, the fill a run of `#` in `--accent`, the track a run of `.` in `--faint` padding out to a shared right edge, the value right-aligned in `--fg`. All bars are one color — there is no per-index palette.
- **Bar length**: `fill = round(max(0, value) / max * width)` — a negative value clamps to a zero-length fill rather than going negative.
- **Hover and selection**: hovering a row turns its fill `--fg`; clicking a row selects it (a `>` marks its label, its fill stays `--fg`, every other row's fill drops to `--text-muted`) and opens the drill list. For a count chart the hover readout reads `Doing // 2 notes` (the value and the note count are the same number, so it is not repeated).

### Minimal base example (bar)

```yaml
---
type: base
view: bar
x: date
y: glasses
aggregate: sum
bin: week
---
```

---

## Line view (`view: line`)

**File**: `app/src/bases/LineView.tsx` (layout: `app/src/bases/asciiLine.ts`)

Renders a value over time as a full-width ASCII line plot inside a `<pre>` block — no SVG, no `<canvas>`.

### Visual details

- **The plot fills the pane width** — the column slot per point is derived from the chart body's measured width divided by the point count, floored at a minimum of 2 columns.
- **Y-axis gutter**: right-aligned, `--faint`, showing exactly three ticks — the series max, the midpoint, and `0`.
- **X-axis labels sit on their own line, under the baseline rule** — each centred under its point. Labels that would collide are thinned (every k-th label shown) rather than overlapping.
- **The drawn line has no gaps** — consecutive glyphs are 8-connected: `-` for a flat run, `/` `\` for a diagonal run, `|` for a steep run. Each actual data point is drawn as `o`, in `--accent`, painted last so it always wins over a connecting glyph on the same cell.
- **The least-squares trend** is drawn as `.` in `--faint`, but only in cells the data line leaves blank — the real data line always wins visually.
- **Hover and drill**: pointing anywhere over the plot maps the cursor to the nearest point; the hovered point's `o` becomes `@` in `--fg` and the readout line updates. Clicking a point opens the drill list for that bucket.
- **Many points**: when more points exist than fit, the plot keeps the last K that fit and the readout appends `// last K of N`.
- **Empty state**: `"No data to chart."` when there are no points.

### Trend and definition math (KaTeX, under the plot)

Below the plot, in `--text-muted`:

1. **The definition** — what each point actually is, derived from the resolved `x`/`y`/`aggregate`/`bin`, e.g.:
   ```
   y(t) = \sum_{n \in B_t} n.\text{priority} \qquad B_t = \{\, n : \operatorname{week}(n.\text{due}) = t \,\}
   ```
   When `y` is a `formula.*` property whose source expression is known (`config.formulas`), a second line is appended showing that formula rendered as math, e.g. `\text{ppu} = \frac{\text{price}}{\text{units}}`.
2. **The trend** — a least-squares fit `ŷ = m·t + b` with `R²`, e.g.:
   ```
   \hat{y} = -0.40\,t + 3.10 \qquad R^2 = 0.82 \qquad t = \text{weeks since Jun 29}
   ```
   Shown only when a trend exists — see [`fitTrend`](#trend-fitting-fittrend) below (fewer than 3 points, or a non-date x axis, means no trend line and no trend math).

See [KaTeX definition and trend formats](#katex-definition-and-trend-formats) for the full rendering rules.

### Minimal base example (line)

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

---

## Stat view (`view: stat`)

**File**: `app/src/bases/StatView.tsx` (tile grid: `app/src/bases/StatTiles.tsx`)

Renders one tile per **declared metric** (`stats:`) — or, with no `stats:` declared, one tile synthesized from the view's own `x`/`y`/`aggregate`. There is no fixed 4-tile layout, no `buckets` tile, and no `average / bucket` tile.

### A tile, top to bottom

| Part | Content |
|---|---|
| Value | The metric's number (`formatValue`: integer as-is, otherwise 1 decimal place), `--fs-display`, `--fg`. The **first** tile is `--accent`. A metric that failed to evaluate shows `—`. |
| Label | The metric's label, `--text-muted`. |
| Period split | `3 this week // 1 last week` (or `today`/`yesterday` for day bins) — the current bin's value vs. the previous bin's, `--text-muted`. Omitted when `x` is not a date axis. |
| Sparkline | The last 12 bins as `▁▂▃▄▅▆▇█`, `--accent`. Omitted alongside the period split when there's no date axis. |
| Expression | The metric's source expression, rendered as KaTeX, `--faint`. |

A metric that fails to parse or evaluate shows `—` as its value and `cannot read: <reason>` in `--danger` in place of the KaTeX expression; the tile's other lines (label, period, sparkline) are simply absent since there's nothing to compute them from, and the other tiles in the view still render normally.

**The sparkline explains itself**: under the glyphs one faint caption names its window and its first/last bin — `last 12 weeks // Jul 6 – Sep 21` — and the current bin's glyph is `--accent`. Hovering a glyph swaps the tile's period line for that bin, e.g. `week of Sep 14 // 3` (`SparklineChart.tsx`; bin keys/labels from `MetricResult.seriesKeys`/`seriesLabels`).

### Declared metrics (`stats:`)

```yaml
view: stat
x: date
bin: week
stats:
  - label: total pages
    value: sum(pages)
  - label: books
    value: count()
  - value: sum(pages) / sum(minutes)   # bare string: label defaults to the expression itself
```

Each entry is either a bare string (label = value = that string) or an object `{ label?, value }` with a string `value` — label defaults to `value` when omitted. See [Stat metrics](#stat-view-declared-metrics) below for the expression language.

With **no `stats:`**, the view synthesizes exactly one metric from its own `x`/`y`/`aggregate` — `count()` labelled `notes` when the aggregate is `count` or no `y` resolves; otherwise `<agg>(<y>)` labelled `<agg> of <y>` (`average` for `avg`).

### Minimal base example (stat)

```yaml
---
type: base
view: stat
x: date
y: pages
aggregate: sum
bin: month
---
```

---

## Heatmap view (`view: heatmap`)

**File**: `app/src/bases/HeatmapView.tsx` (layout: `app/src/bases/heatmapLayout.ts`)

Renders a GitHub-style contribution heatmap: a grid of week columns (Mon–Sun), colored by value intensity, plus a one-line streak readout below.

### Key behavioral difference from other chart types

The heatmap **unconditionally overrides `bin` to `"day"`** before calling `buildChartData`. Any `bin` setting in the view config is therefore ignored — the heatmap is always day-granularity.

### Grid range: spans the pane, ends at the latest activity

The grid shows **as many week columns as fit the chart body**, at 2 character-cells per week column (glyph + a 1-cell gutter), up to a maximum of 53 weeks (a year). `heatmapRange(columns, latestData, today)` (`heatmapLayout.ts`) computes this:

```ts
export function heatmapRange(columns: number, latestData: string | null, today: string): { start: string; end: string }
// weeks = clamp(floor((columns - 2) / 2), 1, 53)
// end   = the LATER of today and the latest dated point (so stale data still ends at today,
//         rather than stretching the grid forward to chase it)
// start = end minus (weeks * 7 - 1) days
```

That `{ start, end }` range is then passed to `buildHeatmapWeeks(points, range)` (`core/src/bases/chart.ts`), which snaps `start` back to the Monday on/before it and `end` forward to the Sunday on/after it, and lays cells into week columns of exactly 7 (Mon index 0 → Sun index 6); days in range with no data are `value: null`.

```ts
// From chart.test.ts:
// buildHeatmapWeeks(points, { start: '2026-05-28', end: '2026-06-02' })
// → weeks start 2026-05-25 (Monday on/before start), end 2026-06-07 (Sunday on/after end)
// → a range wider than the data yields null-valued cells outside the data's actual span
```

Without an explicit `range`, `buildHeatmapWeeks` instead starts on the Monday on/before the earliest point and ends at the last point's own date (no forward padding) — this is the shape the CLI's `base render` uses (see [CLI support](#cli-support-base-render--base-validate) below), since it has no chart-body width to derive a range from.

### Glyph and color encoding

Each cell's glyph and CSS class come from a discrete 5-way tier (0 = no data, 1–4 = the four glyphs), based on `t = (value - min) / (max - min)` over the whole series' `min`/`max`:

| Level | Glyph | CSS class | Color | Used when |
|---|---|---|---|---|
| 0 | `.` | `lv0` | `var(--faint)` | `value === null` or `value <= 0` |
| 1 | `.` | `lv0` | `var(--faint)` | `t` in `[0, 0.25)` — visually identical to an empty cell |
| 2 | `-` | `lv1` | `var(--text-muted)` | `t` in `[0.25, 0.5)` |
| 3 | `+` | `lv2` | `var(--accent)` | `t` in `[0.5, 0.75)` |
| 4 | `#` | `lv3` | `var(--accent)` | `t` in `[0.75, 1]` |

When all values are equal (`max === min`), `t` is forced to `1` (top tier). Colors are plain text colors and re-tint when the theme changes.

The legend is right-aligned directly under the grid's right edge at `--fs-micro` and states each glyph's value range in numbers, then what is plotted — e.g. `. none  - 50–149  + 150–248  # 249–347 // words per day` (`legendRanges` in `app/src/bases/heatmapLayout.ts`, computed from the same thresholds `levelOf` uses). Each glyph is in its level colour; the ranges are `--text-muted`.

### Month label row

Above the grid, a sparse month label row shows the abbreviated month name (e.g. `"May"`, `"Jun"`) on the week column containing that month's 1st; other columns are blank. A label with no blank column of clearance before the next one is dropped, keeping the later (fuller) month over an earlier sliver.

### Hover, click and streak readout

Hovering a cell updates the readout line to that day's label/value/note-count. At rest the readout names what is plotted and what a click does, e.g. `sum of words per day // click a day to log a value`. **Right-click** any cell opens the drill list for that day, in every case.

**Left-click edits the day**, and what it does depends on where the rows come from (`dayAction` in `app/src/bases/heatmapWrites.ts`, wired by `BaseView`'s heatmap write seam):

| rows come from | chart | click |
|---|---|---|
| the base file's own table (no `source:` query — the default; no daily notes needed) | numeric `y` | an inline number field opens on the day (`HeatmapDayEditor`); Enter/blur saves — updates that day's row, or adds a row `{x: date, y: n}` on an empty day; empty or `0` deletes the row. A day with several rows opens the drill instead (`N entries — edit in the table`). |
| the base file's own table | count (no `y`) | toggles the day: adds a row `{x: date}`, or deletes that day's rows |
| a query source (notes/tasks) | numeric `y`, exactly one note that day | the same inline field, saving via `set-property` on that note |
| a query source | anything else (empty day, several notes, count) | nothing is created; the drill opens and the readout says why (`no note on Sep 14`, `2 notes — open one to edit`) |

Without a base file to write to (an embedded ```` ```query ```` block), the heatmap is read-only and a click drills. The square updates immediately (a local override), reconciled when fresh rows arrive.

The streak statistics are one readout line under the grid — `<n> days logged // current streak <n> days // longest <n> days` (singular `day` when 1).

### Empty state message

`"No dated rows to chart. Set an x date column in view settings."` — shown when there are no weeks to draw (no rows carry a parseable date in the `x` column).

### Minimal base example (heatmap)

```yaml
---
type: base
view: heatmap
x: date
y: words
aggregate: sum
# bin is ignored for heatmap; always day-granularity
---
```

---

## Shared chart chrome: readout, drill, ViewBar config

Bar, line and heatmap share the same interaction chrome, laid out by `ChartFrame` (`app/src/bases/ChartFrame.tsx`) around each view's own body: a `readout` slot above, the chart body (which measures its own live character grid via a hidden probe and reports `{ columns, cellWidth }` through `onGrid`), an optional `footer` slot below (the line/stat KaTeX, or the heatmap's streak line), and an optional `drill` slot under that.

### Readout (`Readout`, `app/src/ui/Readout.tsx`)

A single line above the chart, parts joined by ` // `:

- **At rest** (`--text-muted`): the chart's caption and a peak/summary fact, e.g. `sum of priority by week of due // peak 3 (Jul 1)`.
- **While hovering a bucket** (`--fg`): the hovered bucket's label, value and note count, e.g. `Jul 20 // 3 // 2 notes`.

`chartCaption(spec)` and `bucketReadout(label, value, rowCount)` (`core/src/bases/chartText.ts`) produce these parts — see below.

### Drill list (`ChartDrill`, `app/src/bases/ChartDrill.tsx`)

Clicking a bucket opens a list of the notes behind it, under the chart: a header `<label> // N notes` with a `[ clear ]` `TextButton`, then one row per note — a faint tree prefix (`|--` / `` `-- ``) and a `NoteLink` with the note's display name (`rowLabel()` in `chartColumns.ts`) that opens it. The header's count is singular for one note (`1 note`). Clicking the same bucket again, or `[ clear ]`, closes the list. A data change that removes the selected bucket also closes it. When the view has no `onOpen` (no opener available — e.g. the enclosing context can't navigate), rows render as plain, unclickable text instead of buttons rather than disappearing. The list scrolls past 12 rows.

### ViewBar config pickers

The ViewBar's config region shows one labelled `Select` per axis field, writing straight back into the base file:

```
x [due ▾]  y [priority ▾]  agg [sum ▾]  bin [week ▾]
```

- **Heatmap** has no `bin` picker (bin is always forced to `day`).
- **A stat view with `stats:` declared** shows only `x` and `bin` (the per-metric `value`/`label` pairs aren't editable from the bar).
- **An inline ` ```query ` block** (no base file to write back into) shows no pickers at all — there is no write target.

---

## Stat view: declared metrics (`stats:`)

The metric expression language (`core/src/bases/metrics.ts`) is a small subset of the Bases expression grammar, built around five aggregate functions evaluated over rows:

| Form | Meaning |
|---|---|
| `count()` | Number of rows |
| `count(<expr>)` | Number of rows where `<expr>` is truthy, e.g. `count(status == "done")` |
| `sum(<expr>)` | Sum of `<expr>` over all rows with a numeric result (non-numeric skipped); `0` when nothing numeric matches |
| `avg(<expr>)` | Mean of `<expr>`'s numeric values; `null` when nothing numeric matches |
| `min(<expr>)` / `max(<expr>)` | Min/max of `<expr>`'s numeric values; `null` when nothing numeric matches |

Around one or more aggregate calls, plain arithmetic is allowed: numeric literals, unary `-`, and binary `+ - * / %` — for example `sum(price) / sum(units)`, `max(priority) - min(priority)`. Division or modulo by zero evaluates to `null`, and `null` propagates through arithmetic rather than becoming `NaN`.

**A bare identifier or property reference outside an aggregate call is an error** — a metric has no single row to read from, so `priority` (without `sum(...)`/`count(...)`/etc. around it) throws `priority must be inside sum, avg, min, max or count`. This same check runs at `bismuth base validate` time (see below), and again at evaluation time on every render.

### `MetricResult`

```ts
type MetricResult = {
    label: string
    source: string            // the metric expression text
    value: number | null      // over ALL rows
    current: number | null    // over rows in the bin containing `today`
    previous: number | null   // over rows in the bin before that
    series: (number | null)[] // the last 12 bins ending at today's bin, oldest first
    bin: Bin                  // view.bin ?? 'week'
    hasTime: boolean          // false when x is not a date axis: current/previous null, series []
    error?: string
}
```

`current`/`previous`/`series` are only populated when the view's `x` resolves to a date axis (`hasTime`); otherwise they're `null`/`[]` and the stat tile shows no period split or sparkline for that metric. A parse or evaluation failure is captured on `error` rather than thrown — the tile shows `—` and `cannot read: <error>`, and every other declared metric on the same view still evaluates and renders normally.

---

## KaTeX definition and trend formats

`ui/Tex` (`app/src/ui/Tex.tsx`) is the one place KaTeX gets rendered — it loads lazily through `app/src/editor/katexLoader.ts` and sanitizes its output; no component imports `katex` directly. Every chart's math comes from two pure modules in `core/src/bases/`:

### Trend fitting (`fitTrend`)

```ts
// core/src/bases/trend.ts
export function fitTrend(
    points: { key: string; label: string; value: number }[],
    spec: { isDate: boolean; bin: Bin },
): TrendFit | null   // { slope, intercept, r2, unit: Bin, origin: string }
```

A least-squares fit of value against `t` = bins-since-the-first-point (day difference for `day`/`week` bins — `week` divides by 7 — real month arithmetic for `month`). Returns `null` when the axis isn't a date axis, there are fewer than 3 points, or every point shares the same `t` (zero variance). `r2` is `1` when every value is equal (a flat line fits perfectly) — it never comes out `NaN`.

### `chartDefinitionLatex` and `trendLatex`

```ts
// core/src/bases/chartLatex.ts
export function chartDefinitionLatex(spec: ChartSpec, formulas?: Record<string, string>): string
export function trendLatex(fit: TrendFit): string
export function exprToLatex(e: Expr): string   // renders a parsed Bases expression as LaTeX
export function metricToLatex(e: Expr): string // a stat metric expression as math notation
export function texText(s: string): string     // \text{…} with \ { } $ & # ^ _ % ~ escaped
```

`chartDefinitionLatex` renders what each point *is*, from the resolved `x`/`y`/`aggregate`/`bin`/`isDate`:

- With an `x` axis: `<y-line> \qquad B_t = \{\, n : <membership> \,\}` — the membership clause is `\operatorname{week}(n.\text{due}) = t` for a week/month bin, or `n.\text{due} = t` for a day bin or a category axis. The `<y-line>` depends on the aggregate: `y(t) = \left|B_t\right|` for count, `y(t) = \sum_{n \in B_t} n.\text{priority}` for sum, `\frac{1}{\left|B_t\right|}\sum_{...}` for avg, `\min_{n \in B_t}`/`\max_{n \in B_t}` for min/max.
- With no `x` axis: the same aggregate form over `\text{notes}` directly, no `B_t`.
- When `y` is a `formula.*` property and its source expression is available in `config.formulas`, a `\qquad \text{<name>} = <exprToLatex(...)>` clause is appended (a parse failure on the formula source appends nothing rather than breaking the rest of the line) — e.g. `\qquad \text{ppu} = \frac{\text{price}}{\text{units}}`.

`trendLatex` renders the fit as `\hat{y} = -0.40\,t + 3.10 \qquad R^2 = 0.82 \qquad t = \text{weeks since Jun 29}` — 2 decimal places, the intercept's sign folded into a single `+`/`-` (never `+ -0.40`), and the unit word (`days`/`weeks`/`months`) matching the fit's bin.

`exprToLatex` is the general Bases-expression-to-LaTeX renderer `chartDefinitionLatex` uses for a formula `y` — a property name is escaped via `texText` (so a hostile name like `a_b`, `{x}`, or `50%` renders as literal text, e.g. `\text{a\_b \{x\} 50\%}`, never a KaTeX parse error), `/` becomes `\frac{}{}`, `*` becomes `\cdot`, comparisons become `= \ne < \le > \ge`, `&&`/`||` become `\land`/`\lor`, and so on. String literals take TeX quotes (`\text{``done''}`).

A stat tile renders its metric with `metricToLatex`, which writes the aggregates as math instead of function calls, with `n.<name>` for each note's property (the same row variable as the line definition): `sum(price)` → `\sum_{n} n.\text{price}`, `avg(priority)` → `\overline{n.\text{priority}}`, `min`/`max` → `\min_{n}`/`\max_{n}`, `count()` → `\#\,\text{notes}`, `count(status == "done")` → `\#\{\, n : n.\text{status} = \text{``done''} \,\}`, and `sum(price) / sum(units)` → a fraction of the two sums. Arithmetic between aggregates keeps `exprToLatex`'s operators; a summand that is itself a sum or difference is parenthesised.

---

## CLI support: `base render` / `base validate`

- **`bismuth base render <path>`** on a chart view includes the same `chart: ChartData` (`buildChartData` output, including per-point `rows`) that the frontend renders from, plus `heatmapWeeks` for a `heatmap` view (`buildHeatmapWeeks(chart.points).weeks`, without a pane-width `range` — see the heatmap section above) and **`metrics: MetricResult[]`** for a `stat` view (`metricResults(flatRows, view, today())`), so a stat view's declared or synthesized metrics can be inspected headlessly.
- **`bismuth base validate <path>`** parses every declared `stats[].value` expression and reports a failure as `stats[<j>].value: "<expr>" failed to parse — <reason>` — the same class of check as a filter/formula expression error, and the only place a bad metric expression surfaces before render time (a bad metric at render time just nulls that tile's numbers rather than throwing).

---

## Edge cases and gotchas

### Boolean columns are excluded from y auto-detection

`isNumericValue` in `chart.ts` returns `false` for booleans. This means a `done: true/false` frontmatter field will never be auto-selected as the y axis, preventing row-count inflation from boolean data.

```ts
// From chart.test.ts:
// rows = [{ date: "2026-05-01", done: true }, { date: "2026-05-01", done: false }]
// buildChartData(rows, {}) → valueLabel: "count", points[0].value: 2
// (falls back to count because "done" is boolean → not auto-picked as y)
```

### `aggregate: "count"` with an explicit `y` still counts rows

Setting `aggregate: "count"` causes the engine to push `1` per row regardless of the `y` value. The `y` field is ignored. `valueLabel` is `"count"`.

```ts
// From chart.test.ts:
// rows = [{ date: "2026-05-01", glasses: 5 }, { date: "2026-05-01", glasses: 3 }]
// buildChartData(rows, { x: "date", y: "glasses", aggregate: "count" })
// → valueLabel: "count", points[0].value: 2  (not 8)
```

### Non-numeric y values within a bucket

Within a bucket, `toNumber(v)` is applied to each `y` value. Values that produce `NaN` (e.g. a string `"pending"`) are silently skipped and do not contribute to the aggregate. A bucket where every row has a non-numeric `y` returns `0` from `aggregate()`.

### Zero and negative values never break a chart

A bar's fill clamps at 0 for a negative value rather than drawing backwards. A line's ticks span `[min(0, min), max]`, so an all-negative or mixed-sign series still has a sane 0 reference line. A stat metric's `avg`/`min`/`max` over zero matching rows is `null` (rendered as `—` or the sparkline's lowest glyph), never `NaN`.

### Heatmap grid range, not just its start, is day-precise

`buildHeatmapWeeks` snaps whatever `range.start`/`range.end` it's given outward to a full Mon–Sun grid (Monday on/before `start`, Sunday on/after `end`) — a dataset or requested range whose edge falls on a Thursday still gets a complete first/last week column, with the extra days `value: null`.

### `date` field on `ChartPoint` is only populated for `bin: "day"`

Week and month bin keys are ISO date strings representing the start of the interval (e.g. `"2026-05-25"` for the week of May 25), but `ChartPoint.date` is only set when `bin === "day"`. The heatmap grid therefore only receives populated `date` fields because it forces `bin: "day"`.

### A metric expression parse/evaluation error never breaks the other tiles

Each declared `stats[]` entry is evaluated independently — a bad expression on one metric sets that metric's `error` and nulls its numbers, but every other metric on the same stat view still computes and renders normally. `bismuth base validate` catches a parse failure ahead of time; a runtime evaluation failure (e.g. a `sqrt` of something non-numeric) is only visible in the rendered tile or `base render`'s `metrics` payload.

### A bare identifier in a metric expression is always an error, never a silent zero

`priority` on its own (outside `sum(...)`/`avg(...)`/etc.) throws rather than resolving to some default row's value — a metric expression has no implicit row context the way a filter or formula expression does.

---

## Cross-references

- [Bases overview](../overview.md) — how base files are structured and how the view is declared
- [ViewConfig type reference](../overview.md) — full `ViewConfig` interface including all view kinds
- `core/src/dates.ts` — `Bin`, `binKey`, `binLabel`, `addDaysISO`
- `core/src/bases/query.ts` — `resolveProperty` (property id namespacing)
- `core/src/bases/values.ts` — `toNumber` (value coercion)
- `core/src/bases/parser.ts`/`ast.ts` — the expression grammar `exprToLatex` walks

Source: `app/src/bases/BarView.tsx`, `app/src/bases/barRows.ts`, `app/src/bases/LineView.tsx`, `app/src/bases/asciiLine.ts`, `app/src/bases/StatView.tsx`, `app/src/bases/StatTiles.tsx`, `app/src/bases/sparkline.ts`, `app/src/bases/HeatmapView.tsx`, `app/src/bases/heatmapLayout.ts`, `app/src/bases/heatmapWrites.ts`, `app/src/bases/HeatmapDayEditor.tsx`, `app/src/bases/SparklineChart.tsx`, `app/src/bases/ChartFrame.tsx`, `app/src/ui/Readout.tsx`, `app/src/bases/ChartDrill.tsx`, `app/src/bases/chartColumns.ts`, `app/src/bases/chartViewProps.ts`, `app/src/ui/Tex.tsx`, `core/src/bases/chart.ts`, `core/src/bases/metrics.ts`, `core/src/bases/trend.ts`, `core/src/bases/chartLatex.ts`, `core/src/bases/chartText.ts`, `core/src/bases/types.ts`, `core/src/bases/parse.ts`, `cli/src/commands/base.ts`, `core/src/dates.ts`, `core/test/bases/chart.test.ts`, `core/test/bases/metrics.test.ts`, `core/test/bases/trend.test.ts`, `core/test/bases/chartLatex.test.ts`, `core/test/bases/chartText.test.ts`
