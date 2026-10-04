// core/src/statusBarEval.ts — evaluates the `statusBar:` items into rendered segments.
import type { Row } from './bases/types'
import { buildVaultRows } from './basesData'
import { buildTaskRows } from './bases/tasksData'
import { resolveSource, resolveRefPath, resolveBaseRows } from './bases/source'
import { parseBaseFile } from './bases/parse'
import { runView, toContext } from './bases/query'
import { getFileAccess } from './fileAccess'
import { fileBasename } from './pathUtils'
import type { TreeEntry } from './graph'
import { passesFilter } from './bases/filters'
import type { SourceSpec } from './bases/types'
import { todayISO } from './dates'
import { renderStatusTemplate, templateTokens, type StatusVars } from './statusBarTemplate'
import type { StatusBarItem, StatusBuiltin, StatusTone } from './statusBarItems'

export type StatusSegment = {
    id: string
    builtin?: StatusBuiltin
    align: 'left' | 'right'
    /** '' for builtins and for untrusted run items. */
    text: string
    tone?: StatusTone
    command?: string
    tooltip?: string
    icon?: string
    /** A run item not yet approved on this machine. */
    untrusted?: { command: string }
    /** A query/run failure; the UI shows `err` with this as its tooltip. */
    error?: string
    /** Present on run items: refresh hint in seconds. */
    every?: number
}

export type StatusRunResult = { output: string } | { error: string }

export type StatusEvalDeps = {
    root: string
    today?: string
    vaultRows?: () => Promise<Row[]>
    vaultTasks?: (paths?: string[]) => Promise<Row[]>
    countFiles: () => Promise<{ files: number; folders: number; notes: number }>
    run: (command: string, every: number) => Promise<StatusRunResult>
    isTrusted: (command: string) => boolean
}

/** {files}/{folders}/{notes} from a listTree() result. `.settings` is vault config and a system
 *  folder (`.daemon`) is not the user's content; neither is counted. */
export function countTree(tree: TreeEntry[]): { files: number; folders: number; notes: number } {
    let files = 0
    let folders = 0
    let notes = 0
    for (const e of tree) {
        if (e.path === '.settings' || e.isSystemFolder || e.path.startsWith('.daemon/')) continue
        if (e.kind === 'dir') folders++
        else {
            files++
            if (e.path.endsWith('.md')) notes++
        }
    }
    return { files, folders, notes }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs `fn` at most once per evaluation; every caller shares the one promise. */
const once = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | undefined
    return () => (p ??= fn())
}

async function queryCount(
    q: NonNullable<StatusBarItem['query']>,
    deps: StatusEvalDeps,
    today: string,
): Promise<number> {
    const ctx = { root: deps.root, today, vaultRows: deps.vaultRows, vaultTasks: deps.vaultTasks }
    if (q.source === 'base') {
        if (!q.ref) return 0
        // what the base SHOWS (its own filters applied), not its source rows
        const path = await resolveRefPath(deps.root, q.ref)
        const text = await (await getFileAccess()).readNote(deps.root, path)
        const { config } = parseBaseFile(text, { name: fileBasename(path), path })
        const shown = runView(config, await resolveBaseRows(path, ctx)).groups.flatMap(g => g.rows)
        const where = q.where
        return where ? shown.filter(r => passesFilter(where, toContext(r))).length : shown.length
    }
    const spec: SourceSpec =
        q.source === 'notes'
            ? { kind: 'notes', from: q.ref, where: q.where }
            : { kind: 'tasks', from: q.ref, where: q.where }
    return (await resolveSource(spec, ctx)).length
}

/** Evaluates every item concurrently; output keeps list order. Never throws (per-item failures
 *  become `error`). Stats/tasks are computed only if some template references them, and at most
 *  once per call. */
export async function evaluateStatusBar(
    items: StatusBarItem[],
    deps: StatusEvalDeps,
): Promise<StatusSegment[]> {
    const today = deps.today ?? todayISO()
    const counts = once(deps.countFiles)
    const rows = once(() => (deps.vaultRows ?? (() => buildVaultRows(deps.root)))())
    const tasks = once(() => (deps.vaultTasks ?? (() => buildTaskRows(deps.root)))())

    const statVars = async (tokens: Set<string>): Promise<StatusVars> => {
        const vars: StatusVars = {}
        if (tokens.has('date')) vars.date = today
        if (tokens.has('files') || tokens.has('folders') || tokens.has('notes')) {
            const c = await counts()
            vars.files = c.files
            vars.folders = c.folders
            vars.notes = c.notes
        }
        if (tokens.has('tags')) {
            const all = new Set<string>()
            for (const r of await rows()) for (const t of r.file?.tags ?? []) all.add(t)
            vars.tags = all.size
        }
        if ([...tokens].some(t => t.startsWith('tasks.'))) {
            let open = 0
            let done = 0
            let due = 0
            let overdue = 0
            for (const r of await tasks()) {
                const n = r.note as Record<string, unknown>
                if (n.status === 'done') done++
                if (n.resolved === true || n.status === 'done' || n.status === 'cancelled') continue
                open++
                const d = typeof n.due === 'string' ? n.due : undefined
                if (d === today) due++
                else if (d && d < today) overdue++
            }
            vars['tasks.open'] = open
            vars['tasks.done'] = done
            vars['tasks.due'] = due
            vars['tasks.overdue'] = overdue
        }
        return vars
    }

    return Promise.all(
        items.map(async item => {
            const seg: StatusSegment = { id: item.id, align: item.align, text: '' }
            if (item.builtin) seg.builtin = item.builtin
            if (item.tone) seg.tone = item.tone
            if (item.command) seg.command = item.command
            if (item.tooltip) seg.tooltip = item.tooltip
            if (item.icon) seg.icon = item.icon
            try {
                if (item.builtin) {
                    // builtins render in the UI; the segment only carries placement
                } else if (item.run !== undefined) {
                    seg.every = item.every
                    if (!deps.isTrusted(item.run)) {
                        seg.untrusted = { command: item.run }
                    } else {
                        const r = await deps.run(item.run, item.every)
                        if ('error' in r) seg.error = r.error
                        else seg.text = item.text !== undefined
                            ? renderStatusTemplate(item.text, { output: r.output, ...(await statVars(templateTokens(item.text))) })
                            : r.output
                    }
                } else {
                    const tokens = item.text !== undefined ? templateTokens(item.text) : new Set<string>()
                    const vars = await statVars(tokens)
                    if (item.query) {
                        const count = await queryCount(item.query, deps, today)
                        vars.count = count
                        seg.text = item.text !== undefined ? renderStatusTemplate(item.text, vars) : String(count)
                    } else {
                        seg.text = renderStatusTemplate(item.text ?? '', vars)
                    }
                }
            } catch (e) {
                seg.text = ''
                seg.error = msg(e)
            }
            return seg
        }),
    )
}
