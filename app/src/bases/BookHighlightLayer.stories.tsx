// Visual spec for <BookHighlightLayer> — region highlights over a book page. The page is a
// canvas drawn here; the store is an in-memory stand-in so the story can read the doc back.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { emptyDoc, PAGE_H, PAGE_W, type DrawingDoc } from '../../../core/src/drawing/model'
import { resolveHighlightColor } from '../../../core/src/drawing/pageHighlights'
import type { AnnotationStore } from '../preview/annotationTypes'
import BookHighlightLayer from './BookHighlightLayer'
import type { PageSlot } from './bookPageStores'
import { bookPageUrl } from './_bookPages'
import { ToastHost } from '../ui/ToastHost'

const PAGE = { w: 300, h: 400 }

const SLOT: PageSlot = {
    leaf: 0,
    file: 'pages/page-1.png',
    docPage: 0,
    nat: { w: 300, h: 400 },
    rendered: { left: 0, top: 0, w: PAGE.w, h: PAGE.h },
}

/** A store over a doc held in memory: `edit` applies at once, no sidecar, no debounce. */
function memoryStore(initial: DrawingDoc | null) {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(initial)
    const store: AnnotationStore = {
        doc,
        loadState: () => 'ready',
        edit: fn => setDoc(fn(doc() ?? emptyDoc())),
        undo: () => {},
        redo: () => {},
        resetHistory: () => {},
        flush: async () => {},
        setPdfHighlights: () => {},
        highlightStore: () => 'sidecar',
    }
    return store
}

const seeded = (): DrawingDoc => ({
    ...emptyDoc(),
    pages: [{ strokes: [], highlights: [{ id: 'h1', c: 'hl', rects: [{ x: 200, y: 300, w: 300, h: 80 }] }] }],
})

type Props = { store: AnnotationStore; armed?: boolean; color?: string; onRegion?: (e: unknown) => void }

function Harness(props: Props) {
    const [armed, setArmed] = createSignal(props.armed ?? true)
    return (
        <div
            data-harness
            style={{ position: 'relative', width: `${PAGE.w}px`, height: `${PAGE.h}px`, margin: '24px' }}
        >
            <img src={bookPageUrl(1, PAGE)} width={PAGE.w} height={PAGE.h} alt="" />
            <BookHighlightLayer
                slots={[SLOT]}
                store={() => props.store}
                armed={armed()}
                color={props.color ?? 'hl'}
                edit={(_, fn) => props.store.edit(fn)}
                onHighlighted={() => setArmed(false)}
                onRegion={props.onRegion}
            />
        </div>
    )
}

const meta = {
    title: 'Bases/BookHighlightLayer',
    component: BookHighlightLayer,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof BookHighlightLayer>

export default meta
type Story = StoryObj<typeof meta>

function drag(el: HTMLElement, from: [number, number], to: [number, number]) {
    const r = el.getBoundingClientRect()
    const fire = (type: string, p: [number, number]) =>
        el.dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                pointerId: 5,
                button: 0,
                clientX: r.left + p[0],
                clientY: r.top + p[1],
            }),
        )
    fire('pointerdown', from)
    fire('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2])
    fire('pointermove', to)
    fire('pointerup', to)
}

export const ArmedDragDrawsABox: Story = {
    name: 'Armed drag draws a box',
    render: () => {
        const store = memoryStore(null)
        ;(globalThis as { __store?: AnnotationStore }).__store = store
        return <Harness store={store} color="#7fd99a" />
    },
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-book-highlights]')!
        drag(layer, [40, 60], [200, 120])
        const store = (globalThis as { __store?: AnnotationStore }).__store!
        await waitFor(() => expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(1))
        const box = layer.querySelector<HTMLElement>('[data-book-highlight-rect]')!
        await expect(getComputedStyle(box).backgroundColor).toBe('rgb(127, 217, 154)')
        const r = store.doc()!.pages[0].highlights![0].rects[0]
        // 300x400 page image: the fit box is the whole 816x1056 logical page
        await expect(r.x).toBeGreaterThanOrEqual(0)
        await expect(r.x + r.w).toBeLessThanOrEqual(PAGE_W)
        await expect(r.y + r.h).toBeLessThanOrEqual(PAGE_H)
        // the image fits 792x1056 at x 12, so page px 40 is logical 12 + 40 * 792 / 300
        await expect(r.x).toBeCloseTo(12 + (40 * 792) / 300, 0)
        await expect(layer.hasAttribute('data-armed')).toBe(false)
    },
}

export const ClickRemoves: Story = {
    name: 'Click removes',
    render: () => {
        const store = memoryStore(seeded())
        ;(globalThis as { __store?: AnnotationStore }).__store = store
        return <Harness store={store} />
    },
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-book-highlights]')!
        await expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(1)
        const store = (globalThis as { __store?: AnnotationStore }).__store!
        // the seeded box is at logical (200..500, 300..380); its centre in page px
        const k = 300 / 792
        const cx = (350 - 12) * k
        const cy = 340 * k
        drag(layer, [cx, cy], [cx, cy])
        await waitFor(() => expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(0))
        await expect(store.doc()!.pages[0].highlights ?? []).toHaveLength(0)
    },
}

export const Unarmed: Story = {
    render: () => <Harness store={memoryStore(seeded())} armed={false} />,
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-book-highlights]')!
        await expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(1)
        await expect(getComputedStyle(layer).pointerEvents).toBe('none')
        await expect(getComputedStyle(layer.firstElementChild!).backgroundColor).toBe(
            hexToRgb(resolveHighlightColor('hl')),
        )
    },
}

/** Unarmed, the pointer over a box turns into an X and a click removes the box; the toast's `undo`
 *  puts it back. Click the yellow box to try it. */
export const UnarmedClickRemoves: Story = {
    name: 'Unarmed click removes',
    render: () => {
        const store = memoryStore(seeded())
        ;(globalThis as { __store?: AnnotationStore }).__store = store
        return (
            <>
                <Harness store={store} armed={false} />
                <ToastHost />
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-book-highlights]')!
        const store = (globalThis as { __store?: AnnotationStore }).__store!
        const box = () => layer.querySelector<HTMLElement>('[data-book-highlight-rect]')
        hoverOn(box()!)
        await waitFor(() => expect(cursorIsX()).toBe(true))
        clickOn(box()!)
        await waitFor(() => expect(box()).toBeNull())
        await expect(store.doc()!.pages[0].highlights ?? []).toHaveLength(0)
        ;(await undoButton()).click()
        await waitFor(() => expect(store.doc()!.pages[0].highlights?.[0]?.id).toBe('h1'))
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }))
    },
}

function hexToRgb(hex: string): string {
    const n = parseInt(hex.slice(1, 7), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/** A press and release at `el`'s centre, on the element under that point, as a real mouse sends
 *  them: pointerdown, pointerup, click. */
function clickOn(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const under = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el
    const at = { bubbles: true, clientX: x, clientY: y, button: 0 }
    under.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', buttons: 1 }))
    under.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse' }))
    under.dispatchEvent(new MouseEvent('click', at))
}
/** The pointer resting on `el`'s centre, on the element under that point. */
function hoverOn(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const under = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el
    under.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: y }))
}
const cursorIsX = () => document.documentElement.hasAttribute('data-highlight-hover')
/** The toast's `undo` button, once it shows. */
const undoButton = () =>
    waitFor(() => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('undo'))
        expect(b).toBeTruthy()
        return b!
    })
