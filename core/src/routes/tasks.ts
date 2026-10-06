import { listMarkdown, readNote, writeNote, fileExists } from '../files'
import { AppError } from '../error'
import {
    collectVaultTasks,
    applyTaskToggle,
    setTaskLineDate,
    archiveResolvedTasks,
} from '../tasks'
import { appendTaskLine, resolveTaskFilePath } from '../taskCreate'
import { updateTaskLineFields, removeTaskItem } from '../taskEdit'
import type { TaskPatch } from '../taskEdit'
import { todayISO } from '../dates'
import { filterByPath } from '../visibilityFilter'
import { ok, type Handler, type RouteContext } from './context'

export default function tasksRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { denyEntriesForRequest, cfg } = ctx
    return {
        'GET /tasks': async (req, __) => {
            const tasks = await collectVaultTasks(cfg.vault)
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterByPath(tasks, denyEntries, t => t.path))
        },

        // What the boot-time task-syntax migration did, for the app to toast once on mount.
        // A read, not a mutation — the rewrite already happened at boot. `ran: null` means
        // the pass is still walking the vault, which the frontend treats as "ask again in a
        // moment" rather than "nothing happened".
        //
        // Deny-filtered like every other content read: `flagged` carries a note's actual line
        // text and `files`/`skipped` their paths, so an AI-visibility-restricted note would
        // otherwise leak through a route that only means to report counts. `changed` is
        // re-summed from the filtered files rather than passed through, because the total
        // otherwise tells a denied caller how many converted lines live in notes it cannot
        // see — and because the app renders it beside `files.length`, which IS per-channel.
        // Migration runs regardless of visibility; this only decides who is TOLD.
        'GET /tasks/migration': async req => {
            if (!ctx.taskMigration) return ok({ ran: null })
            const denyEntries = await denyEntriesForRequest(req)
            const files = filterByPath(
                ctx.taskMigration.files,
                denyEntries,
                f => f.file,
            )
            return ok({
                ...ctx.taskMigration,
                files,
                changed: files.reduce((n, f) => n + f.changed, 0),
                flagged: filterByPath(
                    ctx.taskMigration.flagged,
                    denyEntries,
                    f => f.file,
                ),
                skipped: filterByPath(
                    ctx.taskMigration.skipped,
                    denyEntries,
                    f => f.file,
                ),
            })
        },
    }
}

