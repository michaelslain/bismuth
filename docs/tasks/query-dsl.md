# Tasks Query DSL

This document is the exhaustive reference for the **tasks query DSL** implemented by `core/src/tasks-query.ts` (`runTaskQuery`). It is a small, pure, synchronous evaluator for a **bounded subset** of the [Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) query language. Given the full list of extracted `Task`s, a multi-line query string, and "today's" ISO date, it returns the filtered + sorted tasks plus a list of human-readable errors for unrecognized filter lines. Every filter keyword, date expression, sort key, boolean operator, and the exact error/ignore behavior is documented below, with copy-pasteable examples drawn directly from `core/test/tasks-query.test.ts`.

> Where this DSL is used: tasks are a **base source** in Bismuth (`source: tasks`), and a focused task list is rendered via a ` ```query ` block with `tasks: <dsl>`. See the [bases overview](../bases/overview.md) and the [tasks overview](./syntax.md) for how a query string reaches `runTaskQuery`. The DSL itself (this file) is independent of how the query is surfaced.

## Entry point and signature

```ts
runTaskQuery(allTasks: Task[], query: string, today: string): QueryOutcome
```

```ts
interface QueryOutcome {
  tasks: Task[];   // filtered + sorted
  errors: string[]; // one message per unrecognized line / parse problem
}
```

- `allTasks` — every `Task` to consider (already extracted by `core/src/tasks.ts`).
- `query` — the query text. **Each line is one instruction** (see [Line model](#line-model-and-evaluation-order)).
- `today` — an ISO date string `YYYY-MM-DD`. ALL relative date keywords (`today`, `tomorrow`, `in N days`, …) resolve against this value. The tests pass `TODAY = "2026-05-27"`. The caller supplies this; the DSL never reads the system clock.

It is **pure and synchronous**: no I/O, no mutation of the input array (sorting copies via `[...tasks].sort(...)`).

## The `Task` shape (what filters read)

Filters and sorters read these fields of `Task` (from `core/src/tasks.ts`):

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"todo" \| "done" \| "in-progress" \| "cancelled" \| "other"` | drives `done`/`not done`/`is cancelled` |
| `statusChar` | `string` | the raw char between `[ ]` (not used by the DSL directly) |
| `description` | `string` | task text, signifiers stripped, tags kept; sortable |
| `priority` | `"highest" \| "high" \| "medium" \| "low" \| "lowest" \| "none"` | default `"none"`; sortable, filterable |
| `tags` | `string[]` | parsed `#tags` without `#` (the DSL has **no** tag filter) |
| `due` | `string?` | 📅 `YYYY-MM-DD` |
| `scheduled` | `string?` | ⏳ `YYYY-MM-DD` |
| `start` | `string?` | 🛫 `YYYY-MM-DD` |
| `done` | `string?` | ✅ `YYYY-MM-DD` |
| `created` | `string?` | ➕ `YYYY-MM-DD` |
| `cancelled` | `string?` | ❌ `YYYY-MM-DD` |
| `recurrence` | `string?` | 🔁 text; presence drives `is recurring` |

The six date fields the DSL understands are exactly: **`due`, `scheduled`, `start`, `done`, `created`, `cancelled`** (`DATE_FIELDS`). No other field name is a valid date filter or sort key.

## Line model and evaluation order

`runTaskQuery` splits the query on `\r?\n` and processes each line independently:

1. **Blank / comment lines are skipped.** A line is skipped if, after `trim()`, it is empty OR starts with `#`.
   ```text
   # this is a comment line and is ignored
   not done

   priority is high
   ```
