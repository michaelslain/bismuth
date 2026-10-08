# Tasks-plugin query text

A `tasks:` value in a ` ```query ` block or a `source: tasks` base may hold Obsidian Tasks-plugin
query text (`not done`, `due before tomorrow`, `sort by priority`). Bismuth translates that text into
a Bases filter expression every time the query is read, so such a block renders without edits. This
page is for anyone reading or converting a block written that way; new queries use a plain `where:`
expression ([filters](../bases/filters.md)).

```query
tasks: |-
  not done
  priority is high
  sort by due reverse
```

reads the same rows, in the same order, as:

```query
tasks:
where: (!note.resolved) && (note.priority == "high")
sort: note.due desc
```

## Rewrite a block into the plain form

`bismuth base migrate-queries` rewrites every such block in a vault into the plain form shown above.
The rewrite is optional: the read-time translation keeps working either way.

```bash
bismuth base migrate-queries --vault <vault> --dry-run   # report per-file counts, write nothing
bismuth base migrate-queries --vault <vault>             # rewrite in place
```

The command is idempotent. It leaves a block untouched and reports it as unconvertible when the block
already has its own `where:` or `sort:` key beside the Tasks text, or when a date leaf names a
weekday (`due friday`), which has no relative Bases form.

## Translation table

Each Tasks-plugin leaf becomes the Bases expression in the right column. `<field>` is one of `due`,
`scheduled`, `start`, `done`, `created`, `cancelled`.

| Tasks text | Bases expression |
| --- | --- |
| `done` | `note.resolved` |
| `not done` | `!note.resolved` |
| `is cancelled` | `note.status == "cancelled"` |
| `is not cancelled` | `note.status != "cancelled"` |
| `is recurring` | `note.recurring` |
| `is not recurring` | `!note.recurring` |
| `priority is <word>` | `note.priority == "<word>"` |
| `priority is not <word>` | `note.priority != "<word>"` |
| `<field> <date>` | `note.<field> == "<ISO date>"` |
| `<field> before <date>` | `note.<field> < "<ISO date>"` |
| `<field> after <date>` | `note.<field> > "<ISO date>"` |
| `sort by priority\|<field>\|description [reverse]` | a sort on that property, descending with `reverse` |

Relative dates (`today`, `tomorrow`, `in 3 days`, `2 days ago`, weekday names) resolve against the
query's `today` when the block is read. `AND`/`OR` become `&&`/`||`; parentheses keep their meaning.

## What silently changes a result

- **An unrecognized leaf becomes `true`.** A typo such as `not dnoe` filters nothing on that line
  and raises no error; the rest of the line still applies. `bismuth base migrate-queries --dry-run`
  lists unrecognized leaves.
- **Display lines are ignored.** `group by`, `limit`, `hide`, `show`, `short mode`, `full mode` and
  `explain` are recognised and dropped; the view's own config controls display.
- **`sort by priority` ranks by urgency**, not alphabetically: `highest`, `high`, `medium`, `none`,
  `low`, `lowest`. The plain `sort: note.priority` key ranks the same way, so a rewritten block keeps
  its order.

## How it works

`translateTaskDsl(dsl, today)` turns the text into a `where` string plus a `SortSpec` list;
`looksLikeTaskDsl(text)` is the cheap check `source.ts` uses to decide whether a `tasks:` value needs
translating, and `applyTaskSort` sorts at the source level through the same `compareForSort` the view
uses. `base migrate-queries` calls the translator with live (relative) dates and writes the result
through `migrateQueryBody`.

Source: `core/src/bases/taskDsl.ts`, `core/src/bases/source.ts`, `core/src/bases/queryBlock.ts`,
`cli/src/commands/base.ts`
