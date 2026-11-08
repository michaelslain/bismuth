import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findVisionHelper, recognizeLines, recognizePages, renderPages, resetVisionHelperCache } from '../src/visionOcr'
import { tempDir } from './helpers'

const hasSwift = process.platform === 'darwin' && existsSync('/usr/bin/swiftc')
const fixture = join(import.meta.dir, 'fixtures', 'book', 'handwritten.png')

/** A two-page pdf, page 1 saying ALPHA and page 2 saying BRAVO, built by hand. */
function twoPagePdf(box = '0 0 400 200'): string {
    const objs: string[] = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>`,
        '',
        `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>`,
        '',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    const stream = (word: string) => {
        const body = `BT /F1 48 Tf 40 80 Td (${word}) Tj ET`
        return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`
    }
    objs[3] = stream('ALPHA')
    objs[5] = stream('BRAVO')
    let out = '%PDF-1.4\n'
    const offsets: number[] = []
    objs.forEach((o, i) => {
        offsets.push(out.length)
        out += `${i + 1} 0 obj\n${o}\nendobj\n`
    })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const dir = tempDir('vision-pdf-')
    const path = join(dir, 'two.pdf')
    writeFileSync(path, out)
    return path
}

describe.skipIf(!hasSwift)('visionOcr', () => {
    test('findVisionHelper returns an executable path', () => {
        const helper = findVisionHelper()
        expect(helper).not.toBeNull()
        expect(existsSync(helper!)).toBe(true)
    }, 60_000)

    test('recognizePages reads the image fixture', async () => {
        const out = await recognizePages(fixture, { timeoutMs: 60_000 })
        expect(out.length).toBe(1)
        expect(out[0].page).toBe(1)
        expect(out[0].text.toLowerCase()).toContain('milk')
        // the real helper scores every line it read, in the text's order
        expect(out[0].lines?.map(l => l.text).join('\n')).toBe(out[0].text)
        for (const l of out[0].lines ?? []) {
            expect(l.confidence).toBeGreaterThanOrEqual(0)
            expect(typeof l.misspelled).toBe('number')
        }
    }, 60_000)

    test('recognizeLines returns top-left boxes inside 0..1, top line first', async () => {
        const out = await recognizeLines(fixture, { timeoutMs: 60_000 })
        expect(out.length).toBe(1)
        const lines = out[0].lines
        expect(lines.length).toBeGreaterThan(0)
        for (const l of lines) {
            expect(l.x).toBeGreaterThanOrEqual(0)
            expect(l.y).toBeGreaterThanOrEqual(0)
            expect(l.x + l.w).toBeLessThanOrEqual(1.001)
            expect(l.y + l.h).toBeLessThanOrEqual(1.001)
        }
        const ys = lines.map(l => l.y)
        expect(ys[0]).toBe(Math.min(...ys))
    }, 60_000)

    test('an exif-rotated phone photo reads upright, with boxes in the displayed frame', async () => {
        // Pixels stored rotated 90 degrees CCW, exif Orientation 6: it displays like handwritten.png.
        const rotated = join(import.meta.dir, 'fixtures', 'book', 'rotated-exif6.jpg')
        const out = await recognizeLines(rotated, { timeoutMs: 60_000 })
        const lines = out[0].lines
        const lower = lines.map(l => l.text).join('\n').toLowerCase()
        expect(lower).toContain('remember the milk')
        expect(lower).toContain('tuesday notebook')
        expect(lines.length).toBeGreaterThan(0)
        expect(lines[0].text.toLowerCase()).toContain('remember')
        expect(lines[0].y).toBeLessThan(0.3)
        expect(lines[0].w).toBeGreaterThan(0.5)
        expect(lines[1].y).toBeGreaterThan(lines[0].y)
    }, 60_000)

    test('a pdf comes back page by page and --pages filters', async () => {
        const pdf = twoPagePdf()
        const all = await recognizePages(pdf, { timeoutMs: 60_000 })
        expect(all.map(p => p.page)).toEqual([1, 2])
        expect(all[0].text.toUpperCase()).toContain('ALPHA')
        expect(all[1].text.toUpperCase()).toContain('BRAVO')
        const only = await recognizePages(pdf, { pages: [2], timeoutMs: 60_000 })
        expect(only.map(p => p.page)).toEqual([2])
    }, 60_000)
})

