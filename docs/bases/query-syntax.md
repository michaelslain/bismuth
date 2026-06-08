# Bases Expression Grammar

This document is the canonical, end-to-end reference for the **Bases expression language** — the small expression grammar used everywhere a Bases query needs a value or a boolean test: `filters:`, per-view `filters:`, `formulas:` definitions, `groupBy`/`sort` property strings, and the `where:` clause of an inline ` ```query ` block. It covers tokenization (the lexer), the parse grammar and operator precedence (the parser → AST), and evaluation semantics (how each construct produces a runtime value). Every rule here is verified against `core/src/bases/lexer.ts`, `parser.ts`, `ast.ts`, `evaluate.ts`, `functions.ts`, `values.ts`, and `parse.ts`, with concrete examples drawn from the test suite in `core/test/bases/`.

For the surrounding system — how an expression slots into a base file, the available functions/methods, and how rows are sourced — see [bases overview](./overview.md), [functions reference](./functions.md), and [views](./overview.md). Where those siblings don't exist yet, this file is self-contained for the grammar itself and includes the built-in functions/methods inline.

---

## 1. Pipeline overview

An expression is a **string**. It travels through three pure stages:

1. **Lex** (`lexer.ts` `lex(src)`) → `Token[]`
2. **Parse** (`parser.ts` `parseExpr(src)`) → `Expr` AST (`ast.ts`)
3. **Evaluate** (`evaluate.ts` `evaluate(node, ctx)`) → a runtime value, against an `EvalContext`

`parseExpr` internally calls `lex`; you almost never call `lex` directly. `passesFilter` (`filters.ts`) wraps the whole pipeline and coerces the result to a boolean for filter contexts.

```ts
import { parseExpr } from "core/src/bases/parser";
import { evaluate } from "core/src/bases/evaluate";

evaluate(parseExpr("price > 5 && age < 1"), ctx); // => boolean
```

**Fail-closed everywhere.** A malformed expression never crashes a query:
- In a filter, `passesFilter` catches the throw and returns `false` (`"this is not valid )(" → false`).
- A bad regex literal evaluates to `undefined` instead of throwing.
- `String.matches()` with a malformed pattern returns `false`.

---

## 2. Lexer — tokens & literals

`lex(src)` scans left-to-right, skipping any whitespace (`/\s/`). It emits `Token[]` where each token has a `kind`, an optional `value`/`flags`, and a source `pos`.

### 2.1 Token kinds

```ts
type TokenKind =
  | "number" | "string" | "ident"
  | "op" | "dot" | "comma" | "arrow"
  | "lparen" | "rparen" | "lbracket" | "rbracket"
  | "regex"
  | "true" | "false" | "null";
```

| Kind        | Produced by                                  | `value`               |
|-------------|----------------------------------------------|-----------------------|
| `number`    | a numeric literal                            | the `Number`          |
| `string`    | a `"…"` or `'…'` literal                      | the unquoted contents |
| `ident`     | a name `[A-Za-z_][A-Za-z0-9_]*`              | the identifier text   |
| `op`        | an operator from the two-/one-char sets      | the operator string   |
| `dot`       | `.`                                          | —                     |
| `comma`     | `,`                                          | —                     |
| `arrow`     | `=>`                                         | —                     |
| `lparen`/`rparen`     | `(` / `)`                          | —                     |
| `lbracket`/`rbracket` | `[` / `]`                          | —                     |
| `regex`     | a `/pattern/flags` literal (contextual)      | the pattern; `flags` set |
| `true`/`false`/`null` | the bare keywords                  | — (kind carries the meaning) |

### 2.2 String literals

Quoted with `"` or `'`. The quote char is recorded and the scanner reads until the matching quote.

- **Escapes**: a backslash escapes the *next* character literally — `\\X` appends `X`. So `'a\'b'` lexes to the string `a'b`. There is no special handling for `\n`/`\t` etc.: `\n` becomes the literal char `n`. (See `lexer.test.ts`: `lex("'a\\'b'")[0]` → `{ kind: "string", value: "a'b" }`.)
- The `value` stored is the **unquoted, unescaped** contents.
- An unterminated string runs to end-of-input (the loop simply stops at `n`).

```
"hi"     -> { kind: "string", value: "hi" }
'a\'b'   -> { kind: "string", value: "a'b" }
```

### 2.3 Number literals

A run of digits, with **at most one** `.`:

