# Bases Filters

This document is the canonical reference for **filtering** in the Bismuth Bases system: how `filters:` (in a base/view config) and `where:` (in a `where`/`from` source spec) select which rows survive. It covers the `FilterNode` shape, the `and`/`or`/`not` combinator trees, how a single string filter is parsed and evaluated against one note's context, the truthiness rule that decides pass/fail, comparison semantics per value type, short-circuit operators, and the date/duration arithmetic that filter expressions can rely on. Everything here is drawn directly from `core/src/bases/filters.ts`, `evaluate.ts`, `values.ts`, `functions.ts`, `parser.ts`, `lexer.ts`, `query.ts`, `source.ts`, and the colocated tests.

For the broader Bases model see [bases overview](./overview.md); for sources and composition see [sources](./sources.md); for the full function/method catalog see [functions](./functions.md); for sorting/grouping/columns see [query](./query-syntax.md).

## The `FilterNode` type

A filter is a `FilterNode`, defined in `core/src/bases/types.ts`:

```ts
export type FilterNode =
  | string                       // a Bases expression evaluated for truthiness
  | { and: FilterNode[] }        // every child must pass
  | { or: FilterNode[] }         // at least one child must pass
  | { not: FilterNode[] };       // every child must FAIL (NOR — see gotcha)
```

It is recursive: the children of `and`/`or`/`not` are themselves `FilterNode`s, so you can nest trees arbitrarily. A **leaf** is always a string expression.

Two places consume filters:

- `BaseConfig.filters` — global, ANDed with each view's filters (see [Where filters live](#where-filters-live)).
- `ViewConfig.filters` — per-view.
- A `SourceSpec`'s `where` field (`{ kind: "notes", where? }` / `{ kind: "tasks", where? }`) is a **plain string filter** (not a full `FilterNode` tree) — see [`where:` in sources](#where-in-sources).

## Evaluating a filter: `passesFilter`

The entire filter engine is `passesFilter(node, ctx)` in `core/src/bases/filters.ts`:

```ts
export function passesFilter(node: FilterNode | undefined, ctx: EvalContext): boolean {
  if (!node) return true;

  if (typeof node === "string") {
    try {
      return truthy(evaluate(parseExpr(node), ctx));
    } catch {
      return false;
    }
  }

  if ("and" in node) return node.and.every((n) => passesFilter(n, ctx));
  if ("or" in node)  return node.or.some((n)   => passesFilter(n, ctx));
  if ("not" in node) return node.not.every((n) => !passesFilter(n, ctx));
  return true;
}
```

Behavior, point by point:

1. **`undefined` (or any falsey node) passes everything.** No filter = every row is kept (`passesFilter(undefined, ctx) === true`). Verified by the test `undefined filter passes everything`.
2. **A string leaf** is `parseExpr`'d into an AST, `evaluate`d against the row's context, then run through `truthy()`. The row passes iff the result is truthy.
3. **A string leaf that throws or fails to parse returns `false` (fail closed).** Both the `parseExpr` and the `evaluate` are inside a `try/catch`. A syntactically broken expression such as `"this is not valid )("` makes the row **fail**, not error out — test `malformed expression fails closed (does not throw)`.
4. **`and`** uses `Array.every` — all children must pass; an empty `and: []` passes (vacuously true).
5. **`or`** uses `Array.some` — at least one child must pass; an empty `or: []` fails (vacuously false).
6. **`not`** uses `Array.every(child => !passesFilter(child))` — every child must FAIL for the `not` to pass. See the [NOR gotcha](#gotcha-not-is-nor-not-elementwise-negation) below.

### `EvalContext` — what a filter sees per note

Each row is evaluated against an `EvalContext` (built by `toContext(row, hostThis)` in `query.ts`):

```ts
export interface EvalContext {
  file: FileMeta;                          // file.* metadata (name, path, folder, tags, links, …)
  note: Record<string, unknown>;           // bare frontmatter keys + note.* keys
  formula: Record<string, unknown>;        // formula.* (computed before filtering — see below)
  this?: Record<string, unknown>;          // host/embedding note's frontmatter (this.*) — optional
  scope?: Scope;                           // lambda parameter scope chain
}
```

`FileMeta` (from `types.ts`) provides:

| `file.` field | Meaning |
|---|---|
| `name` | basename without extension, e.g. `"housing"` |
| `basename` | alias of `name` (Obsidian parity) |
| `path` | vault-relative path, e.g. `"reading/housing.md"` |
| `folder` | folder path, `""` at vault root |
| `ext` | `"md"`, `"base"`, … |
| `size` | bytes (number) |
| `ctime` / `mtime` | epoch ms (numbers) |
| `tags` | `string[]` without the leading `#` |
| `links` | `string[]` wikilink targets (no `.md`, no `#heading`, no `|alias`) |

**Formulas are computed before filtering.** In `runView` (`query.ts`), step 1 computes `formula.*` for every row, and only then (step 2) applies the filter. This means a filter can reference `formula.ppu` and it will already be populated. Test: `formula references work in filters` (`passesFilter("formula.ppu > 5", ctx)` is `true` when `ctx.formula.ppu === 6`).

## How a leaf string is evaluated

A leaf string is a full Bases expression. The pipeline is `parseExpr(src)` → `evaluate(ast, ctx)` → `truthy(result)`. The expression language (parser/evaluator) is documented fully in [functions](./functions.md); the parts that matter for filtering are below.

### Identifier resolution

`resolveIdent` (in `evaluate.ts`) resolves a bare name in this order:

1. **Lambda scope chain** (`ctx.scope`) — innermost first; used inside `.map`/`.filter`/`.reduce` lambdas.
2. The reserved roots: `file` → `ctx.file`, `note` → `ctx.note`, `formula` → `ctx.formula`, `this` → `ctx.this`.
3. **Otherwise a bare name is a frontmatter key**: `ctx.note[name]` (or `undefined` if `ctx.note` is absent).

So in a filter:

- `status` and `note.status` are the same thing (a frontmatter key). Test `resolves bare, note., and file. identifiers`: `run("price")` → `10`, `run("note.status")` → `"in-progress"`, `run("file.name")` → `"housing"`.
- `file.tags`, `file.folder`, `file.path`, etc. read `FileMeta`.
- `formula.ppu` reads the precomputed formula.
- `this.minPrice` reads the **host note's** frontmatter when the base is embedded inline in another note (see [`this.` host context](#this-host-note-context)).

### Member, index, and missing values

- **Member access** (`obj.name`) returns `undefined` when the object is `null`/`undefined` or when the key is missing — never throws. Test: `run("note.missing")` → `undefined`.
- **`.length`** is special-cased on strings and arrays (`getMember`): `file.tags.length`, `someString.length`.
- **Index access** (`arr[0]`, `obj["key"]`): numeric index into an array, string key into an object; otherwise `undefined`. Test: `run("file.tags[0]")` → `"logistics"`.

### Operators available in a filter

From `parser.ts` (`BINARY_PRECEDENCE`) and `evaluate.ts` (`evalBinary`), in **increasing** precedence (higher binds tighter):

| Prec | Operators | Notes |
|---|---|---|
| 1 | `\|\|` | logical OR (short-circuit, returns an operand value) |
| 2 | `&&` | logical AND (short-circuit, returns an operand value) |
| 3 | `==`, `!=` | loose equality / inequality (see [equality](#-and--equality)) |
| 4 | `>`, `<`, `>=`, `<=` | ordered comparison (NaN-safe — see [ordered comparison](#--ordered-comparison)) |
| 5 | `+`, `-` | numeric or date/duration arithmetic, or string concat for `+` |
| 6 | `*`, `/`, `%` | numeric arithmetic |

Unary operators (`parseUnary`): `!x` (logical NOT, via `truthy`) and `-x` (numeric negation, via `toNumber`). Test: `run("!done")` → `true` (when `done` is `false`), `run("-age")` → `-2`.

All binary operators are **left-associative** (`parseBinary` recurses with `prec + 1`). Parentheses group: `run("1 + 2 * 3")` → `7`, `run("(1 + 2) * 3")` → `9`.

There are **no keyword operators** (`and`, `or`, `not`, `in`, `like` are NOT operators — they would lex as identifiers/frontmatter keys). Combination of conditions inside a single string uses `&&` / `||` / `!`; the YAML `and`/`or`/`not` keys are the structural alternative. The full operator/punctuation set the lexer recognizes is `+ - * / % > < ! == != >= <= && || => . , ( ) [ ]` plus regex literals (`/pat/flags`), string literals (`"…"` / `'…'`), numbers, and the keywords `true` / `false` / `null`.

### Calling functions/methods in a filter

A leaf can call global functions (`if(...)`, `date(...)`, `today()`, `now()`, `duration(...)`, `min`/`max`, `link`, etc.) and type-dispatched methods. The methods most relevant to filtering are on `file` (`FileMeta`):

| Call | Returns | Filter use |
|---|---|---|
| `file.hasTag("book")` | `true` if `"book"` is in `file.tags` (multiple args = ANY match) | `file.hasTag("book")` |
| `file.hasLink("Other")` | `true` if `"Other"` is in `file.links`; accepts a name, a `FileMeta` (e.g. `this.file`), or a `Link`, all compared by basename | `file.hasLink(this.file)` |
| `file.inFolder("reading")` | `true` if `file.folder === "reading"` OR starts with `"reading/"` (subfolders included) | `file.inFolder("reading")` |
| `file.hasProperty("price")` | `true` if `ctx.note` has its own key named `"price"` | `file.hasProperty("isbn")` |

String/array/date methods (`.contains`, `.startsWith`, `.endsWith`, `.matches`, `.isEmpty`, `.lower`, `.upper`, array `.contains`/`.isEmpty`, date `.isEmpty`, etc.) are all usable in filters because the result just gets fed to `truthy()`. Notable:

- `tags.contains("book")` — array membership (also `===`-or-string-equal per element).
- `title.lower().contains("dune")` — case-insensitive substring test.
- `name.matches(/^chapter/i)` — regex test (regex literal supported; bad patterns fail closed to `false`).
- `due.isEmpty()` — for a `Date`, true when the date is invalid/NaN.

See [functions](./functions.md) for the complete catalog and per-type dispatch.

## Truthiness: what makes a row pass

The pass/fail decision is `truthy(value)` from `core/src/bases/values.ts`:

```ts
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);   // 0 and NaN are falsey
  if (typeof v === "string") return v.length > 0;                  // "" is falsey
  if (Array.isArray(v)) return v.length > 0;                       // [] is falsey
  if (v instanceof Date) return !Number.isNaN(v.getTime());        // invalid Date is falsey
  return true;                                                     // any other object is truthy
}
```

| Value | Truthy? |
|---|---|
| `null`, `undefined` | no |
| `false` | no |
| `true` | yes |
| `0`, `NaN` | no |
| any other number (incl. negatives) | yes |
| `""` | no |
| any non-empty string | yes |
| `[]` | no |
| any non-empty array | yes |
| invalid `Date` (`getTime()` is NaN) | no |
| valid `Date` | yes |
| any other object (incl. a `Link`) | yes |

This means a **bare property name is a presence/non-empty test**:

- `filters: status` keeps rows whose `status` frontmatter is a non-empty string (or any truthy value), and drops rows where `status` is missing, `""`, `0`, `false`, `[]`, or `null`.
- `filters: tags` keeps rows that have at least one tag.
- `filters: "!status"` keeps rows where `status` is **absent or empty/falsey**.
- `filters: "file.hasProperty('due')"` is the precise "has a `due` key at all (even if empty/false)" test, distinct from the truthiness test `due`.

## Comparison semantics per value type

### `==` and `!=` (equality)

`==` is `looseEquals(l, r)`; `!=` is `!looseEquals(l, r)`. From `values.ts`:

```ts
export function looseEquals(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();   // by instant
  if (isLink(a) && isLink(b)) return a.path === b.path;                             // by path
  if (isLink(a)) return a.path === b || a.display === b;                            // link vs string
  if (isLink(b)) return b.path === a || b.display === a;
  return a === b;                                                                    // strict ===
}
```

- **Date vs Date**: equal iff same instant (`getTime()`), not reference identity.
- **Link vs Link**: equal iff same `path`.
- **Link vs string**: equal iff the string matches the link's `path` OR its `display` text.
- **Everything else**: JavaScript `===`. So `"10" == 10` is **false** (no numeric coercion in equality), `1 == 1.0` is true, `true == 1` is false, `null == undefined` is false (strict `===` says they differ). There is no type coercion for `==`/`!=` outside the Date/Link special cases.

Examples (filters.test / evaluate.test):
- `status != "done"` → keeps non-done rows; `status == "done"` → keeps done rows.
- `price == 10 || age == 99` → `true` when `price` is `10`.

### `>`, `<`, `>=`, `<=` (ordered comparison)

These use `cmpSafe(l, r)` which wraps `compare` but first **fails NaN-safe on null/undefined**:

```ts
function cmpSafe(l, r) {
  if (l == null || r == null) return NaN;   // missing operand -> NaN
  return compare(l, r);
}
```

A NaN result makes every ordered comparison `false` (`NaN > 0`, `NaN < 0`, `NaN >= 0`, `NaN <= 0` are all `false`). So **a missing operand never throws and never passes an ordered comparison.** Test: `run("missing > 5")` → `false`.

`compare(a, b)` (in `values.ts`) returns a sign-comparison:

```ts
export function compare(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();  // chronological
  if (typeof a === "number" && typeof b === "number") return a - b;              // numeric
  if (a == null) return b == null ? 0 : -1;                                       // nulls sort first
  if (b == null) return 1;
  return String(a).localeCompare(String(b));                                      // locale string compare
}
```

Per type:

- **Date vs Date**: chronological (`getTime` difference). So `due < today()` is a real date comparison.
- **number vs number**: numeric difference. So `price > 5`, `age <= 3`.
- **null/undefined**: sort first (treated as less than any present value) inside `compare`, **but** ordered operators never reach this branch for a missing operand — `cmpSafe` short-circuits null/undefined to NaN → `false`. (The `compare` null-handling matters for `sort:` and `groupBy` ordering, not for filter `>`/`<`.)
- **Mixed / everything else**: coerced to strings and compared with `localeCompare`. So comparing a string to a number, or two strings, is a lexical (locale-aware) comparison: `"banana" > "apple"` is true.

> Gotcha: ordered comparisons across mismatched types fall back to **string** comparison, which is rarely what you want. `"10" > "9"` is `false` (string compare: `"1" < "9"`). Keep the operands the same type, or coerce with `number(x)` / `date(x)`.

### `&&` and `||` (short-circuit, value-returning)

These do **not** coerce to booleans — they return one of the operand values (JS semantics), short-circuiting:

```ts
if (op === "&&") { const l = evaluate(left); return truthy(l) ? evaluate(right) : l; }
if (op === "||") { const l = evaluate(left); return truthy(l) ? l : evaluate(right); }
```

- `a && b` → if `a` is falsey, returns `a` (and never evaluates `b`); else returns `b`.
- `a || b` → if `a` is truthy, returns `a`; else returns `b`.

Test `&& / || return operand values, not booleans`:
- `missing || "default"` → `"default"`
- `status || "default"` → `"in-progress"` (truthy string passes through)
- `price && "yes"` → `"yes"` (truthy number → right)
- `done && "yes"` → `false` (falsey left short-circuits, returns `false`)
- `!!(missing || "default")` → `true`

**This is safe in a filter** because `passesFilter` always runs the final result through `truthy()`. `status || "default"` returns a non-empty string, which is truthy, so the row passes. You usually only see the value-not-boolean behavior when one expression feeds another (e.g. inside a formula or an `if(...)`), not at the filter boundary. The combinators `&&`/`||` and the YAML `and`/`or` keys are interchangeable for combining conditions; pick whichever is clearer.

## Date and duration arithmetic in filters

Filters frequently compare dates. The `+` and `-` operators understand **duration string literals** and **`duration()` ms values** when one side is a `Date` or a number.

Duration literals are parsed by `parseDurationMs` (`functions.ts`) — `/^(-?\d+(?:\.\d+)?)(ms|mo|M|[smhdwy])$/`:

| Suffix | Unit | ms |
|---|---|---|
| `ms` | milliseconds | 1 |
| `s` | seconds | 1000 |
| `m` | minutes | 60 000 |
| `h` | hours | 3 600 000 |
| `d` | days | 86 400 000 |
| `w` | weeks | 7 × day |
| `mo` / `M` | months (≈30 days) | 30 × day |
| `y` | years (≈365 days) | 365 × day |

Notes: `m` = minutes, `M`/`mo` = months. Fractional and negative quantities are allowed (`"1.5w"`, `"-2h"`). A non-matching string yields `NaN` (not a duration).

`evalPlus` / `evalMinus` semantics (from `evaluate.ts`):

- **`Date + "7d"`** → a Date shifted forward by the duration. (Test: `d + "1d"` adds 86 400 000 ms.)
- **`Date - "2h"`** → shifted back. (Test: `d - "2h"` subtracts 7 200 000 ms.)
- **`number + "1d"`** (e.g. `file.mtime` is epoch ms) → stays numeric, adds the ms. (Test: `file.mtime + "1d"`.)
- **`Date + 0` / `"0d"`** → the zero-length duration is honored (a regression test guards that `"0d"` doesn't fall through to string concat): `d + "0d"` returns the same instant as a `Date`.
- **`Date + duration("7d")`** → `duration()` returns ms (a number); `Date + number` shifts the date too, so `today() + duration("7d")` works the same as `today() + "7d"`. (Tests: `urgency buckets via a date formula`, `urgency buckets work with duration() too`.)
- **`"abc" + "def"`** (neither side a Date/number/duration) → string concatenation (`evalPlus` falls through to `${asString(l)}${asString(r)}`).

Relevant helpers usable in date filters: `today()` (midnight today), `now()` (current instant), `date(x)` (coerce a string/Date to a `Date`), and the date methods `.plus("7d")`, `.minus("3d")`, `.format("YYYY-MM-DD")`, `.date()` (strip time), `.isEmpty()`.

Real filter patterns (drawn from the urgency-bucket tests):

```yaml
# overdue tasks
filters: 'date(due) < today()'

# due within the next week (inclusive)
filters: 'date(due) <= today() + "7d"'

# has a due date AND it's overdue (combine combinator + expression)
filters:
  and:
    - 'file.hasProperty("due")'
    - 'date(due) < today()'
```

## Where filters live

### Base-level `filters:` ANDed with each view's `filters:`

In `runView` (`query.ts`), the effective filter for a view is `combineFilters(base.filters, view.filters)`:

```ts
export function combineFilters(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { and: [a, b] };
}
```

So a base's global `filters:` is **ANDed** with the view's `filters:`. Test `applies global + view filters with AND`:

```yaml
filters: 'file.hasTag("book")'      # base-level global
views:
  - type: table
    name: V
    filters: 'status == "open"'     # view-level
    order: [file.name]
# Effective: file.hasTag("book") AND status == "open"  → only "alpha"
```

`combineFilters` also passes through when one side is `undefined` (test `combineFilters ANDs two nodes`): `combineFilters(undefined, "price > 5")` returns `"price > 5"` unchanged.

### `where:` in sources

A `SourceSpec` of kind `notes` or `tasks` carries a `where` **string** (not a `FilterNode` tree). In `resolveSource` (`source.ts`):

```ts
if (spec.kind === "notes") {
  let rows = ...;                        // vault notes (optionally scoped by `from`)
  if (!spec.where) return rows;
  return rows.filter((r) => passesFilter(spec.where!, toContext(r)));
}
```

So `where:` is exactly the same leaf-string filter machinery (`passesFilter` on a string), evaluated per note with `toContext(r)` (note that the source `where` is evaluated **without** a `hostThis`, so `this.*` is undefined there). To combine conditions in a `where:` string, use `&&` / `||` / `!` inside the one string — a source `where` cannot be an `and`/`or`/`not` YAML tree (it is typed as `string`).

For tasks, `where` is handled separately by `filterTaskRows(rows, spec.where, today)` (the task query DSL); see [tasks](../tasks/syntax.md) and [sources](./sources.md).

Examples (frontmatter accepts a string source form, normalized by `normalizeSource`):

```yaml
# notes tagged #book whose price clears 5
source: notes where file.hasTag("book") && price > 5

# tasks scoped to the notes another base selects
source:
  kind: tasks
  from: "[[Google Keep]]"
  where: not done
```

## `this.` host-note context

When a base is rendered **inline inside another note** (an embedded `query` block), the host note's frontmatter flows in as `this.*`. `runView(base, rows, viewIndex, hostThis)` passes `hostThis` into both formula computation and `toContext`, so filters can reference it.

Test `hostThis flows into filters / formulas / groupBy as this.*`:

```yaml
formulas:
  adj: 'price * this.markup'
views:
  - type: table
    name: V
    filters: 'price >= this.minPrice'    # this.minPrice comes from the host note
    order: [file.name, formula.adj]
# host = { minPrice: 10, markup: 2, tier: "open" }
# → only alpha (price 10) and gamma (price 20) clear minPrice; adj = price * 2
```

`file.hasLink(this.file)` is the canonical "this note links back to the host note" filter — `linkName()` normalizes `this.file` (a `FileMeta`) to its basename before checking `file.links` (test `file.hasLink accepts a FileMeta (this.file), matching by name`).

## Worked examples of `and`/`or`/`not` trees

From `filters.test.ts` (`ctx.file.tags = ["book"]`, `ctx.note = { status: "open", price: 10 }`, `ctx.formula = { ppu: 6 }`):

```ts
// AND of a tag check and a nested OR
const f = { and: ['file.hasTag("book")', { or: ["price > 5", "price < 0"] }] };
passesFilter(f, ctx);                        // true  (has tag book AND price>5)

passesFilter({ not: ['file.hasTag("book")'] }, ctx);   // false (it DOES have book)
passesFilter({ not: ['file.hasTag("movie")'] }, ctx);  // true  (it does NOT have movie)

passesFilter('status != "done"', ctx);       // true
passesFilter('status == "done"', ctx);       // false
passesFilter("formula.ppu > 5", ctx);        // true
passesFilter("this is not valid )(", ctx);   // false (fails closed)
```

YAML authoring forms (these mirror the `FilterNode` shape):

```yaml
# Single leaf
filters: 'status != "done"'

# AND (all must pass)
filters:
  and:
    - 'file.hasTag("book")'
    - 'price > 5'

# OR (any may pass)
filters:
  or:
    - 'status == "open"'
    - 'status == "in-progress"'

# NOT (every child must fail)
filters:
  not:
    - 'file.hasTag("archive")'

# Nested: (book AND (open OR in-progress)) AND NOT archived
filters:
  and:
    - 'file.hasTag("book")'
    - or:
        - 'status == "open"'
        - 'status == "in-progress"'
    - not:
        - 'file.hasTag("archive")'
```

## Gotchas and edge cases

- **`not` is NOR, not element-wise negation.** `passesFilter` implements `not` as `node.not.every((n) => !passesFilter(n, ctx))` — **every** child must fail for the `not` to pass. With one child this is plain negation. With multiple children, `not: [A, B]` passes only when both A and B fail (i.e. it's `NOT (A OR B)`), **not** `NOT A AND NOT B` per element (those happen to be equivalent by De Morgan, but the failure semantics are "all children must individually fail"). If any child passes, the whole `not` fails.
- **Fail closed.** A malformed leaf expression, a thrown method call, or a bad regex literal all resolve to `false`, dropping the row — you will never see an error surfaced from a filter; you'll see fewer rows. Double-check expressions if rows vanish unexpectedly.
- **`undefined`/empty filter = pass-all.** Omitting `filters:` shows every row in the source.
- **Bare name = non-empty test, via `truthy`.** `filters: status` is "has a non-empty status", which is different from `file.hasProperty("status")` ("the key exists, even if empty/false/0").
- **`==` does not coerce types** (except Date↔Date by instant and Link↔string by path/display). `"10" == 10` is `false`. Use `number()`/`date()` to align types first.
- **Ordered comparisons (`> < >= <=`) with a missing operand are `false`** (`cmpSafe` → NaN), and **mismatched non-null types fall back to locale string comparison** — keep operands the same type.
- **Formulas are available in filters** because they're computed before filtering, but **only the formulas declared on the base config** (`base.formulas`). A typo in a formula name resolves to `undefined` (falsey).
- **`&&`/`||` return operand values, not booleans**, but the filter boundary always applies `truthy()`, so this is transparent for the pass/fail decision; it matters when chaining into another expression/formula.
- **Source `where:` is a string, not a tree.** You cannot put `and:`/`or:`/`not:` YAML under a source `where`; combine with `&&`/`||`/`!` inside the single expression instead. Full `FilterNode` trees are only available under `filters:` in a base/view config.
- **`this.*` is only populated for embedded bases.** A standalone base file has no host note, so `this.minPrice` is `undefined` (filters using it then fail-closed via NaN/falsey). Source `where:` strings never get a `hostThis`.

Source: `core/src/bases/filters.ts`, `core/src/bases/evaluate.ts`, `core/src/bases/values.ts`, `core/src/bases/functions.ts`, `core/src/bases/parser.ts`, `core/src/bases/lexer.ts`, `core/src/bases/query.ts`, `core/src/bases/source.ts`, `core/src/bases/types.ts`, `core/test/bases/filters.test.ts`, `core/test/bases/evaluate.test.ts`, `core/test/bases/query.test.ts`
