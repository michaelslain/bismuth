# Chart Views: bar, line, stat, heatmap

Bismuth provides four chart view types — `bar`, `line`, `stat`, and `heatmap` — all rendered from the same data-shaping pipeline in `core/src/bases/chart.ts`. Each is declared inside a `type: base` file's `views:` array by setting `type:` to the corresponding string. All four share the same axis/aggregation fields (`x`, `y`, `aggregate`, `bin`) on `ViewConfig` in `core/src/bases/types.ts`; the heatmap overrides `bin` to `"day"` unconditionally. Rows flow through `buildChartData()`, which buckets them, aggregates numeric values, and returns sorted `ChartPoint[]` consumed by each renderer.

**In this doc:** the shared bucketing/aggregation pipeline every chart view runs through → the config fields all four share → per-view-type visual details and a minimal example each (bar, line, stat, heatmap) → edge cases and gotchas.

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
}

interface ChartData {
  points:     ChartPoint[];  // sorted; empty when there are no chartable rows
  min:        number;        // minimum point value (0 when no points)
  max:        number;        // maximum point value (0 when no points)
  isDate:     boolean;       // true when x resolved to a date column (>= 50% of rows parse as ISO date)
  valueLabel: string;        // "count" for count aggregate; otherwise the y field name
}
```

### `ViewConfig` fields consumed by chart views

All fields are optional; sensible defaults apply when omitted.

| Field | Type | Default | Description |
|---|---|---|---|
| `x` | `string` | auto-detected | Property id for the x-axis / category dimension. Bare names resolve to `note.<name>`; `file.` / `formula.` prefixes are also valid. |
| `y` | `string` | auto-detected | Property id whose numeric values are aggregated per bucket. Ignored when `aggregate: "count"`. |
| `aggregate` | `"sum" \| "avg" \| "count" \| "min" \| "max"` | `"sum"` if `y` resolves; `"count"` otherwise | How values within each bucket are combined. |
| `bin` | `"day" \| "week" \| "month"` | `"day"` | Time-granularity for date axes. Has no effect on category axes. The heatmap always forces `"day"` regardless of this setting. |

### Auto-detection of `x` and `y`

When `x` is not specified, `buildChartData` iterates all columns present in any row and picks the **first column where ≥ 50% of non-null values parse as an ISO date** (`YYYY-MM-DD` prefix). If no date column exists, it falls back to `cols[0]` (the first column found).

When `y` is not specified, the code picks the **first column (other than `x`) where ≥ 50% of non-null values are numeric**. A boolean column is explicitly excluded from auto-detection — `toNumber(true) === 1` would otherwise mistakenly claim a `done: true/false` flag column as the y axis. If no numeric column is found, the aggregate falls back to `"count"`.

```ts
// Auto-detection example from chart.test.ts:
// rows = [{ date: "2026-05-01", glasses: 4 }, { date: "2026-05-02", glasses: 6 }]
// view = {} (no x/y specified)
// → isDate: true, points[0].value: 4, points[1].value: 6
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
views:
  - type: bar       # or line | stat | heatmap
    name: My Chart
    x: date         # property id for x-axis / category (auto-detected if omitted)
    y: glasses      # property id for y-axis values (auto-detected if omitted)
    aggregate: sum  # sum | avg | count | min | max  (default: sum when y exists, count otherwise)
    bin: day        # day | week | month  (default: day; heatmap always forces day)
```

---

## Bar view (`type: bar`)

**File**: `app/src/bases/BarView.tsx`

Renders each bucket as one row of a character-grid bar chart, via `<AsciiChart series={...} width={32} />` (`app/src/ui/ascii/AsciiMeter.tsx`) — the same `#`-fill renderer the design system uses for its progress meters. There is no SVG; the whole chart is monospace text.

### Visual details

- **One row per bucket**, in a `<div style="white-space: pre">` inside `.barChart` (`app/src/bases/BarView.module.css`: `font-size: var(--fs-ui)`, `line-height: 17px`).
- **Row layout**: `<label><bar of '#'><padding><value>` — the label is right-padded to the width of the longest label in the series (`chartLabelPad`), the bar is a run of `#` characters, then enough spaces to reach the chart's `width` (32 columns) plus one, then the raw numeric value with no formatting.
- **Bar length**: `chartFill(value, max, width)` = `Math.round((value / max) * width)` (`app/src/ui/ascii/asciiMeterMath.ts`), where `max` is `chartMax(series)` — the largest value in the series, floored to `1` so an empty or all-≤1 series never divides by zero.
- **Color**: cycles through 5 theme tokens by bar index, in order:
  1. `var(--graph-0, var(--teal))`
  2. `var(--graph-1, var(--blue))`
  3. `var(--graph-2, var(--violet))`
  4. `var(--graph-3, var(--green))`
  5. `var(--graph-4, var(--gold))`
  Colors re-tint automatically when the user switches themes. With more than 5 bars the palette wraps modulo 5 (`BAR_PALETTE[i % 5]` in `BarView.tsx`).
