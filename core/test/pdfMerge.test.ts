// core/test/pdfMerge.test.ts — merging a newer version of a PDF: pages drawn as ink with pdf.js and
// matched, the plan, and the write (every page takes the newer picture; kept pages keep their text and
// marks, updated pages their marks but not their text, new pages arrive empty).
import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeOrder, mergePdf, pageInk, planPdfMerge } from '../src/pdfMerge'
import { ADDED_MIN, pageMatch, SAME_MIN } from '../src/pdfMergePlan'
import { rewritePdfPages } from '../src/pdfPages'
import { applyPdfHighlightEdits, readPdfHighlights } from '../src/drawing/pdfHighlights'
import { emptyDoc, parseDoc, serializeDoc } from '../src/drawing/model'
import { readTranscript } from '../src/transcript'
import { AppError } from '../src/error'
import { makeVault, tempDir } from './helpers'
import { createServer } from '../src/server'
import { createLocalBackend } from '../src/localBackend'
import { readRunRecords } from '../src/runRegistry'
import { pdfOfBars, pdfOfWidths, type BarPage } from './pdfFixtures'

process.env.BISMUTH_RUN_DIR ??= tempDir('bismuth-pdfmerge-run-')

const pdf = pdfOfBars
type Spec = BarPage
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

const COMPANION = ['---', 'transcribed: ai', '---', '<!-- bismuth:transcript:start -->', '### Page 1', '', 'one', '', '### Page 2', '', 'two', '', '### Page 3', '', 'three', '<!-- bismuth:transcript:end -->', ''].join('\n')

async function vault(old: Spec[], next: Spec[]) {
    const doc = { ...emptyDoc(), pages: old.map((_, n) => ({ strokes: [{ t: 'pen', c: '#000', w: 2, pts: [n + 1, n + 1, 255] }] })), bookmarks: [{ id: 'b3', page: 2, label: 'three' }] }
    const v = makeVault({ 'n.pdf.md': COMPANION, 'n.pdf.draw': serializeDoc(doc as never) })
    writeFileSync(join(v, 'n.pdf'), await pdf(old))
    writeFileSync(join(v, 'n2.pdf'), await pdf(next))
    return v
}

describe('pageInk + pageMatch', () => {
    test('the same page reframed is alike with nothing added, a line written on adds ink', async () => {
        const [a, moved, written] = await pageInk(await pdf([{ id: 1 }, { id: 1, shift: 8 }, { id: 1, extra: true }]))
        const same = pageMatch(a!, moved!)
        expect(same.same).toBeGreaterThan(SAME_MIN)
        expect(same.added).toBeLessThan(ADDED_MIN)
        expect(pageMatch(a!, written!).added).toBeGreaterThanOrEqual(ADDED_MIN)
    })
})

describe('planPdfMerge', () => {
    test('every page photographed again, the last one written on, and a page appended', async () => {
        const v = await vault([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 1, shift: 6 }, { id: 2, shift: 6 }, { id: 3, shift: 6, extra: true }, { id: 4 }])
        const plan = await planPdfMerge(v, 'n.pdf', { file: 'n2.pdf' })
        expect(plan.steps).toEqual([
            { kind: 'keep', page: 0, from: 0 },
            { kind: 'keep', page: 1, from: 1 },
            { kind: 'update', page: 2, from: 2 },
            { kind: 'add', from: 3 },
        ])
        expect([plan.pages, plan.kept, plan.updated, plan.added, plan.only]).toEqual([4, 2, 1, 1, 0])
    })

    test('with no page unchanged, every page pairs by order', async () => {
        // the newer pages are blank: nothing on them is like the old pages
        const v = await vault([{ id: 1 }, { id: 2 }], [{ id: 1 }])
        writeFileSync(join(v, 'n2.pdf'), await pdfOfWidths([400, 400, 400]))
        const plan = await planPdfMerge(v, 'n.pdf', { file: 'n2.pdf' })
        expect(plan.steps).toEqual([
            { kind: 'update', page: 0, from: 0 },
            { kind: 'update', page: 1, from: 1 },
            { kind: 'add', from: 2 },
        ])
        expect(plan.kept).toBe(0)
    })

    test('picked bytes plan the same as a vault file', async () => {
        const v = await vault([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }, { id: 5 }])
        const plan = await planPdfMerge(v, 'n.pdf', { data: b64(readFileSync(join(v, 'n2.pdf'))), name: 'n v2.pdf' })
        expect(plan.added).toBe(1)
        expect(mergeOrder(plan.steps)).toEqual([{ with: 1, marksOf: 1, textOf: 1 }, { with: 2, marksOf: 2, textOf: 2 }, { with: 3 }])
    })
})