- `42` → `42`; `3.5` → `3.5`.
- Only the **first** dot is part of the number. A second dot ends the literal, so `1.2.3` lexes as `number(1.2)`, `dot`, `number(3)` — never a `NaN` token. This is a deliberate regression guard (`lexer.test.ts`: "a malformed numeric literal '1.2.3'…").
- `1..2` → `number(1)`, `dot`, `dot`, `number(2)`; the first number is `1`, never `NaN`.
- There is **no** leading-`.` form (`.5`), no exponent form (`1e3`), no sign as part of the literal (a leading `-` is a unary operator, see §4.3), and no separators.

### 2.4 Boolean & null keywords

The bare words `true`, `false`, `null` lex to their own token kinds (not `ident`):

```
true false null -> ["true", "false", "null"]
```

Any other identifier-shaped word becomes an `ident`.

### 2.5 Identifiers

`[A-Za-z_]` then `[A-Za-z0-9_]*`. Identifiers are used for:
- the namespace roots `file`, `note`, `formula`, `this`,
- bare frontmatter property names (`price`, `status`, …),
- global function names (`if`, `max`, `today`, …),
- method names after a `.`,
- lambda parameter names.

### 2.6 List literals

There is **no list literal in the expression grammar.** `[ … ]` is only the **index** operator (postfix `expr[index]`, §3.6). Lists arrive as *values* from frontmatter (a YAML array), from `file.tags`/`file.links`, or by calling the `list(...)` global (§5). YAML-level arrays like `columns: [todo, reading, done]` are parsed by the **YAML** layer (`parse.ts`), not by this expression lexer.

### 2.7 Date literals

There is **no date literal token.** Dates enter expressions as:
- a frontmatter value that round-tripped as a JS `Date` (the row builder coerces date-typed frontmatter), or
- a string passed to the `date(...)` global (e.g. `date("2026-05-27")`, or `date(due)` where `due` is a frontmatter string), or
- `now()` / `today()` (§5).

**Duration strings** like `"7d"` are ordinary string literals; they only become durations when used in date arithmetic or `duration(...)` (§6).

### 2.8 Operators

Two-char operators (matched before one-char): `==`, `!=`, `>=`, `<=`, `&&`, `||`.
One-char operators: `+`, `-`, `*`, `/`, `%`, `>`, `<`, `!`.

`=>` is special-cased *before* the two-char set and emits an `arrow` token (lambda). A lone `=` is **not** a token (no assignment); only `==` and `=>` consume `=`.

### 2.9 Regex literals (contextual)

A `/` begins a **regex literal** instead of division **only when the previous token would naturally be followed by a fresh value** (`regexAllowedAfter`):

> regex is allowed when there is no previous token, or the previous token is `op`, `comma`, `dot`, `lparen`, `lbracket`, or `arrow`.

So after an operand (`number`, `ident`, `string`, `rparen`, `rbracket`, `true/false/null`, `regex`) a `/` is **division**.

- `10 / 2` → `/` is an `op` (division) — the `2` after `10` means a value just ended (`functions.test.ts`: `10 / 2 === 5`).
- `title.matches(/^hello/i)` → after `lparen`, `/` starts a regex; pattern `^hello`, flags `i`.

Regex scanning:
- reads to the closing unescaped `/`,
- `\` escapes the next char,
- `[ … ]` toggles a character-class context so a `/` inside `[…]` does not close the literal,
- a newline aborts the regex (`j = -1`), and the `/` falls through to be treated as a division op.
- Trailing flags are any run of lowercase `[a-z]` after the closing `/`.

The token carries `value` = the raw pattern source and `flags` = the flag string. (`{ kind: "regex", value: "^hello", flags: "i" }`.)

---

## 3. Parser — grammar & AST

`parseExpr(src)` builds an `Expr` (`ast.ts`). The grammar is a Pratt-style precedence-climbing parser. Top level tries a lambda first, then a binary expression.

```
parse        := lambda | binary(0)
binary(p)    := unary ( OP[prec≥p] binary(prec+1) )*      // left-associative
unary        := ('!' | '-') unary | postfix
postfix      := primary ( '.' ident | '(' args ')' | '[' binary(0) ']' )*
primary      := number | string | true | false | null | ident
              | regex | '(' (lambda-already-tried) binary(0) ')'
args         := ε | (lambda | binary(0)) ( ',' (lambda | binary(0)) )*
lambda       := ident '=>' binary(0)
              | '(' (ident (',' ident)*)? ')' '=>' binary(0)
