// app/src/bases/BookScroll.tsx
// A book read as one long column: every page at the pane's width, top to bottom, drawn from the
// same faces the page turns use. Pages draw as they near the view, so a long book costs only what
// is on screen. The page under the top of the view is the reader's place.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { BookLeaf } from '../../../core/src/bases/bookPages'
import type { Face } from './bookFaces'
import Text from '../ui/Text'
import styles from './BookScroll.module.css'

export type BookScrollProps = {
    leaves: BookLeaf[]
    /** The face of one page; the same loader the page turns draw from. */
    face: (leaf: BookLeaf) => Promise<Face>
    /** Width over height of a page not drawn yet; a drawn page takes its own picture's shape. */
    aspect: number
    /** The page to show at the top: on mount, and whenever it changes from outside (a bookmark jump). */
    target: number
    /** The page now at the top of the view. */
    onPage: (index: number) => void
    class?: string
}

/** How far ahead of the view, in px, a page starts drawing. */
const AHEAD = 1200

const BookScroll: Component<BookScrollProps> = props => {
    let root!: HTMLDivElement
    const pageEls: HTMLDivElement[] = []
    const [near, setNear] = createSignal<ReadonlySet<number>>(new Set())
    let reported = -1

    const topPage = () => {
        const top = root.getBoundingClientRect().top
        let best = 0
        for (let i = 0; i < pageEls.length; i++) {
            const el = pageEls[i]
            if (!el) continue
            if (el.getBoundingClientRect().bottom > top + 8) {
                best = i
                break
            }
        }
        return best
    }
    const onScroll = () => {
        const p = topPage()
        if (p !== reported) {
            reported = p
            props.onPage(p)
        }
    }
    const scrollTo = (i: number) => {
        const el = pageEls[i]
        if (el) root.scrollTop = el.offsetTop - root.offsetTop
        reported = i
    }

    onMount(() => {
        const io = new IntersectionObserver(
            entries => {
                setNear(prev => {
                    const next = new Set(prev)
                    for (const e of entries) {
                        const i = Number((e.target as HTMLElement).dataset.bookScrollPage)
                        if (e.isIntersecting) next.add(i)
                    }
                    return next
                })
            },
            { root, rootMargin: `${AHEAD}px 0px` },
        )
        createEffect(() => {
            props.leaves.length
            queueMicrotask(() => pageEls.forEach(el => el && io.observe(el)))
        })
        onCleanup(() => io.disconnect())
        requestAnimationFrame(() => scrollTo(props.target))
    })
    createEffect(on(() => props.target, t => t !== reported && scrollTo(t), { defer: true }))

    const Page: Component<{ leaf: BookLeaf; index: number }> = p => {
        const [face, setFace] = createSignal<Face>()
        const [shape, setShape] = createSignal<number>()
        let canvas: HTMLCanvasElement | undefined
        createEffect(() => {
            if (!near().has(p.index) || face()) return
            void props.face(p.leaf).then(setFace)
        })
        createEffect(() => {
            const f = face()
            if (!canvas || f?.kind !== 'ready') return
            const src = f.source as CanvasImageSource & { width: number; height: number }
            canvas.width = src.width
            canvas.height = src.height
            canvas.getContext('2d')?.drawImage(src, 0, 0)
            if (src.width > 0 && src.height > 0) setShape(src.width / src.height)
        })
        return (
            <div
                ref={el => (pageEls[p.index] = el)}
                class={styles.page}
                style={{ 'aspect-ratio': `${shape() ?? props.aspect}` }}
                data-book-scroll-page={p.index}
            >
                <Show
                    when={face()?.kind !== 'missing'}
                    fallback={
                        <Text tone="muted" class={styles.missing}>
                            {`missing: ${(face() as { name?: string } | undefined)?.name ?? ''}`}
                        </Text>
                    }
                >
                    <canvas ref={el => (canvas = el)} class={styles.canvas} aria-label={`page ${p.index + 1}`} />
                </Show>
            </div>
        )
    }

    return (
        <div ref={root} class={[styles.scroll, props.class].filter(Boolean).join(' ')} onScroll={onScroll} data-book-scroll>
            <For each={props.leaves}>{(leaf, i) => <Page leaf={leaf} index={i()} />}</For>
        </div>
    )
}

export default BookScroll
