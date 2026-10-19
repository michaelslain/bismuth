import { describe, test, expect } from 'bun:test'
import { makeVault, tempDir } from './helpers'
import {
    cancelPdfMarkdownJob,
    checkPdfMarkdown,
    pdfMarkdownJob,
    pdfMarkdownPath,
    startPdfMarkdownJob,
    type PdfMarkdownOptions,
} from '../src/pdfMarkdown'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    INSTALL_HINTS,
    MARKER_REPAIR,
    MARKER_SHIM,
    markerFailure,
    markerShimEnv,
    runTool,
    sourcedNote,
    tidyMarkdown,
} from '../src/marker'

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

    test('cancel aborts the run, reads cancelled, and a late finish does not overwrite it', async () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        let signal!: AbortSignal
        let finish!: (note: string) => void
        const convert = (_v: string, _f: string, opts: PdfMarkdownOptions = {}) => {
            signal = opts.signal!
            return new Promise<string>(r => (finish = r))
        }
        startPdfMarkdownJob(vault, 'a.pdf', {}, convert)
        expect(signal.aborted).toBe(false)
        expect(cancelPdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'cancelled', note: 'a.md' })
        expect(signal.aborted).toBe(true)
        finish('a.md')
        await new Promise(r => setTimeout(r, 0))
        expect(pdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'cancelled', note: 'a.md' })
    })

    test('cancel leaves a job that is not running as it is', () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        expect(cancelPdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'idle' })
    })

    test('a start after a cancel waits for the stopped engine to exit', async () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        const finishes: ((note: string) => void)[] = []
        const convert = () => new Promise<string>(r => finishes.push(r))
        startPdfMarkdownJob(vault, 'a.pdf', {}, convert)
        cancelPdfMarkdownJob(vault, 'a.pdf')
        expect(startPdfMarkdownJob(vault, 'a.pdf', {}, convert).state).toBe('running')
        await new Promise(r => setTimeout(r, 0))
        expect(finishes.length).toBe(1)
        finishes[0]!('a.md')
        await new Promise(r => setTimeout(r, 0))
        expect(finishes.length).toBe(2)
        finishes[1]!('a.md')
        await new Promise(r => setTimeout(r, 0))
        expect(pdfMarkdownJob(vault, 'a.pdf')).toEqual({ state: 'done', note: 'a.md' })
    })

    test('a queued start cancelled before its turn never runs the engine', async () => {
        const vault = makeVault({ 'a.pdf': '%PDF' })
        const finishes: ((note: string) => void)[] = []
        const convert = () => new Promise<string>(r => finishes.push(r))
        startPdfMarkdownJob(vault, 'a.pdf', {}, convert)
        cancelPdfMarkdownJob(vault, 'a.pdf')
        startPdfMarkdownJob(vault, 'a.pdf', {}, convert)
        cancelPdfMarkdownJob(vault, 'a.pdf')
        finishes[0]!('a.md')
        await new Promise(r => setTimeout(r, 0))
        expect(finishes.length).toBe(1)
        expect(pdfMarkdownJob(vault, 'a.pdf').state).toBe('cancelled')
    })

    test('aborting a tool run ends it and every process it started', async () => {
        // One helper detached from the pipes (llama-server logs to a file), one still holding
        // stdout; both must go, or the run would hang on the pipe or leave an orphan.
        const abort = new AbortController()
        const started = Date.now()
        const run = runTool(
            '/bin/sh',
            ['-c', 'sleep 31 >/dev/null 2>&1 & echo $! >&2; sleep 32 & wait'],
            abort.signal,
        )
        await new Promise(r => setTimeout(r, 300))
        abort.abort()
        const r = await run
        expect(Date.now() - started).toBeLessThan(5000)
        await new Promise(r => setTimeout(r, 100))
        const helper = Number(r.stderr.trim())
        expect(helper).toBeGreaterThan(0)
        expect(() => process.kill(helper, 0)).toThrow()
    })

    test('a failed Marker run names its exception and the repair command, not a traceback', () => {
        const traceback = [
            'Traceback (most recent call last):',
            '  File "/x/marker/providers/pdf.py", line 383, in check_page',
            '    img_bbox = PolygonBox.from_bbox(img_obj.get_pos())',
            "AttributeError: 'PdfImage' object has no attribute 'get_pos'",
        ].join('\n')
        expect(markerFailure(1, traceback)).toBe(
            `marker's install is broken (AttributeError: 'PdfImage' object has no attribute 'get_pos') — repair it: ${MARKER_REPAIR}`,
        )
        expect(markerFailure(1, 'loading\nRuntimeError: llama-server did not start\n')).toBe(
            `marker failed (RuntimeError: llama-server did not start) — if it keeps failing, reinstall it: ${MARKER_REPAIR}`,
        )
        expect(markerFailure(137, '')).toContain('marker failed (exit code 137)')
    })

    test('installs and repairs stay on the marker-pdf 2.x line', () => {
        expect(INSTALL_HINTS.marker_single).toBe("uv tool install 'marker-pdf>=2,<3'")
        expect(MARKER_REPAIR).toBe("uv tool install --reinstall 'marker-pdf>=2,<3'")
    })

    test('the shim aliases get_pos onto a pypdfium2 that only has get_bounds', async () => {
        const dir = tempDir('bismuth-shim-')
        // A stand-in pypdfium2 with the 5.x API; the real one is in Marker's own venv.
        mkdirSync(join(dir, 'fake', 'pypdfium2'), { recursive: true })
        writeFileSync(
            join(dir, 'fake', 'pypdfium2', '__init__.py'),
            'class PdfObject:\n    def get_bounds(self):\n        return (1, 2, 3, 4)\n',
        )
        const env = markerShimEnv(join(dir, 'shim'), { PYTHONPATH: join(dir, 'fake') })
        expect(env.PYTHONPATH).toBe(`${join(dir, 'shim')}:${join(dir, 'fake')}`)
        expect(readFileSync(join(dir, 'shim', 'sitecustomize.py'), 'utf8')).toBe(MARKER_SHIM)
        const r = await runTool(
            'python3',
            ['-c', 'import pypdfium2; print(pypdfium2.PdfObject().get_pos())'],
            undefined,
            env,
        )
        expect(r.stdout.trim()).toBe('(1, 2, 3, 4)')
    })
})