```

### 3.1 AST node types (`ast.ts`)

```ts
type Expr =
  | { type: "num";    value: number }
  | { type: "str";    value: string }
  | { type: "bool";   value: boolean }
  | { type: "null" }
  | { type: "ident";  name: string }
  | { type: "member"; object: Expr; name: string }            // a.b
  | { type: "index";  object: Expr; index: Expr }             // a[b]
  | { type: "call";   callee: Expr; args: Expr[] }            // f(...) / a.b(...)
  | { type: "unary";  op: "!" | "-"; operand: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "lambda"; params: string[]; body: Expr }          // x => … / (a,b) => …
  | { type: "regex";  source: string; flags: string };
```

### 3.2 Primary expressions

`parsePrimary` consumes exactly one token:
- `number` → `{ type: "num", value }`
- `string` → `{ type: "str", value }`
- `true`/`false` → `{ type: "bool", value }`
- `null` → `{ type: "null" }`
- `ident` → `{ type: "ident", name }`
- `regex` → `{ type: "regex", source, flags }`
- `lparen` → grouping: parse a `binary(0)`, then require `rparen` (`(1 + 2) * 3`). Lambdas inside parens are detected *before* this path (§3.7), so here parens are pure grouping.
- Anything else throws `unexpected token: <kind>` (which `passesFilter` catches → `false`).

### 3.3 Member access — `.name`

Postfix `.ident` builds `{ type: "member", object, name }`.
- The thing after `.` **must** be an identifier or the parser throws `expected identifier after '.'`.
- Chains: `a.b.c` → `member(member(a,"b"),"c")`.
- Used for namespaces (`note.status`, `file.name`), object-field access (frontmatter that is itself an object), and the `length` pseudo-property of strings/arrays (§7.2).

### 3.4 Method call vs. global call — `(...)`

Postfix `( args )` builds `{ type: "call", callee, args }`.
- If `callee` is an `ident` → **global function** call: `callFunction(name, args, ctx)` (`max(1,5,3)`).
- If `callee` is a `member` → **method** call on the evaluated receiver: `callMethod(receiver, name, args, ctx)` (`price.toFixed(2)`, `file.hasTag("book")`).
- Any other callee throws `invalid call target` at eval time.

### 3.5 Argument lists — `args`

`parseArgs`:
- empty `()` → `[]`.
- otherwise a comma-separated list; **each argument slot may itself be a full lambda** (`.map(x => x.title)`), tried before falling back to `binary(0)`.
- a missing closer throws `unterminated argument list`; a stray token between args throws `expected ',' or ')'`.

### 3.6 Index access — `[...]`

Postfix `[ expr ]` builds `{ type: "index", object, index }`. The index is a full `binary(0)` expression, and a `]` is required (`expected ']'`).
- `tags[0]` → `index(ident("tags"), num(0))`.
- `file.tags[0]` → index into the resolved array.

### 3.7 Lambdas — `=>`

Two shapes, detected by `tryParseLambda` (called at the statement entry point and in each argument slot):
- **Bare**: `x => body` (single param).
- **Parenthesized**: `(a, b, …) => body`, including the **zero-param** `() => body`. Params must be bare identifiers separated by commas.

If the look-ahead does not form a lambda, the parser **rewinds** (`this.i = saved`) and the tokens are reparsed as a normal expression — so `(1 + 2) * 3` is not mistaken for a lambda. The body is a `binary(0)`.

```
x => x.title              -> lambda(["x"], member(ident x, "title"))
(acc, x) => acc + x.price -> lambda(["acc","x"], binary(+, …))
() => 1                   -> lambda([], num(1))
```

Lambdas are only meaningful as arguments to the array methods `.map`/`.filter`/`.reduce` (§7.4). A lambda evaluates to a real JS closure (§4.5).

---

## 4. Operators & precedence

### 4.1 Binary precedence table (`parser.ts` `BINARY_PRECEDENCE`)

Higher number binds tighter. All binary operators are **left-associative** (the parser recurses with `prec + 1`).

| Precedence | Operators        | Meaning                              |
|-----------:|------------------|--------------------------------------|
| 1          | `\|\|`           | logical OR (value-returning)         |
| 2          | `&&`             | logical AND (value-returning)        |
| 3          | `==`  `!=`       | loose equality / inequality          |
| 4          | `>` `<` `>=` `<=`| ordered comparison                   |
| 5          | `+` `-`          | add / concat / date-shift; subtract  |
| 6          | `*` `/` `%`      | multiply / divide / modulo           |

Examples (from `parser.test.ts` / `evaluate.test.ts`):
- `1 + 2 * 3` parses as `1 + (2 * 3)` and evaluates to `7`.
- `(1 + 2) * 3` → `9`.
- `a > 1 && b < 2` → `(a > 1) && (b < 2)` (top node is `&&`).
- `price > 5 && age < 1` → `false` for `{price:10, age:2}`.

### 4.2 Unary operators

`parseUnary` handles a prefix `!` or `-`, right-recursive (so `!!x` and `--x` nest):
- `!x` → `{ type: "unary", op: "!", operand }` — logical NOT of `truthy(operand)` (always a boolean).
- `-x` → `{ type: "unary", op: "-", operand }` — numeric negation of `toNumber(operand)`.

```
!done -> true   (done = false)
-age  -> -2     (age = 2)
```

Unary binds tighter than any binary operator but looser than postfix (`.`/`(...)`/`[...]`), so `-price.abs()` negates the result of the method call. To negate first, parenthesize: `(-price).abs()` (`functions.test.ts`).

### 4.3 `-` is contextual

A `-` is a **binary** subtraction when it follows an operand, and a **unary** negation otherwise — this is handled structurally by `parseUnary`/`parseBinary` (not the lexer; the lexer always emits `op "-"`).

### 4.4 Logical `&&` / `||` return operand VALUES (JS semantics)

`&&` and `||` short-circuit and return the **operand**, not a coerced boolean (`evaluate.ts` `evalBinary`):
- `&&`: if `truthy(left)` → evaluate & return `right`, else return `left` (unevaluated right).
- `||`: if `truthy(left)` → return `left` (unevaluated right), else evaluate & return `right`.

`truthy` coercion is defined in §8.1. Examples (`evaluate.test.ts`):
```
missing || "default"  -> "default"      (missing is falsey)
status  || "default"  -> "in-progress"  (truthy string passes through)
price   && "yes"      -> "yes"          (truthy number -> right)
done    && "yes"      -> false          (falsey -> left value, here `false`)
!!(missing || "default") -> true        (force a boolean if you need one)
```

In a **filter** position the final value is run through `truthy` at the boundary (`passesFilter`), so `missing || "default"` still works as a filter. But inside a `formula`, the raw operand value is stored — wrap with `!!(…)` if you need a strict boolean column.

### 4.5 Lambda evaluation

A `lambda` node evaluates to a real JS closure that:
- binds its params to the call arguments by position (extra args ignored, missing params are `undefined`),
- extends the current scope chain so **nested lambdas see outer params** and the body can reference outer frontmatter by bare name,
- exposes its declared arity via a hidden `__params` so `.reduce` can tell a 1-arg projection from a 2-arg reducer (§7.4).

```
items.map(x => x.title)              -> ["a","b","c"]
items.filter(x => x.price > 1).length -> 2
items.reduce((acc, x) => acc + x.price, 0) -> 6
items.filter(x => x <= cap)          -> [1,2]   (cap from outer frontmatter)
```

---

## 5. Identifiers & namespace resolution

`resolveIdent(name, ctx)` (`evaluate.ts`) resolves a bare identifier in this order:

1. **Lambda scope chain** — if `ctx.scope` is set, walk parent links; the first scope whose `bindings` has `name` wins. (This is how lambda params shadow everything else.)
2. **`file`** → `ctx.file` (the `FileMeta`).
3. **`note`** → `ctx.note` (the frontmatter object).
4. **`formula`** → `ctx.formula` (computed formula values for this row).
5. **`this`** → `ctx.this` (the embedding/host note's frontmatter, when a base is embedded; otherwise `undefined`).
6. **Default (bare name)** → `ctx.note[name]` — i.e. **a bare identifier is a frontmatter property**.

So these are equivalent for a frontmatter field `status`:
```
status        // bare → note.status
note.status   // explicit
```
and `price` (bare) === `note.price`. (`evaluate.test.ts`: `run("price") === 10`, `run("note.status") === "in-progress"`, `run("file.name") === "housing"`.)

### 5.1 The four namespaces

| Root      | Holds                                            | Example fields |
|-----------|--------------------------------------------------|----------------|
| `file`    | `FileMeta` of the row                            | `file.name`, `file.basename`, `file.path`, `file.folder`, `file.ext`, `file.size`, `file.ctime`, `file.mtime`, `file.tags` (string[]), `file.links` (string[]) |
| `note`    | the row's frontmatter (an object)                | any frontmatter key: `note.status`, `note.price` |
| `formula` | per-row results of the base's `formulas:` block  | `formula.ppu` |
| `this`    | host/embedding note's frontmatter (optional)     | `this.minPrice`, `this.markup`, `this.file` |

`file.*` fields come from `FileMeta` (`types.ts`): `name`/`basename` are the basename **without** extension; `path` is vault-relative; `folder` is `""` at root; `tags` have no leading `#`; `links` are wikilink targets with no `.md`, `#heading`, or `|alias`.

