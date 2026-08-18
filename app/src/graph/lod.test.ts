// app/src/graph/lod.test.ts
//
// Pure LOD math: the per-level aggregate structure (buildLodIndex), the aggregate-edge weight
// scale, the entity mass form (sqrt-scaled radii, ramp glyphs), and — most load-bearing — the
// LEVEL MAPPING of the zoom ladder (lodMix): which hierarchy level owns the field at each stop,
// and where the leaves take over. AsciiGraphRenderer.test.ts covers the same behaviour end to end
// through the raster buffers; this file pins the arithmetic directly.
import { describe, expect, it } from 'bun:test'
import {
    AGG_EDGE_DOUBLE_W,
    aggEdgeWeight,
    buildLodIndex,
    LOD_MIN_CLUSTER,
    LOD_REP_POINTS_K,
    lodMix,
    massCellAlpha,
    massCellCode,
    massRadii,
} from './lod'
import { FILE_LABEL_REVEAL_T } from './labelSelection'
import { CELL_H, CELL_W } from './asciiGrid'

/** Two-level fixture: TOP 0 = {a0..a3 at x≈-100} + {b0,b1 at x≈-60}, TOP 1 = {c0..c2 at x≈100}.
 *  Cross-links: 3 between the tops (a–c), 2 inside TOP 0 (a–b).
 *  NOTE its sub-clusters are 2-4 members, i.e. below the shipped `LOD_MIN_CLUSTER`, so the grouping
 *  tests below pass `minCluster: 1` explicitly — they pin the grouping/centroid/edge ARITHMETIC, which
 *  is independent of the "don't summarize a 1-note cluster" product gate (tested separately). */
function nodes() {
    const out = []
    for (let i = 0; i < 4; i++)
        out.push({ id: `a${i}`, path: [0, 0], x: -100, y: i * 10 })
    for (let i = 0; i < 2; i++)
        out.push({ id: `b${i}`, path: [0, 1], x: -60, y: i * 10 })
    for (let i = 0; i < 3; i++)
        out.push({ id: `c${i}`, path: [1, 2], x: 100, y: i * 10 })
    return out
}
const edges = [
    { from: 'a0', to: 'c0' },
    { from: 'a1', to: 'c1' },
    { from: 'a2', to: 'c2' }, // 3 cross-top
    { from: 'a0', to: 'b0' },
    { from: 'a1', to: 'b1' }, // 2 intra-top, cross-sub
    { from: 'a0', to: 'a1' }, // 1 intra-sub (no aggregate)
]

