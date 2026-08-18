import { expect, test } from 'bun:test'
import {
    modularity,
    significance,
    nullModelModularity,
    nullModelForGraph,
} from '../src/communitySignificance'

/** Two 6-cliques joined by a single bridge — unambiguous community structure. */
function twoCliques(): { adj: number[][]; comm: number[] } {
    const adj: number[][] = Array.from({ length: 12 }, () => [])
    const link = (a: number, b: number) => {
        adj[a].push(b)
        adj[b].push(a)
    }
    for (const base of [0, 6]) {
        for (let i = base; i < base + 6; i++)
            for (let j = i + 1; j < base + 6; j++) link(i, j)
    }
    link(0, 6) // the bridge
    return { adj, comm: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] }
}

/** A ring — every node has degree 2 and there is no community structure to find. */
function ring(n: number, groups: number): { adj: number[][]; comm: number[] } {
    const adj: number[][] = Array.from({ length: n }, () => [])
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        adj[i].push(j)
        adj[j].push(i)
    }
    return {
        adj,
        comm: Array.from({ length: n }, (_, i) => Math.floor(i / (n / groups))),
    }
}

test('modularity is high for two well-separated cliques', () => {
    const { adj, comm } = twoCliques()
    expect(modularity(adj, comm)).toBeGreaterThan(0.4)
})

test('two cliques are significant against the null model', () => {
    const { adj, comm } = twoCliques()
    const s = significance(adj, comm, 30)
    expect(s.significant).toBe(true)
    expect(s.z).toBeGreaterThan(2)
})

test('an arbitrary partition of a ring is NOT significant', () => {
    // A ring's partition has non-trivial raw Q, which is exactly the trap: it must still
    // fail the null-model test, because a random graph with this degree sequence does as well.
    const { adj, comm } = ring(60, 6)
    const s = significance(adj, comm, 30)
    expect(s.significant).toBe(false)
})

test('modularity is 0 when every node is in one community', () => {
    const { adj } = twoCliques()
    expect(modularity(adj, new Array(12).fill(0))).toBeCloseTo(0, 6)
})

// --- Fix round 1 -----------------------------------------------------------------------------
// Findings from the first review pass. Each test below is annotated with the finding ID it pins.

/** Generalises `twoCliques()` to an arbitrary clique size — same shape (two k-cliques, one bridge
 *  edge from node 0 to node k), so k=6 reproduces `twoCliques()` exactly (checked: identical Q/z). */
function twoCliquesOfSize(k: number): { adj: number[][]; comm: number[] } {
    const adj: number[][] = Array.from({ length: 2 * k }, () => [])
    const link = (a: number, b: number) => {
        adj[a].push(b)
        adj[b].push(a)
    }
    for (const base of [0, k]) {
        for (let i = base; i < base + k; i++)
            for (let j = i + 1; j < base + k; j++) link(i, j)
    }
    link(0, k) // the bridge
    return {
        adj,
        comm: Array.from({ length: 2 * k }, (_, i) => (i < k ? 0 : 1)),
    }
}

test('Minor 5: modularity is 0 (not NaN) on a graph with no edges', () => {
    // `if (m2 === 0) return 0` in `modularity` was untested and load-bearing: remove it and an
    // all-isolated graph divides by zero into NaN, which fails closed today only by accident
    // (`NaN >= 2` is false) — a NaN would still surface anywhere `q`/`z` gets displayed.
    const adj: number[][] = Array.from({ length: 5 }, () => [])
    expect(modularity(adj, [0, 1, 2, 3, 4])).toBe(0)
})

