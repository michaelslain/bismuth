import { describe, test, expect } from 'bun:test'
import { makeVault } from './helpers'
import {
    checkPdfMarkdown,
    pdfMarkdownJob,
    pdfMarkdownPath,
    startPdfMarkdownJob,
} from '../src/pdfMarkdown'
import { sourcedNote, tidyMarkdown } from '../src/marker'

describe('pdf → markdown', () => {
    test('the note sits beside the PDF with the extension swapped', () => {
        expect(pdfMarkdownPath('papers/week 8.pdf')).toBe('papers/week 8.md')
        expect(pdfMarkdownPath('X.PDF')).toBe('X.md')
    })

    test('the note links back to its PDF in frontmatter', () => {
        expect(sourcedNote('# Title\n\nrate  $\\eta$  here', 'x.pdf')).toBe(
            '---\nsource: "[[x.pdf]]"\n---\n\n# Title\n\nrate $\\eta$ here\n',
        )
    })

    test('a sentence Marker broke before inline math is rejoined', () => {
        const md = 'For a learning rate\n\n $\\eta > 0$ the update is\n\n$$x$$\n'
        expect(tidyMarkdown(md)).toBe('For a learning rate $\\eta > 0$ the update is\n\n$$x$$\n')
        // A finished sentence, a heading or display math above keeps its own paragraph.
        expect(tidyMarkdown('Done.\n\n $a$ starts')).toBe('Done.\n\n $a$ starts\n')
        expect(tidyMarkdown('# Head\n\n $a$ x')).toBe('# Head\n\n $a$ x\n')
        expect(tidyMarkdown('$$y$$\n\n $a$ x')).toBe('$$y$$\n\n $a$ x\n')
    })

    test('refuses a non-PDF, a missing file and an existing note', () => {
        const vault = makeVault({ 'a.pdf': '%PDF', 'b.pdf': '%PDF', 'b.md': 'mine' })
        expect(checkPdfMarkdown(vault, 'a.pdf')).toBe('a.md')
        expect(() => checkPdfMarkdown(vault, 'a.md')).toThrow('not a PDF')
        expect(() => checkPdfMarkdown(vault, 'gone.pdf')).toThrow('no such file')
        expect(() => checkPdfMarkdown(vault, 'b.pdf')).toThrow('already exists')
        expect(checkPdfMarkdown(vault, 'b.pdf', true)).toBe('b.md')
    })

    test('a job runs in the background, joins a second start, then reads done', async () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        let finish!: (note: string) => void
        let calls = 0
        const convert = () => {
            calls++
            return new Promise<string>(r => (finish = r))
        }
        expect(pdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'idle' })
        expect(startPdfMarkdownJob(vault, 'a.pdf', {}, convert).state).toBe('running')
        expect(startPdfMarkdownJob(vault, 'a.pdf', {}, convert).state).toBe('running')
        expect(calls).toBe(1)
        finish('a.md')
        await Promise.resolve()
        expect(pdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'done', note: 'a.md' })
    })

    test('an existing note answers exists instead of converting, unless replace', () => {
        const vault = makeVault({ 'a.pdf': '%PDF', 'a.md': 'mine' })
        let calls = 0
        const convert = () => {
            calls++
            return new Promise<string>(() => {})
        }
        expect(startPdfMarkdownJob(vault, 'a.pdf', {}, convert)).toEqual({
            state: 'exists',
            note: 'a.md',
        })
        expect(calls).toBe(0)
        expect(startPdfMarkdownJob(vault, 'a.pdf', { replace: true }, convert).state).toBe('running')
        expect(calls).toBe(1)
    })

    test('a failed conversion reads as error with the engine message', async () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        const convert = () => Promise.reject(new Error('marker exited 1'))
        startPdfMarkdownJob(vault, 'a.pdf', {}, convert)
        await new Promise(r => setTimeout(r, 0))
        expect(pdfMarkdownJob(vault, 'a.pdf')).toEqual({
            state: 'error',
            message: 'marker exited 1',
        })
    })
})
