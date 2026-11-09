// core/test/transcriptEdit.test.ts — setTranscriptPage, writeTranscriptPage, remapTranscriptPages.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    TRANSCRIPT_END,
    TRANSCRIPT_START,
    mergeTranscript,
    readTranscript,
    remapTranscriptPages,
    setTranscriptPage,
    writeTranscriptPage,
} from '../src/transcript'
import { makeVault } from './helpers'

const NOW = new Date('2026-10-31T12:00:00.000Z')
const base = mergeTranscript(
    '---\ntags: [a]\n---\nmy note\n',
    [
        { page: 1, text: 'one' },
        { page: 2, text: 'two' },
        { page: 3, text: 'three' },
    ],
    'marker',
    'pdf',
    NOW,
)

describe('setTranscriptPage', () => {
    test('replaces one page, keeps the others, the engine stamp and the rest of the note', () => {
        const out = setTranscriptPage(base, 2, 'TWO ==kept mark==', 'pdf')
        expect(readTranscript(out)).toEqual([
            { page: 1, text: 'one' },
            { page: 2, text: 'TWO ==kept mark==' },
            { page: 3, text: 'three' },
        ])
        expect(out).toContain('transcribed: marker')
        expect(out).toContain('transcribedAt: 2026-10-31T12:00:00.000Z')
        expect(out).toContain('tags: [a]')
        expect(out).toContain('my note')
    })

    test('adds a page that has no text yet, in page order', () => {
        const out = setTranscriptPage(base, 5, 'five', 'pdf')
        expect(readTranscript(out).map(p => p.page)).toEqual([1, 2, 3, 5])
    })

    test('empty text removes the page; the last one removes the block', () => {
        const out = setTranscriptPage(base, 2, '  \n ', 'pdf')
        expect(readTranscript(out).map(p => p.page)).toEqual([1, 3])
        let left = out
        for (const p of [1, 3]) left = setTranscriptPage(left, p, '', 'pdf')
        expect(left).not.toContain(TRANSCRIPT_START)
        expect(left).toContain('my note')
        expect(left).toContain('transcribed: marker')
    })

    test('into an empty companion writes the block with no engine stamp', () => {
        const out = setTranscriptPage('', 1, 'typed', 'image')
        expect(out).toBe(`${TRANSCRIPT_START}\ntyped\n${TRANSCRIPT_END}\n`)
        expect(setTranscriptPage('', 1, '', 'image')).toBe('')
    })

    test('text with the end marker cannot cut the block short', () => {
        const out = setTranscriptPage(base, 1, `a ${TRANSCRIPT_END} b`, 'pdf')
        expect(readTranscript(out)).toHaveLength(3)
    })
})

describe('writeTranscriptPage', () => {
    test('reads, marks, writes; a missing companion is created; no change writes nothing', async () => {
        const vault = makeVault({})
        const marked: string[][] = []
        await writeTranscriptPage(vault, 'a.png.md', 1, 'hello', 'image', { mark: p => marked.push(p) })
        expect(readFileSync(join(vault, 'a.png.md'), 'utf8')).toContain('hello')
        expect(marked).toEqual([['a.png.md']])
        await writeTranscriptPage(vault, 'a.png.md', 1, 'hello', 'image', { mark: p => marked.push(p) })
        expect(marked).toHaveLength(1)
    })
})

describe('remapTranscriptPages', () => {
    test('renumbers kept pages, drops removed ones, leaves new ones without text', () => {
        const out = remapTranscriptPages(base, [2, null, 0])
        expect(readTranscript(out)).toEqual([
            { page: 1, text: 'three' },
            { page: 3, text: 'one' },
        ])
        expect(out).toContain('transcribed: marker')
        expect(out).toContain('my note')
    })
    test('a page used twice keeps its text on both', () => {
        expect(readTranscript(remapTranscriptPages(base, [1, 1])).map(p => p.text)).toEqual(['two', 'two'])
    })
    test('a note with no transcript is returned as it was', () => {
        expect(remapTranscriptPages('just a note\n', [0])).toBe('just a note\n')
    })
})

describe('a page line that reads like a page heading', () => {
    const book = setTranscriptPage(setTranscriptPage('', 1, 'one', 'pdf'), 2, 'two', 'pdf')

    test('stays on its page, and no page number is made', () => {
        const text = 'one\n\n### Page 2\n\nstill one'
        const pages = readTranscript(setTranscriptPage(book, 1, text, 'pdf'))
        expect(pages.map(p => p.page)).toEqual([1, 2])
        expect(pages[0].text).toBe(text)
        expect(pages[1].text).toBe('two')
    })

    test('comes back exactly over repeated saves, a backslash of its own included', () => {
        const text = '\\### Page 9\n### Page 7\nafter'
        let md = setTranscriptPage(book, 1, text, 'pdf')
        md = setTranscriptPage(md, 2, 'two again', 'pdf')
        expect(readTranscript(md)[0].text).toBe(text)
    })

    test('a lone image keeps it as its one page', () => {
        const text = 'before\n### Page 3\nafter'
        expect(readTranscript(setTranscriptPage('', 1, text, 'image'))).toEqual([{ page: 1, text }])
    })
})