/** A stand-in helper: a shell script that prints `json` whatever it is asked. */
function fakeHelper(json: string): string {
    const path = join(tempDir('vision-fake-'), 'helper.sh')
    writeFileSync(path, `#!/bin/sh\necho '${json}'\n`)
    chmodSync(path, 0o755)
    return path
}

describe('visionOcr with a stand-in helper', () => {
    const savedPath = process.env.PATH
    afterEach(() => {
        delete process.env.BISMUTH_VISION_PATH
        process.env.PATH = savedPath
        resetVisionHelperCache()
    })

    test('confidence parses when present and stays undefined when omitted', async () => {
        process.env.BISMUTH_VISION_PATH = fakeHelper('[{"page":1,"text":"a","confidence":0.8},{"page":2,"text":"b"}]')
        resetVisionHelperCache()
        const out = await recognizePages('/x/y.png')
        expect(out).toEqual([{ page: 1, text: 'a', confidence: 0.8 }, { page: 2, text: 'b' }])
        expect('confidence' in out[1]).toBe(false)
    })

    test('each line carries its confidence and misspelled count in text order', async () => {
        process.env.BISMUTH_VISION_PATH = fakeHelper(
            '[{"page":1,"text":"a bb","lines":[{"text":"a","confidence":1,"misspelled":0,"x":0,"y":0,"w":1,"h":0.1},{"text":"bb","confidence":0.3,"x":0,"y":0.2,"w":1,"h":0.1}]}]',
        )
        resetVisionHelperCache()
        const out = await recognizePages('/x/y.png')
        expect(out[0].lines).toEqual([
            { text: 'a', confidence: 1, misspelled: 0 },
            { text: 'bb', confidence: 0.3 },
        ])
    })

    test('renderPages returns one path per page the helper wrote', async () => {
        process.env.BISMUTH_VISION_PATH = fakeHelper('[{"page":2,"path":"/o/page-2.png"},{"page":4,"path":"/o/page-4.png"}]')
        resetVisionHelperCache()
        const out = await renderPages('/x/y.pdf', '/o', { pages: [2, 4] })
        expect(out).toEqual([{ page: 2, path: '/o/page-2.png' }, { page: 4, path: '/o/page-4.png' }])
    })

    test('a missing helper is VISION_UNAVAILABLE', async () => {
        delete process.env.BISMUTH_VISION_PATH
        process.env.PATH = ''
        resetVisionHelperCache()
        if (findVisionHelper()) return // a bundled helper exists on this machine
        resetVisionHelperCache()
        await expect(recognizePages('/x/y.png')).rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' })
        await expect(renderPages('/x/y.png', '/o')).rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' })
    })
})

describe.skipIf(!hasSwift)('visionOcr real helper', () => {
    test('reports a confidence in 0..1 and renders a png per page', async () => {
        const out = await recognizePages(fixture, { timeoutMs: 60_000 })
        expect(out[0].confidence).toBeGreaterThan(0)
        expect(out[0].confidence).toBeLessThanOrEqual(1)
        const dir = tempDir('vision-render-')
        const pdf = twoPagePdf()
        const rendered = await renderPages(pdf, dir, { pages: [2], timeoutMs: 60_000 })
        expect(rendered).toEqual([{ page: 2, path: join(dir, 'page-2.png') }])
        expect(existsSync(rendered[0].path)).toBe(true)
    }, 60_000)

    test('renders cap the long edge at 2048', async () => {
        const dir = tempDir('vision-cap-')
        // 1600x900 points renders at 2x = 3200 px, over the cap
        const pdf = twoPagePdf('0 0 1600 900')
        const rendered = await renderPages(pdf, dir, { pages: [1], timeoutMs: 60_000 })
        const png = readFileSync(rendered[0].path)
        const width = png.readUInt32BE(16)
        const height = png.readUInt32BE(20)
        expect(Math.max(width, height)).toBe(2048)
        expect(Math.min(width, height)).toBeGreaterThan(0)
    }, 60_000)
})
