# Tasks → Obsidian Tasks-plugin emoji

## Sources

Bismuth:
- `docs/tasks/syntax.md` — the bracket field grammar, status characters, recurrence, and the (reverse) emoji migration table.
- `docs/tasks/query-dsl.md` — the ` ```query ` `tasks:` form and the legacy Tasks-DSL it still reads.
- `docs/cli/reference.md` — `task list`.

Obsidian Tasks plugin:
- https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format (raw: https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/docs/Reference/Task%20Formats/Tasks%20Emoji%20Format.md) — the emoji format. **Check this page for the current emoji set before converting.**
- https://publish.obsidian.md/tasks/Getting+Started/Statuses (raw: https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/docs/Getting%20Started/Statuses.md) — status characters (`[/]` in progress, `[-]` cancelled).
- https://publish.obsidian.md/tasks/Queries/Filters, https://publish.obsidian.md/tasks/Queries/Grouping, https://publish.obsidian.md/tasks/Queries/Sorting (raw: https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/docs/Queries/Filters.md, https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/docs/Queries/Grouping.md, https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/docs/Queries/Sorting.md) — ` ```tasks ` query lines.
- The field order is written in the plugin's source, `src/Layout/TaskLayoutOptions.ts` (`TaskLayoutComponent`): https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/Layout/TaskLayoutOptions.ts — "the order here determines the order that task fields are rendered and written to markdown". Re-read it before relying on the order below.

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

**Bismuth.** Any `- [ ] text` checkbox line is a task. Metadata is bracket fields anywhere on the line, in any order: dates `[due|scheduled|start|done|created|cancelled YYYY-MM-DD]` (a real calendar day), a priority word `[highest|high|medium|low|lowest]`, a recurrence `[every <rule>]`. The first occurrence of a key wins; a malformed bracket (`[due soon]`, `[chapter 3]`), a `[[wikilink]]` and a `[text](url)` are not fields and stay text. A `#tag` after a recurrence rule is a tag, not part of the rule. Status characters: space todo, `x` done, `/` in progress, `-` cancelled.

**Obsidian Tasks plugin.** Emoji signifiers at the end of the line, written in this fixed order: **🆔 id, ⛔ depends-on, priority, recurrence, 🏁 on-completion, created, start, scheduled, due, cancelled, done**, then a block link. Id, depends-on and on-completion have no Bismuth counterpart, so the conversion writes **priority, recurrence, created, start, scheduled, due, cancelled, done**, which is the script's `DATE_ORDER` after priority and recurrence. Verified 2026-10-03 against the plugin's `TaskLayoutComponent` enum ("the order here determines the order that task fields are rendered and written to markdown") and `DefaultTaskSerializer.serialize`, which loops over those components in that order: https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/Layout/TaskLayoutOptions.ts and https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/src/TaskSerializer/DefaultTaskSerializer.ts.

| Bismuth | Emoji | | Bismuth | Emoji |
|---|---|---|---|---|
| `[highest]` | `🔺` | | `[created D]` | `➕ D` |
| `[high]` | `⏫` | | `[start D]` | `🛫 D` |
| `[medium]` | `🔼` | | `[scheduled D]` | `⏳ D` |
| *(no priority)* | *(none)* | | `[due D]` | `📅 D` |
| `[low]` | `🔽` | | `[cancelled D]` | `❌ D` |
| `[lowest]` | `⏬` | | `[done D]` | `✅ D` |
| `[every week]` | `🔁 every week` | | | |

Not produced by this conversion: `🏁` (on completion), `🆔` / `⛔` (dependencies). The Tasks plugin's optional *global filter* has no Bismuth counterpart — Bismuth treats every checkbox as a task, so leave the plugin's global filter **unset**.

## Convert

