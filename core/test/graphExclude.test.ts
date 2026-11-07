import { describe, expect, test } from 'bun:test'
import {
    excludeFromGraph,
    graphExcludeFrom,
    graphHidden,
    hideInGraph,
    showInGraph,
} from '../src/graphExclude'
import type { GraphData } from '../src/graph'

const g: GraphData = {
    nodes: [
        { id: 'keep', label: 'keep', kind: 'note' },
        {
            id: 'mem:people/user-profile',
            label: 'user-profile',
            kind: 'memory',
        },
        { id: 'tag:user-profile', label: '#user-profile', kind: 'tag' },
    ],
    edges: [
        { from: 'mem:people/user-profile', to: 'keep', kind: 'about' },
        { from: 'keep', to: 'tag:user-profile', kind: 'tag' },
    ],
}

describe('excludeFromGraph', () => {
    test('a memory note matches by its memory path and by its vault path', () => {
        for (const entry of [
            'people/user-profile',
            '.daemon/memory/people/user-profile.md',
        ]) {
            const out = excludeFromGraph(g, [entry])
            expect(out.nodes.map(n => n.id)).toEqual([
                'keep',
                'tag:user-profile',
            ])
            expect(out.edges).toEqual([g.edges[1]])
        }
    })

    test('names only match notes, never a tag of the same name', () => {
        const out = excludeFromGraph(g, ['user-profile'])
        expect(out.nodes.map(n => n.id)).toContain('tag:user-profile')
    })

    test('an empty list returns the graph unchanged', () => {
        expect(excludeFromGraph(g, [])).toBe(g)
        expect(excludeFromGraph(g, ['  '])).toBe(g)
    })
})

describe('graphExcludeFrom', () => {
    test('reads graph.exclude, keeping only non-empty strings', () => {
        expect(
            graphExcludeFrom({ graph: { exclude: ['a', '', 3, 'b'] } }),
        ).toEqual(['a', 'b'])
        expect(graphExcludeFrom({ graph: { exclude: 'a' } })).toEqual([])
        expect(graphExcludeFrom({})).toEqual([])
    })
})

describe('folder entries', () => {
    const tree: GraphData = {
        nodes: [
            { id: 'journal/2026-11-01', label: '2026-11-01', kind: 'note' },
            { id: 'journal/deep/a', label: 'a', kind: 'note' },
            { id: 'journaling', label: 'journaling', kind: 'note' },
            { id: 'journal', label: 'journal', kind: 'note' },
            { id: 'mem:people/x', label: 'x', kind: 'memory' },
        ],
        edges: [],
    }
    const ids = (list: string[]) =>
        excludeFromGraph(tree, list).nodes.map(n => n.id)

    test('a path ending in / hides every note under the folder, at any depth, and nothing else', () => {
        expect(ids(['journal/'])).toEqual([
            'journaling',
            'journal',
            'mem:people/x',
        ])
    })

    test('a memory folder matches by its vault path', () => {
        expect(ids(['.daemon/memory/people/'])).not.toContain('mem:people/x')
    })
})

describe('hideInGraph / showInGraph / graphHidden (the file menu toggle)', () => {
    test('hiding a note appends its path without .md, once', () => {
        const once = hideInGraph(['a'], 'notes/index.md', false)
        expect(once).toEqual(['a', 'notes/index'])
        expect(hideInGraph(once, 'notes/index.md', false)).toBe(once)
        expect(graphHidden(once, 'notes/index.md', false).own).toBe(true)
        expect(graphHidden(once, 'index.md', false).own).toBe(false)
    })

    test('a bare name already hides the note, so hiding adds nothing', () => {
        expect(hideInGraph(['index'], 'notes/index.md', false)).toEqual([
            'index',
        ])
    })

    test('showing a note removes every entry naming it, path and bare name', () => {
        expect(
            showInGraph(
                ['index', 'notes/index', 'notes/index.md', 'other'],
                'notes/index.md',
                false,
            ),
        ).toEqual(['other'])
    })

    test('an image or PDF is named by its own path, which is its companion note', () => {
        const list = hideInGraph([], 'scans/paper.pdf', false)
        expect(list).toEqual(['scans/paper.pdf'])
        const g2: GraphData = {
            nodes: [
                { id: 'scans/paper.pdf', label: 'paper.pdf', kind: 'note' },
            ],
            edges: [],
        }
        expect(excludeFromGraph(g2, list).nodes).toEqual([])
    })

    test('a folder toggles its own trailing-slash entry', () => {
        const list = hideInGraph([], 'journal', true)
        expect(list).toEqual(['journal/'])
        expect(graphHidden(list, 'journal', true)).toEqual({
            own: true,
            byFolder: null,
        })
        expect(showInGraph(list, 'journal', true)).toEqual([])
    })

    test('a note under a hidden folder reports the folder, and showing the note leaves it', () => {
        const list = ['journal/']
        expect(graphHidden(list, 'journal/deep/a.md', false)).toEqual({
            own: false,
            byFolder: 'journal/',
        })
        expect(graphHidden(list, 'journal/deep', true).byFolder).toBe(
            'journal/',
        )
        expect(showInGraph(list, 'journal/deep/a.md', false)).toEqual(list)
        // a note named like the folder is not hidden by it
        expect(graphHidden(list, 'journal.md', false)).toEqual({
            own: false,
            byFolder: null,
        })
    })

    test('the toggle round-trips through the graph filter for a memory note', () => {
        const list = hideInGraph(
            [],
            '.daemon/memory/people/user-profile.md',
            false,
        )
        expect(excludeFromGraph(g, list).nodes.map(n => n.id)).not.toContain(
            'mem:people/user-profile',
        )
        expect(
            showInGraph(list, '.daemon/memory/people/user-profile.md', false),
        ).toEqual([])
    })
})