describe('mergePdf', () => {
    test('every page is the newer picture; kept pages keep text and marks, an updated page its marks, a new page nothing', async () => {
        const v = await vault([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 1 }, { id: 2 }, { id: 3, extra: true }, { id: 4 }])
        const path = join(v, 'n.pdf')
        const hl = { id: 'h', c: '#ffee00', rects: [{ x: 100, y: 100, w: 200, h: 20 }] }
        writeFileSync(path, await applyPdfHighlightEdits(readFileSync(path), { add: [{ page: 0, highlight: hl }, { page: 2, highlight: hl }], remove: [] }))

        await mergePdf(v, 'n.pdf', { file: 'n2.pdf' })

        const merged = readFileSync(path)
        const got = await pageInk(merged)
        const want = await pageInk(readFileSync(join(v, 'n2.pdf')))
        expect(got.map((g, i) => pageMatch(want[i]!, g).same > 0.99)).toEqual([true, true, true, true])

        const hls = await readPdfHighlights(merged)
        expect(hls.pages.map(p => p.length)).toEqual([1, 0, 1, 0])
        expect(hls.pages[2]![0]!.rects[0]!.x).toBeCloseTo(100, 0)

        const draw = parseDoc(readFileSync(join(v, 'n.pdf.draw'), 'utf8'))
        expect(draw.pages.map(p => p.strokes[0]?.pts[0] ?? -1)).toEqual([1, 2, 3, -1])
        expect(draw.bookmarks).toEqual([{ id: 'b3', page: 2, label: 'three' }])

        expect(readTranscript(readFileSync(join(v, 'n.pdf.md'), 'utf8'))).toEqual([
            { page: 1, text: 'one' },
            { page: 2, text: 'two' },
        ])
    })

    test('a with page out of range is refused before anything is written', async () => {
        const v = await vault([{ id: 1 }], [{ id: 1 }])
        const before = readFileSync(join(v, 'n.pdf'))
        const err = await rewritePdfPages(v, 'n.pdf', [{ page: 1 }, { with: 3 }], { with: { file: 'n2.pdf' } }).catch(e => e)
        expect((err as AppError).message).toBe('the with pdf has no page 3 (it has 1)')
        expect(readFileSync(join(v, 'n.pdf')).equals(before)).toBe(true)
    })
})

describe('routes', () => {
    test('POST /pdf/merge/plan plans, POST /pdf/pages with the bytes writes it, a hidden newer file is refused', async () => {
        const v = await vault([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2, extra: true }, { id: 3 }])
        writeFileSync(join(v, 'secret.pdf'), readFileSync(join(v, 'n2.pdf')))
        writeFileSync(join(v, 'secret.pdf.md'), '---\nvisibility: hidden\n---\n')
        const server = createServer({ vault: v, port: 0 })
        try {
            const token = readRunRecords().find(r => r.vault === v)?.token ?? ''
            const call = (path: string, body: unknown, restricted = false) =>
                fetch(`http://localhost:${server.port}${path}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...(restricted ? {} : { 'X-Bismuth-Token': token }) },
                    body: JSON.stringify(body),
                })
            const w = { data: b64(readFileSync(join(v, 'n2.pdf'))), name: 'n2.pdf' }
            const res = await call('/pdf/merge/plan', { file: 'n.pdf', with: w })
            expect(res.status).toBe(200)
            const plan = (await res.json()) as { steps: unknown[]; updated: number; added: number }
            expect([plan.updated, plan.added]).toEqual([1, 1])
            expect((await call('/pdf/merge/plan', { file: 'n.pdf', with: { file: 'secret.pdf' } }, true)).status).toBe(403)
            expect((await call('/pdf/merge/plan', { file: 'n.pdf', with: { file: 'n.pdf.md' } })).status).toBe(400)

            const order = mergeOrder(plan.steps as never)
            const wrote = await call('/pdf/pages', { file: 'n.pdf', order, with: w })
            expect(wrote.status).toBe(200)
            expect(await wrote.json()).toEqual({ pages: 3 })
            expect(readTranscript(readFileSync(join(v, 'n.pdf.md'), 'utf8')).map(p => p.page)).toEqual([1])
        } finally {
            server.stop(true)
        }
    })

    test('the in-process backend writes a merge order but cannot plan one', async () => {
        const v = await vault([{ id: 1 }], [{ id: 1 }, { id: 2 }])
        const be = createLocalBackend({ vault: v } as Parameters<typeof createLocalBackend>[0])
        const err = await be.dispatch('POST', '/pdf/merge/plan', { file: 'n.pdf', with: { file: 'n2.pdf' } }).catch(e => e)
        expect((err as AppError).code).toBe('MERGE_UNAVAILABLE')
        expect(await be.dispatch('POST', '/pdf/pages', { file: 'n.pdf', order: [{ page: 1 }, { with: 2 }], with: { file: 'n2.pdf' } })).toEqual({ pages: 2 })
    })
})
