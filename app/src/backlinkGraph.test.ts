import { describe, expect, it } from 'bun:test'
import { deriveBacklinks, pathToNoteId } from './backlinkGraph'
import type { GraphData, GraphNode } from '../../core/src/graph'

const note = (id: string, label = id): GraphNode => ({
    id,
    label,
    kind: 'note',
})
const tag = (id: string, label = id): GraphNode => ({ id, label, kind: 'tag' })

describe('pathToNoteId', () => {
    it('strips a trailing .md extension', () => {
        expect(pathToNoteId('reading/quotes/borges.md')).toBe(
            'reading/quotes/borges',
        )
    })

    it('is case-insensitive on the extension', () => {
        expect(pathToNoteId('Note.MD')).toBe('Note')
    })

    it('leaves an extension-less path untouched', () => {
        expect(pathToNoteId('no-extension')).toBe('no-extension')
    })
})

describe('deriveBacklinks', () => {
    it('returns an empty list for an empty graph', () => {
        expect(deriveBacklinks({ nodes: [], edges: [] }, 'a')).toEqual([])
    })

    it('returns an empty list for an empty noteId', () => {
        const g: GraphData = {
            nodes: [note('a')],
            edges: [{ from: 'a', to: 'b', kind: 'link' }],
        }
        expect(deriveBacklinks(g, '')).toEqual([])
    })

    it('finds notes that link to the target note', () => {
        const g: GraphData = {
            nodes: [note('a', 'Alpha'), note('b', 'Bravo')],
            edges: [{ from: 'a', to: 'b', kind: 'link' }],
        }
        expect(deriveBacklinks(g, 'b')).toEqual([{ id: 'a', label: 'Alpha' }])
    })

    it('ignores edges pointing AWAY from the target note', () => {
        const g: GraphData = {
            nodes: [note('a'), note('b')],
            edges: [{ from: 'b', to: 'a', kind: 'link' }],
        }
        expect(deriveBacklinks(g, 'b')).toEqual([])
    })

    it('ignores non-link edge kinds (e.g. tag/about/message/open)', () => {
        const g: GraphData = {
            nodes: [note('a'), note('b')],
            edges: [{ from: 'a', to: 'b', kind: 'about' }],
        }
        expect(deriveBacklinks(g, 'b')).toEqual([])
    })

    it('drops a self-link', () => {
        const g: GraphData = {
            nodes: [note('a')],
            edges: [{ from: 'a', to: 'a', kind: 'link' }],
        }
        expect(deriveBacklinks(g, 'a')).toEqual([])
    })

    it('excludes a non-note source (e.g. a tag node) even if it somehow targets the note', () => {
        const g: GraphData = {
            nodes: [note('a'), tag('tag:x')],
            edges: [{ from: 'tag:x', to: 'a', kind: 'tag' }],
        }
        expect(deriveBacklinks(g, 'a')).toEqual([])
    })

    it('dedupes multiple links from the same source note', () => {
        const g: GraphData = {
            nodes: [note('a', 'Alpha'), note('b')],
            edges: [
                { from: 'a', to: 'b', kind: 'link' },
                { from: 'a', to: 'b', kind: 'link' },
            ],
        }
        expect(deriveBacklinks(g, 'b')).toEqual([{ id: 'a', label: 'Alpha' }])
    })

    it('sorts results by label', () => {
        const g: GraphData = {
            nodes: [note('z', 'Zed'), note('a', 'Alpha'), note('m', 'Mid')],
            edges: [
                { from: 'z', to: 'target', kind: 'link' },
                { from: 'a', to: 'target', kind: 'link' },
                { from: 'm', to: 'target', kind: 'link' },
            ],
        }
        expect(deriveBacklinks(g, 'target').map(e => e.label)).toEqual([
            'Alpha',
            'Mid',
            'Zed',
        ])
    })
})