describe('buildLodIndex — aggregate entities', () => {
    it('groups per level with correct counts and member ids, largest cluster first', () => {
        const levels = buildLodIndex(nodes(), edges, 1)
        expect(levels.length).toBe(2)
        // Level 0: TOP 0 (6 members) before TOP 1 (3).
        expect(levels[0].clusters.map(c => [c.community, c.count])).toEqual([
            [0, 6],
            [1, 3],
        ])
        expect(new Set(levels[0].clusters[0].memberIds)).toEqual(
            new Set(['a0', 'a1', 'a2', 'a3', 'b0', 'b1']),
        )
        // Level 1: sub 0 (4) then sub 2 (3) then sub 1 (2).
        expect(levels[1].clusters.map(c => [c.community, c.count])).toEqual([
            [0, 4],
            [2, 3],
            [1, 2],
        ])
    })

    it("positions every entity at its members' centroid", () => {
        const levels = buildLodIndex(nodes(), edges, 1)
        const top0 = levels[0].clusters.find(c => c.community === 0)!
        // (4×-100 + 2×-60) / 6
        expect(top0.wx).toBeCloseTo((4 * -100 + 2 * -60) / 6, 10)
        const sub2 = levels[1].clusters.find(c => c.community === 2)!
        expect(sub2.wx).toBeCloseTo(100, 10)
        expect(sub2.wy).toBeCloseTo(10, 10)
    })

    it("records each entity's member SPREAD, not just its centroid — how big the summarized thing is", () => {
        // The phosphor bloom emits an aggregate as a cloud of this size (densityField.ts pushCloud);
        // emitted at the centroid alone it out-peaks the leaves it stands for and blacks out the field.
        const levels = buildLodIndex(nodes(), edges, 1)
        // TOP 0 = 4 members at x=-100 and 2 at x=-60. mean = -86.6…; population variance is computed
        // here from the fixture rather than copied off the implementation.
        const xs = [-100, -100, -100, -100, -60, -60]
        const ys = [0, 10, 20, 30, 0, 10]
        const pop = (v: number[]) => {
            const m = v.reduce((a, b) => a + b, 0) / v.length
            return Math.sqrt(
                v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length,
            )
        }
        const top0 = levels[0].clusters.find(c => c.community === 0)!
        expect(top0.sdx).toBeCloseTo(pop(xs), 8)
        expect(top0.sdy).toBeCloseTo(pop(ys), 8)
        expect(top0.sdx).toBeGreaterThan(0)
        // A cluster whose members share an axis has ZERO spread on it — not a NaN, and not a fudge.
        const sub2 = levels[1].clusters.find(c => c.community === 2)! // all three at x = 100
        expect(sub2.sdx).toBe(0)
        expect(sub2.sdy).toBeCloseTo(pop([0, 10, 20]), 8)
    })

    it('aggregates inter-cluster links per level with real counts (intra-cluster links never count)', () => {
        const levels = buildLodIndex(nodes(), edges, 1)
        // Level 0: ONE connector — the 3 a–c links; the a–b and a–a links live inside TOP 0.
        expect(levels[0].edges.length).toBe(1)
        expect(levels[0].edges[0].count).toBe(3)
        expect(levels[0].edges[0].w).toBe(1) // the level's heaviest connector reads full
        // Level 1: sub0–sub2 (3 links) and sub0–sub1 (2 links); a0–a1 stays inside sub 0.
        const l1 = levels[1].edges.map(e => e.count).sort((x, y) => y - x)
        expect(l1).toEqual([3, 2])
        const heavy = levels[1].edges.find(e => e.count === 3)!
        const light = levels[1].edges.find(e => e.count === 2)!
        expect(heavy.w).toBe(1)
        expect(light.w).toBeCloseTo(Math.log1p(2) / Math.log1p(3), 10)
        expect(light.w).toBeLessThan(heavy.w)
    })

    it('returns an empty structure when no node carries a hierarchy (LOD off)', () => {
        expect(buildLodIndex([{ id: 'x', x: 0, y: 0 }], [])).toEqual([])
    })

    it('omits communities under LOD_MIN_CLUSTER — a summary view is not a scatter of 1-note dots', () => {
        // The reference vault has 143 fully-isolated notes; as singleton communities at every level they
        // turned the coarsest stop into 15 real masses plus 143 unnamed, indistinguishable dots.
        const many = [
            ...Array.from({ length: 8 }, (_, i) => ({
                id: `big${i}`,
                path: [0, 0],
                x: 0,
                y: i,
            })),
            ...Array.from({ length: 20 }, (_, i) => ({
                id: `orphan${i}`,
                path: [i + 1, i + 1],
                x: 500,
                y: i,
            })),
        ]
        const gated = buildLodIndex(many, [])
        expect(gated[0].clusters.map(c => c.count)).toEqual([8])
        // ...and the gate is exactly the shipped constant, not an ad-hoc number.
        expect(LOD_MIN_CLUSTER).toBe(4)
        // With the gate opened, every singleton comes back — so the omission really is the gate.
        expect(buildLodIndex(many, [], 1)[0].clusters.length).toBe(21)
    })

    it('drops aggregate edges whose endpoint community was gated out', () => {
        const ns = [
            ...Array.from({ length: 5 }, (_, i) => ({
                id: `a${i}`,
                path: [0],
                x: 0,
                y: i,
            })),
            ...Array.from({ length: 5 }, (_, i) => ({
                id: `b${i}`,
                path: [1],
                x: 100,
                y: i,
            })),
            { id: 'lonely', path: [2], x: 200, y: 0 },
        ]
        const es = [
            { from: 'a0', to: 'b0' },
            { from: 'a1', to: 'lonely' },
        ]
        const levels = buildLodIndex(ns, es)
        expect(levels[0].clusters.length).toBe(2) // "lonely" is not summarized
        expect(levels[0].edges.length).toBe(1) // ...so neither is its connector
        expect(levels[0].edges[0].count).toBe(1)
    })
})

