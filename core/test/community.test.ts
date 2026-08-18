import { test, expect } from 'bun:test'
import {
    detectCommunities,
    detectCommunityHierarchy,
    communityLevelsFor,
    pickExemplar,
} from '../src/community'

test('two disconnected triangles → two communities', () => {
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z'].map(id => ({ id, label: id }))
    const edges = [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['x', 'y'],
        ['y', 'z'],
        ['z', 'x'],
    ].map(([from, to]) => ({ from, to }))
    const m = detectCommunities(nodes, edges)
    expect(m.get('a')!.community).toBe(m.get('b')!.community)
    expect(m.get('a')!.community).toBe(m.get('c')!.community)
    expect(m.get('x')!.community).toBe(m.get('y')!.community)
    expect(m.get('a')!.community).not.toBe(m.get('x')!.community)
})

test('deterministic across runs', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id }))
    const edges = [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
    ].map(([from, to]) => ({ from, to }))
    const a = JSON.stringify([...detectCommunities(nodes, edges)])
    const b = JSON.stringify([...detectCommunities(nodes, edges)])
    expect(a).toBe(b)
})

test('isolated node gets its own community + self label', () => {
    const m = detectCommunities([{ id: 'lonely', label: 'Lonely' }], [])
    expect(m.get('lonely')!.label).toBe('Lonely')
})

test('empty graph → empty map', () => {
    expect(detectCommunities([], []).size).toBe(0)
})

test("exemplar label comes from the community's hubs, not a short-titled leaf", () => {
    // star: hub connected to 3 leaves → hub is exemplar for the whole community. Note the LEAF labels
    // are SHORTER than the hub's, and the exemplar rule prefers short names (see pickExemplar) — the
    // degree-fraction gate is what keeps a leaf out of the pool entirely.
    const nodes = ['hub', 'l1', 'l2', 'l3'].map(id => ({
        id,
        label: id.toUpperCase(),
    }))
    const edges = [
        ['hub', 'l1'],
        ['hub', 'l2'],
        ['hub', 'l3'],
    ].map(([from, to]) => ({ from, to }))
    const m = detectCommunities(nodes, edges)
    for (const id of ['hub', 'l1', 'l2', 'l3'])
        expect(m.get(id)!.label).toBe('HUB')
})

// --- Exemplar (cluster NAME) selection -------------------------------------------------------------
// The names are drawn on a monospace ASCII grid, so SHORT is the whole point: the old
// "highest-degree member" rule produced full note-title sentences that overlapped into soup.

test('pickExemplar prefers a TAG member over a note, whatever the degrees', () => {
    const pick = pickExemplar([
        {
            id: 'n1',
            label: 'Player - More Responsive Walking Physics + Animations',
            kind: 'note',
            degree: 40,
        },
        { id: 'tag:school', label: '#school', kind: 'tag', degree: 22 },
        {
            id: 'n2',
            label: 'Some Other Long Note Title Here',
            kind: 'note',
            degree: 30,
        },
    ])
    expect(pick!.label).toBe('#school')
})

test('pickExemplar picks the SHORTEST name among the hub pool', () => {
    const pick = pickExemplar([
        { id: 'a', label: 'A Very Long Note Title Indeed', degree: 30 },
        { id: 'b', label: 'Kant', degree: 25 },
        { id: 'c', label: 'Another Longish Title', degree: 28 },
    ])
    expect(pick!.label).toBe('Kant')
})

test("pickExemplar prefers a candidate that FITS the field's cap over a longer non-fitting one", () => {
    // The field's readability contract is specifically about the FIT cap (EXEMPLAR_FIT_CHARS, mirrors
    // app/src/graph/labelSelection.ts CLUSTER_LABEL_MAX_CHARS), not raw brevity for its own sake —
    // pinned explicitly here even though today it coincides with "shortest wins" (see pickExemplar's
    // doc comment), so a future change to the ranking rule can't silently stop preferring a name the
    // field never has to cut.
    const pick = pickExemplar([
        {
            id: 'long',
            label: 'A Genuinely Very Long Note Title That Exceeds The Field Cap',
            degree: 40,
        },
        { id: 'fits', label: 'Twenty Chars Exact!!', degree: 25 }, // exactly 20 chars, clears the degree-fraction gate too
    ])
    expect(pick!.label).toBe('Twenty Chars Exact!!')
    expect(pick!.label.length).toBeLessThanOrEqual(20)
})