**No Bismuth→emoji CLI command exists** (`bismuth task migrate` goes the other way). Rewrite the task lines in `$OUT` with this script. It reads each `.md`, counts every checkbox line (fenced or not, as Bismuth's `task list` does), rewrites only the unfenced ones that carry bracket fields, consumes a duplicate field the way Bismuth does (first value wins, the repeat is dropped), preserves line endings, and prints `tasks=<checkbox lines seen> rewritten=<lines changed>`. Save it as `rewrite-tasks.ts` in your scratch directory:

```ts
// rewrite-tasks.ts
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const DATE: Record<string, string> = { created: '➕', start: '🛫', scheduled: '⏳', due: '📅', cancelled: '❌', done: '✅' }
const DATE_ORDER = ['created', 'start', 'scheduled', 'due', 'cancelled', 'done']
const PRIORITY: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }
const FIELD = /(?<!\[)\[([^[\]]+)\](?!\()/g
const TASK = /^(\s*)([-*+]) \[(.)\] (.*?)(\r?)$/

const realDay = (s: string) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return false
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

const rewrite = (body: string) => {
    const dates: Record<string, string> = {}
    let priority = ''
    let rule = ''
    let tail = ''
    const text = body.replace(FIELD, (all, inner: string) => {
        const word = inner.trim()
        if (PRIORITY[word]) {
            if (!priority) priority = PRIORITY[word]
            return ''
        }
        if (/^every\s/.test(word)) {
            if (rule) return ''
            const cut = word.search(/\s#/)
            rule = cut < 0 ? word : word.slice(0, cut)
            tail = cut < 0 ? '' : word.slice(cut)
            return tail
        }
        const m = word.match(/^(due|scheduled|start|done|created|cancelled) (\S+)$/)
        if (m && realDay(m[2])) {
            if (!dates[m[1]]) dates[m[1]] = m[2]
            return ''
        }
        return all
    })
    if (!priority && !rule && !Object.keys(dates).length) return null
    const parts = [text.replace(/\s{2,}/g, ' ').trim()]
    if (priority) parts.push(priority)
    if (rule) parts.push('🔁 ' + rule)
    for (const k of DATE_ORDER) if (dates[k]) parts.push(DATE[k] + ' ' + dates[k])
    return parts.join(' ')
}

let seen = 0
let changed = 0
const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (entry.endsWith('.md')) {
            let fence = false
            let dirty = false
            const lines = readFileSync(path, 'utf8').split('\n').map(line => {
                if (/^\s*(```|~~~)/.test(line)) fence = !fence
                const m = line.match(TASK)
                if (!m) return line
                seen++
                if (fence) return line
                const next = rewrite(m[4])
                if (next === null) return line
                dirty = true
                changed++
                return `${m[1]}${m[2]} [${m[3]}] ${next}${m[5]}`
            })
            if (dirty) writeFileSync(path, lines.join('\n'))
        }
    }
}
walk(root)
console.log(`tasks=${seen} rewritten=${changed}`)
```

Run `bun run rewrite-tasks.ts "$OUT"`. Then:

1. **Check the order and emoji against the live Tasks docs** (Sources above) — the script encodes the 2026-10-03 snapshot. If the plugin added or reordered a field, edit `DATE_ORDER`/`DATE`/`PRIORITY` before running.
2. **Compare counts**: `tasks=` must equal `bismuth task list --vault "$SRC" | jq length` (SKILL step 5d). A difference means a note you generated or a file the walk skipped (dot-folders); fenced checkboxes are counted on both sides — find it before going on. Expected extra: tasks converted from a `mode: tasks` base's stored body rows (`bases`, item B7) are new checkbox lines the source's `task list` never counted.
3. **A recurring task** keeps Bismuth's rule text: `[every week]` → `🔁 every week`. Rules Bismuth rolls over (`every day|N days|week|N weeks|month|N months|year|N years|weekday`) are also Tasks rules; others (`every other day`, `every week on Sunday`, `when done`) pass through verbatim and the plugin may read them differently — list every non-standard rule in the report.
4. **Statuses**: `[/]` and `[-]` are copied as-is. If they do not render as in-progress / cancelled in Obsidian, follow the Statuses page.
5. **` ```query ` blocks with `tasks:`** → a ` ```tasks ` block. Legacy bodies are Tasks-plugin lines: copy the `tasks:` value (a single line, or a `|-` block scalar) as the block body, one query line each — **except the `done` / `not done` lines**, which Bismuth reads as `note.resolved` / `!note.resolved` (done OR cancelled, `core/src/bases/taskDsl.ts`), so they translate as in the table below, not verbatim. Every other legacy line copies as is. The modern form translates leaf by leaf:

   | Bismuth | ` ```tasks ` line |
   |---|---|
   | `tasks: not done` (a legacy line) | `not done` + `is not cancelled` (two lines; Bismuth reads it as `!note.resolved`, which also hides cancelled tasks) |