- **No label cutoff, no tooltip**: every bucket's label is always shown as the row prefix — there is no bar-count threshold that hides labels (that gate now belongs to the line view's x-axis labels, below). No element carries a `title` attribute.
- **Empty state**: `"No data to chart."` message when `points.length === 0`.

### Minimal base example (bar)

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

---

## Line view (`type: line`)

**File**: `app/src/bases/LineView.tsx` (layout: `app/src/bases/asciiLine.ts`)

Renders a value over time as an ASCII line plot inside a `<pre>` block — `buildLinePlot(data().points)` lays the points onto a character grid, and `LineView` renders the result as text rows. There is no SVG.

### Visual details

- **Grid size**: `height` rows (default `9`) tall, `points.length * colWidth` columns wide (`colWidth` default `8`) — one column-slot per point, the point centered in its slot at column `i * colWidth + floor(colWidth / 2)`.
- **Vertical scale**: each point's row is `rowFor(value, max, height)`, proportional to `max = Math.max(0, ...values, 1)` — floored to `1` so an all-zero or empty series never divides by zero. Row 0 is the top (the series max); the bottom row is `0`.
- **Connecting glyphs**: between two consecutive points, each intervening column gets `/` (row decreasing), `\` (row increasing), or `-` (row unchanged), interpolated linearly between the two points' rows.
- **Point markers**: each actual data point is drawn as `o`, painted last so it always wins over a connecting glyph landing on the same cell.
- **Coloring**: each row is split into accent/blank runs (`LineSegment.accent`); non-blank runs (the `/ - \ o` glyphs) render through `<Text class={styles.glyph}>`, colored `var(--accent)`; blank runs are plain text, inheriting `.linePlot`'s `var(--faint)`.
- **Y-axis gutter**: a 3-character tick column on the left — the top row shows the series max, the bottom row shows `0`, middle rows are blank.
- **Baseline rule**: a `+---…` axis rule below the grid, sized to the plot width.
- **X-axis labels**: one label per point, aligned under its column — but only when `points.length <= 16`; with 17+ points `axisLabels` is the empty string and the label row does not render.
- **No tooltip**: individual point values are not exposed via `title` attributes.
- **Empty state**: `"No data to chart."` when `plot().rows.length === 0` (zero points).

### Minimal base example (line)

```yaml
---
type: base
views:
  - type: line
    name: Weight Over Time
    x: date
    y: weight
    aggregate: avg
    bin: week
