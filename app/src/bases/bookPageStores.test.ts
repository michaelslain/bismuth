import { describe, expect, test } from 'bun:test'
import { emptyDoc, serializeDoc } from '../../../core/src/drawing/model'
import { addBookmark } from '../../../core/src/drawing/pageBookmarks'
import type { BookLeaf } from '../../../core/src/bases/bookPages'
import type { AnnotationStore } from '../preview/annotationTypes'
import {
    createEditHistory,
    createPageStores,
    pageSlots,
    readSidecars,
} from './bookPageStores'

function recorder() {
    const log: string[] = []
    const make = (file: string) => ({
        store: {
            flush: async () => {
                log.push(`flush ${file}`)
            },
            undo: () => log.push(`undo ${file}`),
            redo: () => log.push(`redo ${file}`),
        } as unknown as AnnotationStore,
        dispose: () => {
            log.push(`dispose ${file}`)
        },
    })
    return { log, make: (file: string) => (log.push(`make ${file}`), make(file)) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('createPageStores', () => {
    test('a spread [a,b] makes stores for a and b only', () => {
        const { log, make } = recorder()
        const s = createPageStores(make)
        s.sync(['a', 'b'])
        expect(log).toEqual(['make a', 'make b'])
        expect(s.get('a')).toBeDefined()
        expect(s.get('c')).toBeUndefined()
        expect(s.files()).toEqual(['a', 'b'])
    })

    test('turning to [c,d] flushes then disposes a and b', async () => {
        const { log, make } = recorder()
        const s = createPageStores(make)
        s.sync(['a', 'b'])
        log.length = 0
        s.sync(['c', 'd'])
        await tick()
        expect(log.filter(l => l.startsWith('make')).sort()).toEqual(['make c', 'make d'])
        for (const f of ['a', 'b']) expect(log.indexOf(`flush ${f}`)).toBeLessThan(log.indexOf(`dispose ${f}`))
        expect(log.filter(l => l.startsWith('dispose')).length).toBe(2)
        expect(s.get('a')).toBeUndefined()
        expect(s.files()).toEqual(['c', 'd'])
    })

    test('a file shown on both sides, or kept across a turn, has one store', () => {
        const { log, make } = recorder()
        const s = createPageStores(make)
        s.sync(['a', 'a'])
        s.sync(['a', 'b'])
        expect(log).toEqual(['make a', 'make b'])
    })

    test('close flushes and disposes everything', async () => {
        const { log, make } = recorder()
        const s = createPageStores(make)
        s.sync(['a', 'b'])
        await s.close()
        expect(log.filter(l => l.startsWith('dispose')).sort()).toEqual(['dispose a', 'dispose b'])
        expect(s.files()).toEqual([])
    })
})

describe('readSidecars', () => {
    test('one read per distinct page file, in parallel', async () => {
        const reads: string[] = []
        const doc = serializeDoc(addBookmark(emptyDoc(), 0, 'Page 3'))
        const out = await readSidecars(['p1.png', 'p1.png', 'b.pdf', 'p2.png'], async path => {
            reads.push(path)
            if (path === 'p2.png.draw') throw new Error('404')
            return path === 'p1.png.draw' ? doc : ''
        })
        expect(reads.sort()).toEqual(['b.pdf.draw', 'p1.png.draw', 'p2.png.draw'])
        expect(out.get('p1.png')?.bookmarks?.[0]?.label).toBe('Page 3')
        expect(out.get('b.pdf')).toBeNull()
        expect(out.get('p2.png')).toBeNull()
    })
})

describe('pageSlots', () => {
    const leaf = (file: string, pdfPage?: number) => ({ ref: { file, kind: pdfPage ? 'pdf' : 'image' }, pdfPage }) as unknown as BookLeaf
    const leaves = [leaf('a.png'), leaf('b.pdf', 1), leaf('b.pdf', 2)]
    const size = { w: 300, h: 400 }
    test('spread puts the right page one page-width in, a pdf leaf targets its own page', () => {
        const slots = pageSlots({
            spread: { left: 1, right: 2 },
            layout: 'spread',
            pageSize: { w: 300, h: 400 },
            leaves,
            sizes: { left: size, right: size },
        })
        expect(slots.map(s => [s.leaf, s.file, s.docPage, s.rendered.left])).toEqual([
            [1, 'b.pdf', 0, 0],
            [2, 'b.pdf', 1, 300],
        ])
    })
    test('a cover has only a right page; single starts at 0; a landscape image is letterboxed', () => {
        const cover = pageSlots({
            spread: { right: 0 },
            layout: 'spread',
            pageSize: { w: 300, h: 400 },
            leaves,
            sizes: { right: size },
        })
        expect(cover.map(s => s.rendered.left)).toEqual([300])
        const single = pageSlots({
            spread: { right: 0 },
            layout: 'single',
            pageSize: { w: 300, h: 400 },
            leaves,
            sizes: { right: { w: 400, h: 300 } },
        })
        expect(single[0].rendered).toEqual({ left: 0, top: 87.5, w: 300, h: 225 })
    })
})

describe('createEditHistory', () => {
    test('undo goes to the file edited last, skipping files turned away from; redo returns it', () => {
        const { log, make } = recorder()
        const s = createPageStores(make)
        s.sync(['a', 'b'])
        const h = createEditHistory()
        h.record('a')
        h.record('b')
        s.sync(['a'])
        expect(h.undo(s.get)).toBe(true)
        expect(log.filter(l => l.startsWith('undo'))).toEqual(['undo a'])
        expect(h.redo(s.get)).toBe(true)
        expect(log.filter(l => l.startsWith('redo'))).toEqual(['redo a'])
        expect(h.redo(s.get)).toBe(false)
    })

    test('turning back to a file does not resurrect its old undo entries', () => {
        const { log, make } = recorder()
        const h = createEditHistory()
        const s = createPageStores(make, { onRetire: f => h.forget(f) })
        s.sync(['a', 'b'])
        h.record('a')
        h.record('b')
        s.sync(['b'])
        s.sync(['a', 'b'])
        // a's new store has no history: the key goes to b's edit, not a dead entry for a
        expect(h.undo(s.get)).toBe(true)
        expect(log.filter(l => l.startsWith('undo'))).toEqual(['undo b'])
        expect(h.undo(s.get)).toBe(false)
        expect(h.redo(s.get)).toBe(true)
    })
})

describe('retiring stores and chained edits', () => {
    function slow() {
        const log: string[] = []
        let release!: () => void
        const gate = new Promise<void>(r => (release = r))
        const make = (file: string) => ({
            store: {
                flush: async () => {
                    log.push(`flush ${file}`)
                    await gate
                },
            } as unknown as AnnotationStore,
            dispose: () => void log.push(`dispose ${file}`),
        })
        return { log, make, release }
    }

    test('settled(file) waits for the retire and onRetire fires', async () => {
        const { log, make, release } = slow()
        const retired: string[] = []
        const s = createPageStores(make, { onRetire: f => retired.push(f) })
        s.sync(['a'])
        s.sync([])
        expect(retired).toEqual(['a'])
        let done = false
        void s.settled('a').then(() => (done = true))
        await tick()
        expect(done).toBe(false)
        await s.settled('zzz')
        release()
        await s.settled('a')
        expect(log).toEqual(['flush a', 'dispose a'])
        await tick()
        expect(done).toBe(true)
        await s.settled('a') // resolved again once nothing is pending
    })
})