test('pickExemplar falls back to the shortest overall when NOTHING in the pool fits the cap', () => {
    const pick = pickExemplar([
        { id: 'a', label: 'A Reasonably Long Note Title Here', degree: 10 }, // 34 chars
        {
            id: 'b',
            label: 'An Even Longer Note Title Than That One Indeed',
            degree: 20,
        }, // 47 chars
    ])
    expect(pick!.label).toBe('A Reasonably Long Note Title Here') // shortest of the two, even past the cap
})

test('pickExemplar excludes members below the degree fraction (a leaf never names a cluster)', () => {
    const pick = pickExemplar([
        { id: 'hub', label: 'Bibliography', degree: 100 },
        { id: 'leaf', label: 'x', degree: 1 },
    ])
    expect(pick!.label).toBe('Bibliography')
})

test('pickExemplar is deterministic and total', () => {
    expect(pickExemplar([])).toBeUndefined()
    const ms = [
        { id: 'b', label: 'same', degree: 5 },
        { id: 'a', label: 'same', degree: 5 },
    ]
    expect(pickExemplar(ms)!.id).toBe('a') // equal length + equal degree → smallest id
    expect(pickExemplar([...ms].reverse())!.id).toBe('a')
})

test('a tag member names its community end-to-end (detectCommunities carries `kind`)', () => {
    const nodes = [
        { id: 'tag:books', label: '#books', kind: 'tag' },
        ...Array.from({ length: 10 }, (_, i) => ({
            id: `n${i}`,
            label: `A Long Book Note Title Number ${i}`,
            kind: 'note',
        })),
    ]
    const edges = Array.from({ length: 10 }, (_, i) => ({
        from: 'tag:books',
        to: `n${i}`,
    }))
    const m = detectCommunities(nodes, edges)
    expect(m.get('n0')!.label).toBe('#books')
})

// --- Hierarchy ("clusters in clusters in clusters") ------------------------------------------------

test('level count derives from node count, at the documented breakpoints', () => {
    // levels = clamp(1, 4, 1 + floor(log_4.5((n/10)/8))) → breakpoints at 360 / 1620 / 7290.
    expect(communityLevelsFor(0)).toBe(1)
    expect(communityLevelsFor(1)).toBe(1)
    expect(communityLevelsFor(359)).toBe(1)
    expect(communityLevelsFor(360)).toBe(2)
    expect(communityLevelsFor(1619)).toBe(2)
    expect(communityLevelsFor(1620)).toBe(3)
    expect(communityLevelsFor(7289)).toBe(3)
    expect(communityLevelsFor(7290)).toBe(4)
    // Capped at 4 — a 5th level is not distinguishable in a viewport.
    expect(communityLevelsFor(1_000_000)).toBe(4)
    // Monotone: growing a vault never REMOVES a level.
    let prev = 1
    for (let n = 1; n < 20000; n += 37) {
        const l = communityLevelsFor(n)
        expect(l).toBeGreaterThanOrEqual(prev)
        prev = l
    }
})

/** `supers.length` super-topics, each split into sub-topics, densely linked inside a sub-topic,
 *  moderately across sub-topics of the same super, sparsely across supers. Deterministic (fixed LCG)
 *  — this is the shape a hierarchy is supposed to recover. */
