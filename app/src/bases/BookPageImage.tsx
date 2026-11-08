// app/src/bases/BookPageImage.tsx
// One page picture in side by side: it loads its face when it nears the view (a long book draws only
// what is on screen), paints it on a canvas, and carries the locate boxes and clicks over it.
import { createEffect, createSignal, onCleanup, onMount, Show, untrack, type Component } from 'solid-js'
import type { Face } from './bookFaces'
import LocateLayer, { type LocateBox } from './LocateLayer'
import Text from '../ui/Text'
import styles from './BookPageImage.module.css'

export type BookPageImageProps = {
    /** The page's face; the same loader the page turns draw from. */
    face: () => Promise<Face>
    /** Changes when the face must be made again (dark pages). */
    rev?: number
    label: string
    boxes: LocateBox[]
    /** A click on the page, in page fractions. */
    onPoint?: (x: number, y: number) => void
    className?: string
}

/** How far ahead of the view, in px, a page starts loading. */
const AHEAD = 1200

const BookPageImage: Component<BookPageImageProps> = props => {
    let host!: HTMLDivElement
    let canvas: HTMLCanvasElement | undefined
    const [near, setNear] = createSignal(false)
    const [face, setFace] = createSignal<Face>()
    onMount(() => {
        const io = new IntersectionObserver(es => es.length > 0 && setNear(es[es.length - 1].isIntersecting), { rootMargin: `${AHEAD}px 0px` })
        io.observe(host)
        onCleanup(() => io.disconnect())
    })
    createEffect(() => {
        if (!near()) {
            // a page that scrolled far away gives its canvas back
            untrack(() => {
                if (canvas && face()) canvas.width = 0
                setFace(undefined)
            })
            return
        }
        void props.rev
        let live = true
        void untrack(() => props.face()).then(f => live && setFace(f))
        onCleanup(() => (live = false))
    })
    createEffect(() => {
        const f = face()
        if (!canvas || f?.kind !== 'ready') return
        const src = f.source as CanvasImageSource & { width: number; height: number }
        canvas.width = src.width
        canvas.height = src.height
        canvas.getContext('2d')?.drawImage(src, 0, 0)
    })
    return (
        <div ref={host} class={[styles.page, props.className].filter(Boolean).join(' ')} data-page-image>
            <Show
                when={face()?.kind !== 'missing'}
                fallback={
                    <Text tone="muted" class={styles.missing}>
                        {`missing: ${(face() as { name?: string } | undefined)?.name ?? ''}`}
                    </Text>
                }
            >
                <canvas ref={el => (canvas = el)} class={styles.canvas} aria-label={props.label} />
            </Show>
            <LocateLayer boxes={props.boxes} onPoint={props.onPoint} />
        </div>
    )
}

export default BookPageImage
