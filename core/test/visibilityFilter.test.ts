import { test, expect, describe } from 'bun:test'
import { join } from 'node:path'
import { writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import {
    agentChannel,
    agentDenyEntries,
    agentMemoryDirAllowed,
    filterByPath,
    filterGraph,
    filterTree,
    folderRestricted,
    graphContentPath,
    isDeniedPath,
} from '../src/visibilityFilter'
import { stampCommunities } from '../src/engine'
import type { GraphData, GraphEdge, GraphNode } from '../src/graph'
import { makeVault, tempDir } from './helpers'

const HIDDEN_TITLE = 'Hidden Strategy Hub'
const DENY = [
    { rel: 'Private/hub.md', abs: '/v/Private/hub.md' },
    { rel: 'Vault Hidden/inner.md', abs: '/v/Vault Hidden/inner.md' },
]

describe('agentChannel', () => {
    test('no env is the owner (null)', () => {
        expect(agentChannel({})).toBeNull()
        expect(agentChannel({ BISMUTH_AGENT_CHANNEL: '' })).toBeNull()
    })
    test('BISMUTH_AGENT_CHANNEL names the channel', () => {
        expect(agentChannel({ BISMUTH_AGENT_CHANNEL: 'daemon' })).toBe('daemon')
        expect(agentChannel({ BISMUTH_AGENT_CHANNEL: 'chat' })).toBe('chat')
    })
    test('an MCP-spawned CLI is an agent: BISMUTH_MCP_CHANNEL alone resolves, unknown values to the stricter daemon', () => {
        expect(agentChannel({ BISMUTH_MCP_CHANNEL: 'chat' })).toBe('chat')
        expect(agentChannel({ BISMUTH_MCP_CHANNEL: 'x' })).toBe('daemon')
    })
    test('the direct channel wins over the MCP one', () => {
        expect(
            agentChannel({
                BISMUTH_AGENT_CHANNEL: 'daemon',
                BISMUTH_MCP_CHANNEL: 'chat',
            }),
        ).toBe('daemon')
    })
})

describe('agentDenyEntries', () => {
    test('the owner gets [] without the vault being read', async () => {
        expect(await agentDenyEntries('/does/not/exist/anywhere', {})).toEqual(
            [],
        )
    })
    test('an agent on a vault with an unparseable .settings THROWS (fail closed)', async () => {
        const vault = makeVault({
            '.settings': 'folderVisibility: [unclosed\n  : :\n',
            'a.md': 'a',
        })
        await expect(
            agentDenyEntries(vault, { BISMUTH_AGENT_CHANNEL: 'daemon' }),
        ).rejects.toThrow()
        // A failed walk is not cached: the next call retries, and succeeds once the file is fixed.
        writeFileSync(join(vault, '.settings'), 'folderVisibility: {}\n')
        expect(
            await agentDenyEntries(vault, { BISMUTH_AGENT_CHANNEL: 'daemon' }),
        ).toEqual([])
    })
    test('an agent gets the deny list, memoised per (vault, channel)', async () => {
        const vault = makeVault({
            'secret.md': '---\nvisibility: hidden\n---\nx',
            'chatty.md': '---\nvisibility: chat-only\n---\nx',
            'open.md': 'x',
        })
        const daemon = await agentDenyEntries(vault, {
            BISMUTH_AGENT_CHANNEL: 'daemon',
        })
        expect(daemon.map(e => e.rel).sort()).toEqual(['chatty.md', 'secret.md'])
        // Same array identity, and also through the MCP spelling of the same channel.
        expect(
            await agentDenyEntries(vault, { BISMUTH_MCP_CHANNEL: 'daemon' }),
        ).toBe(daemon)
        const chat = await agentDenyEntries(vault, {
            BISMUTH_AGENT_CHANNEL: 'chat',
        })
        expect(chat.map(e => e.rel)).toEqual(['secret.md'])
        expect(chat).not.toBe(daemon)
    })
})

describe('filterByPath', () => {
    const items = [{ p: 'open.md' }, { p: 'Private/hub.md' }, { p: 'x/y.md' }]
    test('drops a denied path', () => {
        expect(filterByPath(items, DENY, i => i.p)).toEqual([
            { p: 'open.md' },
            { p: 'x/y.md' },
        ])
    })
    test('returns the input itself for empty entries', () => {
        expect(filterByPath(items, [], i => i.p)).toBe(items)
    })
    test('drops a file under a hidden folder', () => {
        expect(
            filterByPath([{ p: 'Vault Hidden/inner.md' }], DENY, i => i.p),
        ).toEqual([])
    })
})

describe('graphContentPath', () => {
    const node = (id: string, kind: GraphNode['kind']): GraphNode => ({
        id,
        label: id,
        kind,
    })
    test('note and memory nodes map to a vault path; every other kind is null', () => {
        expect(graphContentPath(node('a/b', 'note'))).toBe('a/b.md')
        expect(graphContentPath(node('mem:x', 'memory'))).toBe(
            '.daemon/memory/x.md',
        )
        expect(graphContentPath(node('tag', 'tag'))).toBeNull()
    })
})

/** 3 clusters of notes (a hidden hub + 12 spokes; two visible rings), plus tags. Big enough that
 *  `stampCommunities` runs (>= 30 nodes) even after the hidden hub is removed. */
function buildGraph(): GraphData {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const note = (id: string, label: string) =>
        nodes.push({ id, label, kind: 'note', folder: '' })
    note('Private/hub', HIDDEN_TITLE)
    for (let i = 0; i < 12; i++) {
        note(`a${i}`, `Spoke ${i}`)
        edges.push({ from: 'Private/hub', to: `a${i}`, kind: 'link' })
    }
    for (const prefix of ['b', 'c']) {
        for (let i = 0; i < 12; i++) {
            note(`${prefix}${i}`, `${prefix.toUpperCase()} ${i}`)
            edges.push({
                from: `${prefix}${i}`,
                to: `${prefix}${(i + 1) % 12}`,
                kind: 'link',
            })
            edges.push({
                from: `${prefix}${i}`,
                to: `${prefix}${(i + 2) % 12}`,
                kind: 'link',
            })
        }
    }
    edges.push({ from: 'a0', to: 'b0', kind: 'link' })
    edges.push({ from: 'b6', to: 'c6', kind: 'link' })
    nodes.push({ id: 'tag:onlyhidden', label: '#onlyhidden', kind: 'tag' })
    nodes.push({ id: 'tag:shared', label: '#shared', kind: 'tag' })
    nodes.push({ id: 'tag:lonely', label: '#lonely', kind: 'tag' })
    edges.push({ from: 'Private/hub', to: 'tag:onlyhidden', kind: 'tag' })
    edges.push({ from: 'Private/hub', to: 'tag:shared', kind: 'tag' })
    edges.push({ from: 'a1', to: 'tag:shared', kind: 'tag' })
    return stampCommunities({ nodes, edges })
}

describe('filterGraph', () => {
    test('sanity: unfiltered, the hidden hub IS a community label (so the test below can fail)', () => {
        const g = buildGraph()
        const labels = g.nodes.flatMap(n => [
            n.communityLabel,
            ...(n.communityPathLabels ?? []),
        ])
        expect(labels).toContain(HIDDEN_TITLE)
    })

    test('drops a hidden note node and every edge touching it', () => {
        const out = filterGraph(buildGraph(), DENY)
        expect(out.nodes.some(n => n.id === 'Private/hub')).toBe(false)
        expect(
            out.edges.some(
                e => e.from === 'Private/hub' || e.to === 'Private/hub',
            ),
        ).toBe(false)
        expect(out.nodes.some(n => n.id === 'a0')).toBe(true)
    })

    test('drops a tag only the hidden note carried, keeps one shared with a visible note and an always-lonely one', () => {
        const ids = filterGraph(buildGraph(), DENY).nodes.map(n => n.id)
        expect(ids).not.toContain('tag:onlyhidden')
        expect(ids).toContain('tag:shared')
        expect(ids).toContain('tag:lonely')
    })

    test('no communityLabel or communityPathLabels names the hidden note after re-stamping', () => {
        const out = filterGraph(buildGraph(), DENY)
        const stamped = out.nodes.filter(n => n.communityLabel !== undefined)
        expect(stamped.length).toBeGreaterThan(0) // re-stamped, not merely cleared
        for (const n of out.nodes) {
            expect(n.communityLabel ?? '').not.toContain(HIDDEN_TITLE)
            for (const l of n.communityPathLabels ?? [])
                expect(l).not.toContain(HIDDEN_TITLE)
        }
    })

    test('does not mutate the input graph or its nodes', () => {
        const g = buildGraph()
        const before = structuredClone(g)
        const out = filterGraph(g, DENY)
        expect(g).toEqual(before)
        expect(out).not.toBe(g)
        for (const n of out.nodes) expect(g.nodes).not.toContain(n)
    })

    test('returns the input itself when nothing is denied or nothing matches', () => {
        const g = buildGraph()
        expect(filterGraph(g, [])).toBe(g)
        expect(
            filterGraph(g, [{ rel: 'nope.md', abs: '/v/nope.md' }]),
        ).toBe(g)
    })

    test('strips a dropped id from per-view layouts', () => {
        const g = buildGraph()
        g.views = {
            second: {
                pos3d: { 'Private/hub': [0, 0, 0], a0: [1, 1, 1] },
                pos2d: { 'Private/hub': [0, 0], a0: [1, 1] },
            },
        }
        const out = filterGraph(g, DENY)
        expect(Object.keys(out.views?.second?.pos3d ?? {})).toEqual(['a0'])
        expect(Object.keys(out.views?.second?.pos2d ?? {})).toEqual(['a0'])
        expect(Object.keys(g.views.second!.pos3d)).toContain('Private/hub')
    })
})

describe('filterTree', () => {
    const tree = [
        { path: 'open.md', kind: 'file' as const },
        { path: 'Private', kind: 'dir' as const },
        { path: 'Private/secret.md', kind: 'file' as const },
        { path: 'Vault Hidden', kind: 'dir' as const },
        { path: 'Vault Hidden/inner.md', kind: 'file' as const },
        { path: 'Mixed', kind: 'dir' as const },
        { path: 'Mixed/seen.md', kind: 'file' as const },
        { path: 'Mixed/unseen.md', kind: 'file' as const },
    ]
    const deny = [
        { rel: 'Private/secret.md', abs: '/v/Private/secret.md' },
        { rel: 'Vault Hidden/inner.md', abs: '/v/Vault Hidden/inner.md' },
        { rel: 'Mixed/unseen.md', abs: '/v/Mixed/unseen.md' },
    ]
    const restricted = (d: string) => d === 'Vault Hidden'

    test('drops a denied file, a hidden folder with no kept child, and keeps a folder that still has a visible child', () => {
        const out = filterTree(tree, deny, restricted).map(e => e.path)
        expect(out).toEqual(['open.md', 'Mixed', 'Mixed/seen.md'])
        // `Private` is not itself restricted, but its only file is hidden: an empty `Private/`
        // would name the hidden note's folder, so it goes too.
        expect(out).not.toContain('Private')
        expect(out).not.toContain('Vault Hidden')
        expect(out).not.toContain('Vault Hidden/inner.md')
        expect(out).not.toContain('Private/secret.md')
    })
    test('a restricted folder that still holds a visible file (explicit override) stays', () => {
        const out = filterTree(
            [
                { path: 'Vault Hidden', kind: 'dir' as const },
                { path: 'Vault Hidden/shown.md', kind: 'file' as const },
            ],
            [],
            restricted,
        )
        expect(out.map(e => e.path)).toEqual([
            'Vault Hidden',
            'Vault Hidden/shown.md',
        ])
    })
    test('an empty restricted folder is dropped even when no file is denied (an agent with nothing to deny)', () => {
        const out = filterTree(
            [{ path: 'Vault Hidden', kind: 'dir' as const }],
            [],
            restricted,
        )
        expect(out).toEqual([])
    })
    test('returns the input itself when there is nothing to filter', () => {
        expect(filterTree(tree, [], () => false)).toBe(tree)
    })
    test('a dir under a dropped restricted ancestor is dropped even when empty', () => {
        const out = filterTree(
            [
                { path: 'Vault Hidden', kind: 'dir' as const },
                { path: 'Vault Hidden/sub', kind: 'dir' as const },
                { path: 'Vault Hidden/sub/deep', kind: 'dir' as const },
                { path: 'open.md', kind: 'file' as const },
            ],
            [],
            restricted,
        )
        expect(out.map(e => e.path)).toEqual(['open.md'])
    })
    test('a dir under a dropped ancestor is dropped when the ancestor lost its files to a deny', () => {
        const out = filterTree(
            [
                { path: 'Private', kind: 'dir' as const },
                { path: 'Private/empty', kind: 'dir' as const },
                { path: 'Private/secret.md', kind: 'file' as const },
            ],
            [{ rel: 'Private/secret.md', abs: '/v/Private/secret.md' }],
            () => false,
        )
        expect(out).toEqual([])
    })
    test('an empty unrestricted dir that never held a denied file stays', () => {
        const out = filterTree(
            [
                { path: 'Empty', kind: 'dir' as const },
                { path: 'Private', kind: 'dir' as const },
                { path: 'Private/secret.md', kind: 'file' as const },
            ],
            [{ rel: 'Private/secret.md', abs: '/v/Private/secret.md' }],
            () => false,
        )
        expect(out.map(e => e.path)).toEqual(['Empty'])
    })
})

describe('agentMemoryDirAllowed', () => {
    test('exactly <vault>/.daemon/memory is allowed, existing or not', () => {
        const vault = makeVault({ 'a.md': 'x' })
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory'))).toBe(true)
        mkdirSync(join(vault, '.daemon', 'memory'), { recursive: true })
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory'))).toBe(true)
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory') + '/')).toBe(true)
    })
    test('a symlinked <vault>/.daemon/memory is allowed by either spelling', () => {
        const vault = makeVault({ 'a.md': 'x' })
        const real = tempDir('memory-real-')
        mkdirSync(join(vault, '.daemon'), { recursive: true })
        symlinkSync(real, join(vault, '.daemon', 'memory'))
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory'))).toBe(true)
        expect(agentMemoryDirAllowed(vault, real)).toBe(true)
    })
    test('a sibling, the vault root, and a subdirectory are refused', () => {
        const vault = makeVault({ 'a.md': 'x' })
        mkdirSync(join(vault, '.daemon', 'memory', 'sub'), { recursive: true })
        mkdirSync(join(vault, '.daemon', 'other'), { recursive: true })
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'other'))).toBe(false)
        expect(agentMemoryDirAllowed(vault, vault)).toBe(false)
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory', 'sub'))).toBe(false)
    })
    test('a .. escape that lands outside is refused, one that lands back on the dir is allowed', () => {
        const vault = makeVault({ 'a.md': 'x' })
        mkdirSync(join(vault, '.daemon', 'memory'), { recursive: true })
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory', '..', '..'))).toBe(false)
        expect(agentMemoryDirAllowed(vault, join(vault, '.daemon', 'memory', '..', 'memory'))).toBe(true)
    })
    test('a symlink pointing elsewhere is refused; a symlinked memory dir pointing at the real one resolves equal', () => {
        const vault = makeVault({ 'Vault Hidden/inner.md': 'x' })
        mkdirSync(join(vault, '.daemon', 'memory'), { recursive: true })
        const link = join(vault, 'link')
        symlinkSync(vault, link)
        expect(agentMemoryDirAllowed(vault, link)).toBe(false)
        const real = join(vault, '.daemon', 'memory')
        const alias = join(vault, 'alias')
        symlinkSync(real, alias)
        expect(agentMemoryDirAllowed(vault, alias)).toBe(true)
        // a not-yet-created dir under a symlink that escapes is still refused
        expect(agentMemoryDirAllowed(vault, join(link, 'x'))).toBe(false)
    })
})

