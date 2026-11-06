import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addMarks, marksOnPage } from '../src/bookMarks'
import {
    TRANSCRIPT_END,
    TRANSCRIPT_START,
    mergeTranscript,
    readTranscript,
    renderTranscript,
    writeTranscript,
} from '../src/transcript'
import { tempDir } from './helpers'

const NOW = new Date('2026-10-31T12:00:00.000Z')
const pages = [
    { page: 1, text: 'first page' },
    { page: 2, text: 'second page\nwith $x^2$' },
]

describe('renderTranscript', () => {
    test('a pdf gets one heading per page in page order', () => {
        const out = renderTranscript([pages[1], pages[0]], 'pdf')
        expect(out.indexOf('### Page 1')).toBeGreaterThanOrEqual(0)
        expect(out.indexOf('### Page 1')).toBeLessThan(out.indexOf('### Page 2'))
        expect(out).toContain('first page')
    })
})

describe('mergeTranscript', () => {
    test('into an empty companion writes frontmatter then the marked block', () => {
        const out = mergeTranscript('', pages, 'on-device', 'pdf', NOW)
        expect(out.startsWith('---\n')).toBe(true)
        expect(out).toContain('transcribed: on-device')
        expect(out).toContain('transcribedAt: 2026-10-31T12:00:00.000Z')
        expect(out).toContain(TRANSCRIPT_START)
        expect(out.indexOf(TRANSCRIPT_START)).toBeLessThan(out.indexOf(TRANSCRIPT_END))
        expect(out.indexOf('---', 3)).toBeLessThan(out.indexOf(TRANSCRIPT_START))
    })

    test('keeps tags, comments and body byte for byte; block goes after', () => {
        const before = '---\n# keep me\ntags: [a]\n---\nmy note\n'
        const out = mergeTranscript(before, pages, 'ai', 'image', NOW)
        expect(out).toContain('# keep me\ntags: [a]\n')
        expect(out).toContain('transcribed: ai')
        const body = out.slice(out.indexOf('---\n', 4) + 4)
        expect(body.startsWith('my note\n')).toBe(true)
        expect(body.indexOf('my note')).toBeLessThan(body.indexOf(TRANSCRIPT_START))
    })

    test('a second merge replaces only the block', () => {
        const once = mergeTranscript('---\ntags: [a]\n---\nmy note\n', pages, 'on-device', 'pdf', NOW)
        const twice = mergeTranscript(once, [{ page: 1, text: 'redone' }], 'ai', 'pdf', NOW)
        expect(twice.split(TRANSCRIPT_START).length).toBe(2)
        expect(twice).toContain('redone')
        expect(twice).not.toContain('first page')
        expect(twice).toContain('my note')
        expect(twice).toContain('tags: [a]')
        expect(twice).toContain('transcribed: ai')
        expect(twice.match(/transcribed:/g)!.length).toBe(1)
    })
})

describe('mergeTranscript marks', () => {
    test('a re-run with identical text leaves a mark wrapping a line unchanged', () => {
        const text = 'the big dog. then the big\ndog sat'
        const marked = addMarks(mergeTranscript('', [{ page: 1, text }], 'on-device', 'image', NOW), 1, ['big dog sat'])
        expect(marked).toContain('==big==\n==dog sat==')
        const again = mergeTranscript(marked, [{ page: 1, text }], 'on-device', 'image', NOW)
        expect(again).toBe(marked)
    })

    test('a re-run keeps a mark whose text is still there and drops one that is not', () => {
        const first = mergeTranscript('', [{ page: 1, text: 'buy ==milk== and ==eggs==' }], 'on-device', 'image', NOW)
        const out = mergeTranscript(first, [{ page: 1, text: 'buy milk today' }], 'ai', 'image', NOW)
        expect(out).toContain('buy ==milk== today')
        expect(out).not.toContain('==eggs==')
    })
})

describe('readTranscript', () => {
    test('round-trips what mergeTranscript wrote', () => {
        const out = mergeTranscript('', pages, 'on-device', 'pdf', NOW)
        expect(readTranscript(out)).toEqual(pages)
    })
    test('no block reads as empty', () => {
        expect(readTranscript('---\ntags: [a]\n---\nhi\n')).toEqual([])
    })
    test('a single image page round-trips', () => {
        const out = mergeTranscript('', [{ page: 1, text: 'just one' }], 'on-device', 'image', NOW)
        expect(readTranscript(out)).toEqual([{ page: 1, text: 'just one' }])
    })
})

describe('mergeTranscript marks on a partial run', () => {
    test('a page filled from the stored transcript is not marked twice', () => {
        const base = mergeTranscript(
            '',
            [
                { page: 1, text: 'one' },
                { page: 2, text: 'milk again\nmilk twice' },
            ],
            'on-device',
            'pdf',
            NOW,
        )
        const marked = addMarks(base, 2, ['milk'])
        const incoming = [{ page: 1, text: 'one redone' }, ...readTranscript(marked).filter(p => p.page === 2)]
        const out = mergeTranscript(marked, incoming, 'on-device', 'pdf', NOW)
        expect(marksOnPage(out, 2)).toEqual(['milk'])
        expect(out).toContain('==milk== again\nmilk twice')
    })
})

describe('writeTranscript', () => {
    test('adds books once and writes the companion into the vault', async () => {
        const root = tempDir('book-tr-')
        writeFileSync(join(root, 'p.pdf.md'), '---\ntags: [a]\n---\n')
        const opts = { book: 'Notebook', now: NOW }
        await writeTranscript(root, 'p.pdf.md', pages, 'on-device', 'pdf', opts)
        await writeTranscript(root, 'p.pdf.md', pages, 'on-device', 'pdf', opts)
        const text = readFileSync(join(root, 'p.pdf.md'), 'utf8')
        expect(text).toContain('books: ["[[Notebook]]"]')
        expect(text.match(/\[\[Notebook\]\]/g)!.length).toBe(1)
        expect(text).toContain('tags: [a]')
        expect(readTranscript(text)).toEqual(pages)
    })
    test('book path and bare name dedupe to one normalised link', async () => {
        const root = tempDir('book-tr-')
        await writeTranscript(root, 'b.pdf.md', pages, 'on-device', 'pdf', { book: 'books/Notebook.base.jsonl', now: NOW })
        await writeTranscript(root, 'b.pdf.md', pages, 'on-device', 'pdf', { book: 'Notebook', now: NOW })
        const text = readFileSync(join(root, 'b.pdf.md'), 'utf8')
        expect(text).toContain('books: ["[[Notebook]]"]')
        expect(text.match(/Notebook/g)!.length).toBe(1)
    })
    test('mark receives the companion path once', async () => {
        const root = tempDir('book-tr-')
        const seen: string[][] = []
        await writeTranscript(root, 'm.png.md', [pages[0]], 'on-device', 'image', { now: NOW, mark: p => seen.push(p) })
        expect(seen).toEqual([['m.png.md']])
    })
    test('creates a missing companion', async () => {
        const root = tempDir('book-tr-')
        await writeTranscript(root, 'new.png.md', [pages[0]], 'ai', 'image', { now: NOW })
        expect(readTranscript(readFileSync(join(root, 'new.png.md'), 'utf8'))).toEqual([pages[0]])
    })
})
