import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Component, type JSX } from 'solid-js'
import TranscriptPage, { type TranscriptPageHandle } from './TranscriptPage'
import type { TranscriptCheck } from '../../../core/src/transcript'
import { estimateHeight, indexAt, offsetOf, planWindow } from './transcriptDocWindow'
import styles from './TranscriptDoc.module.css'

export type TranscriptDocPage = {
    key: string
    label?: string
    text: string
    status?: JSX.Element
    /** the page's review checks, their approve and their scan strip (TranscriptPage's props) */
    checks?: TranscriptCheck[]
    onApprove?: (line: string) => void
    crop?: (line: string) => JSX.Element | undefined
}
export type TranscriptDocProps = {
    pages: TranscriptDocPage[]
    onSave: (key: string, text: string) => void
    /** scroll so this page's section is at the top */
    at?: { key: string; frac?: number }
    onAt?: (at: { key: string; frac: number }) => void
    pageRef?: (key: string, handle: TranscriptPageHandle | undefined) => void
    fontFamily?: string
    textScale?: number
    onContextMenu?: (e: MouseEvent, key: string, selection: string) => void
    className?: string
}

const OVERSCAN_VIEWPORTS = 1
const DEFAULT_VIEWPORT = 800

/** Text mode: every page's section in one scrolling column, note width and centred. Only the
 *  sections near the viewport (and the one holding focus) mount an editor; the rest hold their last
 *  measured height, so scrolling a 300-page book mounts a handful of editors, not 300. */
