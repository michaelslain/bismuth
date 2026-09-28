# stat

One tile per **declared metric** (`stats:`) — or, with no `stats:` declared, one tile synthesized from the view's own `x`/`y`/`aggregate`. **There is no fixed 4-tile total/average/buckets/peak grid** — tile count matches metric count (`app/src/bases/StatView.tsx` + `StatTiles.tsx`). Shares its data pipeline (`buildChartData`) with `bar`/`line`/`heatmap`.

## Working example

```yaml
---
type: base
views:
  - type: stat
    name: Reading Stats
    x: date
    bin: week
    stats:
      - label: total pages
        value: sum(pages)
      - label: books
        value: count()
      - value: sum(pages) / sum(minutes)   # bare string: label defaults to the expression itself
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `x` | `string` (property id) | auto-detected | Bucketing axis — drives the period split + sparkline on each tile, not tile layout. |
| `y` | `string` (property id) | auto-detected | Value axis for the synthesized metric. Ignored when `aggregate: count`. Irrelevant once `stats:` is declared. |
| `aggregate` | `"sum"\|"avg"\|"count"\|"min"\|"max"` | `"sum"` if `y` resolves, else `"count"` | Only used to synthesize the single metric when `stats:` is absent. |
| `bin` | `"day"\|"week"\|"month"` | `"day"` | Bucket size for each metric's period split + 12-bin sparkline. |
| `stats` | array of `{ label?, value }` or bare strings | none — falls back to one synthesized metric | **Stat view only.** Each entry's `value` is a metric expression (see below); `label` defaults to `value` when omitted. |

### `stats:` metric expressions

A small subset of the Bases expression grammar, built around five aggregate functions evaluated over rows (`core/src/bases/metrics.ts`):

| Form | Meaning |
|---|---|
| `count()` | Number of rows |
| `count(<expr>)` | Number of rows where `<expr>` is truthy, e.g. `count(status == "done")` |
| `sum(<expr>)` | Sum of `<expr>`'s numeric values (non-numeric rows skipped); `0` when nothing numeric matches |
| `avg(<expr>)` | Mean of `<expr>`'s numeric values; `null` when nothing numeric matches |
| `min(<expr>)` / `max(<expr>)` | Min/max of `<expr>`'s numeric values; `null` when nothing numeric matches |

Plain arithmetic is allowed around one or more aggregate calls — numeric literals, unary `-`, and binary `+ - * / %` — e.g. `sum(price) / sum(units)`, `max(priority) - min(priority)`. Division or modulo by zero evaluates to `null` (propagates through arithmetic, never becomes `NaN`).

**A bare identifier or property reference outside an aggregate call is an error**, both at `bismuth base validate` time and at every render: `priority` alone throws `priority must be inside sum, avg, min, max or count` — a metric has no single row to read from, unlike a filter or formula expression.

## Failure modes

- **Tile count equals `stats:` length, or 1 when `stats:` is omitted — it is never driven by bucket count.** With no `stats:`, exactly one metric is synthesized (`count()` labelled `notes` when the aggregate is `count` or no `y` resolves; otherwise `<agg>(<y>)` labelled `<agg> of <y>`). There is no total/average/buckets/peak 4-card mode to trigger by widening `bin`.
- **Each tile shows a period split and 12-bin sparkline only when `x` resolves to a date axis** (`hasTime`) — `3 this week // 1 last week` (or `today`/`yesterday` for day bins) comparing the current bin's value to the previous one. A non-date `x` means every tile omits both, silently, not as an error.
- **A metric that fails to parse or evaluate shows `—` as its value and `cannot read: <reason>` in place of its KaTeX expression** — its label/period/sparkline lines are simply absent, but every *other* declared metric on the same view still evaluates and renders normally. `bismuth base validate` catches parse failures ahead of time; a runtime evaluation failure only surfaces in the rendered tile or `base render`'s `metrics` payload.
- **`aggregate: count` ignores `y` entirely**, even if you set one — the synthesized metric counts rows, not a sum/average of `y`. Inside a declared `stats:` expression, use `count(<expr>)` explicitly if you want a conditional count.
- **The first tile is styled `--accent`**; every other tile's value is plain `--fg` — this is positional (first entry in `stats:`), not tied to any particular metric semantics.

Full reference: `docs/bases/views/charts.md`
