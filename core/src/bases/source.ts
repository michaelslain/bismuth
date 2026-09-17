import type { BaseConfig, Row, SourceSpec } from './types'
import { buildVaultRows } from '../basesData'
import { buildTaskRows } from './tasksData'
import { parseBaseFile } from './parse'
import { passesFilter } from './filters'
import { toContext, resolveProperty } from './query'
import { translateTaskDsl, looksLikeTaskDsl, applyTaskSort } from './taskDsl'
import { getFileAccess } from '../fileAccess'
import { fileBasename } from '../pathUtils'
import { refToPath } from './sourceSpec'
import { todayISO } from '../dates'

export interface SourceCtx {
    root: string
    today?: string
    /** Base file paths already entered, for cycle protection across composition.
     *  Paths are resolved to their real paths (symlinks dereferenced) before adding to prevent
     *  symlink-based cycles (e.g., A -> link-to-A -> A). */
    seen?: Set<string>
    /** Optional provider for the full (unscoped) vault rows, letting the caller serve them
     *  from a cache instead of re-scanning. Falls back to buildVaultRows(root) when absent. */
    vaultRows?: () => Promise<Row[]>
    /** Optional provider for vault task rows. Called with no paths for the unscoped/global case
     *  (the caller may cache that); with `paths` for scoped extraction (never cached). Falls back
     *  to buildTaskRows(root, paths) when absent. */
    vaultTasks?: (paths?: string[]) => Promise<Row[]>
}

// Composed base files are re-parsed on every resolveBaseRows call along a composition
// chain; cache the parse keyed by CONTENT (not mtime — see the comment at the call
// site below) so repeated resolves of the same unchanged base file skip parseBaseFile.
const baseParseCache = new Map<string, { raw: string; config: BaseConfig; rows: Row[] }>()

/**
 * Resolve a base FILE to its rows, following its OWN declared source (composition).
 * An own-rows base (no `source:`) returns its inline table rows; a base whose source
 * is notes/tasks/another-base re-runs that source. Cycles terminate via `seen` after
 * resolving symlinks to prevent symlink-based loops.
 */
export async function resolveBaseRows(
    path: string,
    ctx: SourceCtx,
): Promise<Row[]> {
    const seen = ctx.seen ?? new Set<string>()
    const fa = await getFileAccess()

    // Resolve symlinks to their real paths to detect cycles even through symlink chains.
    // E.g., if A -> link-to-A or A -> B -> link-to-A, both are caught. Best-effort:
    // realPath() falls back to the input path when it can't resolve (e.g. on iOS).
    const realPath = await fa.realPath(path)

    if (seen.has(realPath)) return [] // cycle: A -> ... -> A (possibly through symlinks)
    seen.add(realPath)

    let text: string
    try {
        text = await fa.readNote(ctx.root, path)
    } catch {
        return []
    }
    const name = fileBasename(path)
    // Keyed by content equality, NOT mtime: filesystem mtime resolution is commonly
    // 1s or coarser, so an edit-then-immediate-read within the same tick could
    // incorrectly serve a stale parse under an mtime check. Comparing the raw text
    // (already read above) costs nothing extra and has no such race.
    const cached = baseParseCache.get(realPath)
    const fresh = cached?.raw === text
    const parsed = fresh ? cached! : parseBaseFile(text, { name, path })
    if (!fresh) baseParseCache.set(realPath, { raw: text, config: parsed.config, rows: parsed.rows })
    const { config, rows } = parsed
    // No declared source => inline (own-rows) base: return its table rows.
    if (!config.source) return rows
    return resolveSource(config.source, { ...ctx, seen })
}

/** Resolve any source (base | notes | tasks) to a uniform Row[]. */
export async function resolveSource(
    spec: SourceSpec,
    ctx: SourceCtx,
): Promise<Row[]> {
    const today = ctx.today ?? todayISO()

    if (spec.kind === 'base') {
        if (!spec.ref) return []
        return resolveBaseRows(refToPath(spec.ref), ctx)
    }

    if (spec.kind === 'notes') {
        let rows = await (ctx.vaultRows?.() ?? buildVaultRows(ctx.root))
        if (spec.from) {
            const scoped = await resolveBaseRows(refToPath(spec.from), ctx)
            const paths = new Set(scoped.map(r => r.file.path))
            rows = rows.filter(r => paths.has(r.file.path))
        }
        if (!spec.where) return rows
        return rows.filter(r => passesFilter(spec.where!, toContext(r)))
    }

    // tasks — optionally scoped to the notes a referenced base selects.
    let paths: string[] | undefined
    if (spec.from) {
        const scoped = await resolveBaseRows(refToPath(spec.from), ctx)
        paths = [...new Set(scoped.map(r => r.file.path))].filter(Boolean)
    }
    // Unscoped (no `from`) is the global case the provider may cache; scoped extraction
    // (paths set) must always run fresh, so only the provider's no-arg call is cacheable.
    const rows = paths
        ? await buildTaskRows(ctx.root, paths)
        : await (ctx.vaultTasks?.() ?? buildTaskRows(ctx.root))
    // Task filters are Bases filter expressions, the same language `notes` uses above.
    // A `where` still holding legacy Tasks-DSL text is translated on the way in, so an
    // un-migrated ```query block keeps working — INCLUDING a trailing `sort by …` line,
    // which the old evaluator applied in the same pass as the filter. Losing that here
    // silently turns the query builder's sort control into a no-op for every tasks
    // source, since it still emits `sort by …` lines.
    if (!spec.where) return rows
    const isDsl = looksLikeTaskDsl(spec.where)
    const translation = isDsl ? translateTaskDsl(spec.where, today) : undefined
    const expr = isDsl ? translation!.where : spec.where
    const filtered = expr ? rows.filter(r => passesFilter(expr, toContext(r))) : rows
    return isDsl
        ? applyTaskSort(filtered, translation!.sort, (r, p) => resolveProperty(p, r))
        : filtered
}
