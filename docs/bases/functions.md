# Bases Functions & Methods Reference

This is the **complete, exhaustive reference** for every built-in function and per-type method available in Bismuth's Bases expression language. These are evaluated against a single note (or row) inside formulas, filters, `groupBy`/`sort` properties, and inline ` ```query ` blocks. The expression engine compiles Bases expressions to an AST (`parser.ts` → `ast.ts`) and evaluates them with `evaluate.ts`, which delegates *call* nodes to two dispatch surfaces in `functions.ts`:

- **Global functions** — `callFunction(name, args, ctx)`: called as bare `name(...)`, e.g. `if(...)`, `max(...)`, `today()`.
- **Per-type methods** — `callMethod(receiver, name, args, ctx)`: called as `receiver.name(...)`, dispatched by the runtime type of the receiver (file / number / string / array / date).

Every function/method below is documented with its signature, return type, the exact behavior found in the source, and a copy-pasteable example drawn from the actual code or tests. If a name is not in these dispatch tables it evaluates to `undefined` (no error thrown).

See also: [Bases overview](./overview.md), [filters](./filters.md), [expression grammar / operators](./query-syntax.md).

---

## Value model & coercion (read this first)

Functions and operators rely on a small set of coercion helpers in `core/src/bases/values.ts`. Understanding them explains many edge cases below.

### `truthy(v)` — what counts as "true"
Used by `if(...)`, `&&`, `||`, `!`, and `Array.filter`. Rules (in order):
- `null` / `undefined` → `false`
- boolean → itself
- number → `true` unless `0` or `NaN`
- string → `true` unless empty (`""`)
- array → `true` unless empty (`[]`)
- `Date` → `true` unless an invalid date (`NaN` time)
- any other object (e.g. a `Link`, a `FileMeta`) → `true`

### `toNumber(v)` — numeric coercion
Used by `number()`, `min`/`max`, arithmetic, and number-method receivers:
- number → itself
- string → `Number(v)`, or `NaN` if not parseable
- boolean → `1` / `0`
- `Date` → epoch milliseconds (`getTime()`)
- anything else → `NaN`

### `looseEquals(a, b)` — used by `==` / `!=`
- two `Date`s → equal iff same `getTime()`
- two `Link`s → equal iff same `path`
- one `Link` → equal iff the other matches its `path` **or** its `display`
- otherwise strict `===`

### `compare(a, b)` — used by `> < >= <=`, `sort`, `groupBy` ordering
- two `Date`s → chronological (`a.getTime() - b.getTime()`)
- two numbers → numeric
- `null`/`undefined` sort first
- otherwise `String(a).localeCompare(String(b))`