| `tasks: done` (a legacy line) | `(done) OR (is cancelled)` (Bismuth reads it as `note.resolved`) |
   | `where: !note.resolved` | `not done` + `is not cancelled` (two lines; `resolved` means done OR cancelled — verify on the Filters page) |
   | `where: note.resolved` | `(done) OR (is cancelled)` (verify on the Filters page) |
   | `where: note.priority == "high"` | `priority is high` |
   | `where: note.recurring` | `is recurring` |
   | `where: note.status == "cancelled"` | `is cancelled` |
   | `where: note.due < "2026-09-14"` | `due before 2026-09-14` |
   | `sort: note.due` | `sort by due` |
   | `sort: note.priority` | `sort by priority` |
   | `group: file.name` | `group by filename` |

   There is no verified translation for `limit:` — look up the plugin's limit line in its Queries docs, or leave a `# not converted` comment and report it. Check each line against the Filters / Grouping / Sorting pages. `&&` becomes separate lines (all lines AND together); `||` has no line form — write `(…) OR (…)` per the Filters page or report it. Anything you cannot translate: leave a comment line `# not converted: <original>` inside the block and report it.

## Lossy

- The Tasks plugin's global filter, on-completion (`🏁`), dependencies (`🆔`, `⛔`) and Dataview-style `[due:: D]` fields: nothing in Bismuth maps to them.
- Unusual recurrence rules (see Convert 3).
- A task's field position: Bismuth lets fields sit mid-sentence; the output always puts the emoji last, so words that followed a field on the same line now come before it (nothing is deleted, the order of prose and metadata changes).
- Task bases: kanban/calendar presentation of tasks, `mode: tasks`, scoped `from:`. A ` ```tasks ` block lists tasks; it does not draw boards or grids. Tasks **stored as rows in a `mode: tasks` base's own body** are not vault checkbox lines: they convert to checkbox lines per `bases` (item B7), not to a query.
- Impossible or malformed dates (`[due 2026-02-30]`): left as literal text, the same as Bismuth does.

## Validate

- `grep` for bracket fields on checkbox lines returns 0 (SKILL step 5 a). Hits whose date is not a real calendar day (`[due 2026-02-30]`) are legitimate text; to separate them, pipe the grep through this filter, which prints only the lines that are still real fields (expected: nothing):
  ```bash
  <the step 5 a task grep> | bun -e 'for (const l of (await Bun.stdin.text()).split("\n")) { const bad = [...l.matchAll(/\[(?:due|scheduled|start|done|created|cancelled) (\d{4})-(\d{2})-(\d{2})\]/g)].some(m => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() !== +m[3]); if (l && !bad) console.log(l) }'
  ```
  A line it prints is a missed conversion. A line with an impossible date it hides goes in the report as "left as text".
- `tasks=` equals the source's `bismuth task list` count (SKILL step 5 d).
- Spot-check three converted lines against the Emoji Format page: emoji order, one space between fields, date `YYYY-MM-DD`.
- The report names the **Tasks** plugin as required.