---
```

---

## Stat view (`type: stat`)

**File**: `app/src/bases/StatView.tsx` (tile grid: `app/src/bases/StatTiles.tsx`)

Renders a summary as a grid of plain-number stat tiles — "the largest type in the system, and the one view with no ASCII chart at all" (`StatView.tsx`'s own comment). The number of tiles depends on how many points the chart data contains; there is no sparkline anywhere in this view.

### Zero points

`tiles()` returns `[]`, and `ChartFrame` renders the empty state `"No data to chart."` instead of any tiles.

### One point

`tiles()` returns a single tile — `{ label: valueLabel, value: fmt(total) }` — rendered through the same `StatTiles` grid as the multi-point case: the same big-number styling (`.statValue`, `var(--fs-display)`, `var(--ui-font-stack)`), just one tile instead of four. There is no distinct "big number" treatment, no subtitle line, and no sparkline.

### Two or more points

`tiles()` returns a 4-tile grid, always in this order:

| Tile | Label | Value |
|---|---|---|
| 1 | `"total <valueLabel>"` | Sum of all bucket values (integer if whole, otherwise 1 decimal place); `tone: "accent"` (colored `var(--accent)`) |
| 2 | `"average / bucket"` | Mean of all bucket values, always `toFixed(1)` |
| 3 | `"buckets"` | Count of distinct buckets |
| 4 | `"peak <valueLabel>"` | Maximum bucket value (integer if whole, otherwise 1 decimal place); `tone: "faint"` when the peak is `0` |

Tile 1 additionally carries a delta whenever `latest - previous !== 0` — including a **negative** change (e.g. `"-3 latest"`), not just a strictly positive one: `` `${change > 0 ? '+' : ''}${fmt(change)} latest` ``. The delta renders in `.statDelta`, which is always `var(--faint)` regardless of sign — there is no green/red coloring and no arrow glyph. A zero change shows no delta at all.

### Number formatting

The `fmt` helper: if the number is a whole integer (`Number.isInteger(n)`), it renders without a decimal point. Otherwise it rounds to 1 decimal place (`n.toFixed(1)`). The average tile always uses `toFixed(1)` regardless.

### Minimal base example (stat)

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

---

## Heatmap view (`type: heatmap`)

**File**: `app/src/bases/HeatmapView.tsx`

Renders a GitHub-style contribution heatmap: a grid of week columns (Mon–Sun), colored by value intensity, plus streak statistics below.

### Key behavioral difference from other chart types

The heatmap **unconditionally overrides `bin` to `"day"`** before calling `buildChartData`:

```ts
const data = createMemo(() => buildChartData(rows(), { ...props.result.view, bin: "day" }));
```

Any `bin` setting in the view config is therefore **ignored**. The heatmap is always day-granularity.

### Grid layout (`buildHeatmapWeeks`)

After `buildChartData`, the heatmap calls `buildHeatmapWeeks(data().points)` from `core/src/bases/chart.ts`. This function:

1. Builds a `Map<date, value>` from the aggregated points. Duplicate dates (which `buildChartData` already prevents through aggregation) are last-write-wins.
2. Finds the earliest and latest dates in the data.
3. Starts the grid on the **Monday on/before the earliest date** (ISO week start).
4. Fills cells day-by-day, producing week columns of exactly 7 cells (Mon index 0 → Sun index 6).
5. The final column is **padded out to Sunday** even if the last data point falls mid-week; extra cells have `value: null`.
6. Days within the range that have no data carry `value: null` (shown as empty/grey cells).

```ts
// From chart.test.ts:
// points with dates 2026-05-28 (Thursday) and 2026-06-02 (Tuesday)
// → weeks[0][0].date === "2026-05-25"  (Monday back-fill)
// → weeks[0][3] === { date: "2026-05-28", value: 3 }
// → weeks[1][6].value === null          (padded tail to Sunday 2026-06-07)
```

### Glyph and color encoding

The heatmap draws intensity as a **glyph**, not a background color or cell size — "intensity is the glyph, never the cell size" (the legend's own caption, echoed in a `HeatmapView.tsx` comment). Each cell's glyph and CSS class come from `levelOf(value, min, max)` (`HeatmapView.tsx`), a discrete 5-way tier (0 = no data, 1–4 = the four glyphs):

| Level | Glyph | CSS class | Color | Used when |
|---|---|---|---|---|
| 0 | `.` | `lv0` | `var(--faint)` | `value === null` or `value <= 0` |
| 1 | `.` | `lv0` | `var(--faint)` | `t` in `[0, 0.25)` — visually identical to an empty cell |
| 2 | `-` | `lv1` | `var(--node-cold, var(--faint))` | `t` in `[0.25, 0.5)` |
| 3 | `+` | `lv2` | `var(--accent)` | `t` in `[0.5, 0.75)` |
| 4 | `#` | `lv3` | `var(--accent)` | `t` in `[0.75, 1]` |

Where `t = (value - min) / (max - min)`, using the same `min`/`max` `buildChartData` returns for the whole series. When all values are equal (`max === min`), `t` is forced to `1` (top tier). Colors are plain text colors from `HeatmapView.module.css` and re-tint when the theme changes — there is no `color-mix`, and no `--teal`/`--surface-2` tokens are involved.

Each cell also carries a `title` attribute — `` `${cell.date}: ${cell.value ?? 0}` `` (e.g. `"2026-05-28: 3"`) — so hovering a cell shows its exact value even though the glyph itself only encodes 4 discrete tiers.

The legend row below the grid renders the four tiers directly (`.` `-` `+` `#` under classes `lv0`–`lv3`) between the words `"less"` and `"more"`, followed by the caption `"intensity is the glyph, never the cell size"`.

### Month label row

Above the grid, a sparse month label row shows the abbreviated month name (e.g. `"May"`, `"Jun"`) at the first column that falls in each new month; other columns are blank. The labels use `.heatMonths` styling — `var(--fs-micro)`, `var(--faint)`, `var(--ui-font-stack)` (`HeatmapView.module.css`), not a hardcoded font or size.

### Streak statistics

Below the grid, three tiles — reusing the same `StatTiles` component and `.statgrid` / `.statTile` CSS classes as the stat view (`app/src/bases/StatTiles.tsx`, extracted from a formerly-duplicated `Charts.module.css`) — show:

| Tile | Label | Value |
|---|---|---|
| 1 | `"entries"` | Number of days with `value > 0` |
| 2 | `"current streak"` | Length of the consecutive-day streak ending at the last entry date, in days |
| 3 | `"longest streak"` | Maximum consecutive-day streak across all data |

