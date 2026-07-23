# Chart Views: bar, line, stat, heatmap

Bismuth provides four chart view types — `bar`, `line`, `stat`, and `heatmap` — all of which are rendered from the same data-shaping pipeline in `core/src/bases/chart.ts`. Each view type is declared inside the `views:` array of a `type: base` markdown file by setting `type:` to the corresponding string. All four share the same axis/aggregation configuration fields (`x`, `y`, `aggregate`, `bin`) defined on `ViewConfig` in `core/src/bases/types.ts`; the heatmap overrides `bin` to `"day"` unconditionally. Rows flow through `buildChartData()` which buckets them, aggregates numeric values, and returns sorted `ChartPoint[]` consumed by each renderer.

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

Renders a vertical bar chart as an inline SVG (`viewBox="0 0 800 300"`, `PAD=28`). Each bucket becomes one bar.

### Visual details

- **SVG dimensions**: 800 × 300 logical units, scales responsively via `width: 100%` CSS.
- **Padding**: 28px on all sides for axis clearance.
- **Bar width**: `(800 - 56) / N` pixels per bar, minus 4px total gutter (2px each side), minimum 1px wide.
- **Bar height**: proportional to `value / max`; `max` is floored to 1 to avoid division-by-zero on a single-value dataset.
- **Corner radius**: `rx={4}` (rounded tops).
- **Color**: cycles through 5 theme tokens in order:
  1. `var(--graph-0, var(--teal))`
  2. `var(--graph-1, var(--blue))`
  3. `var(--graph-2, var(--violet))`
  4. `var(--graph-3, var(--green))`
  5. `var(--graph-4, var(--gold))`
  Colors re-tint automatically when the user switches themes. With more than 5 bars the palette wraps modulo 5.
- **Opacity**: `0.88` on each bar.
- **X-axis labels**: rendered only when `data().points.length <= 16`. Labels are clipped to the bar width and use `"Monaspace Xenon"` monospace font at 10px, 50% opacity. With 17+ bars the label row is hidden.
- **Tooltip**: each `<rect>` carries a `<title>` with `"<label>: <value>"`.
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

**File**: `app/src/bases/LineView.tsx`

Renders a line chart with an area fill as an inline SVG (`viewBox="0 0 800 300"`, `PAD=28`).

### Visual details

- **SVG dimensions and padding**: identical to BarView (800 × 300, PAD=28).
- **X spacing**: evenly distributes points across `W - 2*PAD` pixels. With exactly 1 point, `step=0` (single centered dot).
- **Line**: `<polyline>` in `var(--blue)`, `stroke-width="2"`, no fill.
- **Area fill**: `<polygon>` closing down to the baseline at `y = H - PAD`, filled with a `linearGradient` from `var(--blue)` at 35% opacity (top) to 0% opacity (bottom).
- **Dots**: one `<circle r="2.4">` per point in `var(--teal)`.
- **No x-axis labels**: the line view does not render any text labels or axes.
- **No tooltip**: individual point values are not exposed via title attributes.
- **Empty state**: `"No data to chart."` when `points.length === 0` (the `geom()` memo returns `null`).

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

**File**: `app/src/bases/StatView.tsx`

Renders a summary statistics view. The display mode switches between a single big number and a 4-card grid depending on how many points the chart data contains.

### Single-bucket mode (≤ 1 point)

When `data().points.length <= 1`, the view shows:
- A large serif number (52px, font `var(--editor-font)`): the **total** of all point values (sum of the single bucket, or 0 when empty).
- A subtitle line: `"total <valueLabel> · avg <avg>/bucket"`.
- A sparkline SVG (200 × 36 px) drawn as a `<polyline>` in `var(--blue)`.

The sparkline uses 30px of vertical range (within a 34px viewport), with points mapped the same way as `buildChartData` — proportional to `max`. With zero points the sparkline is an empty string `""` (renders nothing).

### Multi-bucket mode (≥ 2 points)

When `data().points.length >= 2`, the view renders a 4-column grid of stat cards. The four cards are always:

| Card | Label | Value |
|---|---|---|
| 1 | `"total <valueLabel>"` | Sum of all bucket values (integer if whole, otherwise 1 decimal place) |
| 2 | `"average / bucket"` | Mean of all bucket values (1 decimal place) |
| 3 | `"buckets"` | Count of distinct buckets |
| 4 | `"peak <valueLabel>"` | Maximum bucket value (integer if whole, otherwise 1 decimal place) |

