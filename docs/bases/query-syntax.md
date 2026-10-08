# Bases expression syntax

The Bases expression language is the small formula language behind filters, computed columns and conditions in a base. It reads properties, compares values, does arithmetic on numbers, strings and dates, and calls the functions and methods listed in [functions](./functions.md). This page is for anyone writing a `filters`, `formulas`, `where` or similar expression.

```yaml
filters: 'price > 5 && file.hasTag("book")'
formulas:
  ppu: "(price / age).toFixed(2)"
  urgency: 'if(!due, "No date", if(date(due) < today(), "Overdue", "Later"))'
```

## Where do expressions appear?

An expression is a string in these places:

| Place | Role |
|---|---|
| `filters:` | A leaf of the base's filter tree. See [filters](./filters.md). |
| `formulas:` | One computed value per row, read as `formula.<name>`. |
| `source: ... where` and `where:` | A filter on a source's rows. See [sources](./sources.md). |
| A query block's `where:` | A filter on the block's rows. See [the query block](./query-block.md). |
| A declared formula property's `expr` | The same as `formulas:`. See [properties](./properties.md). |

`order`, `sort` and `groupBy` take a property id such as `note.price` or `formula.ppu`, not an expression. A bare name there means `note.<name>`, so a formula must be written `formula.ppu`; a bare `ppu` reads `note.ppu`.

## What literals can I write?

| Literal | Examples | Notes |
|---|---|---|
| String | `"hi"`, `'hi'` | A backslash makes the next character literal, so `'a\'b'` is `a'b` and `\n` is the letter `n`, not a newline. |
| Number | `42`, `3.5` | Digits with at most one dot. No leading dot, no exponent, no sign: `-5` is a unary minus, and `1e3` reads as `1`. |
| Boolean and null | `true`, `false`, `null` | |
| Regex | `/^hello/i` | Only where a value is expected, such as an argument: `title.matches(/^hello/i)`. After an operand `/` is division. |

There is no list literal and no date literal. `[ ... ]` is only an index (`tags[0]`). Lists come from frontmatter, from `file.tags` and `file.links`, or from `list(...)`. Dates come from frontmatter, from `date("2026-05-27")`, or from `now()` and `today()`. A duration such as `"7d"` is an ordinary string that acts as a duration in date arithmetic.

## How are names resolved?

A name resolves in this order: a lambda parameter, then the roots `file`, `note`, `formula` and `this`, then a bare frontmatter key.

| Root | Holds | Examples |
|---|---|---|
| `file` | The row's file metadata | `file.name` (no extension), `file.path`, `file.folder`, `file.ext`, `file.size`, `file.ctime`, `file.mtime`, `file.tags`, `file.links` |
| `note` | The row's frontmatter | `note.status`, `note.price` |
| `formula` | The base's computed values for this row | `formula.ppu` |
| `this` | The embedding note's frontmatter, when the base is embedded; otherwise undefined | `this.minPrice`, `this.file` |

A bare name is a frontmatter key, so `status` and `note.status` are the same. A missing name is `undefined`, and member access on `undefined` or `null` also gives `undefined` without an error. `.length` on a string or list is a member, not a call: `title.length`.

## Which operators are there?

Binary operators are left-associative. Higher precedence binds tighter.

| Precedence | Operators | Meaning |
|---:|---|---|
| 1 | `\|\|` | Or; returns an operand |
| 2 | `&&` | And; returns an operand |
| 3 | `==` `!=` | Equality |
| 4 | `>` `<` `>=` `<=` | Ordered comparison |
| 5 | `+` `-` | Add or concatenate; subtract |
| 6 | `*` `/` `%` | Multiply, divide, remainder |

Prefix `!` and `-` bind tighter than any binary operator but looser than member access and calls, so `-price.abs()` negates the result of `price.abs()`. Write `(-price).abs()` to negate first. Parentheses group: `1 + 2 * 3` is 7 and `(1 + 2) * 3` is 9.

`&&` and `||` short-circuit and return an operand, not a boolean: `missing || "default"` is `"default"`, and `done && "yes"` is `false` when `done` is false. A filter tests the final value for truthiness, so this does not matter there. In a formula the raw operand is stored, so wrap with `!!( ... )` for a strict boolean column.

There are no `and`, `or` or `not` keyword operators and no assignment: a lone `=` is not valid. `*`, `/` and `%` always convert both sides to numbers; there is no integer division.

## How do dates and durations work?

`+` and `-` understand durations. A duration string is a number followed by a unit, matching `^(-?\d+(\.\d+)?)(ms|mo|M|[smhdwy])$`:

| Unit | Meaning |
|---|---|
| `ms`, `s` | milliseconds, seconds |
| `m` | minutes |
| `h`, `d`, `w` | hours, days, weeks |
| `mo` or `M` | months, treated as 30 days |
| `y` | years, treated as 365 days |

Lowercase `m` is minutes and `mo` or `M` is months, so `"30m"` is 30 minutes. A duration must be the whole string: `"7days"` and `"7 d"` are not durations. Fractions and negatives work (`"1.5w"`, `"-2h"`).

| Expression | Result |
|---|---|
| `today() + "7d"` | A date seven days from today's midnight. |
| `today() + duration("7d")` | The same: `duration()` returns milliseconds, and a date plus a number shifts the date. |
| `d - "2h"` | A date two hours earlier. |
| `d + "0d"` | The same instant, still a date. |
| `file.mtime + "1d"` | A number (epoch milliseconds) plus a day. |
| `"p" + 1` | The string `p1`, when neither side is a date, number or duration. |