describe('buildLodIndex — per-cluster representative points (reps)', () => {
    /** Weighted population sd of a rep set, on one axis — same population-variance formula the
     *  `pop()` helper above uses on raw members, just weighted. Used to compare a `reps` set's own
     *  implied spread against the cluster's real member spread (`sdx`/`sdy`), which the "records
     *  each entity's member SPREAD" test above already pins as the correct population sd of the raw
     *  fixture coordinates — so comparing against `c.sdx`/`c.sdy` here is comparing against
     *  independently-verified ground truth, not against this file's own new code. */
    function weightedPopSd(
        reps: { x: number; y: number; weight: number }[],
        axis: 'x' | 'y',
    ): number {
        const W = reps.reduce((a, r) => a + r.weight, 0)
        const m = reps.reduce((a, r) => a + r.weight * r[axis], 0) / W
        const v =
            reps.reduce(
                (a, r) => a + r.weight * (r[axis] - m) * (r[axis] - m),
                0,
            ) / W
        return Math.sqrt(v)
    }

    // NOTE on constant-independence (Round-1 review, CRITICAL-2): every `k` used below is a LITERAL
    // passed explicitly to `buildLodIndex`'s 4th argument, never the imported `LOD_REP_POINTS_K`.
    // These tests pin the ALGORITHM's behaviour at a given k; whether 24 (or 8, or 64) is the right
    // SHIPPED default is a separate, narrower claim pinned once, below, directly on the constant.

    it(
        'reproduces the members EXACTLY, as a set with unit weights, whenever k >= the member count ' +
            '(both comfortably above n and exactly at n === k)',
        () => {
            const ns = Array.from({ length: 7 }, (_, i) => ({
                id: `m${i}`,
                path: [0],
                x: i * 3,
                y: -i * 5,
            }))
            for (const k of [7, 24]) {
                // n === k, and k comfortably above n — both literals
                const c = buildLodIndex(ns, [], 1, k)[0].clusters[0]
                expect(c.count).toBe(7)
                expect(c.reps.length).toBe(7)
                expect(c.reps.every(r => r.weight === 1)).toBe(true)
                expect(new Set(c.reps.map(r => `${r.x},${r.y}`))).toEqual(
                    new Set(ns.map(n => `${n.x},${n.y}`)),
                )
            }
        },
    )

    it('drops no member at n = k + 1 — the smallest case where reps stop being exact', () => {
        // Round-1 review (IMPORTANT-2) found a first version silently dropped exactly one member here
        // (always the last in encounter order). With k-means, n = k+1 puts one real member into some
        // cluster alongside another, so weight conservation must still hold exactly even though
        // point-level exactness has just ended (one rep is now a 2-member average).
        const k = 24
        const ns = Array.from({ length: k + 1 }, (_, i) => ({
            id: `m${i}`,
            path: [0],
            x: i * 7,
            y: i * i,
        }))
        const c = buildLodIndex(ns, [], 1, k)[0].clusters[0]
        expect(c.count).toBe(k + 1)
        expect(c.reps.length).toBeLessThanOrEqual(k)
        const total = c.reps.reduce((a, r) => a + r.weight, 0)
        expect(total).toBe(k + 1) // exact integer — see the dedicated exactness test below
        for (const r of c.reps) expect(Number.isInteger(r.weight)).toBe(true)
    })

    it(
        'conserves total weight as an EXACT INTEGER — no members lost or double-counted — ' +
            'whether k is below, at, or above n',
        () => {
            // v1's `n / k` weight landed off by up to 9.09e-13 in a broader sweep (Round-1 review,
            // IMPORTANT-3); k-means weights are member COUNTS, so the sum must be bit-exact, not merely
            // toBeCloseTo.
            const ns = Array.from({ length: 10 }, (_, i) => ({
                id: `m${i}`,
                path: [0],
                x: i,
                y: i * i,
            }))
            for (const k of [3, 7, 10, 24]) {
                const c = buildLodIndex(ns, [], 1, k)[0].clusters[0]
                expect(c.reps.length).toBeLessThanOrEqual(Math.min(10, k))
                const totalWeight = c.reps.reduce((a, r) => a + r.weight, 0)
                expect(totalWeight).toBe(10) // ABSOLUTE and bit-exact: ten members in, ten members' worth of weight out
                for (const r of c.reps)
                    expect(Number.isInteger(r.weight)).toBe(true)
            }
        },
    )

    it(
        'a spatially separated 8-member sub-blob inside a 300-member cluster keeps its own ' +
            'representation — not zeroed by encounter order, not diluted away',
        () => {
            // Round-1 review CRITICAL-1: a real vault's `core/src/files.ts` walk is folder-contiguous and
            // unsorted, so a cluster's members arrive as contiguous per-folder runs, not a
            // position-independent shuffle. This fixture reproduces that shape directly: 292 "background"
            // members spread broadly (never near the sub-blob) plus an 8-member sub-blob planted as ONE
            // CONTIGUOUS RUN in the middle of encounter order — the folder-run shape the review measured
            // failing against a stride sample.
            //
            // WHY 8, NOT THE REVIEW'S OWN "20-member" EXAMPLE: checked directly against a fixed-stride
            // sampler (this file's v1, reinstated temporarily to verify) — at n=300 and ANY k in the
            // brief's 16-32 band, the widest possible gap between stride samples is under 20 (300/16 = 18.75
            // members between samples, worst case), so by pigeonhole a CONTIGUOUS 20-member run can never
            // fully avoid every sample; the review's own suggested numbers cannot force a full zero here.
            // An 8-member run can (8 < the ~12-19-member gaps in that band) and was confirmed, by direct
            // sweep, to hit an exact zero at a real offset (13, used below) under that stride sampler —
            // i.e. this fixture is proven capable of failing before trusting that the fix passes it.
            const background = Array.from({ length: 292 }, (_, i) => {
                const angle = (i / 292) * 2 * Math.PI * 3.3
                const r = 200 + (i % 7) * 20
                return {
                    id: `bg${i}`,
                    path: [0],
                    x: r * Math.cos(angle),
                    y: r * Math.sin(angle),
                }
            })
            const jitter = [-2, -1, 0, 1, 2]
            const subCx = 5000,
                subCy = 5000
            const subBlob = Array.from({ length: 8 }, (_, i) => ({
                id: `sub${i}`,
                path: [0],
                x: subCx + jitter[i % 5],
                y: subCy + jitter[(i * 3) % 5],
            }))
            const ns = [
                ...background.slice(0, 13),
                ...subBlob,
                ...background.slice(13),
            ]
            const c = buildLodIndex(ns, [], 1, 24)[0].clusters[0]
            expect(c.count).toBe(300)

            const nearSubBlob = c.reps.filter(
                r => Math.hypot(r.x - subCx, r.y - subCy) < 50,
            )
            expect(nearSubBlob.length).toBeGreaterThanOrEqual(1) // LITERAL: at least 1 rep lies within the sub-blob
            const subBlobWeight = nearSubBlob.reduce((a, r) => a + r.weight, 0)
            expect(Math.abs(subBlobWeight - 8)).toBeLessThan(3) // LITERAL: represented weight within 3 of the true 8
        },
    )

    it(
        'on a deliberately clumped, anisotropic fixture (two tight blobs on a diagonal), reps stay in the ' +
            'blobs and split proportionally, EVEN ON AN UGLY SPLIT — a single centroid+sd ellipse cannot do either',
        () => {
            // Blob A / Blob B sizes are 29/11 — deliberately NOT a multiple of 1/k (Round-1 review,
            // IMPORTANT-4: a 30/10 split is an exact multiple of 1/24 and passed by arithmetic coincidence;
            // 29/11 does not have that property, so a pass here is not a fixture accident.
            const nA = 29,
                nB = 11
            const jitter = [-2, -1, 0, 1, 2]
            const A = Array.from({ length: nA }, (_, i) => ({
                id: `A${i}`,
                path: [0],
                x: -1000 + jitter[i % 5],
                y: -1000 + jitter[(i * 3) % 5],
            }))
            const B = Array.from({ length: nB }, (_, i) => ({
                id: `B${i}`,
                path: [0],
                x: 1000 + jitter[i % 5],
                y: 1000 + jitter[(i * 3) % 5],
            }))
            const ns = [...A, ...B]
            const c = buildLodIndex(ns, [], 1, 24)[0].clusters[0]
            expect(c.count).toBe(nA + nB)

            // --- Prove the fixture actually exhibits the problem an ellipse has -------------------------
            // A single centroid+sd "ellipse" summary is centred at (wx, wy) with radii (sdx, sdy). If that
            // centre sits nowhere near EITHER real blob, an ellipse drawn there necessarily invents density
            // in the empty gap between them — the exact failure `pushCloud`'s header measures. Confirm the
            // centroid really does land in that empty gap before trusting the fix's assertions below.
            const distTo = (px: number, py: number) =>
                Math.hypot(c.wx - px, c.wy - py)
            expect(distTo(-1000, -1000)).toBeGreaterThan(500) // nowhere near blob A
            expect(distTo(1000, 1000)).toBeGreaterThan(500) // nowhere near blob B either
            // ...and the ellipse's own radii are enormous relative to either blob's real 2-unit jitter —
            // an ellipse this size, centred in the gap, covers the gap itself, not two tight blobs.
            expect(c.sdx).toBeGreaterThan(500)
            expect(c.sdy).toBeGreaterThan(500)

            // --- The fix: every rep sits inside a real blob, never in the gap --------------------------
            for (const r of c.reps) {
                const dA = Math.hypot(r.x - -1000, r.y - -1000)
                const dB = Math.hypot(r.x - 1000, r.y - 1000)
                expect(Math.min(dA, dB)).toBeLessThan(10) // within the +-2 jitter (with room to spare), not the gap
            }
            // Both blobs are actually represented (not just the majority one)...
            const nearA = c.reps.filter(
                r => Math.hypot(r.x - -1000, r.y - -1000) < 10,
            )
            const nearB = c.reps.filter(
                r => Math.hypot(r.x - 1000, r.y - 1000) < 10,
            )
            expect(nearA.length).toBeGreaterThan(0)
            expect(nearB.length).toBeGreaterThan(0)
            // ...and split EXACTLY along the real 29/11 membership (k-means assigns every point to exactly
            // one real blob when the blobs are this well separated — no quantization to multiples of n/k).
            const wA = nearA.reduce((a, r) => a + r.weight, 0)
            const wB = nearB.reduce((a, r) => a + r.weight, 0)
            expect(wA).toBe(nA)
            expect(wB).toBe(nB)

            // --- reps' OWN spread matches the members' real spread far better than a single centroid ---
            // (a single centroid is a POINT — spread 0, i.e. 100% wrong on an axis whose real spread is
            // ~1000). The weighted reps reproduce the real (sdx, sdy) closely; a bare centroid cannot.
            const repSdx = weightedPopSd(c.reps, 'x')
            const repSdy = weightedPopSd(c.reps, 'y')
            expect(repSdx).toBeGreaterThan(c.sdx * 0.85)
            expect(repSdy).toBeGreaterThan(c.sdy * 0.85)
            expect(repSdx).toBeLessThan(c.sdx * 1.15)
            expect(repSdy).toBeLessThan(c.sdy * 1.15)
        },
    )

    it("LOD_REP_POINTS_K stays within the brief's cost ceiling — pinned from ABOVE, not just documented", () => {
        // Round-1 review, CRITICAL-2: k=8,16,32,64,256,1000,10000 were ALL fully green against every
        // other test in this file, because those tests followed whatever the constant was rather than
        // pinning it. This is the one place the shipped VALUE is checked, against literal bounds that
        // do not move if the constant does: raising it to 10000 (or dropping it to 1) must go red here.
        //
        // Round-2 review, CRITICAL-2 (partial): this range check alone is a fact about the number, not
        // a behavioural property — K=15 and K=33 fail it too, for no reason beyond "outside the band".
        // The LOWER edge now has real behavioural backing: the "24 equal blobs" test below is exactly
        // the shape that needs k this large (fewer clusters than distinct real sub-populations forces
        // some to share or lose a rep — see that test's own comment). The UPPER edge does NOT have an
        // in-file behavioural test: Task 24b's actual wiring turned out simpler than earlier drafts of
        // this comment predicted — each `reps` point becomes its own single `BloomPoint` push in
        // `emitBloom()` (AsciiGraphRenderer.ts), not a per-rep ring-sampled `pushCloud` splat
        // (`densityField.ts`), so `CLOUD_MAX_RINGS`/`CLOUD_MAX_PER_RING` are irrelevant to the shipped
        // cost and there is nothing of that shape to import here. The real, behavioural ceiling on the
        // shipped value lives downstream in `AsciiGraphRenderer.test.ts` (`BLOOM_MASS_FRAME_BUDGET`),
        // which imports `LOD_REP_POINTS_K` directly and cross-checks it against a live renderer's
        // actual per-frame `bloomPoints` — see that test for the real number. So: the upper bound HERE
        // stays a brief-imposed literal, not because it can't be pinned, but because the pin belongs to
        // the test downstream that can actually see the cost.
        expect(LOD_REP_POINTS_K).toBeGreaterThanOrEqual(16) // LITERAL lower bound, the brief's own band
        expect(LOD_REP_POINTS_K).toBeLessThanOrEqual(32) // LITERAL upper bound here — behaviourally pinned in AsciiGraphRenderer.test.ts, see above
    })

    it(
        '24 equal 10-member blobs spread with no dominant axis: every blob keeps its own rep and exact ' +
            'weight — the seeding strategy is load-bearing, not incidental',
        () => {
            // Round-2 review, IMPORTANT (new): farthest-first seeding is what makes this pass. Swapping it
            // for plain first-k-in-encounter-order seeding (verified directly, not just claimed) leaves
            // this file's OTHER tests fully green — they all use few, very well-separated populations,
            // where any seeding converges to the same partition under Lloyd's iteration — while 10 of these
            // 24 blobs come back with ZERO reps under that mutant. This fixture is the discriminating shape
            // both directions: many SIMILAR-sized populations with NO dominant axis (the same isotropic
            // arrangement `representativePoints`' doc comment cites as the reason v2's 1D projection was
            // abandoned), at k exactly equal to the population count, so every population needs its OWN
            // seed and none can be shared.
            const numBlobs = 24,
                blobSize = 10,
                radius = 1000
            const jitter = [-2, -1, 0, 1, 2]
            const ns: { id: string; path: number[]; x: number; y: number }[] =
                []
            const centers: { x: number; y: number }[] = []
            for (let b = 0; b < numBlobs; b++) {
                const angle = (b / numBlobs) * 2 * Math.PI
                const cx = radius * Math.cos(angle),
                    cy = radius * Math.sin(angle)
                centers.push({ x: cx, y: cy })
                for (let i = 0; i < blobSize; i++) {
                    ns.push({
                        id: `b${b}_${i}`,
                        path: [0],
                        x: cx + jitter[i % 5],
                        y: cy + jitter[(i * 3) % 5],
                    })
                }
            }
            const c = buildLodIndex(ns, [], 1, 24)[0].clusters[0]
            expect(c.count).toBe(numBlobs * blobSize)
            for (const center of centers) {
                const near = c.reps.filter(
                    r => Math.hypot(r.x - center.x, r.y - center.y) < 50,
                )
                expect(near.length).toBeGreaterThanOrEqual(1) // LITERAL: every blob keeps at least 1 rep
                const w = near.reduce((a, r) => a + r.weight, 0)
                expect(w).toBe(10) // LITERAL and exact: every blob's true 10 members, not diluted or lost
            }
        },
    )

    it(
        'a non-finite member coordinate degrades to a safe stand-in instead of propagating — no NaN ' +
            'rep, no silently shrunk rep count',
        () => {
            // Round-2 review: an earlier version let one NaN member turn a whole cluster's `reps` into a
            // single NaN rep, and let one Infinity member silently drop the rep count (24 -> 20). Verify
            // both are gone: weight conservation still holds exactly, and no rep coordinate is non-finite.
            const good = Array.from({ length: 39 }, (_, i) => ({
                id: `g${i}`,
                path: [0],
                x: i * 3,
                y: i * i,
            }))
            const withNaN = [...good, { id: 'bad', path: [0], x: NaN, y: 5 }]
            const cNaN = buildLodIndex(withNaN, [], 1, 24)[0].clusters[0]
            expect(cNaN.count).toBe(40)
            for (const r of cNaN.reps) {
                expect(Number.isFinite(r.x)).toBe(true)
                expect(Number.isFinite(r.y)).toBe(true)
            }
            expect(cNaN.reps.reduce((a, r) => a + r.weight, 0)).toBe(40)

            const withInfinity = [
                ...good,
                { id: 'bad', path: [0], x: Infinity, y: 5 },
            ]
            const cInf = buildLodIndex(withInfinity, [], 1, 24)[0].clusters[0]
            expect(cInf.count).toBe(40)
            for (const r of cInf.reps) {
                expect(Number.isFinite(r.x)).toBe(true)
                expect(Number.isFinite(r.y)).toBe(true)
            }
            expect(cInf.reps.reduce((a, r) => a + r.weight, 0)).toBe(40) // ABSOLUTE: no member silently dropped
        },
    )
})

