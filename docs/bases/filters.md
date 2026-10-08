# Base filters

A filter decides which rows a base keeps. The base's `filters:` key holds one expression or an `and`/`or`/`not` tree of expressions, and a row stays when the result is true. This page is for anyone writing or debugging a filter; the expression language itself is in [expression syntax](./query-syntax.md) and the methods you can call in [functions](./functions.md).

```yaml
---
type: base
source: notes where file.hasTag("book")
filters:
  and:
    - 'status == "open" || status == "in-progress"'
    - 'price > 5'
    - not:
        - file.hasTag("archive")
view: table
---
```

## What shapes can a filter take?

A filter is a string, or a tree whose branches are `and`, `or` and `not` keys holding lists of filters. A string leaf is any [Bases expression](./query-syntax.md).

```yaml
# one expression
filters: 'status != "done"'

# every child must pass
filters:
  and:
    - 'file.hasTag("book")'
    - 'price > 5'

# at least one child must pass
filters:
  or:
    - 'status == "open"'
    - 'status == "in-progress"'

# every child must fail
filters:
  not:
    - 'file.hasTag("archive")'

# nested: book and (open or in-progress) and not archived
filters:
  and:
    - 'file.hasTag("book")'
    - or:
        - 'status == "open"'
        - 'status == "in-progress"'
    - not:
        - 'file.hasTag("archive")'
```

Within one string you can combine conditions with `&&`, `||` and `!`. The words `and`, `or` and `not` are not operators inside an expression; they work only as the tree keys above. `filters` is the base's only filter: a base has one view and the view has none of its own.

An empty or absent `filters` keeps every row. An empty `and: []` keeps every row and an empty `or: []` keeps none.

## What makes a row pass?

The result of a leaf is tested for truthiness. These values are false: `null`, `undefined`, `false`, `0`, `NaN`, an empty string, an empty list and an invalid date. Everything else is true, including negative numbers, non-empty strings and lists, valid dates and links.

So a bare property name is a presence test:

| Filter | Keeps rows where |
|---|---|
| `status` | `status` is non-empty. Rows with it missing, `""`, `0`, `false` or `[]` drop. |
| `tags` | the note has at least one tag. |
| `"!status"` | `status` is absent or empty. |
| `file.hasProperty("due")` | the `due` key exists, even when its value is empty or false. |

`not` passes only when every child fails. With one child that is plain negation; with several, `not: [A, B]` keeps a row only when neither A nor B matches.

## What can a filter read?

A filter sees one row at a time:

| Name | Holds |
|---|---|
| `file.name`, `file.path`, `file.folder`, `file.tags`, `file.links`, `file.size`, `file.ctime`, `file.mtime` | File metadata. `name` has no extension, `path` is vault-relative, `folder` is empty at the root, `tags` have no `#`. |
| `note.<key>` or a bare `<key>` | A frontmatter value. |
| `formula.<name>` | A value from the base's `formulas`, computed before filtering, so a filter can use it. |
| `this.<key>`, `this.file` | The frontmatter and file of the note that embeds the base; see [embedded bases](#how-does-a-filter-use-the-note-it-is-embedded-in). |

The methods used most often in filters are `file.hasTag("book")` (any of several tags), `file.hasLink("Other")`, `file.inFolder("reading")` (including subfolders) and `file.hasProperty("price")`. String, list and date methods work too; see [functions](./functions.md).

Date filters use `date(x)`, `today()` and duration strings:

```yaml
# overdue
filters: 'date(due) < today()'

# due within the next week
filters: 'date(due) <= today() + "7d"'

# has a due date and it is overdue
filters:
  and:
    - 'file.hasProperty("due")'
    - 'date(due) < today()'
```

In a time zone behind UTC, `date(due) < today()` is also true on the due day, because `date()` reads a date-only string as midnight UTC. See [why is my date a day off](./functions.md#why-is-my-date-a-day-off).

## What happens to a filter that is wrong?

A filter that fails never raises an error. It drops the row, so you see fewer rows, not a message.

- A leaf that fails to parse or throws counts as false for every row, so the base shows no rows. `bismuth base validate` reports unparseable filters and formulas.
- An ordered comparison (`>`, `<`, `>=`, `<=`) with a missing value is false, so rows without that property drop out.
- `==` does not convert types: `"10" == 10` is false. Align types first with `number()` or `date()`. Ordered comparison across mismatched types falls back to comparing strings, where `"10" > "9"` is false.
- A typo in a formula name reads as `undefined`, which is false.
- The expression parser ignores trailing tokens it does not understand. `!note.resolved and note.priority == "high"` parses as `!note.resolved` and silently drops the rest. Use `&&`.

### Why did my filter lose its tail?

A `#` after a space starts a YAML comment, even inside what looks like a quoted string, unless the whole value starts with a quote:

```yaml
filters: tags.contains(" #book")     # parsed as: tags.contains("
filters: tags.contains("#book")      # fine: no space before the #
filters: 'tags.contains(" #book")'   # fine: the whole value is quoted
```

The truncated filter still parses, into something else, with no error. It affects every unquoted scalar in a filter, including bare items inside an `and`/`or`/`not` list. Quote the whole value. `bismuth base validate` finds these, names the key and line, and prints a quoted replacement.

## Where else do filters appear?

A source's `where:` is a single string, not a tree, and uses the same expressions: `source: notes where file.hasTag("book") && price > 5`. Combine conditions there with `&&` and `||`. A source `where` has no embedding note, so `this.*` is undefined in it. See [sources](./sources.md).

A flat query block's `where:` is also one expression string; see [the query block](./query-block.md).

A base that composes another with `source: base` does not receive the other base's `filters`, so restate them; see [bases overview](./overview.md#how-do-i-show-the-same-rows-in-a-second-view).

## How does a filter use the note it is embedded in?

When a base is embedded in a note through a query block, the host note's frontmatter is `this.*`, and `this.file` is the host's file. A standalone base file has no host, so `this.minPrice` is undefined and a filter on it drops every row.

```yaml
formulas:
  adj: 'price * this.markup'
filters: 'price >= this.minPrice'
view: table
order: [file.name, formula.adj]
```

With a host whose frontmatter is `minPrice: 10` and `markup: 2`, only rows priced 10 or more remain, and `adj` doubles the price. `file.hasLink(this.file)` keeps the rows that link back to the host note.

## Can I edit filters without writing YAML?

Open **Settings** in the view bar and use the **filters** section. It edits the base's `filters:` and, with the same editor, a notes or tasks source's `where:`. Each is a list of conditions under one **match all / any** switch.

- A condition is a property, an operator and a value. The operators follow the property's type: text, number, date, checkbox, tag or list.
- An expression row holds any Bases expression as written. "Edit as expression" turns a condition into one.
- Nothing is lost on save. An untouched editor writes nothing, and a row you did not edit is written back exactly as it was. A nested `or:` or `not:`, or a top-level `not:`, shows as one expression row and is saved as the same subtree. A leaf becomes a visual condition only when recompiling it reproduces its exact text (`done == true` stays an expression because the builder writes `done == "true"`). A condition with no value yet is skipped.
- One condition is written as a bare string, several as `{and: [...]}` or `{or: [...]}`, none removes the key. A source `where` joins its rows as `(a) && (b)`.

## How it works

`passesFilter(node, ctx)` in `core/src/bases/filters.ts` is the whole engine: no node passes; a string runs `parseExpr` then `evaluate` then `truthy` inside a try/catch that returns false; `and` uses `every`, `or` uses `some`, and `not` uses `every` over the negated children. Parsed expressions are cached by string. `combineFilters(a, b)` ANDs two filters; the reader uses it when a `views:` entry carries its own `filters`.

`runView` in `core/src/bases/query.ts` computes `formula.*` for every row first, then applies `base.filters`, then sorts and groups. `toContext(row, hostThis)` builds the evaluation context; the base filter receives `hostThis`, a source `where` does not.

`resolveSource` in `core/src/bases/source.ts` applies a source `where` with the same `passesFilter`. A tasks `where` that looks like Tasks-style text is translated by `translateTaskDsl` first.

`findCommentTruncations` in `core/src/bases/yamlComment.ts` finds the YAML-comment trap by walking the parsed YAML document: for each plain (unquoted) scalar it checks whether the text after where the parser stopped, up to the end of the line, starts with whitespace then `#`. The reported key is the nearest enclosing key, so a bare item in an `and` list reports `and`, not `filters`. `bismuth base validate` (`cli/src/commands/base.ts`) runs it against the raw frontmatter text, before parsing discards the dropped half.

The settings editor is `app/src/bases/BaseSettings.tsx` with its form logic in `filterForm.ts`; conditions compile to the same leaves the query builder emits (`queryGen.ts`'s `compileNotesRow`).

Source: `core/src/bases/filters.ts`, `core/src/bases/evaluate.ts`, `core/src/bases/values.ts`, `core/src/bases/query.ts`, `core/src/bases/source.ts`, `core/src/bases/yamlComment.ts`, `core/src/bases/types.ts`, `cli/src/commands/base.ts`, `app/src/bases/filterForm.ts`, `app/src/bases/BaseSettings.tsx`, `core/test/bases/filters.test.ts`, `core/test/bases/yamlComment.test.ts`
