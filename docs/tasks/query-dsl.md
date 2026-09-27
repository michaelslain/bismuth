# Tasks Query DSL (legacy)

**The tasks query DSL is gone.** `core/src/tasks-query.ts` (`runTaskQuery`), the small evaluator this page used to document, has been deleted. Task filtering now uses the **same Bases filter language** `source: notes` uses (see [filters](../bases/filters.md)): a plain `!note.resolved`-shaped expression, not the old `not done` keyword grammar.

This page exists so a dangling link doesn't break the docs build, and so anyone who remembers the old keywords can find the replacement. Nothing below is callable code.

## Your old queries still work

A `tasks:` value that still holds DSL text (`not done`, `due before tomorrow`, `sort by priority`, …) is translated into a Bases filter expression **at read time** by `translateTaskDsl` (`core/src/bases/taskDsl.ts`) — the one surviving piece of the old evaluator, kept specifically so no existing note breaks. You do not have to change anything for an old ` ```query ` block to keep rendering the same rows in the same order.

To rewrite them in place (optional — the translation shim reads the old form forever):

```
bismuth base migrate-queries --vault <vault>          # rewrites tasks: DSL blocks
bismuth base migrate-queries --vault <vault> --dry-run # reports what would change, writes nothing
```

It is idempotent (running it twice makes no further changes) and leaves a block it can't safely convert untouched, reported as unconvertible rather than guessed at — that's a block that already has its own `where:` or `sort:` key alongside a DSL `tasks:`, or one with a date leaf that names a weekday (`due friday`), which has no live Bases form.

## The replacement shape

Before:

```query
tasks: |-
  not done
  priority is high
  sort by due reverse
```

After (exactly what `bismuth base migrate-queries` writes for this block):

```query
tasks:
where: (!note.resolved) && (note.priority == "high")
sort: note.due desc
```

`tasks:` (bare) just says "this is a task query"; the filter moves to `where:`, a full Bases expression; a lifted-out `sort by …` becomes the dedicated `sort:` key. See [the ```query block](../bases/query-block.md) for the complete key reference, and [tasks syntax](./syntax.md) for the task-line grammar (`[due 2026-09-14]` bracket fields) these filters read.

## Leaf-by-leaf translation

Every DSL leaf the old evaluator accepted, and the Bases expression `translateTaskDsl` turns it into:

| DSL leaf | Bases expression |
| --- | --- |
| `done` | `note.resolved` |
| `not done` | `!note.resolved` |
| `is cancelled` | `note.status == "cancelled"` |
| `is not cancelled` | `note.status != "cancelled"` |
| `is recurring` | `note.recurring` |
| `is not recurring` | `!note.recurring` |
| `priority is <word>` | `note.priority == "<word>"` |
| `priority is not <word>` | `note.priority != "<word>"` |
| `<field> <expr>` (equals) | `note.<field> == "<resolved ISO>"` |
| `<field> before <expr>` | `note.<field> < "<resolved ISO>"` |
| `<field> after <expr>` | `note.<field> > "<resolved ISO>"` |
| `sort by priority\|<field>\|description [reverse]` | not a filter — a `SortSpec` on `note.<field>` (or `note.priority`), `DESC` when `reverse` is present |

`<field>` is one of `due`, `scheduled`, `start`, `done`, `created`, `cancelled`. Relative date words (`today`, `tomorrow`, `in 3 days`, `2 days ago`, weekday names) resolve against the query's `today` at translation time, exactly as they did before.

**Boolean structure carries over unchanged** — only the spellings differ: `AND`/`OR` (uppercase, DSL) become `&&`/`||` (Bases); parentheses mean the same thing in both. An unrecognized leaf degrades to the literal `true` rather than dropping its line or failing the whole query, reproducing the old evaluator's own "unrecognized filter, keep going" behavior — so a typo'd leaf in an old query still filters by whatever the rest of the line said, exactly as before.

`sort by priority` sorts by **rank** (`highest` < `high` < `medium` < `none` < `low` < `lowest`), not alphabetically — `applyTaskSort` (`core/src/bases/taskDsl.ts`) does this for a legacy `tasks:` value, at the SOURCE level. The modern `sort:` key is applied later, at the VIEW level (`runView` in `core/src/bases/query.ts`), through `compareForSort` — which `applyTaskSort` imports, and which ranks any property whose bare name is `priority` by the same table. So `bismuth base migrate-queries` rewrites `sort by priority` into `sort: note.priority` without changing the row order (see `migrateQueryBody` in `cli/src/commands/base.ts`).

## Where this lives in the code now

- `core/src/bases/taskDsl.ts` — `translateTaskDsl(dsl, today)`, `looksLikeTaskDsl(text)` (the cheap discriminator `source.ts` uses to decide whether a `tasks:` value needs translating), and `applyTaskSort`.
- `core/src/bases/queryBlock.ts` — `parseQueryBlock`, which reads the `sort:` key.
- `core/src/bases/source.ts` — applies the translation to a `kind: tasks` source's `where` before filtering.
- `cli/src/commands/base.ts` — `base migrate-queries`.

See also: [```query block](../bases/query-block.md), [Bases filters](../bases/filters.md), [tasks syntax](./syntax.md).