### 5.2 `this.*` — embedded/host context

When a base is embedded in a note (or rendered with a host), `this` is the host note's frontmatter. `this.file` is the host's `FileMeta`. Used in filters, formulas, and `groupBy` (`query.test.ts` "hostThis flows into filters / formulas / groupBy"):
```
filters: "price >= this.minPrice"
formulas: { adj: "price * this.markup" }
```
And `file.hasLink(this.file)` tests whether the current row links to the host note by basename (`evaluate.test.ts`).

### 5.3 Missing identifiers

A bare name not in frontmatter resolves to `undefined`. Member access on `null`/`undefined` returns `undefined` (never throws) — `note.missing → undefined`. This propagates into safe comparisons (§8).

---

## 6. Arithmetic, dates & durations

`+` is the most overloaded operator (`evalPlus`); `-` is `evalMinus`; `* / %` always coerce both sides via `toNumber`.

### 6.1 `+` dispatch order (`evalPlus`)

1. **Date/number + duration string** — if either side parses as a duration (`parseDurationMs`, including the zero duration `"0d" → 0`) and the other side is a `Date`, the result is a shifted `Date`; if the other side is a `number`, the result is `number + dur` (epoch-ms math). So `d + "1d"` adds one day; `file.mtime + "1d"` (mtime is epoch ms) stays numeric.
2. **Date + numeric ms** — `Date + number` (e.g. from `duration("7d")`) → shifted `Date`. This is why `today() + duration("7d")` works (`query.test.ts`).
3. **String concat** — if either side is a string (and no duration matched), concatenate via `asString` (`"a" + "b"`, `"p" + 1 → "p1"`).
4. **Numeric add** — otherwise `toNumber(l) + toNumber(r)`.

