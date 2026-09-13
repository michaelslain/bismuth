import { tempDir } from './helpers'
import { createHash, randomUUID } from 'node:crypto'
import {
    mkdirSync,
    rmSync,
    writeFileSync,
    readdirSync,
    utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from 'bun:test'
import {
    graphSig,
    attachLayout,
    peekLayout,
    computeViewLayouts,
    pruneCacheDir,
    renameLayoutIds,
} from '../src/layout-cache'
import type { GraphData, GraphNode } from '../src/graph'

// Three notes A, B, C; the only edge is a wikilink A -> B.
function baseGraph(): GraphData {
    return {
        nodes: [
            { id: 'A', label: 'A', kind: 'note' },
            { id: 'B', label: 'B', kind: 'note' },
            { id: 'C', label: 'C', kind: 'note' },
        ],
        edges: [{ from: 'A', to: 'B', kind: 'link' }],
    }
}

test('graphSig is stable for an identical graph', () => {
    expect(graphSig(baseGraph(), 'vault')).toBe(graphSig(baseGraph(), 'vault'))
})

test('graphSig is order-independent for nodes and edges', () => {
    const g1 = baseGraph()
    const g2: GraphData = {
        nodes: [g1.nodes[2], g1.nodes[0], g1.nodes[1]],
        edges: [...g1.edges],
    }
    expect(graphSig(g2, 'vault')).toBe(graphSig(g1, 'vault'))
})

// B12: a retargeted wikilink ([[A]] -> [[B]] becomes [[A]] -> [[C]]) keeps the same node set and the
// same edge count, but the connectivity differs — the signature MUST change so the stale layout is busted.
test('graphSig busts when an edge is retargeted (same node set + edge count)', () => {
    const before = baseGraph()
    const after = baseGraph()
    after.edges = [{ from: 'A', to: 'C', kind: 'link' }]

    expect(after.nodes.length).toBe(before.nodes.length)
    expect(after.edges.length).toBe(before.edges.length)
    expect(graphSig(after, 'vault')).not.toBe(graphSig(before, 'vault'))
})

test('graphSig changes when an edge kind changes', () => {
    const before = baseGraph()
    const after = baseGraph()
    after.edges = [{ from: 'A', to: 'B', kind: 'tag' }]
    expect(graphSig(after, 'vault')).not.toBe(graphSig(before, 'vault'))
})

test('graphSig is keyed by vault', () => {
    expect(graphSig(baseGraph(), 'vaultA')).not.toBe(
        graphSig(baseGraph(), 'vaultB'),
    )
})

// A graph with a 2nd-brain note + a 3rd-brain memory node so both subgraphs are non-empty.
function brainGraph(): GraphData {
    return {
        nodes: [
            { id: 'n1', label: 'n1', kind: 'note' },
            { id: 'n2', label: 'n2', kind: 'note' },
            { id: 'mem:m1', label: 'm1', kind: 'memory' },
        ],
        edges: [
            { from: 'n1', to: 'n2', kind: 'link' },
            { from: 'mem:m1', to: 'n1', kind: 'about' },
        ],
    }
}

test('peekLayout returns null for an uncached non-empty subgraph', () => {
    const key = `test-${randomUUID()}` // unique key => guaranteed cold disk cache
    const g: GraphData = {
        nodes: [{ id: 'n1', label: 'n1', kind: 'note' }],
        edges: [],
    }
    expect(peekLayout(g, key)).toBeNull()
})

test('attachLayout omits views when they are not cached yet', async () => {
    const key = `test-${randomUUID()}`
    const out = await attachLayout(brainGraph(), key)
    expect(out.views).toBeUndefined()
    // The full-graph positions are still attached.
    expect(out.nodes.find(n => n.id === 'n1')?.position).toBeDefined()
})

test('computeViewLayouts caches the views; a later attachLayout includes them', async () => {
    const key = `test-${randomUUID()}`
    const g = brainGraph()

    // Cold: no views.
    expect((await attachLayout(g, key)).views).toBeUndefined()

    // Compute them on demand (Task 4's endpoint calls this).
    const views = await computeViewLayouts(g, key)
    expect(views.second.pos3d['n1']).toBeDefined()
    expect(views.second.pos2d['n1']).toHaveLength(2)

    // Now they're cached: attachLayout attaches them.
    const out = await attachLayout(g, key)
    expect(out.views?.second?.pos3d['n1']).toBeDefined()
    expect(out.views?.third?.pos3d['mem:m1']).toBeDefined()
})

// Incremental add-only rebuild: creating a note must NOT scramble the existing layout. The warm-start
// (lastFullLayout) pins every pre-existing node so its 3D + 2D positions are byte-identical across the add.
test('adding a node pins the existing layout (no scramble) and places the new node', async () => {
    const key = `test-${randomUUID()}`
    const g1 = baseGraph() // A, B, C with A -> B
    const out1 = await attachLayout(g1, key)
    const posOf = (out: GraphData, id: string) =>
        out.nodes.find(n => n.id === id)!

    // Add D linked to A — a pure addition (no node removed, no edge retargeted).
    const g2: GraphData = {
        nodes: [...g1.nodes, { id: 'D', label: 'D', kind: 'note' }],
        edges: [...g1.edges, { from: 'A', to: 'D', kind: 'link' }],
    }
    const out2 = await attachLayout(g2, key)

    for (const id of ['A', 'B', 'C']) {
        expect(posOf(out2, id).position).toEqual(posOf(out1, id).position)
        expect(posOf(out2, id).position2d).toEqual(posOf(out1, id).position2d)
    }
    const d = posOf(out2, 'D')
    expect(d.position!.every(n => Number.isFinite(n))).toBe(true)
    expect(d.position2d!.every(n => Number.isFinite(n))).toBe(true)
})

// A deletion is NOT a pure add, so it takes the normal warm path (survivors may relax) — but the layout
// must still be valid: every remaining node keeps a finite position and the removed node is gone.
test('removing a node yields a valid layout for the survivors', async () => {
    const key = `test-${randomUUID()}`
    const g1 = baseGraph()
    await attachLayout(g1, key)
    const g2: GraphData = {
        nodes: g1.nodes.filter(n => n.id !== 'C'),
        edges: g1.edges,
    }
    const out2 = await attachLayout(g2, key)
    expect(out2.nodes.map(n => n.id).sort()).toEqual(['A', 'B'])
    for (const n of out2.nodes)
        expect(n.position!.every(c => Number.isFinite(c))).toBe(true)
})

// ── pruneCacheDir: bounded LRU-by-mtime eviction of the disk cache ──────────────────────────────
// Tested directly against a throwaway dir (rather than through attachLayout's fire-and-forget
// writeSeed) so entry age is controlled deterministically via utimesSync instead of racing real
// wall-clock writes.

function makeAgedFiles(dir: string, names: string[]): void {
    // names[0] is oldest, names[names.length - 1] is newest.
    names.forEach((name, i) => {
        const file = join(dir, name)
        writeFileSync(file, '{}')
        const t = new Date(2000, 0, 1 + i)
        utimesSync(file, t, t)
    })
}

test('pruneCacheDir evicts the oldest entries first, keeping at most maxEntries', () => {
    const dir = tempDir('bismuth-cache-prune-')
    try {
        makeAgedFiles(dir, [
            'f0.json',
            'f1.json',
            'f2.json',
            'f3.json',
            'f4.json',
        ])
        pruneCacheDir(dir, 3)
        expect(readdirSync(dir).sort()).toEqual([
            'f2.json',
            'f3.json',
            'f4.json',
        ])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("pruneCacheDir never evicts a protected name, even when it's the oldest", () => {
    const dir = tempDir('bismuth-cache-prune-')
    try {
        makeAgedFiles(dir, [
            'f0.json',
            'f1.json',
            'f2.json',
            'f3.json',
            'f4.json',
        ])
        // f0 is the oldest by far, but it's the entry this call just wrote/is about to read.
        pruneCacheDir(dir, 3, new Set(['f0.json']))
        const remaining = readdirSync(dir).sort()
        expect(remaining).toContain('f0.json')
        expect(remaining).toHaveLength(3) // still capped: two of the (non-protected) oldest go instead
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('pruneCacheDir is a no-op when under the cap', () => {
    const dir = tempDir('bismuth-cache-prune-')
    try {
        makeAgedFiles(dir, ['f0.json', 'f1.json'])
        pruneCacheDir(dir, 5)
        expect(readdirSync(dir).sort()).toEqual(['f0.json', 'f1.json'])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('pruneCacheDir tolerates a missing directory', () => {
    const dir = join(tmpdir(), `bismuth-cache-prune-missing-${randomUUID()}`)
    expect(() => pruneCacheDir(dir, 3)).not.toThrow()
})

// ── Incremental diff: remove / rename / move / edge edits (seeds remember their edge set) ──────────

function chain(n: number): GraphData {
    const nodes = Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        label: `n${i}`,
        kind: 'note' as const,
    }))
    const edges = nodes.slice(1).map((nd, i) => ({
        from: `n${i}`,
        to: nd.id,
        kind: 'link' as const,
    }))
    return { nodes, edges }
}
// A tuple, not an inferred array: `posOf(g)[id][0]` must type as a 3D position to compare with one.
type NodePos = [GraphNode['position'], GraphNode['position2d']]
const posOf = (g: GraphData) =>
    Object.fromEntries(
        g.nodes.map(n => [n.id, [n.position, n.position2d] as NodePos]),
    )

/** `g` with every id `from` rewritten to `to`, in nodes and edges alike. */
function renamed(g: GraphData, from: string, to: string): GraphData {
    const ren = (id: string) => (id === from ? to : id)
    return {
        nodes: g.nodes.map(n => ({ ...n, id: ren(n.id) })),
        edges: g.edges.map(e => ({ ...e, from: ren(e.from), to: ren(e.to) })),
    }
}

test('removing a node keeps every survivor at its exact prior position', async () => {
    const vault = `vault-${randomUUID()}`
    const before = await attachLayout(chain(40), vault)
    const g = chain(40)
    g.nodes = g.nodes.filter(n => n.id !== 'n39')
    g.edges = g.edges.filter(e => e.to !== 'n39')
    const after = await attachLayout(g, vault)
    const b = posOf(before)
    for (const n of after.nodes)
        expect([n.position, n.position2d]).toEqual(b[n.id])
})

test('renameLayoutIds carries a renamed note to its exact prior position', async () => {
    const vault = `vault-${randomUUID()}`
    const before = await attachLayout(chain(40), vault)
    renameLayoutIds(vault, 'n5.md', 'renamed.md')
    const g = chain(40)
    const ren = (id: string) => (id === 'n5' ? 'renamed' : id)
    g.nodes = g.nodes.map(n => ({ ...n, id: ren(n.id) }))
    g.edges = g.edges.map(e => ({ ...e, from: ren(e.from), to: ren(e.to) }))
    const after = await attachLayout(g, vault)
    const b = posOf(before)
    expect(after.nodes.find(n => n.id === 'renamed')!.position).toEqual(
        b['n5'][0],
    )
    for (const n of after.nodes.filter(n => n.id !== 'renamed'))
        expect([n.position, n.position2d]).toEqual(b[n.id])
})

test('renameLayoutIds remaps every note under a moved folder', async () => {
    const vault = `vault-${randomUUID()}`
    const g0: GraphData = {
        nodes: [
            { id: 'a/x', label: 'x', kind: 'note' },
            { id: 'a/y', label: 'y', kind: 'note' },
            { id: 'z', label: 'z', kind: 'note' },
        ],
        edges: [
            { from: 'a/x', to: 'z', kind: 'link' },
            { from: 'a/y', to: 'z', kind: 'link' },
        ],
    }
    const before = await attachLayout(g0, vault)
    renameLayoutIds(vault, 'a', 'b')
    const g1: GraphData = {
        nodes: [
            { id: 'b/x', label: 'x', kind: 'note' },
            { id: 'b/y', label: 'y', kind: 'note' },
            { id: 'z', label: 'z', kind: 'note' },
        ],
        edges: [
            { from: 'b/x', to: 'z', kind: 'link' },
            { from: 'b/y', to: 'z', kind: 'link' },
        ],
    }
    const after = await attachLayout(g1, vault)
    const b = posOf(before)
    expect(after.nodes.find(n => n.id === 'b/x')!.position).toEqual(
        b['a/x'][0],
    )
    expect(after.nodes.find(n => n.id === 'b/y')!.position).toEqual(
        b['a/y'][0],
    )
})

// The folder-note pattern: a note `proj.md` beside a folder `proj/`. A folder move must not drag the
// same-named note along, and a note rename must not drag the folder's notes along — either misroute
// turns untouched notes into remove+add pairs that re-settle (or, past the cap, a full settle).
function folderNoteGraph(folder: string, note: string): GraphData {
    return {
        nodes: [
            { id: note, label: note, kind: 'note' },
            { id: `${folder}/x`, label: 'x', kind: 'note' },
            { id: `${folder}/y`, label: 'y', kind: 'note' },
            { id: 'other', label: 'other', kind: 'note' },
        ],
        edges: [
            { from: note, to: 'other', kind: 'link' },
            { from: `${folder}/x`, to: 'other', kind: 'link' },
            { from: `${folder}/y`, to: note, kind: 'link' },
        ],
    }
}

test('renameLayoutIds on a folder leaves a same-named sibling note where it is', async () => {
    const vault = `vault-${randomUUID()}`
    const before = posOf(await attachLayout(folderNoteGraph('proj', 'proj'), vault))
    renameLayoutIds(vault, 'proj', 'work')
    const after = posOf(await attachLayout(folderNoteGraph('work', 'proj'), vault))
    expect(after['proj']).toEqual(before['proj'])
    expect(after['work/x']).toEqual(before['proj/x'])
    expect(after['work/y']).toEqual(before['proj/y'])
    expect(after['other']).toEqual(before['other'])
})

test('renameLayoutIds on a note leaves a same-named sibling folder where it is', async () => {
    const vault = `vault-${randomUUID()}`
    const before = posOf(await attachLayout(folderNoteGraph('proj', 'proj'), vault))
    renameLayoutIds(vault, 'proj.md', 'plan.md')
    const after = posOf(await attachLayout(folderNoteGraph('proj', 'plan'), vault))
    expect(after['plan']).toEqual(before['proj'])
    expect(after['proj/x']).toEqual(before['proj/x'])
    expect(after['proj/y']).toEqual(before['proj/y'])
    expect(after['other']).toEqual(before['other'])
})

// The seed objects are shared with the per-signature layout cache, so a remap must COPY: rewriting a
// seed in place would strip `n5` out of the cached pre-rename layout too.
test('renameLayoutIds does not corrupt the cached layout of the pre-rename graph', async () => {
    const vault = `vault-${randomUUID()}`
    const before = await attachLayout(chain(40), vault)
    renameLayoutIds(vault, 'n5.md', 'renamed.md')
    const again = await attachLayout(chain(40), vault) // e.g. the rename is undone
    expect(posOf(again)).toEqual(posOf(before))
})

test('an edge added between existing notes moves only its endpoints', async () => {
    const vault = `vault-${randomUUID()}`
    const before = await attachLayout(chain(60), vault)
    const g = chain(60)
    g.edges.push({ from: 'n3', to: 'n50', kind: 'link' })
    const after = await attachLayout(g, vault)
    const b = posOf(before)
    for (const n of after.nodes.filter(n => n.id !== 'n3' && n.id !== 'n50'))
        expect([n.position, n.position2d]).toEqual(b[n.id])
})

// The other half of the symmetric difference: an edge only the SEED knows about (its endpoints are
// recovered from the stored `from|to|kind` key, not from a live edge object).
test('an edge removed between existing notes moves only its endpoints', async () => {
    const vault = `vault-${randomUUID()}`
    const g1 = chain(60)
    g1.edges.push({ from: 'n3', to: 'n50', kind: 'link' })
    const before = await attachLayout(g1, vault)
    const after = await attachLayout(chain(60), vault)
    const b = posOf(before)
    const moved = after.nodes.filter(
        n => JSON.stringify([n.position, n.position2d]) !== JSON.stringify(b[n.id]),
    )
    for (const n of moved) expect(['n3', 'n50']).toContain(n.id)
})

test('a full settle is byte-identical for identical input and seed (no output drift)', async () => {
    const g = chain(30)
    const a = await attachLayout(g, `vault-${randomUUID()}`)
    const c = await attachLayout(chain(30), `vault-${randomUUID()}`)
    expect(posOf(a)).toEqual(posOf(c))
})

// Seeds written before this change carry no `edges`. They must keep working (no CACHE_VERSION bump):
// a pure add still pins the existing layout exactly.
test('an on-disk seed without edges still pins a pure add', async () => {
    const src = await attachLayout(baseGraph(), `vault-${randomUUID()}`)
    const vault = `vault-${randomUUID()}`
    const version = graphSig(baseGraph(), vault).split('-')[0]
    const hash = createHash('sha1').update(vault).digest('hex').slice(0, 16)
    const dir = process.env.BISMUTH_LAYOUT_CACHE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(
        join(dir, `seed-${version}-${hash}.json`),
        JSON.stringify({
            pos3d: Object.fromEntries(src.nodes.map(n => [n.id, n.position])),
            pos2d: Object.fromEntries(
                src.nodes.map(n => [n.id, [...n.position2d!, 0]]),
            ),
        }),
    )
    const g2: GraphData = {
        nodes: [...baseGraph().nodes, { id: 'D', label: 'D', kind: 'note' }],
        edges: [...baseGraph().edges, { from: 'A', to: 'D', kind: 'link' }],
    }
    const out = posOf(await attachLayout(g2, vault))
    const prior = posOf(src)
    for (const id of ['A', 'B', 'C']) expect(out[id]).toEqual(prior[id])
})

// ── Cancellation + in-flight sharing ────────────────────────────────────────────────────────────

// POST /move remaps the seed and then invalidates the in-flight build. The layout of an already-cached
// graph resolves at once, so ONLY the signal check right before the seed write can stop it from
// overwriting the remapped seed with the pre-rename ids.
test('an attachLayout aborted after its layout resolved never overwrites a remapped seed', async () => {
    const vault = `vault-${randomUUID()}`
    const before = posOf(await attachLayout(chain(40), vault))
    const ac = new AbortController()
    const doomed = attachLayout(chain(40), vault, { signal: ac.signal })
    ac.abort()
    renameLayoutIds(vault, 'n5.md', 'renamed.md')
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })
    const after = posOf(await attachLayout(renamed(chain(40), 'n5', 'renamed'), vault))
    expect(after['renamed']).toEqual(before['n5'])
})

test('an attachLayout aborted mid-build never overwrites a remapped seed', async () => {
    const vault = `vault-${randomUUID()}`
    const before = posOf(await attachLayout(chain(40), vault))
    const g = chain(40)
    g.nodes = g.nodes.filter(n => n.id !== 'n39')
    g.edges = g.edges.filter(e => e.to !== 'n39')
    const ac = new AbortController()
    const doomed = attachLayout(g, vault, { signal: ac.signal })
    ac.abort()
    renameLayoutIds(vault, 'n5.md', 'renamed.md')
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })
    const after = posOf(await attachLayout(renamed(g, 'n5', 'renamed'), vault))
    expect(after['renamed']).toEqual(before['n5'])
})

test('an aborted computeViewLayouts never overwrites remapped view seeds', async () => {
    const vault = `vault-${randomUUID()}`
    await attachLayout(chain(40), vault)
    const views = await computeViewLayouts(chain(40), vault)
    const ac = new AbortController()
    const doomed = computeViewLayouts(chain(40), vault, { signal: ac.signal })
    ac.abort()
    renameLayoutIds(vault, 'n5.md', 'renamed.md')
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })
    const after = await computeViewLayouts(
        renamed(chain(40), 'n5', 'renamed'),
        vault,
    )
    expect(after.second.pos3d['renamed']).toEqual(views.second.pos3d['n5'])
    expect(after.second.pos2d['renamed']).toEqual(views.second.pos2d['n5'])
})

// Two callers asking for the same graph at once (first launch: the boot warm-up and GET /graph/views)
// must share ONE computation. Shared work hands both the very same position arrays.
test('concurrent builds of one graph share a single computation', async () => {
    const vault = `vault-${randomUUID()}`
    const [a, b] = await Promise.all([
        attachLayout(chain(30), vault),
        attachLayout(chain(30), vault),
    ])
    expect(a.nodes[0].position).toBe(b.nodes[0].position!)
})

test('aborting one caller does not cancel a build another caller still awaits', async () => {
    const vault = `vault-${randomUUID()}`
    const ac = new AbortController()
    const doomed = attachLayout(chain(60), vault, { signal: ac.signal })
    const kept = attachLayout(chain(60), vault)
    ac.abort()
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })
    const out = await kept
    for (const n of out.nodes) {
        expect(n.position).toBeDefined()
        expect(n.position2d).toBeDefined()
    }
})

test('aborting the only caller cancels the build: nothing is cached', async () => {
    // Time an uncancelled build of the same shape first, so the wait below provably outlasts one.
    const t0 = performance.now()
    await attachLayout(chain(120), `vault-${randomUUID()}`)
    const fullMs = performance.now() - t0
    const vault = `vault-${randomUUID()}`
    const g = chain(120)
    const ac = new AbortController()
    const doomed = attachLayout(g, vault, { signal: ac.signal })
    ac.abort()
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise(r => setTimeout(r, fullMs * 2 + 50))
    expect(peekLayout(g, vault)).toBeNull()
})

test('the in-memory layout cache is bounded (least recently set is evicted)', async () => {
    const g0 = chain(3)
    const v0 = `vault-${randomUUID()}`
    await attachLayout(g0, v0)
    const kept = peekLayout(g0, v0)
    expect(peekLayout(g0, v0)).toBe(kept!) // served from memory: the same object
    for (let i = 0; i < 16; i++)
        await attachLayout(chain(3), `vault-${randomUUID()}`)
    const again = peekLayout(g0, v0)
    expect(again).not.toBe(kept!) // evicted from memory: re-read from disk
    expect(again).toEqual(kept)
})
