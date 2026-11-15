# Bases functions and methods

Every built-in function and method in the Bases expression language, for use in `formulas`, `filters`, `where` clauses and query blocks. Global functions are called by name (`max(1, 5)`), and methods are called on a value whose type picks the method table (`title.lower()`). The grammar they sit in is in [expression syntax](./query-syntax.md).

```yaml
formulas:
  overdue: 'date(due) < today()'
  label: 'title.lower().replace(" ", "-")'
  total: 'items.reduce("price", 0).round(2)'
```

An unknown function, an unknown method, or a method on the wrong type returns `undefined` without an error, so a typo yields an empty cell, not a message.

## Which global functions are there?

| Function | Returns | Behaviour |
|---|---|---|
| `if(cond, then, else?)` | the chosen value | `then` when `cond` is truthy; otherwise `else`, or `undefined` when omitted. |
| `number(v)` | number | Converts: `"42"` gives 42, `true` gives 1, `"abc"` gives `NaN`. |
| `list(...args)` | list | One list argument is returned as is; otherwise the arguments are wrapped. |
| `min(...args)`, `max(...args)` | number | Minimum or maximum after converting each argument to a number. |
| `now()` | date | The current date and time. |
| `today()` | date | The current date at local midnight. |
| `date(v)` | date | A date stays as is; anything else is parsed from its text. |
| `duration(s)` | number | A duration string in milliseconds, or `NaN` when it is not one. |
| `link(path, display?)` | link | A link value to a note. |
| `random()` | number | A number from 0 up to, not including, 1. |

Nested `if` gives a bucket formula:

```text
if(!due, "No date",
  if(date(due) < today(), "Overdue",
    if(date(due) <= today() + "7d", "This week", "Later")))
```

`duration("7d")` returns milliseconds, not a date. Add it to a date to shift the date: `today() + duration("7d")` and `today() + "7d"` are the same.

### Why is my date a day off?

`date("2026-10-07")` parses a date-only string as midnight UTC, while `today()` is local midnight and `format` reads local time. In a time zone behind UTC, `date("2026-10-07") < today()` is true on 7 October itself, and `date("2026-10-07").format("YYYY-MM-DD")` is `2026-10-06`. Add a time to read the string as local: `date(due + "T00:00:00") < today()` is false on the due day.

## Which file methods are there?

The receiver is a file's metadata: `file`, or `this.file` for the note embedding the base.

| Method | Returns | Behaviour |
|---|---|---|
| `file.hasTag(...names)` | boolean | True when any name is in `file.tags` (tags have no `#`). |
| `file.hasLink(...targets)` | boolean | True when any target is in `file.links`. A target can be a name, a link or a file; all compare by base name. |
| `file.inFolder(folder)` | boolean | True when `file.folder` equals `folder` or sits below it. |
| `file.hasProperty(name)` | boolean | True when the frontmatter has `name` as its own key. |
| `file.asLink(display?)` | link | A link to this file; the display text defaults to the file name. |
| `file.asFile()` | file | The file itself. |

```text
file.hasTag("a", "b")           // true if either tag is present
file.hasLink(this.file)         // true when this note links to the embedding note
file.inFolder("reading")        // true for reading and reading/quotes
file.asLink()                   // a link to this file, showing its name
```

## Read the notes that link to a file, and what it embeds

`file.backlinks` lists the names of the notes that link to or embed the file, sorted by path, each note once. `file.embeds` lists the targets of the file's `![[...]]` embeds as written, without a `|size` or `#heading`. Both are lists, so list methods apply:

```yaml
formulas:
  backlinkCount: 'file.backlinks.length'
  cover: 'if(file.embeds[0].containsAny("jpg", "png", "webp"), file.embeds[0])'
```

`file.backlinks` counts every note in the vault, including notes a base's filters leave out, and resolves links the way the graph does: an exact path wins, then the shallowest note with that name. A `[[link]]` in frontmatter counts as a link. A task row or a row stored in a base has empty lists.

`file.properties` is the file's frontmatter, so `file.properties.status` and `status` read the same value.

## Get the file a link names with asFile()

`asFile()` called on a link, or on link text such as a frontmatter value `"[[Restaurants]]"`, returns that note's file metadata with its frontmatter under `properties`. It returns `null` when no row of the base is that note.