describe('buildLodIndex — non-finite member coordinates at CLUSTER CONSTRUCTION (Task 30)', () => {
    /** Runs `fn` with `console.warn` replaced by a recording stub, restores the original afterward,
     *  and returns the args of every call captured. Same manual-monkeypatch workaround respace.test.ts
     *  uses (bun:test's `spyOn(console, "warn")` doesn't reliably intercept calls from other modules
     *  in this Bun version). */
    function captureWarnings(fn: () => void): unknown[][] {
        const warnings: unknown[][] = []
        const orig = console.warn
        console.warn = (...args: unknown[]) => {
            warnings.push(args)
        }
        try {
            fn()
        } finally {
            console.warn = orig
        }
        return warnings
    }

    it(
        'a single non-finite member leaves wx/wy/sdx/sdy AND reps ALL finite and mutually ' +
            'consistent — not just reps, which is all the pre-Task-30 code sanitized',
        () => {
            // Task 24a's own guard (one layer down, inside representativePoints) already kept `reps`
            // finite for this exact fixture — see the "degrades to a safe stand-in" test above. What it
            // could NOT do is fix wx/wy/sdx/sdy, which were computed one layer UP from the raw, unsanitized
            // sums before reps was ever built. Measured on this fixture before the fix (recorded in the
            // brief): reps=24, nonFiniteReps=0, weightSum=40, but wx=NaN, sdx=NaN — an internally
            // inconsistent cluster.
            const good = Array.from({ length: 39 }, (_, i) => ({
                id: `g${i}`,
                path: [0],
                x: i * 3,
                y: i * i,
            }))
            const withNaN = [...good, { id: 'bad', path: [0], x: NaN, y: 5 }]
            const c = buildLodIndex(withNaN, [], 1, 24)[0].clusters[0]
            expect(c.count).toBe(40)
            expect(Number.isFinite(c.wx)).toBe(true)
            expect(Number.isFinite(c.wy)).toBe(true)
            expect(Number.isFinite(c.sdx)).toBe(true)
            expect(Number.isFinite(c.sdy)).toBe(true)
            // Mutual consistency, not merely "both happen to be finite": reps and the centroid must derive
            // from the SAME sanitized point set, so the reps' own weighted centroid must land back on
            // (wx, wy) — the bad member is relocated to the finite members' mean in both places alike.
            const W = c.reps.reduce((a, r) => a + r.weight, 0)
            const repMx = c.reps.reduce((a, r) => a + r.weight * r.x, 0) / W
            const repMy = c.reps.reduce((a, r) => a + r.weight * r.y, 0) / W
            expect(repMx).toBeCloseTo(c.wx, 6)
            expect(repMy).toBeCloseTo(c.wy, 6)
        },
    )

    it(
        'a cluster whose members are ALL non-finite is OMITTED, not fabricated at (0, 0) — a mass ' +
            'that cannot be given a truthful position is not drawn as one (Step 4)',
        () => {
            // Same reasoning LOD_MIN_CLUSTER already applies to communities too small to summarize
            // honestly: rather than invent a position with no relationship to the real graph, the cluster
            // is dropped from this level entirely. A sibling, healthy community on the same level proves
            // the omission is scoped to the bad one, not a side effect that breaks the whole level.
            const allBad = Array.from({ length: 10 }, (_, i) => ({
                id: `bad${i}`,
                path: [0],
                x: NaN,
                y: NaN,
            }))
            const healthy = Array.from({ length: 6 }, (_, i) => ({
                id: `ok${i}`,
                path: [1],
                x: 50,
                y: i,
            }))
            const levels = buildLodIndex([...allBad, ...healthy], [], 1, 24)
            expect(levels[0].clusters.map(c => c.community)).toEqual([1])
            expect(levels[0].clusters[0].count).toBe(6)
        },
    )

    it(
        'a MOSTLY (not entirely) non-finite cluster is NOT omitted — omission is for the all-bad ' +
            'case only, not a coverage gap a more aggressive threshold could quietly widen',
        () => {
            // Review round 1: mutating the omission condition from `safeCount === 0` to `safeCount <= n /
            // 2` left all 29 tests green, because the two existing fixtures only covered the extremes (1
            // bad of 40, 40 bad of 40) — nothing pinned the middle. A `safeCount <= n / 2` policy would
            // silently drop this fixture's cluster (15 good of 40, i.e. safeCount=15 <= n/2=20), which the
            // brief never asked for: the brief's own omission case is "every member non-finite", not
            // "more than half". This pins that boundary directly.
            const good = Array.from({ length: 15 }, (_, i) => ({
                id: `g${i}`,
                path: [0],
                x: i * 3,
                y: i * i,
            }))
            const bad = Array.from({ length: 25 }, (_, i) => ({
                id: `bad${i}`,
                path: [0],
                x: NaN,
                y: 5,
            }))
            const c = buildLodIndex([...good, ...bad], [], 1, 24)[0].clusters[0]
            expect(c).toBeDefined() // NOT omitted, even though 25 of its 40 members are non-finite
            expect(c.count).toBe(40)
            expect(Number.isFinite(c.wx)).toBe(true)
            expect(Number.isFinite(c.wy)).toBe(true)
            expect(Number.isFinite(c.sdx)).toBe(true)
            expect(Number.isFinite(c.sdy)).toBe(true)
            for (const r of c.reps) {
                expect(Number.isFinite(r.x)).toBe(true)
                expect(Number.isFinite(r.y)).toBe(true)
            }
            expect(c.reps.reduce((a, r) => a + r.weight, 0)).toBe(40)
            // Consistent with the surviving (finite) members' own mean, same check as the single-bad-member
            // test above: reps and the centroid derive from the same sanitized point set.
            const W = c.reps.reduce((a, r) => a + r.weight, 0)
            const repMx = c.reps.reduce((a, r) => a + r.weight * r.x, 0) / W
            const repMy = c.reps.reduce((a, r) => a + r.weight * r.y, 0) / W
            expect(repMx).toBeCloseTo(c.wx, 6)
            expect(repMy).toBeCloseTo(c.wy, 6)

            // The reviewer's own more extreme measurement: 1 finite member of 40 (safeCount=1) is ALSO not
            // omitted, and every non-finite member collapses onto that single real point exactly (0 real
            // spread to summarize from just one true position).
            const oneGood = [{ id: 'solo', path: [1], x: 42, y: 17 }]
            const allElseBad = Array.from({ length: 39 }, (_, i) => ({
                id: `b${i}`,
                path: [1],
                x: NaN,
                y: NaN,
            }))
            const c2 = buildLodIndex([...oneGood, ...allElseBad], [], 1, 24)[0]
                .clusters[0]
            expect(c2).toBeDefined()
            expect(c2.count).toBe(40)
            expect(c2.wx).toBe(42)
            expect(c2.wy).toBe(17)
            expect(c2.sdx).toBe(0)
            expect(c2.sdy).toBe(0)
            expect(c2.reps.reduce((a, r) => a + r.weight, 0)).toBe(40)
        },
    )

    it(
        'logs exactly one console.warn per build when a non-finite member is sanitized, none when ' +
            'input is clean (Step 5) — silently absorbing a layout bug forever is not free',
        () => {
            const good = Array.from({ length: 39 }, (_, i) => ({
                id: `g${i}`,
                path: [0],
                x: i * 3,
                y: i * i,
            }))

            const clean = captureWarnings(() => {
                buildLodIndex(good, [], 1, 24)
            })
            expect(clean.length).toBe(0)

            // Two separate bad communities in the SAME build: still exactly one warning, not one per
            // community and not one per level.
            const withNaN = [...good, { id: 'bad1', path: [0], x: NaN, y: 5 }]
            const withNaN2 = [
                ...withNaN,
                { id: 'bad2', path: [1], x: 7, y: Infinity },
            ]
            const dirty = captureWarnings(() => {
                buildLodIndex(withNaN2, [], 1, 24)
            })
            expect(dirty.length).toBe(1)
        },
    )
})