Edge case (regression-tested): `d + "0d"` must add the zero duration and stay a `Date` at the same instant — it does **not** fall through to string concat (`evaluate.test.ts`).

### 6.2 `-` dispatch (`evalMinus`)

1. **`Date`/`number` − duration string** — `parseDurationMs(r)` non-NaN → `Date - dur` (shifted Date) or `number - dur`.
2. **`Date` − numeric ms** → shifted `Date`.
3. Otherwise `toNumber(l) - toNumber(r)`.

```
d - "2h"      -> Date two hours earlier
d - "0d"      -> same instant
file.mtime - "1d" -> numeric (epoch ms)
```

### 6.3 Duration string grammar (`parseDurationMs`)

A duration **string** matches `^(-?\d+(?:\.\d+)?)(ms|mo|M|[smhdwy])$` (after `.trim()`). Anything else returns `NaN`.

| Suffix | Unit            | ms              |
|--------|-----------------|-----------------|
| `ms`   | milliseconds    | 1               |
| `s`    | seconds         | 1 000           |
| `m`    | **minutes**     | 60 000          |
| `h`    | hours           | 3 600 000       |
| `d`    | days            | 86 400 000      |
| `w`    | weeks           | 7 d             |
| `mo`   | months (≈30 d)  | 30 d            |
| `M`    | months (≈30 d)  | 30 d            |
| `y`    | years (≈365 d)  | 365 d           |

Notes:
- **`m` is minutes, `mo`/`M` is months** — a classic gotcha. `"30m"` is 30 minutes; `"1mo"` is ~30 days.
- Fractional and negative values allowed: `"1.5w"`, `"-2h"`.
- `duration("nonsense") → NaN`; `duration("0d") → 0`.
- The string must be the **whole** value — `"7days"` or `"7 d"` → NaN (the regex anchors `^…$`; whitespace is only trimmed at the ends).

### 6.4 `* / %`

Always numeric: `toNumber(l) <op> toNumber(r)`. Non-numeric operands coerce via `toNumber` (string→`Number`, bool→0/1, Date→epoch ms, else `NaN`). `10 / 2 → 5`. There is no integer division.

---

## 7. Member access, methods & functions in expressions

This section covers *how the grammar invokes* functions/methods; the full per-type catalogue lives in [functions reference](./functions.md) but is summarized here from `functions.ts`.

### 7.1 Global functions — `name(args)`

