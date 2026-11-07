// app/src/ui/popover/createBoxSize.ts
// The live sizes a cursor-placed surface needs to keep itself inside the window: its own box,
// followed by a ResizeObserver, and the window's, followed by `resize`. ContextMenu, its submenu
// flyout and QuickActionRail place themselves from these, so a surface whose rows grow after it
// opens (a label that fills in late, a font or icon landing after the first layout) or a window
// that shrinks while it is open re-runs the edge flip instead of keeping a stale position.
// A ResizeObserver delivers before paint, so the first frame is already placed.
import { createSignal, onCleanup, type Accessor } from 'solid-js'

export type BoxSize = { w: number; h: number }

/** `[size, ref]`: pass `ref` as the element's ref; `size()` is its border box, `{0, 0}` until the
 *  element has laid out (placeAnchored treats 0 as "not measured yet"). */
export function createBoxSize(): [Accessor<BoxSize>, (el: HTMLElement) => void] {
    const [size, setSize] = createSignal<BoxSize>({ w: 0, h: 0 }, {
        equals: (a, b) => a.w === b.w && a.h === b.h,
    })
    let ro: ResizeObserver | undefined
    const ref = (el: HTMLElement) => {
        const read = () => {
            const r = el.getBoundingClientRect()
            setSize({ w: r.width, h: r.height })
        }
        ro?.disconnect()
        ro = new ResizeObserver(read)
        ro.observe(el)
        // A ref runs before the element is in the document (a Portal inserts after it), and the
        // observer's first report lands only at the next frame: read once as soon as the current
        // update has inserted it, so code running right after the mount already sees it placed.
        queueMicrotask(() => {
            if (el.isConnected) read()
        })
    }
    onCleanup(() => ro?.disconnect())
    return [size, ref]
}

/** The window's inner size, updated on `resize`. */
export function createViewportSize(): Accessor<BoxSize> {
    const read = () => ({ w: window.innerWidth, h: window.innerHeight })
    const [size, setSize] = createSignal<BoxSize>(read())
    const onResize = () => setSize(read())
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
    return size
}
