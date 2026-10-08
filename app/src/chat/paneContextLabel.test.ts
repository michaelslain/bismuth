import { describe, expect, test } from 'bun:test'
import { paneContextLabel } from './paneContextLabel'

describe('paneContextLabel', () => {
    test('graph carries the mode, omitted when unknown', () => {
        expect(paneContextLabel('::graph', '2nd')).toBe(
            'knowledge graph (2nd brain)',
        )
        expect(paneContextLabel('::graph', '3rd')).toBe(
            'knowledge graph (3rd brain)',
        )
        expect(paneContextLabel('::graph', 'both')).toBe(
            'knowledge graph (both brains)',
        )
        expect(paneContextLabel('::graph', 'local')).toBe(
            'knowledge graph (local)',
        )
        expect(paneContextLabel('::graph')).toBe('knowledge graph')
    })
    test('daemon, terminal, export', () => {
        expect(paneContextLabel('::daemon')).toBe('daemon page')
        expect(paneContextLabel('::term:abc')).toBe('terminal')
        expect(paneContextLabel('::export:notes/a.md')).toBe(
            'export options for notes/a.md',
        )
    })
    test('empty, chat and files are null', () => {
        expect(paneContextLabel('::empty')).toBeNull()
        expect(paneContextLabel('::chat:x')).toBeNull()
        expect(paneContextLabel('::chat:daemon')).toBeNull()
        expect(paneContextLabel('notes/a.md')).toBeNull()
    })
})