export function tasksMutatingRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { mutatingHandler, cfg } = ctx
    return {
        'POST /tasks/toggle': mutatingHandler(
            async req => {
                const { path, line, status } = (await req.json()) as {
                    path: string
                    line: number
                    status?: string
                }
                const content = await readNote(cfg.vault, path)
                // An explicit `status` (the right-click status menu) sets that exact box char;
                // otherwise it's the plain binary toggle (checkbox click). Resolved tasks sink
                // to the bottom of their list, matching the card view's grouping.
                await writeNote(
                    cfg.vault,
                    path,
                    applyTaskToggle(content, line, status, todayISO()),
                )
                return ok()
            },
            b => b.path,
        ),

        // Calendar drag-to-reschedule: rewrite the ONE date field that placed the task
        // (`scheduled` or `due` — never both) to a new ISO date. Always writes the bracket
        // form, same as toggling — see setTaskLineDate.
        'POST /tasks/reschedule': mutatingHandler(
            async req => {
                const { path, line, field, date } = (await req.json()) as {
                    path: string
                    line: number
                    field: 'due' | 'scheduled' | 'start'
                    date: string
                }
                const content = await readNote(cfg.vault, path)
                const eol = content.includes('\r\n') ? '\r\n' : '\n'
                const lines = content.split(/\r?\n/)
                if (line < 0 || line >= lines.length) {
                    throw new AppError('EINVAL', 'line out of range', 400)
                }
                lines[line] = setTaskLineDate(lines[line], field, date)
                await writeNote(cfg.vault, path, lines.join(eol))
                return ok()
            },
            b => b.path,
        ),

        // Edit a task's description and/or due/scheduled/start/priority fields in place —
        // the UI counterpart to hand-editing the line. `patch` keys set to `null` clear that
        // field; an absent key leaves it untouched. See updateTaskLineFields (taskEdit.ts).
        'POST /tasks/update': mutatingHandler(
            async req => {
                const { path, line, patch } = (await req.json()) as {
                    path: string
                    line: number
                    patch: TaskPatch
                }
                const content = await readNote(cfg.vault, path)
                const eol = content.includes('\r\n') ? '\r\n' : '\n'
                const lines = content.split(/\r?\n/)
                if (line < 0 || line >= lines.length) {
                    throw new AppError('EINVAL', 'line out of range', 400)
                }
                lines[line] = updateTaskLineFields(lines[line], patch)
                await writeNote(cfg.vault, path, lines.join(eol))
                return ok()
            },
            b => b.path,
        ),

        // Delete a task LINE's whole block (the line plus any deeper-indented sub-tasks /
        // wrapped continuation) from the note. See removeTaskItem (taskEdit.ts).
        'POST /tasks/delete': mutatingHandler(
            async req => {
                const { path, line } = (await req.json()) as {
                    path: string
                    line: number
                }
                const content = await readNote(cfg.vault, path)
                let result
                try {
                    result = removeTaskItem(content, line)
                } catch {
                    throw new AppError('EINVAL', 'line out of range', 400)
                }
                await writeNote(cfg.vault, path, result.content)
                return ok()
            },
            b => b.path,
        ),

        // Move a task LINE's whole block to another note, resolving `to` exactly like
        // POST /tasks/create's `file` (a taskFile ref: wikilink, bare name, or path).
        // Moving onto the note it's already in is a no-op that still reports success.
        'POST /tasks/move': mutatingHandler(async req => {
            const { path, line, to } = (await req.json()) as {
                path: string
                line: number
                to: string
            }
            const noteIds = (await listMarkdown(cfg.vault)).map(rel =>
                rel.endsWith('.md') ? rel.slice(0, -3) : rel,
            )
            const destPath = resolveTaskFilePath(to, noteIds)
            if (destPath === path) return ok({ path })

            const content = await readNote(cfg.vault, path)
            let result
            try {
                result = removeTaskItem(content, line)
            } catch {
                throw new AppError('EINVAL', 'line out of range', 400)
            }
            await writeNote(cfg.vault, path, result.content)

            const destText = fileExists(cfg.vault, destPath)
                ? await readNote(cfg.vault, destPath)
                : ''
            const sep =
                destText.length === 0 || destText.endsWith('\n') ? '' : '\n'
            await writeNote(
                cfg.vault,
                destPath,
                `${destText}${sep}${result.removed.join('\n')}\n`,
            )
            return ok({ path: destPath })
        }),

        // Archive completed/cancelled tasks. With a `path`, only that note; otherwise the whole
        // vault. Removal is permanent (git retains history). Returns the count removed.
        'POST /tasks/archive': mutatingHandler(
            async req => {
                const { path } = (await req.json().catch(() => ({}))) as {
                    path?: string
                }
                if (path) {
                    const { content, removed } = archiveResolvedTasks(
                        await readNote(cfg.vault, path),
                    )
                    if (removed > 0) await writeNote(cfg.vault, path, content)
                    return ok({ removed, files: removed > 0 ? 1 : 0 })
                }
                const rels = await listMarkdown(cfg.vault)
                let removed = 0
                let files = 0
                for (const rel of rels) {
                    const res = archiveResolvedTasks(
                        await readNote(cfg.vault, rel),
                    )
                    if (res.removed > 0) {
                        await writeNote(cfg.vault, rel, res.content)
                        removed += res.removed
                        files++
                    }
                }
                return ok({ removed, files })
            },
            b => (b as { path?: string }).path,
        ),

        // The write seam for the "+ task" action: `file` is a taskFile REF (a wikilink, same
        // shape as source.from/source.ref), never a literal path — resolveTaskFilePath is what
        // makes that safe (see taskCreate.ts's header for the defect this fixes). Mutating, not
        // read-table: PUT /file doesn't invalidate, which is the exact race taskScope.ts's
        // header describes (a refetch right after a create legitimately missing the new row).
        // No `pathOf`: the written path isn't known until resolveTaskFilePath runs against the
        // vault's live note list, which pathOf can't do (it only sees the raw request body,
        // synchronously, before `run` executes) — so this always falls back to full invalidation,
        // same as /daily-note and the legacy branch of /cards/review above.
        'POST /tasks/create': mutatingHandler(async req => {
            const { file, body } = (await req.json()) as {
                file: string
                body: string
            }
            const path = await appendTaskLine(cfg.vault, file, body)
            return ok({ path })
        }),
    }
}
