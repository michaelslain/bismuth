// Task command group for the `bismuth` CLI.
// Wraps core's task extraction (collectVaultTasks), the Bases filter language (`--query`
// accepts either a bases expression or legacy Tasks-DSL text, translated on the way in —
// see taskDsl.ts), and the in-place line toggler (toggleTaskLine). The toggle command
// mutates a vault file directly — the app's file watcher picks up the write live —
// mirroring server.ts's POST /tasks/toggle handler.
import type { CommandMap } from '../types'
import { bool, fail, flag, out, positionals, requireVault, today } from '../args'
import {
    collectVaultTasks,
    toggleTaskLine,
    setTaskLineStatus,
    archiveResolvedTasks,
} from '../../../core/src/tasks'
import { reorderTaskBlocks } from '../../../core/src/taskReorder'
import {
    translateTaskDsl,
    looksLikeTaskDsl,
    applyTaskSort,
} from '../../../core/src/bases/taskDsl'
import { passesFilter } from '../../../core/src/bases/filters'
import { toContext } from '../../../core/src/bases/query'
import { taskToRow } from '../../../core/src/bases/taskRow'
import type { Task } from '../../../core/src/tasks'
import { migrateContent } from '../../../core/src/taskMigrate'
import { readNote, writeNote, listMarkdown } from '../../../core/src/files'

// Sorting shares taskDsl.ts's applyTaskSort with source.ts — see its own doc comment
// for why that matters (priority ranks by urgency, not alphabetically; an undated task
// sorts last). Reads the property straight off the Task: every SortSpec translateTaskDsl
// produces names a field Task already carries under the same key (`note.due` -> `due`),
// so there is no need to round-trip through taskToRow/rowToTask — which would silently
// drop `indent`, a field the row shape doesn't carry.
const taskProperty = (t: Task, property: string): unknown =>
    (t as unknown as Record<string, unknown>)[
        property.startsWith('note.') ? property.slice(5) : property
    ]