`+` tries these in order: a duration with a date or number, a date plus a number of milliseconds, string concatenation when either side is a string, then numeric addition.

## How do equality and comparison work?

`==` and `!=` convert nothing. Two dates are equal when they are the same instant, two links when they have the same path, and a link equals a string that matches its path or display text. Everything else uses strict equality, so `"10" == 10` is false and `null == undefined` is false. Convert explicitly: `number("10") == 10`.

`>`, `<`, `>=` and `<=` compare dates by time, numbers numerically, and anything else as strings by locale order. If either side is missing the comparison is false, never an error, so a row missing the property drops out of an ordered filter. Comparing mismatched types falls back to strings, where `"10" > "9"` is false; keep both sides the same type or convert with `number()` or `date()`.

## How do I call functions and methods?

`name(args)` calls a global function such as `if`, `max` or `today`. `value.name(args)` calls a method chosen by the value's type: file, number, string, list or date. An unknown function, an unknown method, or a method on the wrong type returns `undefined` without an error. [Functions](./functions.md) lists every one.

`map`, `filter` and `reduce` take a lambda, `x => x.title` or `(acc, x) => acc + x.price`, which can read outer names. They also take a property path string, `items.map("title")`; `"_"`, `"it"` and `"$"` stand for the item itself and `"_.price"` for its field. `reduce` with a two-parameter lambda is a true reduce; otherwise it sums the projection, as `items.reduce("price", 0)`.

`title.matches(pattern, flags?)` takes a regex literal or a string pattern with an optional flags string. A malformed pattern returns false.

## What happens when an expression is wrong?

A broken expression never raises an error into a query. In a filter it counts as false for every row. A bad regex literal evaluates to `undefined`. The parser throws on a missing identifier after `.`, an unterminated argument list, a missing `]`, or an unexpected token, and the filter catches that.

The parser does not reject trailing tokens it cannot use. `!done and note.priority == "high"` parses as `!done` and drops the rest, which silently matches too many rows. Use `&&`.

| Mistake | Result |
|---|---|
| Bare `ppu` for a formula | Reads `note.ppu`. Write `formula.ppu`. |
| `title.length()` | Fails; `.length` has no parentheses. |
| `[1, 2]` | A parse error; use `list(1, 2)`. |
| `"30m"` meant as months | It is minutes; use `"1mo"`. |
| A missing property in `price > 5` | False, so the row is excluded. |

## How it works

An expression travels through three pure stages: `lex` in `core/src/bases/lexer.ts` produces tokens, `parseExpr` in `core/src/bases/parser.ts` produces an `Expr` tree (`core/src/bases/ast.ts`), and `evaluate` in `core/src/bases/evaluate.ts` produces a value against an `EvalContext`. `passesFilter` in `core/src/bases/filters.ts` wraps all three and applies `truthy`.

The lexer skips whitespace and recognises the two-character operators `==`, `!=`, `>=`, `<=`, `&&`, `||` before the one-character ones, and `=>` as an arrow token. A `/` starts a regex only when there is no previous token or the previous token is an operator, comma, dot, opening bracket or parenthesis, or arrow. A regex runs to the closing unescaped `/`, treats `[ ... ]` as a character class, and ends at a newline; the flags are the lowercase letters that follow. A number takes the first dot only, so `1.2.3` lexes as `1.2`, a dot and `3`.

The parser is a precedence-climbing parser over this grammar:

```
parse     := lambda | binary(0)
binary(p) := unary ( OP[prec >= p] binary(prec + 1) )*
unary     := ('!' | '-') unary | postfix
postfix   := primary ( '.' ident | '(' args ')' | '[' binary(0) ']' )*
primary   := number | string | true | false | null | ident | regex | '(' binary(0) ')'
args      := empty | (lambda | binary(0)) ( ',' (lambda | binary(0)) )*
lambda    := ident '=>' binary(0) | '(' (ident (',' ident)*)? ')' '=>' binary(0)
```

A call whose callee is an identifier is a global call (`callFunction`); a call whose callee is a member access is a method call on the evaluated receiver (`callMethod`). The parser tries a lambda first at the start of an expression and in each argument, and rewinds when the tokens are not a lambda, so `(1 + 2) * 3` is not mistaken for one.

A lambda evaluates to a JavaScript closure that extends the scope chain, so nested lambdas see outer parameters and the body can read frontmatter by bare name. Its declared parameter count is kept so `reduce` can tell a projection from a reducer. `truthy`, `looseEquals`, `compare`, `toNumber` and `asString` live in `core/src/bases/values.ts`; `parseDurationMs` and the method tables live in `core/src/bases/functions.ts`. `canonicalId` in `core/src/bases/query.ts` maps a bare property id to `note.*` for `order`, `sort`, `groupBy` and `summaries`.

Source: `core/src/bases/lexer.ts`, `core/src/bases/parser.ts`, `core/src/bases/ast.ts`, `core/src/bases/evaluate.ts`, `core/src/bases/functions.ts`, `core/src/bases/values.ts`, `core/src/bases/filters.ts`, `core/src/bases/query.ts`, `core/test/bases/lexer.test.ts`, `core/test/bases/parser.test.ts`, `core/test/bases/evaluate.test.ts`, `core/test/bases/functions.test.ts`