Called when the callee is a bare ident (`callFunction`):

| Function       | Behavior |
|----------------|----------|
| `if(cond, a, b?)` | `truthy(cond) ? a : (b ?? undefined)` — `if(price>5,"big","small")`; 2-arg form returns `undefined` when false (`functions.test.ts`). |
| `number(x)`    | `toNumber(x)` — `number("42") → 42`. |
| `list(...)`    | one array arg → that array; otherwise the args as an array — `list("x").length → 1`. |
| `min(...)` / `max(...)` | numeric min/max over `args.map(toNumber)` — `max(1,5,3) → 5`. |
| `now()`        | current `Date`. |
| `today()`      | current `Date` at local midnight (`setHours(0,0,0,0)`). |
| `date(x)`      | `x` if already a `Date`, else `new Date(asString(x))` — `date("2026-05-27")`, `date(due)`. |
| `duration(s)`  | `parseDurationMs(s)` → ms number (not a Date). Composes with `+` since `Date + number` shifts (§6.1). |
| `link(path, display?)` | a `Link` value `{ __link, path, display? }`. |
| `random()`     | `Math.random()`. |
| unknown name   | `undefined` (no throw). |

### 7.2 The `length` pseudo-member

`getMember` special-cases strings and arrays: `.length` returns the count (`title.length → 11`, `items.length → 3`, `file.tags.length → 2`). It is a **member access**, not a method call — `title.length` (no parens). For objects, `length` is just an ordinary key lookup.

### 7.3 Method dispatch by receiver type (`callMethod`)

The receiver type chooses the method table:
- An object that has both `path` and `tags` keys → **file methods** (`hasTag`, `hasLink`, `inFolder`, `hasProperty`, `asLink`).
- `number` → number methods (`toFixed`, `round`, `floor`, `ceil`, `abs`, `isEmpty`).
- `string` → string methods (`lower`, `upper`, `trim`, `title`, `contains`, `startsWith`, `endsWith`, `replace`, `slice`, `split`, `reverse`, `isEmpty`, `matches`).
- `Array` → array methods (`contains`, `join`, `unique`, `sort`, `reverse`, `slice`, `flat`, `isEmpty`, `map`, `filter`, `reduce`).
- `Date` → date methods (`format`, `date`, `isEmpty`, `plus`, `minus`).
- Any other / an unknown method → `undefined`.

Selected examples (`functions.test.ts`):
```
file.hasTag("logistics")   -> true
file.inFolder("reading")   -> true        // exact folder or "reading/..." prefix
file.hasLink("internship") -> true
file.hasProperty("price")  -> true        // own-property check on note frontmatter
price.toFixed(2)           -> "10.46"
price.round(1)             -> 10.5
title.lower()              -> "hello world"
title.contains("World")    -> true
items.join("-")            -> "b-a-a"
items.unique().length      -> 2
d.plus("1w")               -> Date + 7 days
d.minus("30m")             -> Date - 30 minutes
d.format("YYYY-MM-DD")     -> formatted string
```

`file.hasTag` / `inFolder` / `hasLink` accept multiple args and are `.some(...)` over them. `file.hasLink` accepts a name, a `FileMeta` (e.g. `this.file`), or a `Link`, all compared by **basename** (`linkName`). `file.asLink(text?)` builds a `Link` to the current file with optional display text (defaults to the file name).

### 7.4 Array `.map` / `.filter` / `.reduce` — lambda OR string-path forms

Both a real lambda and a **property-path string** are accepted as the iteratee (`compileItemAccessor`):
- A **function** (lambda) is used directly.
- A **string** is a property path on each item: `"title"`, or with an explicit placeholder `"_.title"`, `"it.title"`, `"$.title"`. Bare `"_"` / `"it"` / `"$"` return the item itself. Nested paths (`"a.b"`) walk into objects, short-circuiting to `undefined` on a null/undefined step.

```
items.map("title")            -> ["a","b","c"]      // object items
items.map("_.title")          -> ["a","b","c"]      // equivalent
items.filter("_.price").length -> 3                 // truthy of each price
items.reduce("price", 0)      -> 6                  // sum of the "price" path, seed 0
items.map(x => x.title)       -> ["a","b","c"]      // lambda form
items.reduce((acc, x) => acc + x.price, 0) -> 6     // 2-arg reducer
```

