# Converting Obsidian Tasks plugin tasks

Bismuth reads task metadata as bracket fields (`[due 2026-09-14] [high]`), not the Tasks plugin's emoji, and renders no ` ```tasks ` query fence. `bismuth import obsidian` rewrites every emoji task line to bracket fields and every ` ```tasks ` block to a ` ```query ` block. It does this whether or not `obsidian-tasks-plugin` is in the source's `.obsidian/community-plugins.json`; without the plugin, it records the choice under Defaults taken. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/tasks/syntax.md` (bracket fields, recurrence, migration rules), `docs/tasks/query-dsl.md` (what Tasks-plugin query text becomes), `docs/bases/query-block.md` (the ` ```query ` fence), `docs/cli/reference.md` (`task` and `base migrate-queries`).
- Obsidian Tasks plugin: https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format, https://publish.obsidian.md/tasks/Getting+Started/Global+Filter, https://publish.obsidian.md/tasks/Getting+Started/Statuses

## Format differences

Every `- [ ]` line is a task in Bismuth (there is no global filter). The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Tasks plugin | Bismuth |
|---|---|
| `📅 D` | `[due D]` |
| `⏳ D` | `[scheduled D]` |
| `🛫 D` | `[start D]` |
| `✅ D` | `[done D]` |
| `➕ D` | `[created D]` |
| `❌ D` | `[cancelled D]` |
| `🔺` `⏫` `🔼` `🔽` `⏬` | `[highest]` `[high]` `[medium]` `[low]` `[lowest]` |
| `🔁 every week` | `[every week]` |
| `🏁 keep\|delete` (on completion), `🆔`, `⛔` (dependencies) | not recognised; left as literal text |
| Dataview-style `[due:: D]` | not recognised; left as literal text |
| `[ ]` `[x]` `[/]` `[-]` | same characters (todo, done, in progress, cancelled) |
| the plugin's global filter (for example `#task`) | none; the `#task` tag stays as an ordinary tag |

These recurrence rules roll over when the task is completed: `every day|N days|week|N weeks|month|N months|year|N years|weekday`. Anything else (`every other day`, `every week on Sunday`, a trailing `when done`) is kept verbatim as `[every ...]` with no rollover.

## What the command converts

- Emoji task lines in every note, outside fenced code, become bracket fields. The rewrite is per line and idempotent.
- A ` ```tasks ` block becomes a ` ```query ` block with `tasks:` and `where:` and `sort:` lines. `group by <key>` becomes `group: <field>` for `status`, `priority`, `due`, `scheduled`, `filename` (`file.name`) and `folder` (`file.folder`), and `limit N` becomes `limit: N`.
- The supported filter leaves are `done`, `not done`, `is (not) cancelled`, `is (not) recurring`, `priority is (not) X`, date leaves on `due scheduled start done created cancelled` (`before`, `after`), `sort by`, and `AND`/`OR`.

## What the command reports

| Section | Item |
|---|---|
| Converted | `N emoji task line(s) rewritten to bracket fields` per note, and `tasks query became a query block` per fence |
| Needs a decision | a task line that did not round-trip, a query filter that did not translate, a query with no translation |
| Lossy | one item per query listing its dropped display lines (`hide`, `show`, `short mode`, `full mode`, `explain`, `ignore global query`, a `group by` key with no valid field); a query that names its own note through `{{query.file.…}}`; `🏁 ⛔ 🆔` kept as plain text; numbered tasks |
| Defaults taken | emoji tasks migrated although the Tasks plugin is not installed |

A `preset <name>` line and a one-line `{{preset.<name>}}` are replaced by that preset's text from the Tasks plugin's settings before translation, as the plugin does when it runs the query. A `{{query.file.path}}`, `folder`, `filename`, `filenameWithoutExtension` or `root` placeholder is replaced by the host note's current value, in the plugin's spelling (a folder ends in `/`); the query keeps matching that path if the note is later renamed or moved, which the Lossy item says.

Numbered tasks (`1. [ ] x`) are tasks to the Tasks plugin, but Bismuth's parser reads only `-`, `*` and `+` bullets, so they are not tasks in Bismuth and do not migrate. Tasks-plugin custom statuses beyond `/` and `-` are not read.

## Resolve a Needs a decision item

- **`task did not round-trip, check it: "<line>"`**: the line has a field the rewrite could not carry through unchanged, such as an impossible date like `2026-02-30`. Open the note, correct the date or field on that line in bracket form, and rerun `bismuth task migrate --dry-run --vault "$OUT"` to confirm `"changed":0`.
- **`query filter not translated, matches more tasks than before: "<leaf>"`**: one item per query, naming each leaf that has no task-row form (`filter by function`, `heading includes`, `is blocked`, `happens …`). Each became always-true, so the block matches more tasks than in Obsidian. Rewrite the block's `where:` line by hand using `docs/tasks/query-dsl.md` and the `where:` rows of `docs/bases/query-block.md`, or tell the user the block is looser than before.
- **`tasks query left as written, it has no Bismuth translation`**: the block is still a ` ```tasks ` fence, which Bismuth renders as nothing. Write the block by hand as a ` ```query ` fence following `docs/bases/query-block.md`.

After editing a query, `bismuth task list --query "not done" --vault "$OUT" --pretty` returns `{tasks, errors}` with an empty `errors`. That checks the query parses, not that the translation is complete.

## Validate

- `bismuth task migrate --dry-run --vault "$OUT"` reports `"changed":0`, and `bismuth base migrate-queries --dry-run --vault "$OUT"` reports `"changed":0`.
- `bismuth task list --vault "$OUT" --pretty | grep -c '"line"'` equals the report's Inventory `checkbox tasks` count.