function twoLevelGraph(supers: number[][]) {
    const nodes: { id: string; label: string }[] = []
    const edges: { from: string; to: string }[] = []
    let s = 987654321 >>> 0
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
    const key = (S: number, c: number, i: number) => `s${S}c${c}n${i}`
    supers.forEach((subs, S) =>
        subs.forEach((size, c) => {
            for (let i = 0; i < size; i++)
                nodes.push({ id: key(S, c, i), label: key(S, c, i) })
        }),
    )
    supers.forEach((subs, S) =>
        subs.forEach((size, c) => {
            for (let i = 1; i < size; i++) {
                edges.push({
                    from: key(S, c, i),
                    to: key(S, c, Math.floor(rnd() * i)),
                })
                if (rnd() < 0.5)
                    edges.push({
                        from: key(S, c, i),
                        to: key(S, c, Math.floor(rnd() * size)),
                    })
            }
            for (let i = 0; i < size; i++) {
                if (subs.length > 1 && rnd() < 0.15) {
                    let o = Math.floor(rnd() * (subs.length - 1))
                    if (o >= c) o++
                    edges.push({
                        from: key(S, c, i),
                        to: key(S, o, Math.floor(rnd() * subs[o])),
                    })
                }
                if (rnd() < 0.01) {
                    let oS = Math.floor(rnd() * (supers.length - 1))
                    if (oS >= S) oS++
                    const oc = Math.floor(rnd() * supers[oS].length)
                    edges.push({
                        from: key(S, c, i),
                        to: key(oS, oc, Math.floor(rnd() * supers[oS][oc])),
                    })
                }
            }
        }),
    )
    return { nodes, edges }
}

const SUPERS = [
    [70, 60, 55],
    [65, 60, 50],
    [80, 55, 45],
    [60, 50, 45, 40],
]

test('a big graph gets nested levels; the flat API is the finest one', () => {
    const { nodes, edges } = twoLevelGraph(SUPERS)
    expect(nodes.length).toBeGreaterThanOrEqual(360) // enough to earn 2+ levels
    const h = detectCommunityHierarchy(nodes, edges)
    const levels = communityLevelsFor(nodes.length)
    expect(levels).toBeGreaterThan(1)
    for (const [, a] of h) {
        expect(a.path.length).toBe(levels)
        expect(a.labels.length).toBe(levels)
        // The flat contract: `community`/`label` ARE the finest level.
        expect(a.path[a.path.length - 1]).toBe(a.community)
        expect(a.labels[a.labels.length - 1]).toBe(a.label)
    }
    // Same finest level as the flat API returns.
    const flat = detectCommunities(nodes, edges)
    for (const [id, a] of h) expect(flat.get(id)!.community).toBe(a.community)
})

test('levels are strictly nested and get strictly coarser toward the root', () => {
    const { nodes, edges } = twoLevelGraph(SUPERS)
    const h = detectCommunityHierarchy(nodes, edges)
    const levels = h.get(nodes[0].id)!.path.length
    // Nesting: two nodes sharing a finest community share every coarser one.
    const ancestryOf = new Map<number, string>()
    for (const [, a] of h) {
        const key = a.path.slice(0, -1).join('/')
        const prev = ancestryOf.get(a.community)
        if (prev === undefined) ancestryOf.set(a.community, key)
        else expect(prev).toBe(key)
    }
    // Coarsening: each level up has strictly fewer groups (no level is a copy of its child).
    let prevCount = Infinity
    for (let l = 0; l < levels; l++) {
        const count = new Set([...h.values()].map(a => a.path[l])).size
        expect(count).toBeGreaterThan(prevCount === Infinity ? 1 : 0)
        if (prevCount !== Infinity) expect(count).toBeGreaterThan(prevCount)
        prevCount = count
    }
})

