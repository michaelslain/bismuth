# Tasks (Obsidian Tasks plugin)

Convert only when `obsidian-tasks-plugin` is in the source's `.obsidian/community-plugins.json`. If the vault has emoji tasks but not the plugin, the default is to migrate them and record that in the report under "Defaults taken". Ask first only when a human is in the loop.

## Sources

- Bismuth: `docs/tasks/syntax.md` (bracket fields, recurrence, migration rules), `docs/tasks/query-dsl.md` (what the old ` ```tasks ` text becomes), `docs/bases/query-block.md` (the ` ```query ` fence), `docs/cli/reference.md` (`task` and `base migrate-queries`).
- Obsidian Tasks plugin: https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format, https://publish.obsidian.md/tasks/Getting+Started/Global+Filter, https://publish.obsidian.md/tasks/Getting+Started/Statuses

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

Bismuth reads only bracket fields. Every `- [ ]` line is a task (no global filter). `bismuth task migrate` is the one place the emoji spelling is still read.

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

Recurrence rules with rollover when completed: `every day|N days|week|N weeks|month|N months|year|N years|weekday`. Anything else (`every other day`, `every week on Sunday`, a trailing `when done`) is kept verbatim as `[every ...]` with no rollover.

## Convert

1. Dry run, then read `flagged` (lines that did not fully round-trip, for example an impossible date like `2026-02-30`; each entry's `line` is 0-indexed, so add 1 to find it in an editor):
   ```bash
   bismuth task migrate --dry-run --vault "$OUT" --pretty
   ```
2. Run it: `bismuth task migrate --vault "$OUT" --pretty`. Output is `{changed, files, flagged, skipped}`; `changed` counts task lines. It rewrites per line, skips fenced code, and is idempotent. Every `skipped` file kept its emoji syntax: fix those by hand and list each in the report. `skipped` entries are `{file, error}`: the file could not be read or written. The CLI takes no git snapshot first (the app's automatic first-open run does), so the copy in `$OUT` is your only undo. Rerun after fixing the cause, or edit the lines yourself. A non-empty `skipped` is never a pass.
3. **Before any query rewrite**, find the instruction lines the translator cannot express (`migrate-queries` lists them under `degraded[].leaves` but deletes them from the fence, so capture them now):
   ```bash
   grep -rnE --include='*.md' '^[[:space:]]*(group by|limit|hide|show|short mode|full mode|explain)\b' "$OUT"
   ```
   Hits inside a ` ```tasks ` block need a hand translation or a report line.
4. ` ```tasks ` query fences are not rendered by Bismuth. Rewrite each as a ` ```query ` fence holding the old text under `tasks: |-`:
```bash
cat > "$TMPDIR/x.pl" <<'PL'
s{^```tasks[ \t]*\n(.*?)^```[ \t]*$}{
    my $body = $1;
    "```query\ntasks: |-\n" . join("", map { length($_) ? "  $_\n" : "\n" } split(/\n/, $body)) . "```"
}gsme;
PL
find "$OUT" -name '*.md' -print0 | xargs -0 perl -0pi "$TMPDIR/x.pl"
```
5. Translate the old text to the modern `tasks:` + `where:` + `sort:` form, dry run first: `bismuth base migrate-queries --dry-run --vault "$OUT" --pretty`, then without `--dry-run`. Read `unconvertible` (`{file, block}`, left as is; `block` is 0-indexed among that note's ` ```query ` fences) and `degraded` (`{file, block, leaves}`: each leaf did not translate and now matches more tasks than before). Every entry of `degraded[].leaves` goes into the report's Lossy section, ignored instructions (`group by`, `limit`, `hide`, `show`, `short mode`, `full mode`, `explain`) included; step 6 hand-translates what it can. Also read `skipped` (`{file, error}`), for example a CRLF file the fence scanner did not check: convert it to LF and rerun.
6. Hand-translate what step 3 found, after `migrate-queries` has run (its output block holds `tasks:` and `where:`):
   - `group by <key>` becomes a `group: <field>` line in the same ` ```query ` block. The key is documented in `docs/bases/query-block.md` (the flat-spec key table, row `group: <field>`, and the "group fields" listed under autocomplete). Read that page live to see which fields are valid; do not rely on a list here. Map the Tasks key to the field it names (`group by filename` becomes `group: file.name`, `group by folder` becomes `group: file.folder`, `group by due` becomes `group: due`), and check the mapped field against the page.
   - `limit N` becomes a `limit: N` line (same page, key table).
   - `hide ...`, `show ...`, `explain`, and any `group by` key with no valid field: not translatable. Leave the line out and list the note path, the block and the exact original line in the report's Lossy section.
   Read each edited block back to confirm the new lines sit inside the fence.
   **Validate a hand-added `group:`.** Neither `base validate` nor `migrate-queries` reads a flat fence, and a flat fence cannot be pasted into a base as is (`tasks:`/`group:` are flat-form keys). Write a scratch note under `$OUT` with the same query in base form: `source: tasks`, the block's `where:` text as `where:`, `groupBy: <the same field>`, `view: list`. Then:
   ```bash
   bismuth base validate "scratch.md" --vault "$OUT"                                  # "ok":true (does not check the field)
   bismuth base render "scratch.md" --vault "$OUT" | jq -c '[.groups[]|{key,n:(.rows|length)}]'
   ```
   A valid field gives one group per value (`[{"key":"A","n":1},{"key":"B","n":1}]`). A field that resolves to nothing gives a single group with `"key":""`; fix the field. Delete the scratch note afterwards.
7. Leaves the translator supports: `done`, `not done`, `is (not) cancelled`, `is (not) recurring`, `priority is (not) X`, date leaves on `due scheduled start done created cancelled` (`before`, `after`), `sort by`, `AND`/`OR`. `group by`, `limit`, `hide`, `show` and `explain` lines are removed from the fence and reported in `degraded[].leaves` (step 3 finds them, step 6 translates what it can); any other leaf (`has due date`, `path includes`, `tags include`, ...) becomes always-true. Hand-fix those queries and list them in the report.

## Lossy

- `🏁`, `🆔`, `⛔`, Dataview-style fields, and non-rollover recurrences stay as literal text.
- The global filter has no equivalent; plain checkboxes are tasks now.
- Numbered tasks (`1. [ ] x`) are tasks to the Tasks plugin, but Bismuth's parser reads only `-`, `*` and `+` bullets (`TASK_LINE` in `core/src/taskParse.ts`), so they are not tasks in Bismuth and do not migrate. List each in the report; the inventory's `numbered tasks` row counts them.
- Query lines that were dropped or loosened (steps 3, 6 and 7), and Tasks-plugin custom statuses beyond `/` and `-`.

## Validate

- `bismuth task list --vault "$OUT" --pretty | grep -c '"line"'` equals the inventory's `checkbox tasks`.
- `bismuth task migrate --dry-run --vault "$OUT"` reports `"changed":0`; `bismuth base migrate-queries --dry-run --vault "$OUT"` reports `"changed":0`.
- `bismuth base migrate-queries --vault "$OUT" --pretty` (a real run, after the translation) printed `degraded: []` and `unconvertible: []`, or every entry of `degraded[].leaves` (ignored `group by`/`limit` lines included) and every `unconvertible` block is in the report.
- `bismuth task list --query "not done" --vault "$OUT" --pretty` returns `{tasks, errors}` with an empty `errors`; that checks the query parses, not that the DSL translation was complete.
