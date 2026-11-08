import { describe, expect, test } from 'bun:test'
import {
    bookPageRefs,
    expandLeaves,
    spreadFor,
    stepSpread,
    type BookPageRef,
} from '../../src/bases/bookPages'
import { parseBase } from '../../src/bases/parse'
import { isValidType } from '../../src/bases/types'
import type { Row, ViewConfig } from '../../src/bases/types'

const row = (path: string, note: Record<string, unknown> = {}): Row =>
    ({
        file: { path, name: path, basename: path, folder: '', ext: 'md' },
        note,
        formula: {},
    }) as unknown as Row

const view = (extra: Partial<ViewConfig> = {}): ViewConfig =>
    ({ type: 'book', ...extra }) as ViewConfig

describe('bookPageRefs', () => {
    test('reads wikilinks, embeds and paths from the page column', () => {
        const rows = [
            row('r1.md', { page: '[[a.jpg]]' }),
            row('r2.md', { page: '![[b.pdf]]' }),
            row('r3.md', { page: 'scans/c.png' }),
        ]
        expect(bookPageRefs(rows, view())).toEqual([
            { file: 'a.jpg', kind: 'image', rowIndex: 0 },
            { file: 'b.pdf', kind: 'pdf', rowIndex: 1 },
            { file: 'scans/c.png', kind: 'image', rowIndex: 2 },
        ])
    })

    test('honours view.page', () => {
        const rows = [row('r.md', { page: 'no.jpg', scan: 'yes.jpg' })]
        expect(bookPageRefs(rows, view({ page: 'note.scan' }))[0].file).toBe(
            'yes.jpg',
        )
    })

    test('a companion row with an empty property uses its binary', () => {
        const refs = bookPageRefs([row('x.jpg.md', { page: '' })], view())
        expect(refs).toEqual([{ file: 'x.jpg', kind: 'image', rowIndex: 0 }])
    })

    test('skips notes and empty values; rowIndex is the input index', () => {
        const rows = [
            row('notes.md', { page: '' }),
            row('a.md', { page: 'notes.md' }),
            row('b.md', { page: 'p.png' }),
        ]
        expect(bookPageRefs(rows, view())).toEqual([
            { file: 'p.png', kind: 'image', rowIndex: 2 },
        ])
    })
})

describe('expandLeaves', () => {
    const img: BookPageRef = { file: 'a.jpg', kind: 'image', rowIndex: 0 }
    const pdf: BookPageRef = { file: 'b.pdf', kind: 'pdf', rowIndex: 1 }

    test('a pdf becomes one leaf per page', () => {
        const leaves = expandLeaves([img, pdf], new Map([['b.pdf', 3]]))
        expect(leaves).toHaveLength(4)
        expect(leaves.slice(1).map(l => l.pdfPage)).toEqual([1, 2, 3])
        expect(leaves[0].pdfPage).toBeUndefined()
    })

    test('an unknown page count is one leaf', () => {
        expect(expandLeaves([pdf], new Map())).toEqual([
            { ref: pdf, pdfPage: 1 },
        ])
    })
})

describe('spreadFor', () => {
    test('odd count: cover alone, pairs, last pair full', () => {
        expect(spreadFor(0, 5, 'spread')).toEqual({ right: 0 })
        expect(spreadFor(2, 5, 'spread')).toEqual({ left: 1, right: 2 })
        expect(spreadFor(4, 5, 'spread')).toEqual({ left: 3, right: 4 })
    })
    test('even count ends with a lone left page', () => {
        expect(spreadFor(3, 4, 'spread')).toEqual({ left: 3 })
    })
    test('one leaf, single layout, clamping', () => {
        expect(spreadFor(0, 1, 'spread')).toEqual({ right: 0 })
        expect(spreadFor(3, 9, 'single')).toEqual({ right: 3 })
        expect(spreadFor(99, 5, 'spread')).toEqual({ left: 3, right: 4 })
        expect(spreadFor(99, 5, 'single')).toEqual({ right: 4 })
    })
})

describe('stepSpread', () => {
    test('moves by spread', () => {
        expect(stepSpread(0, 5, 'spread', 1)).toBe(1)
        expect(stepSpread(1, 5, 'spread', 1)).toBe(3)
        expect(stepSpread(3, 5, 'spread', -1)).toBe(1)
        expect(stepSpread(1, 5, 'spread', -1)).toBe(0)
    })
    test('never leaves the book', () => {
        expect(stepSpread(0, 5, 'spread', -1)).toBe(0)
        expect(stepSpread(3, 5, 'spread', 1)).toBe(3)
        expect(stepSpread(2, 3, 'single', 1)).toBe(2)
        expect(stepSpread(0, 3, 'single', -1)).toBe(0)
        expect(stepSpread(1, 3, 'single', 1)).toBe(2)
    })
})

describe('book view config', () => {
    test('book is a view type; page and bookLayout parse', () => {
        expect(isValidType('book')).toBe(true)
        const base = parseBase(
            'type: base\nview: book\npage: note.scan\nbookLayout: single\n',
        )
        expect(base.view.type).toBe('book')
        expect(base.view.page).toBe('note.scan')
        expect(base.view.bookLayout).toBe('single')
    })
    test('bookMode parses and an invalid one reads as pages', () => {
        expect(parseBase('type: base\nview: book\nbookMode: text\n').view.bookMode).toBe('text')
        expect(parseBase('type: base\nview: book\nbookMode: scroll\n').view.bookMode).toBe('scroll')
        expect(parseBase('type: base\nview: book\nbookMode: side\n').view.bookMode).toBe('side')
        expect(parseBase('type: base\nview: book\nbookMode: wide\n').view.bookMode).toBe('pages')
        expect(parseBase('type: base\nview: book\n').view.bookMode).toBeUndefined()
    })

    test('bookFlow parses scroll or flip and drops anything else', () => {
        expect(parseBase('type: base\nview: book\nbookFlow: scroll\n').view.bookFlow).toBe('scroll')
        expect(parseBase('type: base\nview: book\nbookFlow: flip\n').view.bookFlow).toBe('flip')
        expect(parseBase('type: base\nview: book\nbookFlow: fast\n').view.bookFlow).toBeUndefined()
    })
    test('bookDark parses a boolean and drops anything else', () => {
        expect(parseBase('type: base\nview: book\nbookDark: true\n').view.bookDark).toBe(true)
        expect(parseBase('type: base\nview: book\nbookDark: false\n').view.bookDark).toBe(false)
        expect(parseBase('type: base\nview: book\nbookDark: yes\n').view.bookDark).toBeUndefined()
    })
    test('an invalid bookLayout reads as spread', () => {
        const base = parseBase('type: base\nview: book\nbookLayout: wide\n')
        expect(base.view.bookLayout).toBe('spread')
    })
})