describe('aggEdgeWeight', () => {
    it("is log-scaled into 0..1 against the level's heaviest connector", () => {
        expect(aggEdgeWeight(0, 10)).toBe(0)
        expect(aggEdgeWeight(10, 10)).toBe(1)
        expect(aggEdgeWeight(1, 1)).toBe(1)
        const w3 = aggEdgeWeight(3, 100),
            w30 = aggEdgeWeight(30, 100)
        expect(w3).toBeGreaterThan(0)
        expect(w30).toBeGreaterThan(w3)
        expect(w30).toBeLessThan(1)
    })

    it('the doubling threshold sits strictly inside the scale (some edges double, some do not)', () => {
        expect(AGG_EDGE_DOUBLE_W).toBeGreaterThan(0)
        expect(AGG_EDGE_DOUBLE_W).toBeLessThan(1)
    })
})

describe('massRadii — sqrt-scaled entity size', () => {
    it('grows ~with sqrt(count), never below the 1-row/2-col minimum', () => {
        const tiny = massRadii(1, CELL_W, CELL_H)
        expect(tiny.rowR).toBe(1)
        expect(tiny.colR).toBeGreaterThanOrEqual(2)
        const mid = massRadii(120, CELL_W, CELL_H)
        const big = massRadii(480, CELL_W, CELL_H)
        expect(mid.rowR).toBeGreaterThan(tiny.rowR)
        // 4x the members ≈ 2x the radius (sqrt scaling, ±1 cell of rounding), nowhere near 4x.
        expect(Math.abs(big.rowR - mid.rowR * 2)).toBeLessThanOrEqual(1)
    })

    it('stretches the column radius by the cell aspect so the mass reads round', () => {
        const { rowR, colR } = massRadii(200, CELL_W, CELL_H)
        expect(colR).toBeGreaterThan(rowR) // cells are ~2.9x taller than wide
    })
})

