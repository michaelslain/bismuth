import { describe, expect, test } from 'bun:test'
import { summarizeFrontmatter } from './frontmatterSummary'

describe('summarizeFrontmatter', () => {
    test('flow list of tags', () => {
        expect(summarizeFrontmatter('---\ntags: [trip, 2026]\n---\n')).toBe('tags: trip, 2026')
    })
    test('several keys join with //, block lists flatten', () => {
        const raw = '---\ntags:\n  - paper\n  - ml\nauthor: Ada\nyear: 2024\n---\n'
        expect(summarizeFrontmatter(raw)).toBe('tags: paper, ml // author: Ada // year: 2024')
    })
    test('empty template folds to nothing', () => {
        expect(summarizeFrontmatter('---\ntags: []\n---\n')).toBe('')
        expect(summarizeFrontmatter('---\ntitle:\n---\n')).toBe('')
        expect(summarizeFrontmatter('')).toBe('')
    })
    test('skips empty values and keeps the rest', () => {
        expect(summarizeFrontmatter('---\ntags: []\nsource: scan\n---\n')).toBe('source: scan')
    })
    test('dates render as the day', () => {
        expect(summarizeFrontmatter('---\ndate: 2026-10-12\n---\n')).toBe('date: 2026-10-12')
    })
    test('nested maps flatten to key: value pairs', () => {
        expect(summarizeFrontmatter('---\nmeta:\n  w: 10\n  h: 20\n---\n')).toBe('meta: w: 10, h: 20')
    })
    test('unparseable mid-edit yaml falls back to its lines', () => {
        expect(summarizeFrontmatter('---\ntags: [a, b\nauthor: x\n---\n')).toBe(
            'tags: [a, b // author: x',
        )
    })
    test('no fences still summarizes', () => {
        expect(summarizeFrontmatter('tags: [x]')).toBe('tags: x')
    })
})
