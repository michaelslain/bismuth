// bench/basesPerfBench.ts — timing harness for the bases/tasks perf plan
// (.claude/plans/2026-09-17-bases-perf.md). Calls straight into @bismuth/core's exports
// (no HTTP server — isolates exactly the functions under test) against a synthetic vault
// from basesPerfVault.ts. Every task in the plan runs `bun run bench:bases-perf` before
// and after its own change and diffs the printed table — the labels below are the
// contract those before/after comparisons rely on, so change them deliberately.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTaskRows } from '../core/src/bases/tasksData'
import { resolveBaseRows } from '../core/src/bases/source'
import { runView } from '../core/src/bases/query'
import { parseBaseFile } from '../core/src/bases/parse'
import { createAsyncCache } from '../core/src/asyncCache'
import type { Row } from '../core/src/bases/types'
import type { AsyncCache } from '../core/src/asyncCache'
import { buildPerfVault } from './basesPerfVault'
import type { PerfVault } from './basesPerfVault'

export interface PerfResult {
    label: string
    ms: number
}

const VIEW_LOOP_COUNT = 20
const COMPOSED_LOOP_COUNT = 20

/** Optional export from core/src/bases/tasksData.ts, added by task 1 of this plan
 *  (.claude/plans/2026-09-17-bases-perf.md, "incremental task-row patching"). Absent
 *  today — resolved via dynamic import so this file needs no changes once it lands;
 *  the patch-timing row below just starts appearing in the printed table. */
type PatchTaskRows = (
    root: string,
    paths: string[],
    cache: AsyncCache<Row[]>,
) => Promise<void>

async function loadPatchTaskRows(): Promise<PatchTaskRows | null> {
    const mod = await import('../core/src/bases/tasksData').catch(() => null)
    const fn = (mod as { patchTaskRows?: unknown } | null)?.patchTaskRows
    return typeof fn === 'function' ? (fn as PatchTaskRows) : null
}

export async function runBasesPerfBench(
    vault: PerfVault,
): Promise<PerfResult[]> {
    const results: PerfResult[] = []

    // 1. buildTaskRows cold — the full-vault scan finding 1 exists to avoid repeating.
    const coldStart = performance.now()
    await buildTaskRows(vault.root)
    results.push({
        label: 'buildTaskRows (cold, full vault scan)',
        ms: performance.now() - coldStart,
    })

    // 2. The same rebuild again, simulating "one note edited": a fresh full buildTaskRows
    //    call (today's only path — nothing caches this yet, hence finding 1).
    const rebuildStart = performance.now()
    const rebuiltRows = await buildTaskRows(vault.root)
    results.push({
        label: 'buildTaskRows (full rebuild, simulating one note edited)',
        ms: performance.now() - rebuildStart,
    })

    // Once task 1 lands, also time patching a cache pre-seeded with the full row set for
    // ONE changed path — the fix this bench exists to prove out. Skipped gracefully until
    // core/src/bases/tasksData.ts exports patchTaskRows.
    const patchTaskRows = await loadPatchTaskRows()
    if (patchTaskRows) {
        const cache = createAsyncCache<Row[]>(async () => rebuiltRows)
        await cache.get() // pre-seed with the full row set
        const changedPath = rebuiltRows[0]?.file.path
        if (changedPath) {
            const patchStart = performance.now()
            await patchTaskRows(vault.root, [changedPath], cache)
            results.push({
                label: 'patchTaskRows (one changed path against a pre-seeded cache)',
                ms: performance.now() - patchStart,
            })
        }
    } else {
        results.push({
            label: 'patchTaskRows — skipped, not yet exported from tasksData.ts',
            ms: NaN,
        })
    }

    // 3. runView against the calendar base's parsed config, looped 20x against the SAME
    //    resolved rows — exercises per-call overhead (filter/formula/sort evaluation),
    //    not the one-time cost of resolving the rows themselves.
    const calendarText = await readFile(
        join(vault.root, vault.calendarBasePath),
        'utf8',
    )
    const { config: calendarConfig } = parseBaseFile(calendarText, {
        name: vault.calendarBasePath.replace(/\.md$/, ''),
        path: vault.calendarBasePath,
    })
    const calendarRows = await resolveBaseRows(vault.calendarBasePath, {
        root: vault.root,
    })
    const viewStart = performance.now()
    for (let i = 0; i < VIEW_LOOP_COUNT; i++) {
        runView(calendarConfig, calendarRows, 0)
    }
    results.push({
        label: `runView x${VIEW_LOOP_COUNT} (calendar base, same resolved rows)`,
        ms: performance.now() - viewStart,
    })

    // 4. resolveBaseRows against the composed base, looped 20x — each call re-resolves
    //    (including its own source composition), exercising finding 4.
    const composedStart = performance.now()
    for (let i = 0; i < COMPOSED_LOOP_COUNT; i++) {
        await resolveBaseRows(vault.composedBasePath, { root: vault.root })
    }
    results.push({
        label: `resolveBaseRows x${COMPOSED_LOOP_COUNT} (composed base)`,
        ms: performance.now() - composedStart,
    })

    return results
}

const LOOP_LABEL_RE = /x(\d+)\s/

function printResults(results: PerfResult[]): void {
    const rows = results.map(r => {
        const m = r.label.match(LOOP_LABEL_RE)
        const count = m ? Number(m[1]) : null
        return {
            label: r.label,
            ms: Number.isNaN(r.ms) ? 'skipped' : r.ms.toFixed(2),
            'ms/call':
                count && !Number.isNaN(r.ms) ? (r.ms / count).toFixed(3) : '-',
        }
    })
    console.table(rows)
}

if (import.meta.main) {
    const vault = await buildPerfVault()
    try {
        const results = await runBasesPerfBench(vault)
        printResults(results)
    } finally {
        await vault.cleanup()
    }
}
