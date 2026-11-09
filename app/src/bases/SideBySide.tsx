// app/src/bases/SideBySide.tsx
// Page image on the left, that page's text on the right, one scroller. It knows neither the page
// loader nor the transcript: a row brings its own image and text through render functions.
import { For, Show, createEffect, createSignal, on, onCleanup, type Component, type JSX } from 'solid-js'
import styles from './SideBySide.module.css'

export type SideBySideRow = {
    key: string
    image: () => JSX.Element
    text: () => JSX.Element
    aspect: number
    /** built but not shown: a flipped page's neighbour, waiting for its turn */
    hidden?: boolean
}

export type SideBySideProps = {
    rows: SideBySideRow[]
    /** A page at a time: the picture fits the pane and stays, and only the text scrolls. */
    flip?: boolean
    /** scroll to this row (and a fraction down it) when it changes */
    at?: { key: string; frac?: number }
    /** the row at the top of the scroller, and how far through it, as the user scrolls */
    onAt?: (at: { key: string; frac: number }) => void
    className?: string
}

const SideBySide: Component<SideBySideProps> = props => {
    let scroller!: HTMLDivElement
    let programmatic = false

    const rowEls = () => [...scroller.querySelectorAll<HTMLElement>('[data-row-key]')]

    const onScroll = () => {
        if (programmatic) return
        const top = scroller.getBoundingClientRect().top
        const els = rowEls()
        let cur: HTMLElement | undefined
        for (const el of els) {
            if (el.getBoundingClientRect().bottom > top + 1) {
                cur = el
                break
            }
        }
        cur ??= els[els.length - 1]
        if (!cur) return
        const r = cur.getBoundingClientRect()
        const frac = r.height > 0 ? Math.min(1, Math.max(0, (top - r.top) / r.height)) : 0
        props.onAt?.({ key: cur.dataset.rowKey!, frac })
    }

    createEffect(
        on(
            () => [props.at?.key, props.at?.frac, props.rows.length] as const,
            ([key, frac]) => {
                if (key === undefined) return
                const el = rowEls().find(e => e.dataset.rowKey === key)
                if (!el) return
                if (props.flip) {
                    // flipped, the text column is what scrolls; once more after its editor has laid out
                    const text = el.querySelector<HTMLElement>('[data-side-text]')!
                    const place = () => (text.scrollTop = (frac ?? 0) * text.scrollHeight)
                    programmatic = true
                    place()
                    requestAnimationFrame(() => {
                        place()
                        requestAnimationFrame(() => (programmatic = false))
                    })
                    return
                }
                const target = el.offsetTop + (frac ?? 0) * el.offsetHeight
                programmatic = true
                scroller.scrollTop = target
                requestAnimationFrame(() => (programmatic = false))
            },
        ),
    )

    return (
        <div class={`${styles.scroller} ${props.flip ? styles.flip : ''} ${props.className ?? ''}`} ref={scroller} onScroll={onScroll} data-side-by-side>
            <For each={props.rows}>
                {row => {
                    // the text (an editor) mounts when its row first nears the view; the image row holds the height until then
                    const [near, setNear] = createSignal(false)
                    const watch = (el: HTMLElement) => {
                        const io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && setNear(true), {
                            root: scroller,
                            rootMargin: '1200px 0px',
                        })
                        io.observe(el)
                        onCleanup(() => io.disconnect())
                    }
                    let textEl!: HTMLDivElement
                    const onTextScroll = () => {
                        if (!props.flip || row.hidden || programmatic) return
                        const h = textEl.scrollHeight
                        props.onAt?.({ key: row.key, frac: h > 0 ? Math.min(1, textEl.scrollTop / h) : 0 })
                    }
                    // a page turned back to starts at its top again
                    createEffect(on(() => row.hidden, hidden => !hidden && (textEl.scrollTop = 0), { defer: true }))
                    return (
                        <div
                            ref={watch}
                            class={styles.row}
                            classList={{ [styles.hidden]: !!row.hidden }}
                            data-row-key={row.hidden ? undefined : row.key}
                        >
                            <div class={styles.cell}>
                                <div class={styles.image} style={{ '--aspect': String(row.aspect) } as JSX.CSSProperties}>
                                    {row.image()}
                                </div>
                            </div>
                            <div ref={textEl} class={styles.text} data-side-text onScroll={onTextScroll}>
                                <Show when={near() || props.flip}>{row.text()}</Show>
                            </div>
                        </div>
                    )
                }}
            </For>
        </div>
    )
}

export default SideBySide