test("no level collapses into one 'everything' blob", () => {
    // The failure mode this whole module was rewritten to avoid: coarsening that fuses the connected
    // part of the graph into a single super-community, which is not a grouping.
    const { nodes, edges } = twoLevelGraph(SUPERS)
    const h = detectCommunityHierarchy(nodes, edges)
    const levels = h.get(nodes[0].id)!.path.length
    for (let l = 0; l < levels; l++) {
        const sizes = new Map<number, number>()
        for (const [, a] of h)
            sizes.set(a.path[l], (sizes.get(a.path[l]) ?? 0) + 1)
        expect(sizes.size).toBeGreaterThanOrEqual(2)
        // The balance cap (community.ts MAX_GROUP_FRACTION) keeps the biggest group under ~25%; allow
        // a little headroom for a group that was already over the cap before any merging.
        expect(Math.max(...sizes.values()) / nodes.length).toBeLessThan(0.4)
    }
})

test('hierarchy is deterministic and independent of input order', () => {
    const { nodes, edges } = twoLevelGraph(SUPERS)
    const a = detectCommunityHierarchy(nodes, edges)
    const b = detectCommunityHierarchy(nodes, edges)
    const c = detectCommunityHierarchy(
        [...nodes].reverse(),
        [...edges].reverse(),
    )
    for (const [id, x] of a) {
        for (const other of [b, c]) {
            expect(other.get(id)!.path).toEqual(x.path)
            expect(other.get(id)!.labels).toEqual(x.labels)
        }
    }
})

test('a small graph gets exactly one level (unchanged flat behaviour)', () => {
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z'].map(id => ({ id, label: id }))
    const edges = [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['x', 'y'],
        ['y', 'z'],
        ['z', 'x'],
    ].map(([from, to]) => ({ from, to }))
    const h = detectCommunityHierarchy(nodes, edges)
    for (const [, a] of h) {
        expect(a.path.length).toBe(1)
        expect(a.path[0]).toBe(a.community)
    }
})

test('edgeless notes stay their own singleton at every level', () => {
    const { nodes, edges } = twoLevelGraph(SUPERS)
    const withOrphans = [
        ...nodes,
        ...Array.from({ length: 40 }, (_, i) => ({
            id: `orphan${i}`,
            label: `Orphan ${i}`,
        })),
    ]
    const h = detectCommunityHierarchy(withOrphans, edges)
    const levels = h.get(withOrphans[0].id)!.path.length
    for (let i = 0; i < 40; i++) {
        const a = h.get(`orphan${i}`)!
        expect(a.label).toBe(`Orphan ${i}`) // labelled by itself, not absorbed into a neighbour's name
        for (let l = 0; l < levels; l++) {
            const shared = [...h.entries()].filter(
                ([, o]) => o.path[l] === a.path[l],
            )
            expect(shared.length).toBe(1)
        }
    }
})

test("labels at every level name a hub inside that level's community", () => {
    // Two stars joined by a weak bridge: each star's own hub names it at the fine level, and whichever
    // hub has the higher degree names the merged group at the coarse level (the two hub labels are the
    // same length, so pickExemplar's shortest-name rule falls through to degree).
    const nodes: { id: string; label: string }[] = [
        { id: 'hubA', label: 'HUB-A' },
        { id: 'hubB', label: 'HUB-B' },
    ]
    const edges: { from: string; to: string }[] = [{ from: 'hubA', to: 'hubB' }]
    for (let i = 0; i < 12; i++) {
        nodes.push({ id: `a${i}`, label: `a${i}` })
        edges.push({ from: 'hubA', to: `a${i}` })
    }
    for (let i = 0; i < 6; i++) {
        nodes.push({ id: `b${i}`, label: `b${i}` })
        edges.push({ from: 'hubB', to: `b${i}` })
    }
    const h = detectCommunityHierarchy(nodes, edges, { levels: 2 })
    // hubA has the higher degree, so the merged (coarse) group is named after it.
    expect(h.get('a0')!.labels[1]).toBe('HUB-A')
    expect(h.get('b0')!.labels[1]).toBe('HUB-B')
    const coarseLabels = new Set([...h.values()].map(a => a.labels[0]))
    expect(coarseLabels.has('HUB-A')).toBe(true)
})
