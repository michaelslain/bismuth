import { test, expect } from 'bun:test'
import { renderPage, type Ctx2D } from '../../src/drawing/render2d'
import { emptyDoc, PAGE_W, PAGE_H } from '../../src/drawing/model'
import { themeColors } from '../../src/drawing/theme'

function recorder() {
    const calls: string[] = []
    const ctx = new Proxy({} as any, {
        get(_t, prop: string) {
            if (prop === 'calls') return calls
            return (...args: unknown[]) => {
                calls.push(`${prop}(${args.join(',')})`)
            }
        },
        set(_t, prop: string, value: unknown) {
            calls.push(`${String(prop)}=${String(value)}`)
            return true
        },
    })
    return ctx as Ctx2D & { calls: string[] }
}

test('renderPage fills the paper background then draws each stroke', () => {
    const doc = emptyDoc()
    doc.paper.bg = 'grid'
    doc.pages[0].strokes.push({
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: [10, 10, 255, 40, 40, 255],
    })
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('dark'),
        PAGE_W,
        PAGE_H,
    )
    const joined = (ctx as any).calls.join('|')
    expect(joined).toContain('fillRect(0,0,816,1056)')
    expect(joined).toContain('beginPath')
    expect(joined).toContain('fill(')
})

// The blend is chosen by the PAPER's luminance, not fixed. `multiply` can only darken, which is
// what a marker does on white — and on an opaque dark page it can only darken something already
// near-black, so the mark vanished (measured: a gold stroke on the ink theme's #15161A page
// composited to rgb(20,20,22), 1.02:1 against the paper it sits on). `screen` is multiply's
// mirror — it can only lighten — and the same stroke composites to rgb(81,74,62), 2.07:1.
test('highlighter strokes multiply on a LIGHT page', () => {
    const doc = emptyDoc()
    doc.pages[0].strokes.push({
        t: 'hl',
        c: '#e23b3b',
        w: 8,
        pts: [0, 0, 255, 50, 0, 255],
    })
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('light'),
        PAGE_W,
        PAGE_H,
    )
    expect((ctx as any).calls.join('|')).toContain(
        'globalCompositeOperation=multiply',
    )
})

test('highlighter strokes SCREEN on a dark page — multiply would land them on the paper', () => {
    const doc = emptyDoc()
    doc.pages[0].strokes.push({
        t: 'hl',
        c: '#e23b3b',
        w: 8,
        pts: [0, 0, 255, 50, 0, 255],
    })
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('dark'),
        PAGE_W,
        PAGE_H,
    )
    const joined = (ctx as any).calls.join('|')
    expect(joined).toContain('globalCompositeOperation=screen')
    expect(joined).not.toContain('globalCompositeOperation=multiply')
})

test('the wash weight is the same on both papers — only the blend flips', () => {
    const stroke = {
        t: 'hl' as const,
        c: '#e23b3b',
        w: 8,
        pts: [0, 0, 255, 50, 0, 255],
    }
    const alphas = (['dark', 'light'] as const).map(bucket => {
        const doc = emptyDoc()
        doc.pages[0].strokes.push({ ...stroke })
        const ctx = recorder()
        renderPage(
            ctx,
            doc.pages[0],
            doc.paper,
            themeColors(bucket),
            PAGE_W,
            PAGE_H,
        )
        return ((ctx as any).calls as string[]).filter(c =>
            c.startsWith('globalAlpha='),
        )
    })
    expect(alphas[0]).toContain('globalAlpha=0.32')
    expect(alphas[0]).toEqual(alphas[1])
})

test('a PEN stroke is opaque and unblended on either page', () => {
    for (const bucket of ['dark', 'light'] as const) {
        const doc = emptyDoc()
        doc.pages[0].strokes.push({
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: [0, 0, 255, 30, 30, 255],
        })
        const ctx = recorder()
        renderPage(
            ctx,
            doc.pages[0],
            doc.paper,
            themeColors(bucket),
            PAGE_W,
            PAGE_H,
        )
        const joined = (ctx as any).calls.join('|')
        expect(joined).toContain('globalAlpha=1')
        expect(joined).not.toContain('globalCompositeOperation=')
    }
})

test('an unparseable paper colour keeps multiply, the historical behaviour', () => {
    const doc = emptyDoc()
    doc.pages[0].strokes.push({
        t: 'hl',
        c: '#e23b3b',
        w: 8,
        pts: [0, 0, 255, 50, 0, 255],
    })
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        { ...themeColors('dark'), bg: 'var(--bg)' },
        PAGE_W,
        PAGE_H,
    )
    expect((ctx as any).calls.join('|')).toContain(
        'globalCompositeOperation=multiply',
    )
})

test('renderPage blits a resolved image on top of the paper but under the ink', () => {
    const doc = emptyDoc()
    doc.paper.bg = 'blank' // isolate the ordering: blank paper = just the bg fillRect
    doc.pages[0].images = [
        { src: 'data:image/png;base64,XYZ', x: 10, y: 20, w: 100, h: 50 },
    ]
    doc.pages[0].strokes.push({
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: [0, 0, 255, 30, 30, 255],
    })
    const ctx = recorder()
    const seen: string[] = []
    // The resolver is handed the EXACT stored src (same contract the headless export uses), and
    // whatever handle it returns is blitted verbatim — render2d applies NO tint/recolor to it.
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('dark'),
        PAGE_W,
        PAGE_H,
        src => {
            seen.push(src)
            return 'IMG'
        },
    )
    expect(seen).toEqual(['data:image/png;base64,XYZ'])
    const calls = (ctx as any).calls as string[]
    const bg = calls.findIndex(c => c.startsWith('fillRect(0,0,816,1056'))
    const img = calls.findIndex(c => c.startsWith('drawImage(IMG,10,20,100,50'))
    const ink = calls.findIndex(c => c === 'fill()')
    expect(bg).toBeGreaterThanOrEqual(0)
    expect(img).toBeGreaterThan(bg) // image over the background (so the theme wash can't tint it)
    expect(ink).toBeGreaterThan(img) // ink over the image (annotations land on top)
})

test("renderPage skips an image whose src hasn't decoded yet (resolver → undefined)", () => {
    const doc = emptyDoc()
    doc.paper.bg = 'blank'
    doc.pages[0].images = [{ src: 'data:pending', x: 0, y: 0, w: 50, h: 50 }]
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('dark'),
        PAGE_W,
        PAGE_H,
        () => undefined,
    )
    expect((ctx as any).calls.join('|')).not.toContain('drawImage')
})

test('renderPage with images but NO resolver draws nothing for them (back-compat)', () => {
    const doc = emptyDoc()
    doc.pages[0].images = [{ src: 'data:x', x: 0, y: 0, w: 10, h: 10 }]
    const ctx = recorder()
    renderPage(
        ctx,
        doc.pages[0],
        doc.paper,
        themeColors('dark'),
        PAGE_W,
        PAGE_H,
    )
    expect((ctx as any).calls.join('|')).not.toContain('drawImage')
})
