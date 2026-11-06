import { describe, expect, test } from 'bun:test'
import type { PdfPageGeom } from '../../../core/src/drawing/pdfHighlights'
import type { AnnotationStore } from './annotationTypes'
import type { AnnotationStoreOptions } from './createAnnotationStore'
import { createStoreShare } from './sharedAnnotationStore'

function harness() {
    const log: string[] = []
    const saved: { binary: string; pages: unknown }[] = []
    const made: { sidecar: string; binary: string; opts?: AnnotationStoreOptions }[] = []
    const share = createStoreShare(
        (sidecar, binary, opts) => {
            made.push({ sidecar: sidecar(), binary: binary(), opts })
            return {
                flush: async () => {
                    log.push(`flush ${binary()}`)
                },
            } as unknown as AnnotationStore
        },
        (binary, pages) => void saved.push({ binary, pages }),
    )
    return { log, made, saved, share }
}
const geom = (w: number): PdfPageGeom => ({ view: [0, 0, w, 100], rotate: 0 })

describe('sharedAnnotationStore', () => {
    test('a save into the pdf by any holder updates the cache once, with the saved highlights', () => {
        const { made, saved, share } = harness()
        let heard = 0
        share.acquire('b.pdf')
        share.acquire('b.pdf', { onPdfSaved: () => void heard++ })
        const pages = [[]]
        made[0].opts!.onPdfSaved!(pages)
        expect(saved).toEqual([{ binary: 'b.pdf', pages }])
        expect(heard).toBe(1)
    })

    test('two acquirers of one binary share one store over its sidecar', () => {
        const { made, share } = harness()
        const a = share.acquire('b.pdf')
        const b = share.acquire('b.pdf')
        expect(a.store).toBe(b.store)
        expect(made).toHaveLength(1)
        expect(made[0].sidecar).toBe('b.pdf.draw')
        expect(made[0].binary).toBe('b.pdf')
        share.acquire('c.png')
        expect(made).toHaveLength(2)
    })

    test('the last release flushes then disposes; earlier ones do not', async () => {
        const { log, share } = harness()
        const a = share.acquire('b.pdf')
        const b = share.acquire('b.pdf')
        await a.release()
        await a.release() // idempotent
        expect(log).toEqual([])
        expect(share.size()).toBe(1)
        await b.release()
        expect(log).toEqual(['flush b.pdf'])
        expect(share.size()).toBe(0)
    })

    test('acquiring after the last release makes a new store', async () => {
        const { made, share } = harness()
        const a = share.acquire('b.pdf')
        await a.release()
        const b = share.acquire('b.pdf')
        expect(made).toHaveLength(2)
        expect(b.store).not.toBe(a.store)
    })

    test('pageGeom: a later acquirer supplies it when the first had none, first answer wins', () => {
        const { made, share } = harness()
        share.acquire('b.pdf')
        expect(made[0].opts!.pageGeom!(0)).toBeUndefined()
        share.acquire('b.pdf', { pageGeom: p => (p === 0 ? geom(10) : undefined) })
        share.acquire('b.pdf', { pageGeom: () => geom(99) })
        expect(made[0].opts!.pageGeom!(0)).toEqual(geom(10))
        expect(made[0].opts!.pageGeom!(1)).toEqual(geom(99))
    })

    test('onPdfSaved fans out to every acquirer, including one that arrived later', async () => {
        const { made, share } = harness()
        const seen: string[] = []
        const book = share.acquire('b.pdf', { onPdfSaved: () => void seen.push('book') })
        const preview = share.acquire('b.pdf', { onPdfSaved: () => void seen.push('preview') })
        made[0].opts!.onPdfSaved!([])
        expect(seen).toEqual(['book', 'preview'])
        await book.release()
        made[0].opts!.onPdfSaved!([])
        expect(seen).toEqual(['book', 'preview', 'preview'])
        await preview.release()
    })
})