test('I1: trials <= 1 is clamped to a real sample, not skipped to Infinity', () => {
    // OLD bug: `nullModelModularity(adj, comm, 0)` looped zero times, so `qs` stayed empty and
    // mean/sd both silently fell back to 0 (`reduce(..., 0) / (0 || 1)`) — then
    // `q > mean ? Infinity : 0` turned ANY graph with Q > 0 into `z: Infinity, significant: true`
    // WITHOUT ever running a null trial. `trials = 1` hit the same path (sd of one sample is 0).
    // Scenario this guards: `trials` gets exposed as a perf knob and someone sets it to 0/1 to skip
    // an expensive check — every level must not silently read as significant.
    const { adj, comm } = ring(60, 6)
    for (const trials of [0, 1]) {
        const s = significance(adj, comm, trials)
        expect(s.nullSd).toBeGreaterThan(0) // a real (clamped-to->=2-trial) null was actually sampled
        expect(Number.isFinite(s.z)).toBe(true) // not the old Infinity short-circuit
        expect(s.significant).toBe(false) // the ring is still correctly rejected under the floor
    }
})

test('I1: a zero-variance null fails CLOSED, not open', () => {
    // All-isolated nodes: every rewired null graph is edgeless too (m2 === 0 for all of them), so
    // nullMean/nullSd are both exactly 0. The old `q > mean ? Infinity : 0` ternary only avoided
    // Infinity here by coincidence (q also happens to equal mean, 0 > 0 is false) — this pins that a
    // degenerate (sd === 0) null NEVER reports `significant: true`, `z: Infinity`, or `NaN`,
    // regardless of how the degeneracy is reached, rather than relying on that coincidence.
    const adj: number[][] = Array.from({ length: 5 }, () => [])
    const s = significance(adj, [0, 1, 2, 3, 4], 5)
    expect(s.nullSd).toBe(0)
    expect(s.z).toBe(0)
    expect(s.significant).toBe(false)
})

test('I2: two cliques of 4 sit just under the z>=2 gate — pins the threshold from below', () => {
    // z >= 1, z >= 0, even z >= -1 all passed the suite before this test: the ring's z ~= -1.1 was
    // the only lower anchor, so loosening the constant during Part-2 tuning would have kept CI green.
    // Two 4-cliques joined by a bridge land at z ~= 1.85 at trials=100 (stable across trials
    // 90-150, all comfortably inside the 1 < z < 2 band) — genuine, textbook-clean community
    // structure that the CURRENT threshold correctly rejects. A test that only fails at trials=30
    // would land at z ~= 2.15 (the wrong side) and could not pin anything; trials=100 was chosen for
    // exactly this stability, not to hit a specific decimal.
    const { adj, comm } = twoCliquesOfSize(4)
    const s = significance(adj, comm, 100)
    expect(s.z).toBeGreaterThan(1) // discriminates against a loosened z>=1 (or z>=0/z>=-1) threshold
    expect(s.z).toBeLessThan(2)
    expect(s.significant).toBe(false)
})

test('I3: nullModelModularity is invariant to comm — DO NOT wire comm back in', () => {
    // The null is a property of the graph's DEGREE SEQUENCE only (see `nullModelForGraph`'s doc
    // comment): re-scoring `comm` against rewired edges is the exact defect this module exists to
    // reject (it's what silently made the plan's original design always pass, including the ring —
    // see the ring test above and the module-level comment). A future contributor reading `void
    // comm;` may reasonably try to "fix" what looks like a dropped parameter by wiring it back in;
    // that would silently restore the always-open gate. If this test starts failing because `comm`
    // got threaded into the null computation, the CHANGE is the regression, not this test.
    const { adj } = twoCliques()
    const a = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] // the real, structure-respecting partition
    const b = new Array(12).fill(0) // wildly different: everything in one community
    expect(nullModelModularity(adj, a, 5)).toEqual(
        nullModelModularity(adj, b, 5),
    )
})

test('I3: nullModelModularity delegates to the exported nullModelForGraph', () => {
    // Pins the hoisting contract: a caller gating several partitions of the SAME graph (e.g. every
    // level of a community hierarchy) can call `nullModelForGraph(adj, trials, seed)` once and reuse
    // it, instead of paying per level through `nullModelModularity`/`significance`.
    const { adj, comm } = twoCliques()
    expect(nullModelModularity(adj, comm, 5)).toEqual(nullModelForGraph(adj, 5))
})
