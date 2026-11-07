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