```yaml
formulas:
  icon: 'list(type)[0].asFile().properties.icon'
  typeFolder: 'link("Restaurants").asFile().folder'
```

`asFile()` finds the note among the rows the base reads. A base with no `source:` reads every note, so any note is found; a base whose `source:` narrows its rows finds only those rows.

## Which methods does every value have?

| Method | Returns | Behaviour |
|---|---|---|
| `v.toString()` | string | The value as text; an empty property gives `""`. |
| `v.isTruthy()` | boolean | False for an empty value, `false`, `0` or an empty list; true otherwise. |

## Which number methods are there?

| Method | Returns | Behaviour |
|---|---|---|
| `n.toFixed(digits?)` | string | Fixed decimals; `digits` defaults to 0. A string, so you cannot do further arithmetic on it. |
| `n.round(decimals?)` | number | Rounds to `decimals` places, default 0. |
| `n.floor()`, `n.ceil()`, `n.abs()` | number | Round down, round up, absolute value. |
| `n.isEmpty()` | boolean | Always false. |

Use `round(2)` instead of `toFixed(2)` when the result feeds more arithmetic. `(price / age).toFixed(2)` is the usual display formula.

## Which string methods are there?

| Method | Returns | Behaviour |
|---|---|---|
| `s.lower()`, `s.upper()` | string | Change case. |
| `s.trim()` | string | Strip surrounding whitespace. |
| `s.title()` | string | Capitalise each word. |
| `s.contains(sub)` | boolean | Substring test. |
| `s.containsAny(a, b, …)`, `s.containsAll(a, b, …)` | boolean | True when the string holds any, or every, of the arguments. |
| `s.startsWith(p)`, `s.endsWith(p)` | boolean | Prefix and suffix tests. |
| `s.replace(find, repl)` | string | Replaces every occurrence. Plain text, not a regex. |
| `s.slice(start, end?)` | string | A substring. |
| `s.split(sep)` | list | Splits on the separator. |
| `s.reverse()` | string | Reverses the characters. |
| `s.isEmpty()` | boolean | True for the empty string. |
| `s.matches(pattern, flags?)` | boolean | Regex test with a regex literal or a string pattern. A malformed pattern gives false. |

```text
title.title()                 // "Hello World"
"a,b,c".replace(",", ";")     // "a;b;c"
title.matches("^hello", "i")  // true; flags go in the second argument
title.matches(/^hello/i)      // true; or use a regex literal
title.length                  // 11; a member, no parentheses
```

## Which list methods are there?

| Method | Returns | Behaviour |
|---|---|---|
| `a.contains(x)` | boolean | True when an element equals `x` or has the same text. A link-valued element such as `"[[People]]"` equals `link("People")`, and inside an embedded base it equals `this` on the People note. |
| `a.containsAny(x, y, …)`, `a.containsAll(x, y, …)` | boolean | True when the list holds any, or every, of the arguments, compared as `contains` does. |
| `a.join(sep?)` | string | Joins the elements; the separator defaults to `", "`. |
| `a.unique()` | list | Removes duplicates. |
| `a.sort()` | list | A sorted copy using default text order, so numbers sort as text. |
| `a.reverse()` | list | A reversed copy. |
| `a.slice(start, end?)` | list | A sub-list. |
| `a.flat()` | list | Flattens one level. |
| `a.isEmpty()` | boolean | True for an empty list. |
| `a.map(f)`, `a.filter(f)` | list | Projects or keeps elements with a lambda, an expression on `value` and `index`, or a property path. |
| `a.reduce(f, seed?)` | any | A true reduce with a two-parameter lambda or an expression on `acc` and `value`; otherwise sums a projection. |

`sort` and `reverse` leave the original untouched. A layout's `sort:` key, by contrast, orders numbers numerically and dates chronologically.

`map`, `filter` and `reduce` take a lambda, an expression that names the item as `value` (and its position as `index`, the running total as `acc`), as Obsidian writes them, or a property path:

```text
items.map(x => x.title)                      // ["a", "b", "c"]
items.filter(x => x.price > 1).length        // 2
items.reduce((acc, x) => acc + x.price, 0)   // 6
items.filter(value.price > 1).length         // 2, the same filter written the Obsidian way
items.reduce(acc + value.price, 0)           // 6
items.map("title")                           // the same projection as a path string
items.filter("_.price")                      // keeps items whose price is truthy
items.reduce("price", 0)                     // sums each item's price
```

In a path string, `_`, `it` and `$` stand for the item, and a prefix such as `_.` is stripped. Dotted paths reach into nested objects and give `undefined` on a missing step.

## Which date methods are there?

| Method | Returns | Behaviour |
|---|---|---|
| `d.format(fmt)` | string | Formats with the tokens below. An empty `fmt` gives the UTC date as `YYYY-MM-DD`. |
| `d.date()` | date | The same day at local midnight. |
| `d.isEmpty()` | boolean | True for an invalid date. |
| `d.plus(duration)`, `d.minus(duration)` | date | Shifts by a duration string. An invalid duration shifts by zero. |

`format` replaces these tokens, in local time and zero-padded: `YYYY` year, `MM` month, `DD` day, `HH` hours, `mm` minutes, `ss` seconds. `MM` is months and `mm` is minutes; there are no other tokens, and no day or month names.

```text
now().format("YYYY-MM-DD HH:mm")   // "2026-06-08 14:30"
date("bad").isEmpty()              // true
d.plus("1w")                       // seven days later
d.minus("30m")                     // thirty minutes earlier
```

Duration strings and the `+` and `-` rules for dates are in [expression syntax](./query-syntax.md#how-do-dates-and-durations-work).

## Which summaries can a layout show?

A layout's `summaries:` map asks for a footer aggregate over a column. These are separate from the per-row functions above. The value is computed over the filtered rows before `limit` and shown as text.

```yaml
view: table
summaries:
  note.price: Sum
```

| Name | Result |
|---|---|
| `Sum` | Sum of the numeric values; non-numbers are skipped. |
| `Average` | Mean of the numeric values; empty when there are none. |
| `Min`, `Max` | Smallest or largest numeric value; empty when there are none. |
| `Count` | Number of rows. |
| `Empty` | Rows where the value is missing or `""`. |
| `Filled` | Rows where the value is present and not `""`. |
| `Unique` | Number of distinct values. |

The property id is normalised, so `price` and `note.price` name the same column. A summary name outside this list produces an empty footer cell without an error.

## How it works

`callFunction(name, args, ctx)` and `callMethod(receiver, name, args, ctx)` in `core/src/bases/functions.ts` are the two dispatch surfaces that `evaluate` calls. `callMethod` picks the table from the receiver: an object with `path` and `tags` is a file, then number, string, list, date. `callArrayReduce` chooses between the true-reduce and the summing mode by the callback's declared parameter count, and `compileItemAccessor` compiles a property-path string. `evaluate` turns a `map`, `filter` or `reduce` argument that names `value`, `index` or `acc` into a lambda over those names (`implicitLambda`), and reads `file.properties`, `file.backlinks` and `file.embeds` on the row's own file.

`file.embeds` comes from `extractEmbeds` (`core/src/embeds.ts`) when a note is parsed. `fillBacklinks` (`core/src/bases/fileLinks.ts`) sets every vault row's `file.backlinks` after the rows feed is built and after each incremental patch, resolving targets like `resolveLinkTarget` in `core/src/vault.ts`. `runView` builds a `fileLookup` over the rows it is given for `asFile()`, and takes the host note's `this.file` from its row there when the host is one of them. `parseDurationMs` holds the duration grammar.

Conversion helpers are in `core/src/bases/values.ts`: `truthy` (the rule is in [filters](./filters.md#what-makes-a-row-pass)), `toNumber`, `asString` (null becomes `""`, a date becomes its ISO text, a link becomes its display text or path), `looseEquals` and `compare`. A link value is `{ __link: true, path, display? }`. `summarize(name, values)` in `core/src/bases/query.ts` computes the summaries.

Source: `core/src/bases/functions.ts`, `core/src/bases/values.ts`, `core/src/bases/query.ts`, `core/src/bases/evaluate.ts`, `core/src/bases/fileLinks.ts`, `core/src/embeds.ts`, `core/src/basesData.ts`, `core/test/bases/functions.test.ts`, `core/test/bases/query.test.ts`