export const commands: CommandMap = {
    'task list': {
        summary:
            'List all checkbox tasks in the vault (optionally filtered by a Bases filter expression, or legacy Tasks-query DSL text)',
        usage: '[--query <expr>]',
        run: async args => {
            const vault = requireVault(args)
            const tasks = await collectVaultTasks(vault)
            const query = flag(args, 'query')
            if (query === undefined) {
                out(tasks, args)
                return
            }
            const isDsl = looksLikeTaskDsl(query)
            const translation = isDsl ? translateTaskDsl(query, today()) : undefined
            const expr = isDsl ? translation!.where : query
            const filtered = expr
                ? tasks.filter(t => passesFilter(expr, toContext(taskToRow(t))))
                : tasks
            // `sort by …` used to run in the same pass as the filter (the old
            // evaluator's runTaskQuery); dropping it here would silently make the CLI's
            // own sort a no-op, exactly like the resolveSource bug this mirrors.
            const sorted = isDsl
                ? applyTaskSort(filtered, translation!.sort, taskProperty)
                : filtered
            // Diagnostics for a typo'd filter: with degrade-to-true the FILTERING is
            // correct even for an unrecognized leaf, but a user gets no signal at all
            // that part of their query was ignored unless this is surfaced, matching
            // the old evaluator's errors[].
            const errors = (translation?.unrecognized ?? []).map(
                leaf => `unrecognized filter: ${leaf}`,
            )
            out({ tasks: sorted, errors }, args)
        },
    },
    'task toggle': {
        summary:
            "Toggle a task's done state at <file>:<line> (1-based line number), or set an explicit status char with --status",
        usage: '<file> <line> [--status <char>]',
        run: async args => {
            const vault = requireVault(args)
            const [file, lineStr] = positionals(args)
            if (!file || lineStr === undefined)
                fail('usage: task toggle <file> <line>')
            const line = Number(lineStr)
            if (!Number.isInteger(line) || line < 1)
                fail(`invalid line number: ${lineStr}`)
            const status = flag(args, 'status')
            if (status !== undefined) {
                if (status.length !== 1)
                    fail(`--status must be a single character: ${status}`)
                const code = status.charCodeAt(0)
                // Reject C0 controls + DEL (they either desync TASK_LINE's parse or, for \n/\r, physically
                // split the file) — except tab, which TASK_LINE's `.` happily matches and round-trips fine.
                if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
                    fail(
                        `--status must be a printable character (letters, digits, space, tab, punctuation) — got a control character (code ${code})`,
                    )
                }
            }
            const content = await readNote(vault, file)
            // Mirror POST /tasks/toggle: split on "\n", toggle/set the target line in place.
            // toggleTaskLine/setTaskLineStatus may return TWO lines (recurrence inserts the next
            // occurrence above the completed one); splicing into one slot preserves order after join.
            const lines = content.split('\n')
            const idx = line - 1 // 1-based → 0-based
            if (idx < 0 || idx >= lines.length) fail('line out of range')
            lines[idx] =
                status !== undefined
                    ? setTaskLineStatus(lines[idx], status, today())
                    : toggleTaskLine(lines[idx], today())
            await writeNote(vault, file, reorderTaskBlocks(lines.join('\n')))
            out('ok', args)
        },
    },
    'task archive': {
        summary:
            'Permanently remove completed/cancelled tasks — mirrors POST /tasks/archive. With <file>, only that note; omitted, the whole vault. Removal is permanent (git history retains it)',
        usage: '[<file>]',
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args)
            if (file) {
                const { content, removed } = archiveResolvedTasks(
                    await readNote(vault, file),
                )
                if (removed > 0) await writeNote(vault, file, content)
                out({ removed, files: removed > 0 ? 1 : 0 }, args)
                return
            }
            const rels = await listMarkdown(vault)
            let removed = 0
            let files = 0
            for (const rel of rels) {
                const res = archiveResolvedTasks(await readNote(vault, rel))
                if (res.removed > 0) {
                    await writeNote(vault, rel, res.content)
                    removed += res.removed
                    files++
                }
            }
            out({ removed, files }, args)
        },
    },
    'task migrate': {
        summary:
            'Rewrite emoji task signifiers to bracket fields across the vault. Run by hand; the app also runs this automatically the first time it opens a vault. --dry-run reports per-file counts and writes nothing',
        usage: '[--dry-run]',
        run: async args => {
            const vault = requireVault(args)
            const dryRun = bool(args, 'dry-run')
            const rels = await listMarkdown(vault)
            const files: Array<{ file: string; changed: number }> = []
            const skipped: Array<{ file: string; error: string }> = []
            // Lines the rewrite could not round-trip — in practice a calendar-impossible
            // date, which the emoji path accepted by shape alone and the bracket grammar
            // rejects, so it lands as literal description text. Named here (with the
            // rewritten text) because that is the only way a user finds them.
            const flagged: Array<{ file: string; line: number; text: string }> =
                []
            let changed = 0
            // Each file's read/migrate/write is its own try/catch so one unreadable
            // file (permissions, a broken symlink, …) cannot abort the run and leave
            // the vault half migrated — it is skipped and reported, the rest proceed.
            for (const rel of rels) {
                try {
                    const res = migrateContent(await readNote(vault, rel))
                    if (res.changed > 0) {
                        if (!dryRun) await writeNote(vault, rel, res.content)
                        files.push({ file: rel, changed: res.changed })
                        changed += res.changed
                        const lines = res.content.split(/\r\n|\r|\n/)
                        for (const line of res.flagged)
                            flagged.push({
                                file: rel,
                                line,
                                text: lines[line] ?? '',
                            })
                    }
                } catch (err) {
                    skipped.push({
                        file: rel,
                        error: err instanceof Error ? err.message : String(err),
                    })
                }
            }
            out({ changed, files, flagged, skipped }, args)
        },
    },
}