Card 1 additionally shows a delta line when the **latest bucket value is strictly greater than the previous**:
`"+<change> ↑ latest"` in green (`var(--green)`). No delta is shown for zero or negative changes.

### Number formatting

The `fmt` helper: if the number is a whole integer (`Number.isInteger(n)`), it renders without a decimal point. Otherwise it rounds to 1 decimal place (`n.toFixed(1)`). The average always uses `toFixed(1)`.

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

### Color encoding

Four intensity levels are derived from `var(--teal)` using CSS `color-mix`:

| Level | CSS | Used when |
|---|---|---|
| Empty | `var(--surface-2, #1a1a22)` | `value === null` |
| Low | `color-mix(in srgb, var(--teal) 28%, transparent)` | t in [0, 0.25) |
| Medium-low | `color-mix(in srgb, var(--teal) 50%, transparent)` | t in [0.25, 0.5) |
| Medium-high | `color-mix(in srgb, var(--teal) 75%, transparent)` | t in [0.5, 0.75) |
| High | `var(--teal)` | t in [0.75, 1] |

Where `t = (value - min) / (max - min)`. When all values are equal (`max === min`), `t` is forced to 1 (full intensity). Colors re-tint when the theme changes.

### Month label row

Above the grid, a sparse month label row shows the abbreviated month name (e.g. `"May"`, `"Jun"`) at the first column that falls in each new month; other columns are blank. The labels use `"Monaspace Xenon"` monospace at 10px.

### Streak statistics

Below the grid, three stat cards in a 4-column grid (using the same `.statgrid` / `.statCard` CSS as `StatView`) show:

| Card | Label | Value |
|---|---|---|
| 1 | `"Entries"` | Number of days with `value > 0` |
| 2 | `"Current streak"` | Length of the consecutive-day streak ending at the last entry date, in days |
| 3 | `"Longest streak"` | Maximum consecutive-day streak across all data |

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

BarView and LineView floor `max` to `1` when `max <= 0` to avoid division-by-zero rendering. If all rows have a zero value, bars/lines render at zero height rather than erroring.

### Non-numeric y values within a bucket

Within a bucket, `toNumber(v)` is applied to each `y` value. Values that produce `NaN` (e.g. a string `"pending"`) are silently skipped and do not contribute to the aggregate. A bucket where every row has a non-numeric `y` returns `0` from `aggregate()`.

### Bar x-axis label cutoff at 16

Bar labels are only rendered when `data().points.length <= 16`. With 17 or more bars the label row is entirely absent. There is no truncation or rotation — it is a binary show/hide.

### Heatmap grid always starts on Monday

`buildHeatmapWeeks` uses `binKey(dates[0], "week")` to find the grid start, which snaps to Monday. A dataset whose earliest point falls on a Thursday will have 3 null cells (Mon–Wed) at the start of the first column.

### `date` field on `ChartPoint` is only populated for `bin: "day"`

Week and month bin keys are ISO date strings representing the start of the interval (e.g. `"2026-05-25"` for the week of May 25), but `ChartPoint.date` is only set when `bin === "day"`. The heatmap grid therefore only receives populated `date` fields because it forces `bin: "day"`.

### `stat` view: single-bucket vs. multi-bucket threshold is exactly 1

`cards()` returns `[]` (triggering the single-big-number fallback) when `d.points.length <= 1`. With exactly 0 points, the outer `<Show when={data().points.length > 0}>` renders the empty-state placeholder instead.

---

## Cross-references

- [Bases overview](../overview.md) — how base files are structured and how views are declared
- [ViewConfig type reference](../overview.md) — full `ViewConfig` interface including all view kinds
- `core/src/dates.ts` — `Bin`, `binKey`, `binLabel`, `addDaysISO`
- `core/src/bases/query.ts` — `resolveProperty` (property id namespacing)
- `core/src/bases/values.ts` — `toNumber` (value coercion)

Source: `app/src/bases/BarView.tsx`, `app/src/bases/LineView.tsx`, `app/src/bases/StatView.tsx`, `app/src/bases/HeatmapView.tsx`, `core/src/bases/chart.ts`, `core/src/bases/types.ts`, `core/src/dates.ts`, `core/test/bases/chart.test.ts`
