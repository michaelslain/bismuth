// core/test/graphBuilder.test.ts
import { test, expect, describe, afterEach } from 'bun:test'
import { buildGraphFromNotes } from '../src/graphBuilder'
import { setFileAccess, type FileAccess } from '../src/fileAccess'
import type { GraphNode } from '../src/graph'

// A no-disk FileAccess backed by an in-memory map — what a tauri-plugin-fs impl
// stands in for on iPad. Only listMarkdown/readNote matter for graph building.
function memAccess(vault: Record<string, string>): FileAccess {
    return {
        listMarkdown: async () => Object.keys(vault),
        listTree: async () =>
            Object.keys(vault).map(path => ({ path, kind: 'file' as const })),
        readNote: async (_root, rel) => vault[rel] ?? '',
        writeNote: async () => {},
        statNote: async () => null,
        realPath: async p => p,
    }
}

// Reset to the lazy `files.ts` default after each test so other suites that
// build real graphs off disk are unaffected by an injected in-memory reader.
afterEach(() => setFileAccess(undefined as unknown as FileAccess))

describe('buildGraphFromNotes FileAccess seam (the mobile in-process path)', () => {
    test('builds a graph from an injected reader with no filesystem touched', async () => {
        // An entirely in-memory vault — no Bun, no node:fs, no disk.
        setFileAccess(
            memAccess({ 'a.md': 'links to [[b]]', 'b.md': 'leaf note' }),
        )

        const node = (rel: string): GraphNode => ({
            id: rel.replace(/\.md$/, ''),
            label: rel,
            kind: 'note',
        })
        const { nodes, edges, byBase } = await buildGraphFromNotes(
            '/ignored-root',
            node,
            // minimal edge extractor: one "link" edge per [[wikilink]] resolved via byBase
            (nodeId, content, byBase) => {
                const out = []
                for (const m of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
                    const target = byBase.get(m[1])
                    if (target)
                        out.push({
                            from: nodeId,
                            to: target,
                            kind: 'link' as const,
                        })
                }
                return out
            },
        )

        expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
        expect(byBase.get('b')).toBe('b')
        expect(edges).toEqual([{ from: 'a', to: 'b', kind: 'link' }])
    })

    test('setFileAccess swaps the active reader', async () => {
        let used = ''
        const a = memAccess({})
        setFileAccess({
            ...a,
            listMarkdown: async () => {
                used = 'injected'
                return []
            },
        })
        await buildGraphFromNotes(
            '/x',
            r => ({ id: r, label: r, kind: 'note' }),
            () => [],
        )
        expect(used).toBe('injected')
    })
})

describe('buildGraphFromNotes byBase tie-break for duplicate basenames', () => {
    // Two notes share the basename "Name" (x/Name.md and a/b/Name.md) at different depths, plus
    // a linker note that wikilinks the bare basename. A minimal edge extractor resolves `[[Name]]`
    // via byBase, the same seam vault.ts/memory.ts use for real link resolution.
    const edgeExtractor = (
        nodeId: string,
        content: string,
        byBase: Map<string, string>,
        byPath: Map<string, string>,
    ) => {
        const out = []
        for (const m of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const target = byPath.get(m[1]) ?? byBase.get(m[1])
            if (target) out.push({ from: nodeId, to: target, kind: 'link' as const })
        }
        return out
    }
    const node = (rel: string): GraphNode => ({
        id: rel.replace(/\.md$/, ''),
        label: rel,
        kind: 'note',
    })

    test('byBase resolves a bare basename to the shallower duplicate', async () => {
        setFileAccess(
            memAccess({
                'x/Name.md': 'leaf',
                'a/b/Name.md': 'leaf',
                'Linker.md': 'links to [[Name]]',
            }),
        )
        const { byBase, edges } = await buildGraphFromNotes(
            '/vault',
            node,
            edgeExtractor,
        )
        expect(byBase.get('Name')).toBe('x/Name')
        expect(edges).toEqual([{ from: 'Linker', to: 'x/Name', kind: 'link' }])
    })

    test('byBase winner is independent of file walk order', async () => {
        setFileAccess(
            memAccess({
                'Linker.md': 'links to [[Name]]',
                'a/b/Name.md': 'leaf',
                'x/Name.md': 'leaf',
            }),
        )
        const { byBase, edges } = await buildGraphFromNotes(
            '/vault',
            node,
            edgeExtractor,
        )
        expect(byBase.get('Name')).toBe('x/Name')
        expect(edges).toEqual([{ from: 'Linker', to: 'x/Name', kind: 'link' }])
    })

    test('a full path target still resolves to the exact duplicate, not the winner', async () => {
        setFileAccess(
            memAccess({
                'x/Name.md': 'leaf',
                'a/b/Name.md': 'leaf',
                'Linker.md': 'links to [[a/b/Name]]',
            }),
        )
        const { edges } = await buildGraphFromNotes('/vault', node, edgeExtractor)
        expect(edges).toEqual([{ from: 'Linker', to: 'a/b/Name', kind: 'link' }])
    })
})
