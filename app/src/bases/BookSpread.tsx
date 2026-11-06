import { createEffect, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import type { SpreadFaces } from './PageTurnLayer'
import styles from './BookSpread.module.css'

export type BookSpreadProps = {
    faces: SpreadFaces
    layout: 'spread' | 'single'
    /** One page, CSS px, already fitted. */
    pageSize: { w: number; h: number }
    /** File names for the placeholders of pages that could not be read. */
    missing?: { left?: string; right?: string }
    /** A click in a page's outer third: 1 turns forward, -1 back. */
    onTurn: (dir: 1 | -1) => void
    className?: string
}

/** The still pages of an open book, set like a reading app: no page edges, no spine line, the
 *  pages drawn straight onto the pane's background. The left page (spread layout only) and the
 *  right page are each a canvas painted from its face, a placeholder when the file is missing,
 *  and nothing where the spread has no page (the cover's left side). */
const BookSpread: Component<BookSpreadProps> = props => {
    let leftCanvas: HTMLCanvasElement | undefined
    let rightCanvas: HTMLCanvasElement | undefined

    const paint = (canvas: HTMLCanvasElement | undefined, face: SpreadFaces['left'], side: 'left' | 'right') => {
        if (!canvas) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.max(1, Math.round(props.pageSize.w * dpr))
        const h = Math.max(1, Math.round(props.pageSize.h * dpr))
        canvas.width = w
        canvas.height = h
        if (!face) return
        // Contained: a page whose own aspect differs is letterboxed on the pane's own background,
        // against the spine in a spread (as an open book holds it), centred on its own.
        const fs = face as { width?: number; height?: number }
        const fw = Number(fs.width) || w
        const fh = Number(fs.height) || h
        const k = Math.min(w / fw, h / fh)
        const x = props.layout === 'single' ? (w - fw * k) / 2 : side === 'left' ? w - fw * k : 0
        canvas.getContext('2d')!.drawImage(face, x, (h - fh * k) / 2, fw * k, fh * k)
    }
    createEffect(() => paint(leftCanvas, props.faces.left, 'left'))
    createEffect(() => paint(rightCanvas, props.faces.right, 'right'))

    const click = (side: 'left' | 'right') => (e: MouseEvent) => {
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const f = (e.clientX - box.left) / box.width
        if (props.layout === 'single') {
            if (f >= 2 / 3) props.onTurn(1)
            else if (f <= 1 / 3) props.onTurn(-1)
        } else if (side === 'right' && f >= 2 / 3) props.onTurn(1)
        else if (side === 'left' && f <= 1 / 3) props.onTurn(-1)
    }

    const pageStyle = () => ({
        width: `${props.pageSize.w}px`,
        height: `${props.pageSize.h}px`,
    })

    return (
        <div
            class={`${styles.spread} ${props.className ?? ''}`}
            data-book-spread
            data-layout={props.layout}
        >
            <Show when={props.layout === 'spread'}>
                <div
                    class={`${styles.page} ${props.faces.left || props.missing?.left ? '' : styles.empty}`}
                    style={pageStyle()}
                    data-book-page="left"
                    onClick={click('left')}
                >
                    <canvas ref={leftCanvas} class={styles.canvas} />
                    <Show when={props.missing?.left}>
                        {name => (
                            <Text as="div" tone="muted" class={styles.missing}>
                                {`missing: ${name()}`}
                            </Text>
                        )}
                    </Show>
                </div>
            </Show>
            <div
                class={`${styles.page} ${props.faces.right || props.missing?.right ? '' : styles.empty}`}
                style={pageStyle()}
                data-book-page="right"
                onClick={click('right')}
            >
                <canvas ref={rightCanvas} class={styles.canvas} />
                <Show when={props.missing?.right}>
                    {name => (
                        <Text as="div" tone="muted" class={styles.missing}>
                            {`missing: ${name()}`}
                        </Text>
                    )}
                </Show>
            </div>
        </div>
    )
}

export default BookSpread
