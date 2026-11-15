import { describe, expect, test } from 'bun:test'
import { convertFlashcards } from '../../src/obsidianImport/flashcards'
import type { ImportContext } from '../../src/obsidianImport/types'

const ctx = (data?: Record<string, unknown>): ImportContext => ({
    config: {
        present: true,
        plugins: [],
        app: null,
        dailyNotes: null,
        templates: null,
        appearance: null,
        pluginData: data ? { 'obsidian-spaced-repetition': data } : {},
    },
    allPaths: [],
})
const SR = '<!--SR:!2026-09-14,3,250-->'
const run = (files: Record<string, string>, data?: Record<string, unknown>) =>
    convertFlashcards(new Map(Object.entries(files)), ctx(data))
const text = (r: ReturnType<typeof run>, p = 'a.md') => r.edits.find(e => e.path === p)?.text

describe('SR comments', () => {
    test.each([['q::a'], ['q:::a'], ['the ==x== y'], ['the **x** y'], ['the {{x}} y']])(
        'joins onto %s',
        card => {
            const t = text(run({ 'a.md': `#flashcards\n\n${card}\n${SR}\n\nafter\n` }))
            expect(t).toBe(`#flashcards\n\n${card} ${SR}\n\nafter\n`)
        },
    )
    test('after frontmatter', () => {
        const t = text(run({ 'a.md': `---\ntags: [flashcards]\n---\nq::a\n${SR}\n` }))
        expect(t).toContain(`q::a ${SR}`)
    })
    test('multi-line cards are untouched', () => {
        expect(run({ 'a.md': `#flashcards\n\nq\n?\na\n${SR}\n` }).edits).toHaveLength(0)
        expect(run({ 'a.md': `#flashcards\n\nq\n??\na\n${SR}\n` }).edits).toHaveLength(0)
    })
    test('already inline is untouched', () => {
        expect(run({ 'a.md': `#flashcards\n\nq::a ${SR}\n` }).edits).toHaveLength(0)
    })
})

describe('deck tags', () => {
    const data = { flashcardTags: ['#review', '#flashcards'] }
    test('inline, nested suffix kept, lookalike left alone', () => {
        const t = text(run({ 'a.md': '#review/deck\nq::a\n#review-later\n' }, data))
        expect(t).toBe('#flashcards/deck\nq::a\n#review-later\n')
    })
    test('inline code span is left alone', () => {
        expect(text(run({ 'a.md': 'use `a #review b` here\n' }, data))).toBeUndefined()
        expect(text(run({ 'a.md': '`x` #review/d\n' }, data))).toBe('`x` #flashcards/d\n')
    })
    test('frontmatter list and flow', () => {
        const a = text(run({ 'a.md': '---\ntags: [review/x, other]\n---\nq::a\n' }, data))!
        expect(a).toContain('flashcards/x')
        expect(a).toContain('other')
        expect(a).not.toContain('review')
        const b = text(run({ 'a.md': '---\ntags:\n  - review\n---\nq::a\n' }, data))!
        expect(b).toContain('flashcards')
        expect(b).not.toContain('review')
    })
    test('several deck tags are lossy', () => {
        const r = run({ 'a.md': '#flashcards/a\nq::a\n#flashcards/b\nr::b\n' })
        expect(r.items.filter(i => i.section === 'lossy')).toHaveLength(1)
    })
})

describe('folder decks', () => {
    const data = { convertFolderToDecks: true }
    test('adds merged tag to card notes in a folder', () => {
        const r = run(
            {
                'Bio/a.md': '---\ntags: [x]\n---\nq::a\n',
                'Bio/b.md': 'no cards\n',
                'root.md': 'q::a\n',
            },
            data,
        )
        const t = text(r, 'Bio/a.md')!
        expect(t).toContain('x')
        expect(t).toContain('flashcards/Bio')
        expect(r.edits.map(e => e.path)).toEqual(['Bio/a.md'])
    })
    test('creates frontmatter when absent', () => {
        expect(text(run({ 'Bio/a.md': 'q::a\n' }, data), 'Bio/a.md')).toContain('flashcards/Bio')
    })
})