describe('folderRestricted', () => {
    test('reads folderVisibility: chat sees chat-only folders, daemon does not; a hidden folder cascades to children', async () => {
        const vault = makeVault({
            '.settings':
                'folderVisibility:\n  Vault Hidden: hidden\n  Chatty Dir: chat-only\n',
        })
        const chat = await folderRestricted(vault, 'chat')
        const daemon = await folderRestricted(vault, 'daemon')
        expect(chat('Vault Hidden')).toBe(true)
        expect(chat('Vault Hidden/sub')).toBe(true)
        expect(chat('Chatty Dir')).toBe(false)
        expect(daemon('Chatty Dir')).toBe(true)
        expect(daemon('Elsewhere')).toBe(false)
    })
    test('an unparseable .settings throws', async () => {
        const vault = makeVault({ '.settings': 'folderVisibility: [oops\n' })
        await expect(folderRestricted(vault, 'daemon')).rejects.toThrow()
    })
    test('an absent .settings restricts nothing', async () => {
        const restricted = await folderRestricted(tempDir('vis-empty-'), 'daemon')
        expect(restricted('anything')).toBe(false)
    })
})

test('isDeniedPath is re-exported', () => {
    expect(isDeniedPath(DENY, 'Private/hub.md')).toBe(true)
    expect(isDeniedPath(DENY, 'open.md')).toBe(false)
})
