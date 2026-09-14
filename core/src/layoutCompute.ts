// The pure layout compute: one job in, one 3D + flat-2D layout out. No fs, no cache, no seed bookkeeping
// and no shared state, so the same function runs on the request thread (the mobile in-process backend,
// or BISMUTH_LAYOUT_IN_PROCESS=1) and inside the layout worker (layoutWorker.ts) with identical output.
// layout-cache.ts decides WHAT to compute; layoutRunner.ts decides WHERE it runs.
import { computeLayoutAsync, type LayoutInput, type Positions } from './layout'
import type { Layout } from './layoutDiff'

export type { Layout }

/** One layout computation, with no cache or seed bookkeeping: everything `computeLayoutPair` needs. */
export type LayoutJob = {
    input: LayoutInput
    refineTicks: number
    seed?: Layout
    fixedIds?: string[]
}

/** 2D warm-start seed for an incremental rebuild: pinned (existing) nodes hold their PRIOR 2D position
 *  (so 2D stays as stable as 3D), while movable nodes start from their freshly-settled 3D position
 *  flattened (so the 2D layout stays aligned with 3D and the morph flattens in place). */
function incremental2dSeed(
    seed: Layout,
    pos3d: Positions,
    fixed: Set<string>,
): Positions {
    const out: Positions = {}
    for (const id of fixed) {
        const p2 = seed.pos2d[id]
        const p3 = seed.pos3d[id]
        out[id] = p2 ? [p2[0], p2[1], 0] : p3 ? [p3[0], p3[1], 0] : [0, 0, 0]
    }
    for (const id in pos3d) {
        if (fixed.has(id)) continue
        const p = pos3d[id]
        out[id] = [p[0], p[1], 0]
    }
    return out
}

/**
 * The pure 3D-then-2D compute for one job — no cache, no seeds, no shared state — so it can run
 * anywhere (a worker included) unchanged. With `fixedIds` + `seed` it is the pinned incremental
 * settle: every fixed node holds its seed position in both dimensions and only the rest settle. Without
 * them it is a full settle, warm-started from `seed.pos3d` when there is a seed, else cold PivotMDS.
 * Either way the 2D layout is seeded from the 3D one, so a 2D↔3D morph flattens in place.
 */
export async function computeLayoutPair(
    job: LayoutJob,
    signal?: AbortSignal,
): Promise<Layout> {
    const { input, refineTicks, seed, fixedIds } = job
    if (fixedIds && seed) {
        const fixed = new Set(fixedIds)
        const pos3d = await computeLayoutAsync(input, {
            dimensions: 3,
            refineTicks,
            initialPositions: seed.pos3d,
            fixedIds,
            signal,
        })
        const pos2d = await computeLayoutAsync(input, {
            dimensions: 2,
            refineTicks,
            initialPositions: incremental2dSeed(seed, pos3d, fixed),
            fixedIds,
            signal,
        })
        return { pos3d, pos2d }
    }
    const pos3d = await computeLayoutAsync(input, {
        dimensions: 3,
        refineTicks,
        initialPositions: seed?.pos3d,
        signal,
    })
    const pos2d = await computeLayoutAsync(input, {
        dimensions: 2,
        refineTicks,
        initialPositions: pos3d,
        signal,
    })
    return { pos3d, pos2d }
}