`.reduce` is dual-mode (`callArrayReduce`): a **≥2-arity** function (detected via the lambda's `__params`) runs the native `Array.reduce(fn, seed)`; otherwise the first arg is treated as a property path and the values are **summed** with a numeric seed (`args[1] ?? 0`).

### 7.5 String `.matches` and regex

`title.matches(pattern, flags?)` accepts either a **RegExp literal** or a string pattern (+ optional flags string):
```
title.matches("^Hello")      -> true
title.matches("^hello")      -> false
title.matches("^hello", "i") -> true
title.matches(/^hello/i)     -> true     // regex literal
title.matches("(")           -> false    // malformed → fail closed
```

---

## 8. Equality, comparison & coercion semantics

### 8.1 `truthy(v)` (`values.ts`)

Used by `!`, `&&`/`||`, `if`, `.filter`, and the filter boundary:
- `null`/`undefined` → `false`
- boolean → itself
- number → `v !== 0 && !NaN` (so `0` and `NaN` are falsey)
- string → `length > 0` (empty string falsey)
- array → `length > 0` (empty array falsey)
- `Date` → valid date (not `Invalid Date`)
- any other object → `true`

### 8.2 `looseEquals(a, b)` — `==` and `!=`

- two `Date`s → equal iff same `getTime()`.
- two `Link`s → equal iff same `path`.
- a `Link` vs. a non-link → matches if `link.path === other` **or** `link.display === other` (either side).
- otherwise strict JS `===`.

`!=` is the negation. Note there is **no numeric/string coercion** here (unlike JS `==`): `"10" == 10` is `false` because it falls through to `===`. Coerce explicitly with `number("10") == 10` when needed.

Examples (`evaluate.test.ts` / `filters.test.ts`):
```
status != "done"  -> true   (status = "in-progress")
status == "done"  -> false
price == 10 || age == 99 -> true
```

### 8.3 `compare(a, b)` — `<` `>` `<=` `>=`

Ordered comparisons go through `cmpSafe` → `compare`:
- If **either** operand is `null`/`undefined`, `cmpSafe` returns `NaN`, and every ordered comparison against `NaN` is `false`. So `missing > 5 → false` and `missing > 5 → false` (`evaluate.test.ts`: "missing numeric operand yields NaN-safe falsey comparison").
- two `Date`s → by `getTime()`.
- two numbers → numeric difference.
- one side null/undefined (inside `compare`, when not already caught) → null sorts first.
- otherwise → `String(a).localeCompare(String(b))` (locale string order).

This null-safety is why ordered filters never throw on missing fields — they just exclude the row.

### 8.4 `toNumber(v)` (coercion for arithmetic)

- number → itself
- string → `Number(v)` (or `NaN`)
- boolean → 1/0
- `Date` → epoch ms (`getTime()`)
- anything else → `NaN`

`NaN` then propagates: `NaN <op> x = NaN`, and `NaN` comparisons are false, keeping arithmetic on missing fields safe.

### 8.5 `asString(v)` (coercion for concat / string args)

- `null`/`undefined` → `""`
- `Date` → ISO string (`toISOString()`)
- `Link` → its `display ?? path`
- else → `String(v)`

---

## 9. Filters — where expressions become booleans

A `FilterNode` (`types.ts`) is one of:
```ts
type FilterNode =
  | string                       // an expression, coerced via truthy()
  | { and: FilterNode[] }
  | { or:  FilterNode[] }
  | { not: FilterNode[] };
```

`passesFilter(node, ctx)` (`filters.ts`):
- `undefined` → `true` (no filter passes everything).
- **string** → `truthy(evaluate(parseExpr(str), ctx))`, wrapped in try/catch → `false` on any throw (malformed expr fails closed).
- `{ and: [...] }` → every child passes.
- `{ or: [...] }` → some child passes.
- `{ not: [...] }` → every child **fails** (i.e. NOT of each, ANDed).

The base-level `filters:` is ANDed with each view's `filters:` (`combineFilters` / the query engine). Nesting is arbitrary (`parse.test.ts` "canonical obsidian example"):

```yaml
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
```

A `formula.*` reference works in a filter because formulas are computed before filtering (`filters.test.ts`: `formula.ppu > 5 → true`).

```
status != "done"            -> string leaf
{ and: [ 'file.hasTag("book")', { or: ["price > 5","price < 0"] } ] }
{ not: ['file.hasTag("movie")'] }  -> true when the row is NOT tagged movie
```

---

## 10. Formulas, sort & group expressions

### 10.1 Formulas

`formulas:` maps a name → an expression **string**. Each is evaluated per row and stored under `formula.<name>`, then referenceable as `formula.<name>` in columns, sort, group, summaries, and downstream formulas.

```yaml
formulas:
  ppu: "(price / age).toFixed(2)"        # -> "5.00" for price=20, age=4
  adj: "price * this.markup"             # uses host context
  urgency: 'if(!due, "No date", if(date(due) < today(), "Overdue", if(date(due) <= today() + "7d", "This week", "Later")))'
```

The `urgency` example (`query.test.ts`) shows nested `if`, the `date(...)` global, `today()`, and **date + duration-string** arithmetic in a real formula used by `groupBy`. Note the deliberate caveat in the test: `today() + "7d"` works, and `today() + duration("7d")` *also* works (since `duration()` returns ms and `Date + number` shifts) — both bucket identically.

### 10.2 Property identifiers in `order`/`sort`/`groupBy`

`order`, `sort.property`, and `groupBy.property` take a **property-id string**, not a full expression. The query engine canonicalizes a bare frontmatter name to `note.*` (`canonicalId`):
```
"price"       -> "note.price"
"note.price"  -> "note.price"
"file.name"   -> "file.name"
"formula.ppu" -> "formula.ppu"
```
So `order: [file.name, ppu]` resolves `ppu` to the formula only if you write `formula.ppu`; a bare `ppu` would resolve to `note.ppu`. Always namespace formula references explicitly. `groupBy` can also be a bare string in YAML (normalized to `{ property, direction: "ASC" }`, `parse.test.ts`).

---

## 11. Inline ` ```query ` block expressions

Inside a note, a ` ```query ` fenced block can carry a **flat spec** whose `where:` is a single Bases expression string and whose `sort:`/`group:` are property ids (`QueryBlock` in `types.ts`):

```ts
interface QueryBlock {
  source?: SourceSpec;   // from `of:` (a base) or `tasks:` (a task query); undefined → empty state
  as: ViewType;          // from `view:` (or legacy `as:`)
  where?: string;        // a Bases filter expression
  sort?: SortSpec[];
  group?: string;        // a property id
  limit?: number;
}
```

The `where:` value is the same expression grammar documented here (parsed by `parseExpr`, coerced by `truthy`). See [bases overview](./overview.md) for the full block-vs-base distinction and the `of:` / `tasks:` source forms.

---

## 12. Error handling & gotchas (cheat sheet)

- **Malformed expression → `false` in filters** (caught), `undefined` for a bad regex literal, `false` for `String.matches` on a bad pattern. Nothing throws into the query.
- **Parser throws** (then caught by the filter boundary) on: identifier missing after `.`, unterminated arg list, missing `,`/`)` between args, missing `]`, unexpected token, unexpected end of input.
- **`m` = minutes, `mo`/`M` = months.** `"30m"` ≠ 30 months.
- **`==`/`!=` are strict (no coercion):** `"10" == 10` is `false`. Use `number("10") == 10`.
- **`&&`/`||` return operand values, not booleans.** Wrap with `!!(…)` for a strict boolean column in a formula.
- **Bare names are frontmatter.** `price` ≡ `note.price`; `ppu` ≡ `note.ppu` (NOT `formula.ppu`). Namespace formulas explicitly.
- **`.length` has no parens** (it's a member): `title.length`, not `title.length()`.
- **`[ … ]` is index only** — there is no list literal in expressions; use `list(...)` or a frontmatter array.
- **`/` is regex at value position, division after an operand** (§2.9). `10 / 2` divides; `.matches(/^x/)` is a regex.
- **Ordered comparisons against missing/null are `false`** (NaN-safe), so missing fields silently exclude rows rather than erroring.
- **Number literals stop at the second `.`** — `1.2.3` is `1.2 . 3`, never `NaN`.
- **No exponent / leading-dot / signed number literals** — `1e3`, `.5`, `+5` are not number literals (the `-`/`+` are operators).
- **String escapes are literal-next-char only** — `\n` in a string literal is the letter `n`, not a newline.

---

Source: core/src/bases/lexer.ts, core/src/bases/parser.ts, core/src/bases/parse.ts, core/src/bases/ast.ts, core/src/bases/evaluate.ts, core/src/bases/functions.ts, core/src/bases/values.ts, core/src/bases/filters.ts, core/src/bases/types.ts, core/test/bases/lexer.test.ts, core/test/bases/parser.test.ts, core/test/bases/evaluate.test.ts, core/test/bases/functions.test.ts, core/test/bases/filters.test.ts, core/test/bases/parse.test.ts, core/test/bases/query.test.ts
