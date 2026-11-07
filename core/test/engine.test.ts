import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import { writeNote } from '../src/files'
import { buildGraph } from '../src/engine'

test('merges vault + memory and adds cross-brain about edges', async () => {
    const vault = tempDir('bismuth-eng-v-')
    const mem = tempDir('bismuth-eng-m-')
    await writeNote(vault, 'internship.md', '# Internship')
    await writeNote(
        mem,
        'michael-profile.md',
        'He is working on [[internship]].',
    )
    const g = await buildGraph(vault, mem)

    expect(g.nodes.some(n => n.id === 'internship')).toBe(true)
    expect(g.edges).toContainEqual({
        from: 'mem:michael-profile',
        to: 'internship',
        kind: 'about',
    })
})

test('path-style memory reference [[folder/Note]] creates an about edge', async () => {
    const vault = tempDir('bismuth-eng-pathabout-')
    const mem = tempDir('bismuth-eng-pathabout-mem-')
    await writeNote(vault, 'reading/Deep Note.md', '# Deep Note')
    await writeNote(mem, 'profile.md', 'About [[reading/Deep Note]].')
    const g = await buildGraph(vault, mem)
    expect(g.edges).toContainEqual({
        from: 'mem:profile',
        to: 'reading/Deep Note',
        kind: 'about',
    })
})

test('works with no memory dir', async () => {
    const vault = tempDir('bismuth-eng-v2-')
    await writeNote(vault, 'a.md', '# A')
    const g = await buildGraph(vault)
    expect(g.nodes.some(n => n.id === 'a')).toBe(true)
})

test('empty vault produces an empty graph', async () => {
    const vault = tempDir('bismuth-eng-empty-')
    const g = await buildGraph(vault)
    expect(g.nodes).toEqual([])
})

test('about edges only created for vault basenames', async () => {
    const vault = tempDir('bismuth-eng-about-')
    const mem = tempDir('bismuth-eng-about-mem-')
    await writeNote(vault, 'real.md', '')
    await writeNote(mem, 'memory.md', 'Reference to [[real]] and [[fake]]')
    const g = await buildGraph(vault, mem)
    const aboutEdges = g.edges.filter(e => e.kind === 'about')
    // Should have edge to real, but not to fake
    expect(aboutEdges.some(e => e.to === 'real')).toBe(true)
    expect(aboutEdges.some(e => e.to === 'fake')).toBe(false)
})

test('memory references without vault match are ignored', async () => {
    const vault = tempDir('bismuth-eng-nomatch-')
    const mem = tempDir('bismuth-eng-nomatch-mem-')
    await writeNote(vault, 'exists.md', '')
    await writeNote(
        mem,
        'memory.md',
        'References [[missing1]] and [[missing2]]',
    )
    const g = await buildGraph(vault, mem)
    const aboutEdges = g.edges.filter(e => e.kind === 'about')
    expect(aboutEdges.length).toBe(0)
})

test('two disconnected clusters get distinct community ids', async () => {
    const vault = tempDir('bismuth-eng-comm-')
    // Cluster 1: a <-> b <-> c (linked). Cluster 2: x <-> y <-> z (linked). No cross-links.
    await writeNote(vault, 'a.md', '[[b]] [[c]]')
    await writeNote(vault, 'b.md', '[[a]] [[c]]')
    await writeNote(vault, 'c.md', '[[a]] [[b]]')
    await writeNote(vault, 'x.md', '[[y]] [[z]]')
    await writeNote(vault, 'y.md', '[[x]] [[z]]')
    await writeNote(vault, 'z.md', '[[x]] [[y]]')
    // Below MIN_NODES_FOR_CLUSTERING, community detection is skipped entirely — pad with unlinked
    // filler notes so this vault stays above the threshold without disturbing the two clusters' own
    // connectivity (an isolated note is its own singleton community at every level, so it can't merge
    // into or split either real cluster).
    for (let i = 0; i < 26; i++) await writeNote(vault, `filler${i}.md`, '')
    const g = await buildGraph(vault)
    const comm = (id: string) => g.nodes.find(n => n.id === id)!.community
    expect(comm('a')).toBe(comm('b'))
    expect(comm('a')).toBe(comm('c'))
    expect(comm('x')).toBe(comm('y'))
    expect(comm('a')).not.toBe(comm('x'))
    // Exemplar labels stamped onto every node.
    expect(g.nodes.find(n => n.id === 'a')!.communityLabel).toBeDefined()
    // Hierarchy stamped alongside, with the flat fields as its finest level. This vault is far below
    // the 2-level breakpoint (360 nodes), so the path is a single level — same grouping as before.
    for (const n of g.nodes) {
        expect(n.communityPath).toEqual([n.community!])
        expect(n.communityPathLabels).toEqual([n.communityLabel!])
    }
})