2. **`sort by …` lines** are parsed into sorters (see [Sorting](#sorting)).
3. **Recognized-but-unsupported instructions** matching `IGNORED_INSTRUCTION` are silently dropped (see [Ignored instructions](#recognized-but-unsupported-instructions-silently-ignored)).
4. **Everything else is a filter line** — tokenized and parsed as a boolean expression (see [Filters](#filters) and [Boolean expressions](#boolean-expressions-and-or-parentheses)).

After all lines are read:

- A task is kept only if it passes **every** filter line (`filters.every(f => f(t))`). Multiple filter lines are therefore **ANDed together** (see example below).
- If any `sort by` lines exist, the kept tasks are sorted by them in order (first sorter is primary, later ones are tie-breakers).

### Multiple filter lines are ANDed

```text
not done
priority is high
```
Only tasks that are both not done AND high priority survive.

From the tests:
```ts
const q = "not done\npriority is high";
// tasks: {todo,high "keep"}, {done,high "drop-done"}, {todo,low "drop-low"}
runTaskQuery(tasks, q, TODAY).tasks.map(t => t.description); // ["keep"]
```

## Filters

A filter line, after tokenizing, becomes a boolean expression of **leaf** filters. Each leaf is matched **case-insensitively** (the whole leaf is `trim().toLowerCase()`'d before matching). Below is every leaf the DSL recognizes.

### Status filters

| Leaf | Matches |
| --- | --- |
| `done` | `status === "done"` **OR** `status === "cancelled"` |
| `not done` | `status !== "done"` **AND** `status !== "cancelled"` |
| `is cancelled` | `status === "cancelled"` |
| `is not cancelled` | `status !== "cancelled"` |

Key gotcha: **`done` includes cancelled tasks, and `not done` excludes them.** Cancelled is treated as a closed (non-actionable) state, not as a separate "incomplete" state.

```ts
// not done excludes cancelled
const tasks = [
  task({ status: "todo", description: "todo" }),
  task({ status: "in-progress", description: "wip" }),
  task({ status: "cancelled", description: "cancelled" }),
  task({ status: "done", description: "done" }),
];
runTaskQuery(tasks, "not done", TODAY).tasks.map(t => t.description).sort();
// ["todo", "wip"]   (cancelled + done both excluded; in-progress kept)
```

```ts
// done matches BOTH completed and cancelled
runTaskQuery(tasks, "done", TODAY).tasks.map(t => t.description).sort();
// ["cancelled", "done"]
```

```ts
// is cancelled / is not cancelled
const t2 = [task({ status: "cancelled", description: "c" }), task({ status: "todo", description: "t" })];
runTaskQuery(t2, "is cancelled", TODAY).tasks.map(t => t.description);      // ["c"]
runTaskQuery(t2, "is not cancelled", TODAY).tasks.map(t => t.description);  // ["t"]
```

Note: `in-progress` and `other` statuses are kept by `not done` (they are neither `done` nor `cancelled`).

### Recurrence filters

Pattern: `is( not)? recurring`. Tests `recurrence` for truthiness.

| Leaf | Matches |
| --- | --- |
| `is recurring` | `recurrence` is present (truthy) |
| `is not recurring` | `recurrence` is absent |

```ts
const tasks = [task({ recurrence: "every day", description: "r" }), task({ description: "n" })];
runTaskQuery(tasks, "is recurring", TODAY).tasks.map(t => t.description);     // ["r"]
runTaskQuery(tasks, "is not recurring", TODAY).tasks.map(t => t.description); // ["n"]
```

Implementation detail: the predicate is `(t) => !!t.recurrence === !m[1]`, where `m[1]` is the optional `" not"` group. So `is recurring` ⇒ require truthy; `is not recurring` ⇒ require falsy.

### Priority filters

Pattern: `priority is( not)? (highest|high|medium|low|lowest|none)`. Exact equality against `t.priority`.

| Leaf | Matches |
| --- | --- |
| `priority is high` (or `highest`/`medium`/`low`/`lowest`/`none`) | `priority === target` |
| `priority is not high` (etc.) | `priority !== target` |

```ts
const tasks = [task({ priority: "high", description: "h" }), task({ priority: "low", description: "l" })];
runTaskQuery(tasks, "priority is high", TODAY).tasks.map(t => t.description);     // ["h"]
runTaskQuery(tasks, "priority is not high", TODAY).tasks.map(t => t.description); // ["l"]
```

Valid priority names (exactly these six): `highest`, `high`, `medium`, `low`, `lowest`, `none`. Any other word (e.g. `urgent`) makes the leaf unrecognized → an error (see [Error collection](#error-collection-and-resilience)). A task with no priority emoji defaults to `"none"`, so `priority is none` selects those.

### Date filters

Pattern: `(<field>)(?: (before|after))? (<date-expr>)` where `<field>` is one of `due|scheduled|start|done|created|cancelled` and `<date-expr>` is a [date expression](#date-expressions).

Three comparison modes:

| Form | Keeps task when… |
| --- | --- |
| `<field> <date>` (no operator → **on**) | `t[field] === resolved` |
| `<field> before <date>` | `t[field] < resolved` (string compare; ISO dates sort chronologically) |
| `<field> after <date>` | `t[field] > resolved` |

**Undated tasks are always excluded** by any date filter: if `t[field]` is missing/falsy, the predicate returns `false` (the task is dropped).

```ts
const tasks = [
  task({ due: "2026-05-20", description: "past" }),
  task({ due: "2026-05-27", description: "today" }),
  task({ due: "2026-06-10", description: "future" }),
  task({ description: "none" }), // no due → excluded by all due filters
];
runTaskQuery(tasks, "due before today", TODAY).tasks.map(t => t.description); // ["past"]
runTaskQuery(tasks, "due today", TODAY).tasks.map(t => t.description);        // ["today"]
runTaskQuery(tasks, "due after today", TODAY).tasks.map(t => t.description);  // ["future"]
```

Comparisons are **string comparisons** on ISO `YYYY-MM-DD` values, which is correct because that format sorts lexicographically in chronological order. There is no `on or before` / `on or after` form — only the three above. Boundary: `before` and `after` are strict (the exact `resolved` date is excluded from both; only `<field> <date>` matches it).

Examples for every date field:
```text
due today
scheduled before today
start after 2026-01-01
done today
created before in 30 days
cancelled after 2025-01-01
```
(`done today` is used to find tasks completed on `today`; `done` as a date field is distinct from the `done` **status** leaf — context disambiguates: `done` alone = status, `done <date-expr>` = date filter.)

## Date expressions

`resolveDateExpr(expr, today)` resolves a date-expression string (after `trim().toLowerCase()`) to an ISO date, or returns `null` (which makes the enclosing leaf unrecognized). The recognized forms are exactly:

| Expression | Resolves to | Notes |
| --- | --- | --- |
| `today` | `today` | the value passed to `runTaskQuery` |
| `tomorrow` | `addDaysISO(today, 1)` | today + 1 day |
| `yesterday` | `addDaysISO(today, -1)` | today − 1 day |
| `YYYY-MM-DD` | that literal date | must match `/^\d{4}-\d{2}-\d{2}$/` exactly |
| `in N days` / `in N day` | `addDaysISO(today, N)` | `N` is one or more digits; both `day` and `days` accepted |
| `N days ago` / `N day ago` | `addDaysISO(today, -N)` | both `day` and `days` accepted |
| anything else | `null` → leaf unrecognized | |

`addDaysISO(iso, n)` (from `core/src/dates.ts`) constructs `new Date(iso + "T00:00:00")`, adds `n` days, and re-serializes to ISO — i.e. local-time day arithmetic.

```ts
// relative date inside a before-comparison
const tasks = [
  task({ due: "2026-05-30", description: "within" }), // today=2026-05-27, +7 = 2026-06-03
  task({ due: "2026-06-15", description: "beyond" }),
];
runTaskQuery(tasks, "due before in 7 days", TODAY).tasks.map(t => t.description); // ["within"]
```

Notes / gotchas:
- The number in `in N days` / `N days ago` must be a non-negative integer (digits only). `in 7 days` works; `in seven days` does not (→ `null` → unrecognized).
- `in 1 day` and `in 1 days` both parse (the `s?` is optional). Same for `1 day ago` / `1 days ago`.
- There is **no** `next week`, `last week`, `start of month`, weekday names, etc. Only the forms in the table above.
- A bare numeric like `7 days` (without `in`/`ago`) is **not** recognized.

## Boolean expressions (AND / OR / parentheses)

Each filter line is tokenized then parsed as a boolean expression over leaf filters.

### Tokenizer

`tokenize(line)` walks the line char by char and emits tokens:
- `(` and `)` are punctuation tokens (and flush any accumulated leaf buffer first).
- `AND` / `OR` are operator tokens — matched **case-insensitively** (`/^(AND|OR)\b/i`) but **only at a word boundary where the buffer is empty or ends in whitespace**. This means an operator must be surrounded by spaces/parens to be treated as an operator; otherwise it is folded into the leaf text. E.g. `priority is high` keeps "high" intact, and a leaf like `brand` would not have its `and` mis-parsed because the preceding char is not whitespace.
- Everything else accumulates into a `leaf` buffer; the buffer is `trim()`'d and emitted as a leaf when a delimiter is hit.

### Grammar / precedence

`parseBool` implements a recursive-descent parser:
- `Expr := Term (OR Term)*`
- `Term := Factor (AND Factor)*`
- `Factor := "(" Expr ")" | leaf`

So **AND binds tighter than OR** (standard precedence), and parentheses override. A single leaf with no operators is a valid expression.

```ts
const tasks = [
  task({ priority: "high", description: "h" }),
  task({ due: "2026-05-20", description: "due" }),
  task({ description: "neither" }),
];

// OR
runTaskQuery(tasks, "(priority is high) OR (due before today)", TODAY)
  .tasks.map(t => t.description).sort();   // ["due", "h"]

// AND (no task is both high priority and overdue → empty)
runTaskQuery(tasks, "(priority is high) AND (due before today)", TODAY).tasks; // []
```

Parentheses can be nested arbitrarily. From the "real query" test (a deeply nested condition on one line):
```text
((due before today) OR (due today) OR ((due after today) AND (due before in 7 days)) OR (priority is high) OR (scheduled today) OR (scheduled before today))
```

### Multi-line AND vs in-line operators

Remember: each **line** is a separate filter, and lines are ANDed by `runTaskQuery`. So these two queries are equivalent:
```text
not done
priority is high
```
```text
(not done) AND (priority is high)
```
But to express OR you must use the `OR` operator (and usually parentheses) on a **single line** — separate lines cannot OR.

## Sorting

A `sort by …` line is matched by:
```
^sort by (priority|due|scheduled|start|done|created|cancelled|description)(?: (reverse))?$
```
(case-insensitive). The capture group is the sort key; an optional trailing `reverse` flips direction.

Valid sort keys: **`priority`, `description`, and the six date fields** (`due`, `scheduled`, `start`, `done`, `created`, `cancelled`).

| Key | Order |
| --- | --- |
| `priority` | by rank: `highest`(1) → `high`(2) → `medium`(3) → `none`(4) → `low`(5) → `lowest`(6). **NOTE the unusual placement: `none` sorts between `medium` and `low`.** |
| `description` | `localeCompare` (alphabetical) |
| any date field | chronological ascending; **undated tasks sort last** regardless of direction (see below) |
| `<key> reverse` | multiplies the comparator by −1 |

### Priority rank gotcha

`PRIORITY_RANK = { highest:1, high:2, medium:3, none:4, low:5, lowest:6 }`. So when sorting by priority, a task with **no priority (`none`)** appears *above* `low` and `lowest` but *below* `medium`. This mirrors the Obsidian Tasks convention where unset priority ranks as "normal/medium-ish", not as last.

### Undated tasks sort last

For a date-field sorter, the comparator returns `1` when the left task has no value and `-1` when the right has no value, so missing dates are pushed to the **end** of the list. This is applied before the `dir` multiplier only for present-vs-present comparisons, so undated tasks stay last even with `reverse` (the `!av`/`!bv` short-circuits return `1`/`-1` un-multiplied).

```ts
const tasks = [task({ description: "none" }), task({ due: "2026-05-10", description: "dated" })];
runTaskQuery(tasks, "sort by due", TODAY).tasks.map(t => t.description); // ["dated", "none"]
```

### Multiple sort keys (tie-breakers)

Multiple `sort by` lines apply in order: the first is primary, later ones break ties. The combined comparator walks each sorter and returns the first non-zero result.

```ts
const tasks = [
  task({ priority: "low",  due: "2026-05-01", description: "low-early" }),
  task({ priority: "high", due: "2026-06-01", description: "high-late" }),
  task({ priority: "high", due: "2026-05-10", description: "high-early" }),
];
const q = "sort by priority\nsort by due";
runTaskQuery(tasks, q, TODAY).tasks.map(t => t.description);
// ["high-early", "high-late", "low-early"]
//   high before low; within high, earlier due first
```

### Reverse

```text
sort by due reverse
sort by priority reverse
sort by description reverse
```
`reverse` only reverses the present-vs-present comparison; as noted, undated tasks still sort last.

Sorting is **stable-ish via a copy**: `runTaskQuery` does `[...tasks].sort(...)`, so it does not mutate `allTasks`. If there are **no** sort lines, the original input order is preserved (no sort is applied at all).

## Recognized-but-unsupported instructions (silently ignored)

Lines matching `IGNORED_INSTRUCTION` are dropped **without** producing an error and **without** affecting filtering:

```
^(group by|limit|hide|show|short mode|full mode|explain)\b
```
(case-insensitive). So `group by filename`, `limit 5`, `hide edit button`, `show urgency`, `short mode`, `full mode`, `explain` are all accepted-but-no-ops. This lets a user paste a real Obsidian Tasks query that uses grouping/limiting without breaking the result or polluting `errors`.

```ts
const out = runTaskQuery(tasks, "not done\ngroup by filename\nlimit 5", TODAY);
out.errors;                          // []
out.tasks.map(t => t.description);   // ["a"]   (only "not done" actually filtered)
```

Caveat: these are genuinely **ignored**, not implemented — `group by` does not group, `limit` does not truncate. `QueryOutcome` has no grouping/limit fields; any grouping/limiting must happen in the consumer.

## Error collection and resilience

The DSL **collects errors instead of throwing**, and an unrecognized leaf does **not** silently drop tasks. The error messages produced by the parser:

| Situation | Error message pushed |
| --- | --- |
| Leaf text matches no known filter | `unrecognized filter: <leaf text>` |
| Boolean expression ends prematurely (e.g. dangling operator) | `unexpected end of filter` |
| `(` opened but no matching `)` | `missing closing parenthesis` |
| A stray operator token where a factor was expected | `unexpected token in filter` |
| Tokens remain after a complete expression parses | `trailing tokens in filter` |

Crucially, when a leaf is unrecognized, `parseFactor` pushes the error **and substitutes a `() => true` predicate** (the leaf matches everything). When the whole expression can't be built, it likewise defaults to `() => true`. So a broken filter line does **not** exclude tasks — it is effectively a no-op filter plus a recorded error.

```ts
const tasks = [task({ description: "a" }), task({ description: "b" })];
const out = runTaskQuery(tasks, "happiness is high", TODAY);
out.errors.length;  // > 0   (e.g. "unrecognized filter: happiness is high")
out.tasks.length;   // 2     (nothing dropped despite the bad line)
```

This means a query with one good line and one bad line still applies the good line, drops nothing for the bad line, and reports the bad line in `errors`. The UI can surface `errors` while still showing useful results.

The leaf-vs-date disambiguation also leans on `resolveDateExpr` returning `null`: e.g. `due someday` matches the date-filter regex shape but `someday` resolves to `null`, so `parseLeaf` returns `null` and the line becomes `unrecognized filter: due someday`.

## A complete real-world example

From the tests — the user's actual "🔥 today" query, demonstrating most features together (status filter, recurrence filter, deeply nested OR/AND with relative dates, two-key AND priority exclusion, and two sort keys):

```text
not done
is not recurring
((due before today) OR (due today) OR ((due after today) AND (due before in 7 days)) OR (priority is high) OR (scheduled today) OR (scheduled before today))
(priority is not medium) AND (priority is not low)
sort by priority
sort by due
```

With `today = 2026-05-27` and the test's four tasks, this runs with **no errors** and yields exactly `["overdue-high"]`:
```ts
const out = runTaskQuery(tasks, q, TODAY);
out.errors;                         // []
out.tasks.map(t => t.description);  // ["overdue-high"]
```
Walk-through of why: `not done` drops `done-high`; `is not recurring` drops `recurring-high`; the big OR keeps tasks that are overdue/high/etc.; the final `(priority is not medium) AND (priority is not low)` drops `overdue-medium`; `overdue-high` is the lone survivor, sorted by priority then due.

## Quick reference (cheat sheet)

```text
# ── status ──
done                     # status done OR cancelled
not done                 # status not done AND not cancelled
is cancelled
is not cancelled

# ── recurrence ──
is recurring
is not recurring

# ── priority (highest|high|medium|low|lowest|none) ──
priority is high
priority is not medium

# ── dates: field ∈ {due,scheduled,start,done,created,cancelled} ──
due today                # on
due before today
due after 2026-01-01
scheduled before in 7 days
done 3 days ago

# ── date expressions ──
today | tomorrow | yesterday | YYYY-MM-DD | in N days | N days ago

# ── booleans (single line; AND tighter than OR; parens override) ──
(priority is high) OR (due before today)
(not done) AND (priority is not low)

# ── sort (priority|description|due|scheduled|start|done|created|cancelled) ──
sort by priority
sort by due reverse
sort by description

# ── ignored no-ops ──
group by … | limit … | hide … | show … | short mode | full mode | explain

# ── comments / blanks skipped ──
# anything after a leading # is ignored
```

## See also

- [Tasks overview](./syntax.md) — how tasks are extracted and where the DSL is invoked
- [Bases overview](../bases/overview.md) — `source: tasks` and the ` ```query ` block (`tasks: <dsl>`)

Source: core/src/tasks-query.ts, core/test/tasks-query.test.ts, core/src/tasks.ts, core/src/dates.ts