const TranscriptDoc: Component<TranscriptDocProps> = props => {
    let scroller!: HTMLDivElement
    let column!: HTMLDivElement
    // Section offsets start below the column's top padding.
    const pad = () => parseFloat(getComputedStyle(column).paddingTop) || 0
    const [scrollTop, setScrollTop] = createSignal(0)
    const [viewport, setViewport] = createSignal(DEFAULT_VIEWPORT)
    // Measured section heights, by key; a version signal because the map itself is not reactive.
    const measured = new Map<string, number>()
    const [rev, setRev] = createSignal(0)
    // First paint mounts only what is in view; the margin around it mounts a frame later.
    const [settled, setSettled] = createSignal(false)
    const [focused, setFocused] = createSignal<string>()
    const sections = new Map<string, HTMLElement>()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
        let changed = false
        for (const e of entries) {
            const key = (e.target as HTMLElement).dataset.pageKey
            if (!key || !e.target.isConnected) continue
            const h = (e.target as HTMLElement).offsetHeight
            if (h > 0 && measured.get(key) !== h) {
                measured.set(key, h)
                changed = true
            }
        }
        if (changed) setRev(r => r + 1)
    })

    const plan = createMemo(() => {
        rev()
        const pages = props.pages
        const scale = props.textScale ?? 1
        return planWindow({
            count: pages.length,
            heights: pages.map(p => measured.get(p.key)),
            estimate: i => estimateHeight(pages[i].text, { divider: 25, line: 22 * scale, charsPerLine: Math.floor(70 / scale), min: 60 }) + 16,
            scrollTop: scrollTop(),
            viewport: viewport(),
            overscan: settled() ? viewport() * OVERSCAN_VIEWPORTS : 0,
        })
    })

    const mounted = (i: number) => {
        const p = plan()
        const key = props.pages[i].key
        return (i >= p.from && i < p.to) || key === focused()
    }

    // The section at the top of the view and how far into it the view is: when sections above fill
    // in and grow, the view is put back on this spot (the CSS anchoring is off, and WKWebView has none).
    let anchor = { index: 0, px: 0 }
    // At the end of the column the view stays at the end as the last sections measure, as a native scroller would.
    let atEnd = false
    // The scrollTop and offsets the anchor was last reconciled against; a scroll the browser has not
    // reported yet shows as a scrollTop that differs from `lastTop`.
    let lastTops = plan().tops
    let lastTop = 0
    const noteAnchor = (tops: number[]) => {
        const top = scroller.scrollTop
        atEnd = top > 0 && top + scroller.clientHeight >= scroller.scrollHeight - 1
        const { index } = indexAt(tops, top - pad())
        anchor = { index, px: top - pad() - tops[index] }
        lastTops = tops
        lastTop = top
    }
    // A scrollTop the browser moved on its own (the column got shorter than the spot we hold, so it
    // clamped) is not the reader scrolling: the anchor stays and is restored when the column grows.
    const reconcile = () => {
        const top = scroller.scrollTop
        if (top === lastTop) return
        const max = scroller.scrollHeight - scroller.clientHeight
        if (lastTop > max + 1 && Math.abs(top - max) <= 1) lastTop = top
        else noteAnchor(lastTops)
    }
    const restore = (tries: number) => {
        const y = atEnd ? scroller.scrollHeight - scroller.clientHeight : plan().tops[anchor.index] + anchor.px + pad()
        if (Number.isFinite(y) && Math.abs(scroller.scrollTop - y) > 1) scroller.scrollTop = y
        // The window follows what the browser kept.
        setScrollTop(scroller.scrollTop)
        lastTops = plan().tops
        lastTop = scroller.scrollTop
        if (Math.abs(lastTop - y) > 1 && tries > 0) requestAnimationFrame(() => restore(tries - 1))
    }
    createEffect(
        on(
            plan,
            () => {
                reconcile()
                restore(3)
            },
            { defer: true },
        ),
    )

    let frame = 0
    const onScroll = () => {
        reconcile()
        if (frame) return
        frame = requestAnimationFrame(() => {
            frame = 0
            setScrollTop(scroller.scrollTop)
            if (!props.onAt || props.pages.length === 0) return
            const { index, frac } = indexAt(plan().tops, scroller.scrollTop - pad())
            props.onAt({ key: props.pages[index].key, frac })
        })
    }

    onMount(() => {
        const settle = setTimeout(() => setSettled(true), 0)
        onCleanup(() => clearTimeout(settle))
        setViewport(scroller.clientHeight || DEFAULT_VIEWPORT)
        const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => setViewport(scroller.clientHeight || DEFAULT_VIEWPORT))
        ro?.observe(scroller)
        onCleanup(() => ro?.disconnect())
    })
    onCleanup(() => {
        observer?.disconnect()
        if (frame) cancelAnimationFrame(frame)
    })

    // Scroll to `at`; once more after the sections it passes over have mounted and measured.
    const goTo = (at: NonNullable<TranscriptDocProps['at']>) => {
        const i = props.pages.findIndex(p => p.key === at.key)
        if (i < 0) return
        const y = offsetOf(plan().tops, i, at.frac ?? 0) + pad()
        if (Math.abs(scroller.scrollTop - y) > 1) scroller.scrollTop = y
        setScrollTop(scroller.scrollTop)
        anchor = { index: i, px: y - pad() - plan().tops[i] }
        atEnd = false
        lastTops = plan().tops
        lastTop = scroller.scrollTop
    }
    createEffect(
        on(
            () => props.at,
            at => {
                if (!at) return
                goTo(at)
                requestAnimationFrame(() => goTo(at))
            },
        ),
    )

    return (
        <div
            ref={scroller}
            class={`${styles.doc} ${props.className ?? ''}`.trim()}
            onScroll={onScroll}
        >
            <div ref={column} class={styles.column}>
                <For each={props.pages}>
                    {(page, i) => (
                        <section
                            class={styles.section}
                            data-page-key={page.key}
                            ref={el => {
                                sections.set(page.key, el)
                                observer?.observe(el)
                                onCleanup(() => {
                                    sections.delete(page.key)
                                    observer?.unobserve(el)
                                })
                            }}
                            onFocusIn={() => setFocused(page.key)}
                            onFocusOut={() => setFocused(f => (f === page.key ? undefined : f))}
                        >
                            <Show
                                when={mounted(i())}
                                fallback={
                                    <div class={styles.pending} style={{ height: `${plan().tops[i() + 1] - plan().tops[i()]}px` }}>
                                        <TranscriptPage pending label={page.label} status={page.status} text="" onSave={() => {}} />
                                    </div>
                                }
                            >
                                <TranscriptPage
                                    label={page.label}
                                    text={page.text}
                                    status={page.status}
                                    checks={page.checks}
                                    onApprove={page.onApprove}
                                    crop={page.crop}
                                    onSave={text => props.onSave(page.key, text)}
                                    ref={handle => {
                                        props.pageRef?.(page.key, handle)
                                        onCleanup(() => props.pageRef?.(page.key, undefined))
                                    }}
                                    fontFamily={props.fontFamily}
                                    textScale={props.textScale}
                                    onContextMenu={(e, selection) => props.onContextMenu?.(e, page.key, selection)}
                                />
                            </Show>
                        </section>
                    )}
                </For>
            </div>
        </div>
    )
}

export default TranscriptDoc