test('small vaults below the clustering threshold are left unstamped', async () => {
    const vault = tempDir('bismuth-eng-small-')
    await writeNote(vault, 'a.md', '[[b]] [[c]]')
    await writeNote(vault, 'b.md', '[[a]] [[c]]')
    await writeNote(vault, 'c.md', '[[a]] [[b]]')
    await writeNote(vault, 'x.md', '[[y]] [[z]]')
    await writeNote(vault, 'y.md', '[[x]] [[z]]')
    await writeNote(vault, 'z.md', '[[x]] [[y]]')
    const g = await buildGraph(vault)
    expect(g.nodes.length).toBeLessThan(30)
    for (const n of g.nodes) {
        expect(n.community).toBeUndefined()
        expect(n.communityLabel).toBeUndefined()
        expect(n.communityPath).toBeUndefined()
        expect(n.communityPathLabels).toBeUndefined()
    }
})

test('multiple memory notes can link to same vault note', async () => {
    const vault = tempDir('bismuth-eng-multi-')
    const mem = tempDir('bismuth-eng-multi-mem-')
    await writeNote(vault, 'target.md', '')
    await writeNote(mem, 'memory1.md', '[[target]]')
    await writeNote(mem, 'memory2.md', 'Also [[target]]')
    const g = await buildGraph(vault, mem)
    const aboutToTarget = g.edges.filter(
        e => e.kind === 'about' && e.to === 'target',
    )
    expect(aboutToTarget.length).toBe(2)
})

test('graph.exclude in .settings drops the named notes and their edges in every brain', async () => {
    const vault = tempDir('bismuth-eng-excl-')
    const mem = tempDir('bismuth-eng-excl-mem-')
    await writeNote(
        vault,
        'keep.md',
        'links [[user-profile]] and [[index]] #solo',
    )
    await writeNote(vault, 'index.md', '#only-index')
    await writeNote(vault, 'notes/index.md', 'a second index')
    await writeNote(mem, 'user-profile.md', 'about [[keep]] and [[index]]')
    await writeNote(mem, 'facts.md', 'see [[user-profile]] and [[keep]]')
    await writeNote(
        vault,
        '.settings',
        'graph:\n  exclude:\n    - user-profile\n    - index\n',
    )
    const g = await buildGraph(vault, mem)
    const ids = g.nodes.map(n => n.id)
    expect(ids).toContain('keep')
    expect(ids).toContain('mem:facts')
    // a bare name hides every note with that basename, vault and memory alike
    expect(ids).not.toContain('index')
    expect(ids).not.toContain('notes/index')
    expect(ids).not.toContain('mem:user-profile')
    // a tag carried only by an excluded note goes with it; one a kept note carries stays
    expect(ids).not.toContain('tag:only-index')
    expect(ids).toContain('tag:solo')
    const gone = new Set(['index', 'notes/index', 'mem:user-profile'])
    expect(g.edges.some(e => gone.has(e.from) || gone.has(e.to))).toBe(false)
    expect(g.edges).toContainEqual({
        from: 'mem:facts',
        to: 'keep',
        kind: 'about',
    })
})

test('a path-qualified graph.exclude entry hides only that note', async () => {
    const vault = tempDir('bismuth-eng-exclpath-')
    await writeNote(vault, 'index.md', '')
    await writeNote(vault, 'notes/index.md', '')
    const g = await buildGraph(vault, undefined, {
        exclude: ['notes/index.md'],
    })
    const ids = g.nodes.map(n => n.id)
    expect(ids).toContain('index')
    expect(ids).not.toContain('notes/index')
})

test('no graph.exclude leaves the graph as it was', async () => {
    const vault = tempDir('bismuth-eng-exclnone-')
    await writeNote(vault, 'a.md', '[[b]]')
    await writeNote(vault, 'b.md', '')
    await writeNote(vault, '.settings', 'graph:\n  exclude: []\n')
    const g = await buildGraph(vault)
    expect(g.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(g.edges).toHaveLength(1)
})
