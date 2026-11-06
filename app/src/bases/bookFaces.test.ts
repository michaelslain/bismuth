import { describe, expect, test } from 'bun:test'
import { FACE_CACHE_MAX, createFaceLoader, pdfEvictions, type FaceDeps } from './bookFaces'
import type { BookLeaf } from '../../../core/src/bases/bookPages'

const leaf = (file: string, pdfPage?: number): BookLeaf => ({
    ref: { file, kind: pdfPage ? 'pdf' : 'image', rowIndex: 0 },
    pdfPage,
})

function deps(over: Partial<FaceDeps> = {}) {
    const calls: string[] = []
    const d: FaceDeps = {
        loadImage: async file => {
            calls.push(file)
            return { tag: file } as unknown as CanvasImageSource
        },
        renderPdfPage: async (file, page) => {
            calls.push(`${file}#${page}`)
            return { tag: `${file}#${page}` } as unknown as CanvasImageSource
        },
        pdfPageCount: async () => 3,
        ...over,
    }
    return { d, calls }
}

describe('createFaceLoader', () => {
    test('holds at most 6 leaves and evicts the least recently used', async () => {
        const { d, calls } = deps()
        const loader = createFaceLoader(d)
        expect(FACE_CACHE_MAX).toBe(6)
        for (let i = 0; i < 6; i++) await loader.face(leaf(`p${i}.png`))
        // touch p0 so p1 is now the oldest
        await loader.face(leaf('p0.png'))
        await loader.face(leaf('p6.png'))
        expect(loader.size()).toBe(6)
        expect(loader.has(leaf('p1.png'))).toBe(false)
        expect(loader.has(leaf('p0.png'))).toBe(true)
        const before = calls.length
        await loader.face(leaf('p0.png'))
        expect(calls.length).toBe(before)
        await loader.face(leaf('p1.png'))
        expect(calls.length).toBe(before + 1)
    })

    test('a failing image resolves to a missing marker, not a throw', async () => {
        const { d } = deps({
            loadImage: async () => {
                throw new Error('404')
            },
        })
        const f = await createFaceLoader(d).face(leaf('gone/scan 1.jpg'))
        expect(f).toEqual({ kind: 'missing', name: 'scan 1.jpg' })
    })

    test('a failing pdf page resolves to a missing marker naming the pdf', async () => {
        const { d } = deps({
            renderPdfPage: async () => {
                throw new Error('bad pdf')
            },
        })
        const f = await createFaceLoader(d).face(leaf('docs/a.pdf', 2))
        expect(f).toEqual({ kind: 'missing', name: 'a.pdf' })
    })

    test('concurrent requests for one leaf load it once', async () => {
        const { d, calls } = deps()
        const loader = createFaceLoader(d)
        await Promise.all([loader.face(leaf('a.png')), loader.face(leaf('a.png'))])
        expect(calls).toEqual(['a.png'])
    })
})

describe('pdfPageGeom', () => {
    test('is the loader reading the geometry the deps recorded, 0-based', async () => {
        const seen = new Map<string, { view: [number, number, number, number]; rotate: number }>()
        const { d } = deps({
            renderPdfPage: async (file, page) => {
                seen.set(`${file}#${page - 1}`, { view: [0, 0, 612, 792], rotate: page === 2 ? 90 : 0 })
                return {} as unknown as CanvasImageSource
            },
            pdfPageGeom: (file, i) => seen.get(`${file}#${i}`),
        })
        const loader = createFaceLoader(d)
        expect(loader.pdfPageGeom('a.pdf', 1)).toBeUndefined()
        await loader.face(leaf('a.pdf', 2))
        expect(loader.pdfPageGeom('a.pdf', 1)).toEqual({ view: [0, 0, 612, 792], rotate: 90 })
        expect(loader.pdfPageGeom('a.pdf', 0)).toBeUndefined()
    })

    test('a deps without it answers undefined', () => {
        expect(createFaceLoader(deps().d).pdfPageGeom('a.pdf', 0)).toBeUndefined()
    })
})

describe('pdfEvictions', () => {
    test('drops the oldest down to the cap', () => {
        expect(pdfEvictions(['a', 'b', 'c', 'd'], 2, 'd', new Map())).toEqual(['a', 'b'])
    })
    test('skips busy documents and the one just inserted', () => {
        expect(pdfEvictions(['a', 'b', 'c', 'd'], 2, 'a', new Map([['b', 1]]))).toEqual(['c', 'd'])
    })
    test('keeps everything while under the cap', () => {
        expect(pdfEvictions(['a', 'b'], 2, 'b', new Map())).toEqual([])
    })
})