All three labels are lowercase, matching the `streakCards()` literals in `HeatmapView.tsx` — there is no title-casing. Each tile's value renders at a smaller `22px` (`valueStyle={{ 'font-size': '22px' }}`) than `StatView`'s default `var(--fs-display)`, and the grid itself is the same `.statgrid` (`grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))`) as the stat view, not a fixed 4-column layout — with only 3 tiles here it lays out as 3.

Streak counting uses exact date adjacency (`nextDay(prev) === d`). Days with `value === 0` do not count as part of a streak. Both stats pluralize: `"1 day"` vs `"N days"`.

### Empty state message

`"No dated rows to chart. Set an x date column in view settings."` — shown when `buildHeatmapWeeks` returns no weeks (i.e. no rows carry a parseable date in the `x` column).

### `x` field requirement

The heatmap requires the `x` property to resolve to ISO date strings. Since `buildChartData` skips rows with unparseable dates, and `buildHeatmapWeeks` requires `ChartPoint.date` to be populated (which only happens with `bin: "day"` on a date-axis), a non-date `x` column will render the empty state.

### Minimal base example (heatmap)

```yaml
---
type: base
views:
  - type: heatmap
    name: Writing Activity
    x: date
    y: words
    aggregate: sum
    # bin is ignored for heatmap; always day-granularity
---
```

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

### Zero and negative max

`chartMax` (bar, in `asciiMeterMath.ts`) and `buildLinePlot`'s own max calculation (line, in `asciiLine.ts`) both floor the series maximum to `1` — `chartMax` returns `1` whenever the series is empty or every value is `≤ 1`; `buildLinePlot` takes `Math.max(0, ...values, 1)`. Either way, an all-zero or all-negative series renders bars/lines pinned to zero length rather than dividing by zero.

### Non-numeric y values within a bucket

Within a bucket, `toNumber(v)` is applied to each `y` value. Values that produce `NaN` (e.g. a string `"pending"`) are silently skipped and do not contribute to the aggregate. A bucket where every row has a non-numeric `y` returns `0` from `aggregate()`.

### Line x-axis label cutoff at 16

Line view labels (`axisLabels` in `asciiLine.ts`) are only rendered when `points.length <= 16`. With 17 or more points `axisLabels` is the empty string and the label row does not render at all. There is no truncation or rotation — it is a binary show/hide. The bar view carries no such cutoff: every bucket always shows its label as the row prefix, regardless of count.

### Heatmap grid always starts on Monday

`buildHeatmapWeeks` uses `binKey(dates[0], "week")` to find the grid start, which snaps to Monday. A dataset whose earliest point falls on a Thursday will have 3 null cells (Mon–Wed) at the start of the first column.

### `date` field on `ChartPoint` is only populated for `bin: "day"`

Week and month bin keys are ISO date strings representing the start of the interval (e.g. `"2026-05-25"` for the week of May 25), but `ChartPoint.date` is only set when `bin === "day"`. The heatmap grid therefore only receives populated `date` fields because it forces `bin: "day"`.

### `stat` view: single-bucket vs. multi-bucket threshold is exactly 1

`tiles()` (in `StatView.tsx`) returns `[]` for zero points, a single tile for exactly one point, and the 4-tile grid for two or more. The empty-state placeholder is gated on `tiles().length === 0`, passed as `ChartFrame`'s `empty` prop — not a `<Show>` written inline in `StatView.tsx` itself.

---

## Cross-references

- [Bases overview](../overview.md) — how base files are structured and how views are declared
- [ViewConfig type reference](../overview.md) — full `ViewConfig` interface including all view kinds
- `core/src/dates.ts` — `Bin`, `binKey`, `binLabel`, `addDaysISO`
- `core/src/bases/query.ts` — `resolveProperty` (property id namespacing)
- `core/src/bases/values.ts` — `toNumber` (value coercion)

Source: `app/src/bases/BarView.tsx`, `app/src/bases/LineView.tsx`, `app/src/bases/StatView.tsx`, `app/src/bases/HeatmapView.tsx`, `app/src/bases/StatTiles.tsx`, `app/src/bases/ChartFrame.tsx`, `app/src/bases/asciiLine.ts`, `app/src/ui/ascii/AsciiMeter.tsx`, `app/src/ui/ascii/asciiMeterMath.ts`, `core/src/bases/chart.ts`, `core/src/bases/types.ts`, `core/src/dates.ts`, `core/test/bases/chart.test.ts`, `app/src/bases/asciiLine.test.ts`