describe('mass form — the degree-ramp vocabulary, core to fringe', () => {
    it("uses '@' core, 'o' body, '.' fringe by normalized radius", () => {
        expect(String.fromCharCode(massCellCode(0))).toBe('@')
        expect(String.fromCharCode(massCellCode(0.5))).toBe('o')
        expect(String.fromCharCode(massCellCode(0.9))).toBe('.')
    })

    it('fades alpha outward (solid core, soft fringe)', () => {
        expect(massCellAlpha(0)).toBe(1)
        expect(massCellAlpha(0.5)).toBeLessThan(1)
        expect(massCellAlpha(0.9)).toBeLessThan(massCellAlpha(0.5))
    })
})

describe('lodMix — the ladder-onto-levels mapping (level selection per stop)', () => {
    /** The dominant level at progress t, or "glyphs" once the mass band has handed the field over. */
    function owner(t: number, levelCount: number): string {
        const { levelAlphas, glyphAlpha } = lodMix(t, levelCount)
        let best = -1,
            bestA = glyphAlpha
        for (let i = 0; i < levelAlphas.length; i++)
            if (levelAlphas[i] > bestA) {
                best = i
                bestA = levelAlphas[i]
            }
        return best === -1 ? 'glyphs' : `L${best}`
    }

    it('walks coarsest → finest → glyphs across the stops, for the reference 3-level shape', () => {
        // Stops are t = 0, 0.1, …, 1 (10% each). The level split still divides [0, FILE_LABEL_REVEAL_T)
        // evenly (0.25-wide segments at 3 levels), but the MASS BAND itself now ends at
        // BACKBONE_START_T + BACKBONE_FADE_SPAN = 0.46 (backbone.ts), so the ladder reaches individual
        // glyphs far earlier than the old `1 - fileLabelAlpha` keying did: L0 owns 100–90%, L1 80–70%,
        // and from 60% on the glyph bands (mid, then near) own the field.
        expect(owner(0.0, 3)).toBe('L0') // 100%
        expect(owner(0.1, 3)).toBe('L0') // 90%
        expect(owner(0.2, 3)).toBe('L1') // 80%
        expect(owner(0.3, 3)).toBe('L1') // 70%
        expect(owner(0.4, 3)).toBe('glyphs') // 60% — mid-crossfade, glyphAlpha already past half
        expect(owner(0.5, 3)).toBe('glyphs') // 50% — the mass band is over
        expect(owner(0.75, 3)).toBe('glyphs')
        expect(owner(1.0, 3)).toBe('glyphs') // 0%
    })

    it('masses own the far band outright, are gone by the mid plateau, and never come back', () => {
        // Far band: masses hold the whole field, split over the levels.
        for (const t of [0, 0.1, 0.2, 0.3]) {
            const mix = lodMix(t, 3)
            expect(mix.glyphAlpha).toBeLessThan(0.5)
            expect(mix.levelAlphas.reduce((a, b) => a + b, 0)).toBeCloseTo(
                mix.massAlpha,
                8,
            )
        }
        expect(lodMix(0, 3).massAlpha).toBe(1)
        // Mid plateau onward: no mass weight at all, on any level.
        for (const t of [0.5, 0.6, FILE_LABEL_REVEAL_T, 0.9, 1]) {
            const mix = lodMix(t, 3)
            expect(mix.massAlpha).toBe(0)
            expect(mix.glyphAlpha).toBe(1)
            expect(mix.levelAlphas.every(a => a === 0)).toBe(true)
        }
    })

    it('the mid band draws glyphs WITHOUT their real member edges — the two must not be one number', () => {
        // The trap backbone.ts's wiring recipe names: `glyphAlpha` and `memberAlpha` are numerically
        // different across the whole mid band, so a single shared `leafAlpha` cannot serve both. At the
        // mid plateau glyphs are fully on while real member edges are fully off and the backbone owns
        // the between-group story.
        const mid = lodMix(0.6, 3)
        expect(mid.glyphAlpha).toBe(1)
        expect(mid.memberAlpha).toBe(0)
        expect(mid.backboneAlpha).toBe(1)
        // ...and at the deep end they agree again (both 1), which is why the collapse went unnoticed.
        const deep = lodMix(1, 3)
        expect(deep.glyphAlpha).toBe(1)
        expect(deep.memberAlpha).toBe(1)
        expect(deep.backboneAlpha).toBe(0)
    })

    it('total drawn weight is conserved through every crossfade (masses + backbone + members sum to 1)', () => {
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const mix = lodMix(t, 4)
            // The per-level split exhausts the mass band exactly...
            expect(mix.levelAlphas.reduce((a, b) => a + b, 0)).toBeCloseTo(
                mix.massAlpha,
                8,
            )
            // ...and the three bands partition the field.
            expect(
                mix.massAlpha + mix.backboneAlpha + mix.memberAlpha,
            ).toBeCloseTo(1, 8)
            expect(mix.glyphAlpha).toBeCloseTo(
                mix.backboneAlpha + mix.memberAlpha,
                8,
            )
        }
    })

    it('a 1-level graph is a single entity tier crossfading straight into glyphs', () => {
        expect(lodMix(0, 1)).toEqual({
            levelAlphas: [1],
            massAlpha: 1,
            glyphAlpha: 0,
            backboneAlpha: 0,
            memberAlpha: 0,
        })
        const deep = lodMix(1, 1)
        expect(deep.levelAlphas[0]).toBe(0)
        expect(deep.glyphAlpha).toBe(1)
        expect(deep.memberAlpha).toBe(1)
    })
})