> Gotcha: ordered comparisons (`>`, `<`, `>=`, `<=`) against a `null`/missing operand return **false** (the engine's `cmpSafe` returns `NaN` for a null operand, so `missing > 5` is `false`, never throws). Equality (`==`) still works against missing values.

### `asString(v)` — the canonical stringifier
Used everywhere a value must become text (`join`, `replace`, `contains`, string concat with `+`, etc.):
- `null`/`undefined` → `""`
- `Date` → `toISOString()`
- `Link` → its `display` if set, else its `path`
- otherwise `String(v)`

---

## The `Link` value

A `Link` is the object shape `{ __link: true, path: string, display?: string }` (`values.ts`). It is produced by the `link(...)` global and the `file.asLink(...)` method, recognized by `isLink()`, compared specially by `looseEquals`/`compare`, and stringified to its `display ?? path` by `asString`.

---

## Global functions (`callFunction`)

Called as a bare name. Unknown names return `undefined`.

| Function | Signature | Returns | Behavior |
|----------|-----------|---------|----------|
| `if` | `if(cond, then, else?)` | the chosen branch value | `truthy(cond) ? then : (else if provided, otherwise undefined)` |
| `number` | `number(v)` | `number` | `toNumber(v)` coercion |
| `list` | `list(...args)` | `unknown[]` | if called with exactly one array arg, returns it as-is; otherwise wraps all args into an array |
| `min` | `min(...args)` | `number` | `Math.min` over `args.map(toNumber)` |
| `max` | `max(...args)` | `number` | `Math.max` over `args.map(toNumber)` |
| `now` | `now()` | `Date` | current date+time (`new Date()`) |
| `today` | `today()` | `Date` | current date at midnight local (`setHours(0,0,0,0)`) |
| `date` | `date(v)` | `Date` | returns `v` if already a `Date`, else `new Date(asString(v))` |
| `duration` | `duration(s)` | `number` (ms) or `NaN` | parses a duration literal to milliseconds (see Duration literals) |
| `link` | `link(path, display?)` | `Link` | builds `{ __link: true, path, display? }` |
| `random` | `random()` | `number` | `Math.random()` (0..1) |

### `if(cond, then, else?)`
Returns the truthy branch; the else branch is optional and yields `undefined` when omitted.
```text
if(price > 5, "big", "small")   // => "big" when price=10.456
if(price > 50, "big")           // => undefined when condition is false (no else arg)
```
Nesting drives the canonical "urgency bucket" formula:
```text
if(!due, "No date",
  if(date(due) < today(), "Overdue",
    if(date(due) <= today() + "7d", "This week", "Later")))
```

### `number(v)`
```text
number("42")   // => 42
number(true)   // => 1
number("abc")  // => NaN
```

### `list(...args)`
Single array arg passes through; otherwise everything is wrapped.
```text
list("x").length      // => 1
list(1, 2, 3)         // => [1, 2, 3]
list([1, 2])          // => [1, 2]   (the array is returned as-is, NOT [[1,2]])
```

### `min(...args)` / `max(...args)`
Variadic; all args coerced with `toNumber`.
```text
max(1, 5, 3)   // => 5
min(1, 5, 3)   // => 1
```

### `now()` / `today()`
```text
now()     // current instant, with time-of-day
today()   // current date, time zeroed to local midnight
```
`today()` is the building block for due-date math because it composes with `+`/`-` and duration literals.

### `date(v)`
Coerces a string/value to a `Date`. A `Date` argument is returned unchanged.
```text
date("2026-05-27")        // => Date for that day
date(due) < today()       // overdue check on a frontmatter "due" string
```

### `duration(s)`
Parses a duration literal to **milliseconds** (a number, not a `Date`). Returns `NaN` for non-duration input.
```text
duration("1d")        // => 86400000
duration("nonsense")  // => NaN
```
> Gotcha: `duration()` returns a **number**, so to shift a date you must add it: `today() + duration("7d")`. The engine's `+`/`-` operators recognize a numeric-ms offset added to a `Date` and shift the date accordingly (so `today() + duration("7d")` and `today() + "7d"` are equivalent). See Duration literals & date arithmetic below.

### `link(path, display?)`
```text
link("Some Note")                 // => { __link: true, path: "Some Note" }
link("Some Note", "see here")     // => { __link: true, path: "Some Note", display: "see here" }
```

### `random()`
```text
random()   // e.g. 0.42; in (0, 1)
```

---

## File methods (`callFileMethod`)

The receiver is a **`FileMeta`** — the `file` identifier (and `this.file` for an embedding host). Detected by the receiver being a non-array object that has both a `path` and a `tags` key. `FileMeta` fields (also usable as bare member access, e.g. `file.name`, `file.mtime`, `file.tags[0]`): `name` (basename without extension), `basename` (alias of `name`), `path` (vault-relative), `folder` (`""` at root), `ext`, `size` (bytes), `ctime`/`mtime` (epoch ms), `tags` (no leading `#`), `links` (wikilink targets — no `.md`, `#heading`, or `|alias`).

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `hasTag` | `file.hasTag(...names)` | `boolean` | true if any arg (stringified) is in `file.tags` |
| `hasLink` | `file.hasLink(...targets)` | `boolean` | true if any arg's link-name is in `file.links`; accepts a bare name, a `Link`, or a `FileMeta` (e.g. `this.file`) |
| `inFolder` | `file.inFolder(folder)` | `boolean` | true if `file.folder` equals the arg or starts with `arg + "/"` (i.e. is a descendant) |
| `hasProperty` | `file.hasProperty(name)` | `boolean` | true if the note's frontmatter has `name` as an own property |
| `asLink` | `file.asLink(display?)` | `Link` | a `Link` to this file; `display` defaults to the file name |

### `file.hasTag(...names)`
Membership test against `file.tags` (tags are stored without the leading `#`). Variadic — true if **any** arg matches.
```text
file.hasTag("logistics")          // => true  (file.tags = ["logistics", "todo"])
file.hasTag("nope")               // => false
file.hasTag("a", "b")             // => true if either tag present
```

### `file.hasLink(...targets)`
True if any argument names a target in `file.links`. Arguments are normalized to a basename via `linkName`: a `Link` → basename of its `path`; a `FileMeta` → its `name`; a plain string → itself.
```text
file.hasLink("internship")        // => true  (file.links = ["internship"])
file.hasLink(this.file)           // => true when the host note's basename is "internship"
```
This is why an embedded base can ask "does this note link back to the page I'm embedded in?" via `file.hasLink(this.file)`.

### `file.inFolder(folder)`
Folder containment, including descendants.
```text
file.inFolder("reading")          // => true  (file.folder = "reading")
file.inFolder("reading/quotes")   // => true for files in that subfolder (startsWith "reading/quotes/")
```

### `file.hasProperty(name)`
Checks the note's frontmatter for an **own** property.
```text
file.hasProperty("price")         // => true when frontmatter has a "price" key
file.hasProperty("nope")          // => false
```

### `file.asLink(display?)`
Builds a `Link` to this file. With no argument, the display text falls back to the file's `name`.
```text
file.asLink("a quote (p1)")  // => { __link: true, path: "housing.md", display: "a quote (p1)" }
file.asLink()                // => { __link: true, path: "housing.md", display: "housing" }
```

---

## Number methods (`callNumberMethod`)

Receiver is any `number`. (Members like `.length` are NOT numbers — see Array/String for `.length`.)

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `toFixed` | `n.toFixed(digits?)` | `string` | `Number.prototype.toFixed`; `digits` defaults to `0` |
| `round` | `n.round(decimals?)` | `number` | round to `decimals` places (default `0`) |
| `floor` | `n.floor()` | `number` | `Math.floor(n)` |
| `ceil` | `n.ceil()` | `number` | `Math.ceil(n)` |
| `abs` | `n.abs()` | `number` | `Math.abs(n)` |
| `isEmpty` | `n.isEmpty()` | `boolean` | always `false` (a number is never empty) |

### Examples
```text
price.toFixed(2)   // => "10.46"   (price=10.456) — NOTE: returns a STRING
price.round(1)     // => 10.5
price.floor()      // => 10
price.ceil()       // => 11
(-price).abs()     // => 10.456
```
> Gotcha: `toFixed` returns a **string** (matching JS), while `round`/`floor`/`ceil`/`abs` return numbers. Use `round(2)` instead of `toFixed(2)` if you need to keep doing math.

The classic formula `(price / age).toFixed(2)` chains a number method onto the result of division.

---

## String methods (`callStringMethod`)

Receiver is any `string`.

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `lower` | `s.lower()` | `string` | `toLowerCase()` |
| `upper` | `s.upper()` | `string` | `toUpperCase()` |
| `trim` | `s.trim()` | `string` | strips surrounding whitespace |
| `title` | `s.title()` | `string` | Title-cases each word (`\w\S*` → first char upper, rest lower) |
| `contains` | `s.contains(sub)` | `boolean` | `s.includes(asString(sub))` |
| `startsWith` | `s.startsWith(prefix)` | `boolean` | `String.prototype.startsWith` |
| `endsWith` | `s.endsWith(suffix)` | `boolean` | `String.prototype.endsWith` |
| `replace` | `s.replace(find, repl)` | `string` | replaces **all** occurrences (split/join, NOT regex) |
| `slice` | `s.slice(start, end?)` | `string` | `String.prototype.slice`; args coerced via `toNumber` |
| `split` | `s.split(sep)` | `string[]` | split on the (stringified) separator |
| `reverse` | `s.reverse()` | `string` | reverses the characters |
| `isEmpty` | `s.isEmpty()` | `boolean` | true iff `length === 0` |
| `matches` | `s.matches(pattern, flags?)` | `boolean` | regex test; accepts a string pattern (+ optional flags) or a `RegExp`; malformed pattern → `false` |

### Examples
```text
title.lower()             // => "hello world"   (title = "Hello World")
title.upper()             // => "HELLO WORLD"
title.title()             // => "Hello World"   (e.g. "hello world".title())
title.contains("World")   // => true
title.startsWith("Hello") // => true
title.endsWith("World")   // => true
"a,b,c".replace(",", ";") // => "a;b;c"   (replaces ALL, not just the first)
title.slice(0, 5)         // => "Hello"
"a,b,c".split(",")        // => ["a", "b", "c"]
"abc".reverse()           // => "cba"
"".isEmpty()              // => true
title.length              // => 11   (member access, not a method call)
```

### `s.matches(pattern, flags?)`
Regex test. The first argument can be a **string pattern** (with an optional second `flags` argument) or a **regex literal** (`/.../`). Bad patterns fail closed to `false` (never throw).
```text
title.matches("^Hello")       // => true
title.matches("^hello")       // => false   (case-sensitive)
title.matches("^hello", "i")  // => true    (i flag)
title.matches("(")            // => false   (malformed pattern, fails closed)
title.matches(/^hello/i)      // => true    (regex literal with flags)
title.matches(/^hello/)       // => false
```
> Note: `replace` is plain string substitution (split/join), so it does NOT take regex — use `matches` for regex.

---

## Array methods (`callArrayMethod`)

Receiver is any array (e.g. `file.tags`, a frontmatter list, the result of `split`). Array `.length` is a member access (handled in `evaluate.ts`'s `getMember`), not a method.

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `contains` | `arr.contains(x)` | `boolean` | true if any element `=== x` OR `asString(el) === asString(x)` |
| `join` | `arr.join(sep?)` | `string` | `arr.map(asString).join(sep)`; `sep` defaults to `", "` |
| `unique` | `arr.unique()` | `unknown[]` | de-duped (`[...new Set(arr)]`) |
| `sort` | `arr.sort()` | `unknown[]` | a sorted **copy** (default JS lexicographic sort) |
| `reverse` | `arr.reverse()` | `unknown[]` | a reversed **copy** |
| `slice` | `arr.slice(start, end?)` | `unknown[]` | `Array.prototype.slice`; args via `toNumber` |
| `flat` | `arr.flat()` | `unknown[]` | one-level flatten |
| `isEmpty` | `arr.isEmpty()` | `boolean` | true iff `length === 0` |
| `map` | `arr.map(projection)` | `unknown[]` | maps each item via a projection (lambda OR property-path string) |
| `filter` | `arr.filter(predicate)` | `unknown[]` | keeps items where the predicate is `truthy` (lambda OR property-path string) |
| `reduce` | `arr.reduce(fn, seed?)` | `unknown` | folds the array; 2-arg lambda is a real reducer, otherwise sums a projection |

### Examples
```text
items.contains("a")     // => true   (items = ["b", "a", "a"])
items.length            // => 3      (member access)
items.join("-")         // => "b-a-a"
items.join()            // => "b, a, a"   (default separator)
items.unique()          // => ["b", "a"]
items.unique().length   // => 2
file.tags.length        // => 2
[3,1,2].sort()          // => [1, 2, 3]   (copy; original untouched)
[1,2,3].reverse()       // => [3, 2, 1]
[1,2,3,4].slice(1, 3)   // => [2, 3]
[[1],[2]].flat()        // => [1, 2]
[].isEmpty()            // => true
```

### Lambdas vs property-path strings (`map` / `filter` / `reduce`)
`map`, `filter`, and `reduce` accept their callback in **two forms** (handled by `compileItemAccessor` for the string form, and real closures for the lambda form):

**1. Property-path string** — `compileItemAccessor` resolves a path on each item. Bare placeholders `_`, `it`, `$` return the item itself; a leading `_.`/`it.`/`$.` is stripped, then dotted segments index into the item.
```text
items.map("title")        // => ["a","b","c"]   (items are {title,...} objects)
items.map("_.title")      // equivalent to the above
items.filter("_.price")   // keeps items whose .price is truthy
items.reduce("price", 0)  // sums each item's .price, seeded at 0  => 6
```

**2. Real lambdas** — `param => expr` or `(a, b) => expr`. Lambdas close over the surrounding scope (outer frontmatter, nested lambdas) via a scope chain.
```text
items.map(x => x.title)               // => ["a","b","c"]
items.filter(x => x.price > 1).length // => 2
items.reduce((acc, x) => acc + x.price, 0)  // => 6
items.filter(x => x <= cap)           // => [1,2]  (cap=2 read from outer frontmatter)
```

### `arr.reduce(fn, seed?)` — two behaviors
`callArrayReduce` decides by the callback's **arity** (`__params` on a lambda, else `fn.length`):
- **Arity ≥ 2** (e.g. `(acc, x) => ...`): a true `Array.prototype.reduce` with `seed` as the initial accumulator.
  ```text
  items.reduce((acc, x) => acc + x.price, 0)  // => 6
  ```
- **Otherwise** (a property-path string or 1-arg projection): sums `toNumber(projection(item))` over the array, seeded with `toNumber(seed)` (default `0`).
  ```text
  items.reduce("price", 0)  // => 6  (sum of the .price projection)
  ```

---

## Date methods (`callDateMethod`)

Receiver is a `Date` instance (e.g. from `date(...)`, `now()`, `today()`, or a frontmatter date value).

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `format` | `d.format(fmt)` | `string` | formats with a moment-ish token string (see tokens) |
| `date` | `d.date()` | `Date` | a copy with the time zeroed to local midnight |
| `isEmpty` | `d.isEmpty()` | `boolean` | true iff the date is invalid (`NaN` time) |
| `plus` | `d.plus(duration)` | `Date` | shifts forward by a duration literal (invalid duration → +0) |
| `minus` | `d.minus(duration)` | `Date` | shifts backward by a duration literal (invalid duration → -0) |

### `d.format(fmt)`
If `fmt` is empty, returns the ISO date (`YYYY-MM-DD`). Otherwise replaces these tokens (all local time, zero-padded):

| Token | Meaning |
|-------|---------|
| `YYYY` | full year |
| `MM` | month, 2-digit (`getMonth()+1`) |
| `DD` | day of month, 2-digit |
| `HH` | hours, 2-digit |
| `mm` | minutes, 2-digit |
| `ss` | seconds, 2-digit |

```text
now().format("YYYY-MM-DD")          // e.g. "2026-06-08"
now().format("YYYY-MM-DD HH:mm")    // e.g. "2026-06-08 14:30"
now().format("")                    // ISO date only: "2026-06-08"
```
> Gotcha: `mm` is **minutes** and `MM` is **months** (case-sensitive). There is no `M`/`D` short token, no day/month names — only the six fixed tokens above.

### `d.date()`, `d.isEmpty()`, `d.plus()`, `d.minus()`
```text
now().date()           // today at local midnight (time zeroed)
date("bad").isEmpty()  // => true  (invalid date)
d.plus("1w")           // d + 7 days   (d = 2026-05-27 -> 2026-06-03)
d.minus("30m")         // d - 30 minutes
```

---

## Duration literals & date arithmetic

A **duration literal** is a string like `"1d"`, `"-2h"`, `"30m"`, `"1.5w"`, parsed by `parseDurationMs` (regex `^(-?\d+(\.\d+)?)(ms|mo|M|[smhdwy])$`). It returns milliseconds, or `NaN` if it isn't a duration.

| Unit | Meaning | Milliseconds |
|------|---------|--------------|
| `ms` | milliseconds | 1 |
| `s` | seconds | 1000 |
| `m` | **minutes** | 60000 |
| `h` | hours | 3,600,000 |
| `d` | days | 86,400,000 |
| `w` | weeks | 7 × day |
| `mo` | **months** (approx 30 days) | 30 × day |
| `M` | months (alias of `mo`) | 30 × day |
| `y` | years (approx 365 days) | 365 × day |

> Gotcha: lowercase `m` = **minutes**, while `mo`/`M` = **months**. `mo` and `M` are both ~30 days (not calendar-accurate); `y` is ~365 days.

These literals are consumed three ways:
1. The `duration(s)` global → returns the ms number.
2. The `date.plus(...)` / `date.minus(...)` methods → take a duration literal.
3. The `+` and `-` operators directly, when one operand is a `Date` (or epoch-ms number) and the other parses as a duration. This is implemented in `evaluate.ts`'s `evalPlus`/`evalMinus`, not in `functions.ts`, but it's the most common way durations appear:

```text
d + "1d"                     // Date shifted +1 day
d - "2h"                     // Date shifted -2 hours
file.mtime + "1d"            // numeric epoch ms + 1 day (stays a number)
today() + "7d"               // a Date 7 days from today's midnight
today() + duration("7d")     // identical: numeric ms added to a Date shifts it
d + "0d"                     // honors the zero-length duration -> same instant
```
> Gotcha: `today() + duration("7d")` works because `+` recognizes a numeric ms offset added to a Date. But `today() + "7d"` (the string-literal form) is the simplest; both produce the same `Date`. A `0d` duration is honored (yields the same instant), not skipped.

---

## Aggregation / summary functions (`query.ts`)

These are **not** part of the per-row expression dispatch — they are the named aggregations a view's `summaries:` map can request over a column. `summarize(name, values)` in `query.ts` computes them across the post-filter, pre-limit row set, returning a **formatted string**.

| Summary name | Returns (string of) | Behavior |
|--------------|---------------------|----------|
| `Sum` | sum | sum of numeric-coercible values (`toNumber`, NaN dropped) |
| `Average` | mean | `sum / count` of numeric values; `""` if none |
| `Min` | minimum | `Math.min` over numeric values; `""` if none |
| `Max` | maximum | `Math.max` over numeric values; `""` if none |
| `Count` | count | total number of values (all rows, not just numeric) |
| `Empty` | count empty | values that are `null`/`undefined`/`""` |
| `Filled` | count filled | values that are not `null`/`undefined`/`""` |
| `Unique` | distinct count | size of the set of `String(v)` values |

Example view config:
```yaml
views:
  - type: table
    name: V
    summaries:
      note.price: Sum
```
Over rows with prices `10, 4, 20` → `summaries["note.price"] === "34"`. With a filter excluding `done`, the same `Sum` over `10, 20` → `"30"`. Numeric `Min`/`Max` drop non-numbers; `Count`/`Empty`/`Filled`/`Unique` operate over all values.

> The summary property id is canonicalized (`canonicalId`) — a bare `price` and `note.price` both resolve to the `note.price` column.

---

## Property resolution (`query.ts`)

Functions run inside an `EvalContext` whose identifiers resolve as follows (`resolveProperty` / `resolveIdent`):

- `file.*` → fields of the row's `FileMeta` (e.g. `file.name`, `file.mtime`, `file.tags`).
- `note.*` → frontmatter values (e.g. `note.price`).
- `formula.*` → values computed by the base's `formulas:` (e.g. `formula.ppu`).
- `this.*` → the **embedding host note's** frontmatter, present only when a base is rendered inline inside another note (`hostThis`). Used like `price >= this.minPrice` or `price * this.markup`.
- A **bare name** (`price`, `status`) → frontmatter (`note[name]`); `canonicalId` maps a bare `price` to the `note.price` column id for sort/group/summary.

Lambda parameters shadow all of the above inside the lambda body (scope chain in `evaluate.ts`).

```text
price                 // bare -> note.price
note.status           // explicit frontmatter
file.name             // FileMeta field
formula.ppu           // computed formula
price >= this.minPrice  // host-note value in an embedded base
```

---

## Edge cases & gotchas (summary)

- **Unknown function or method → `undefined`** (never an error). A typo silently yields nothing.
- **Wrong receiver type → `undefined`**: calling a string method on a number, etc., dispatches to the wrong table and returns `undefined`.
- **`toFixed` returns a string**; `round` returns a number. Prefer `round` to keep chaining math.
- **`replace` is not regex** — it's a global split/join substitution. Use `matches` for regex tests.
- **`mm` = minutes, `MM` = months; `m` = minutes, `mo`/`M` = months** — case matters everywhere.
- **`sort`/`reverse` on arrays return copies**, leaving the original untouched.
- **`array.sort()` is JS-default (lexicographic)** — numbers sort as strings unless you use a lambda-based approach via formulas. (Note: view-level `sort:` and `groupBy` ordering use the type-aware `compare`, which IS numeric/chronological — only the array `.sort()` method is lexicographic.)
- **Ordered comparison with a missing operand is `false`** (`missing > 5` → `false`), so filters fail safe rather than throwing.
- **`duration()` returns ms (a number)**, not a Date — compose with `+`/`-` to shift dates.
- **`&&`/`||` return operand values, not booleans** (JS semantics): `missing || "default"` → `"default"`, `price && "yes"` → `"yes"`. `truthy()` re-coerces at the filter boundary.

Source: core/src/bases/functions.ts, core/src/bases/values.ts, core/src/bases/query.ts, core/src/bases/evaluate.ts, core/src/bases/types.ts, core/test/bases/functions.test.ts, core/test/bases/evaluate.test.ts, core/test/bases/query.test.ts, core/test/bases/parse.test.ts
