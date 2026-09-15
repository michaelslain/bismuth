// app/src/preview/HighlightLayer.tsx
// In-place PDF text highlights. Mounted by PreviewView INSIDE PdfPages' `overlay`, BEFORE
// PageInk (so ink paints above highlights) — the two share the same host coordinate space
// PageInk.tsx documents: `inset: 0` over the element that positions the pages (PdfPages' scroll
// content for a PDF).
//
// Painting is unconditional (every highlight in the store's doc, on every page PdfPages laid
// out) — highlights are visible whether or not draw/highlight mode is active, same as ink.
// `active()` gates ONLY the interaction: creating a highlight from a text selection, and
// removing one with a collapsed click. Both listen on `contentEl` (the scroll content PdfPages
// hands back via its own `onLayout`'s `scrollEl`), not on this layer's own host — the host stays
// `pointer-events: none` always, so text selection and scrolling are never blocked by it.
//
// THE GEOMETRY (core/src/drawing/pageInk.ts owns the math, same as PageInk): a highlight's rects
// live in the sidecar's 816x1056 logical page space; `pageBoxFor` resolves the box source page
// `i` occupies inside it; `logicalToScreen`/`screenToLogical` convert through a page's `rendered`
// rect (host px). `selectionRects.ts`'s `rectsToPages` is the same conversion run the other way,
// for a browser selection's client rects.
import { createEffect, createMemo, For, onCleanup } from 'solid-js'
import type { AnnotationStore } from './annotationTypes'
import type { PageInkPage } from './PageInk'
import {
    logicalToScreen,
    logicalToScreenScale,
    pageBoxFor,
    screenToLogical,
} from '../../../core/src/drawing/pageInk'
import {
    addHighlight,
    highlightAt,
    mergeLineRects,
    removeHighlight,
    resolveHighlightColor,
} from '../../../core/src/drawing/pageHighlights'
import { emptyDoc } from '../../../core/src/drawing/model'
import { rectsToPages } from './selectionRects'
import styles from './HighlightLayer.module.css'

export type HighlightLayerProps = {
    store: AnnotationStore
    pages: () => PageInkPage[]
    /** Highlight mode: gates the pointerup listener on `contentEl`, same as PageInk's own
     *  `active`. Painting itself is unconditional. */
    active: () => boolean
    /** The element selection/click listeners attach to — PdfPages' scroll content (an ancestor
     *  of every page's pdf.js text layer), NOT this layer's own host. */
    contentEl: () => HTMLElement | undefined
    class?: string
}

type PaintedRect = {
    key: string
    left: number
    top: number
    w: number
    h: number
    color: string
}

function HighlightLayer(props: HighlightLayerProps) {
    let hostRef: HTMLDivElement | undefined

    // `pageBoxFor` needs A DrawingDoc even to compute the FIT box for a page with no stored
    // legacy image — never null-checked at every call site, so a shared fallback here instead.
    const docOrEmpty = () => props.store.doc() ?? emptyDoc()

    const boxFor = (i: number, page: PageInkPage) =>
        pageBoxFor(docOrEmpty(), i, page.nat.w, page.nat.h)

    // ── Painting (unconditional — see header) ─────────────────────────────────────────────────
    const painted = createMemo<PaintedRect[]>(() => {
        const doc = docOrEmpty()
        const pages = props.pages()
        const out: PaintedRect[] = []
        pages.forEach((page, i) => {
            const highlights = doc.pages[i]?.highlights
            if (!highlights?.length) return
            const box = boxFor(i, page)
            for (const h of highlights) {
                const color = resolveHighlightColor(h.c)
                h.rects.forEach((r, ri) => {
                    const topLeft = logicalToScreen(
                        { x: r.x, y: r.y },
                        page.rendered,
                        box,
                    )
                    const k = logicalToScreenScale(page.rendered, box)
                    out.push({
                        key: `${h.id}-${ri}`,
                        left: topLeft.x,
                        top: topLeft.y,
                        w: r.w * k,
                        h: r.h * k,
                        color,
                    })
                })
            }
        })
        return out
    })

    // ── Interaction (active() only) ────────────────────────────────────────────────────────────
    /** The page whose rendered rect (host px) contains `pt` (host px), else -1. */
    const pageAt = (pt: { x: number; y: number }): number =>
        props.pages().findIndex(p => {
            const r = p.rendered
            return (
                pt.x >= r.left &&
                pt.x <= r.left + r.w &&
                pt.y >= r.top &&
                pt.y <= r.top + r.h
            )
        })

    const handleSelection = (sel: Selection, hostOrigin: { left: number; top: number }) => {
        if (sel.rangeCount === 0) return
        const contentEl = props.contentEl()
        const range = sel.getRangeAt(0)
        if (contentEl && !contentEl.contains(range.commonAncestorContainer)) {
            return
        }
        const text = sel.toString()
        if (!text) return
        const clientRects = Array.from(range.getClientRects())
        const pages = props.pages()
        const byPage = rectsToPages(clientRects, hostOrigin, pages, i =>
            boxFor(i, pages[i]!),
        )
        if (byPage.size === 0) return
        props.store.edit(d => {
            let next = d
            for (const [page, rects] of byPage) {
                next = addHighlight(next, page, mergeLineRects(rects), { text })
            }
            return next
        })
        sel.removeAllRanges()
    }

    const handleClick = (
        e: PointerEvent,
        hostOrigin: { left: number; top: number },
    ) => {
        const pt = { x: e.clientX - hostOrigin.left, y: e.clientY - hostOrigin.top }
        const pageIndex = pageAt(pt)
        if (pageIndex === -1) return
        const page = props.pages()[pageIndex]!
        const box = boxFor(pageIndex, page)
        const logical = screenToLogical(pt, page.rendered, box)
        const hit = highlightAt(props.store.doc(), pageIndex, logical)
        if (!hit) return
        props.store.edit(d => removeHighlight(d, pageIndex, hit.id))
    }

    createEffect(() => {
        if (!props.active()) return
        const el = props.contentEl()
        if (!el || !hostRef) return
        const host = hostRef
        const onPointerUp = (e: PointerEvent) => {
            const sel = window.getSelection()
            if (!sel) return
            const hostOrigin = host.getBoundingClientRect()
            if (sel.isCollapsed) {
                handleClick(e, hostOrigin)
            } else {
                handleSelection(sel, hostOrigin)
            }
        }
        el.addEventListener('pointerup', onPointerUp)
        onCleanup(() => el.removeEventListener('pointerup', onPointerUp))
    })

    return (
        <div
            ref={el => (hostRef = el)}
            class={`${styles['highlight-layer']} ${props.class ?? ''}`}
            data-testid="highlight-layer"
        >
            <For each={painted()}>
                {p => (
                    <div
                        class={styles.rect}
                        data-testid="highlight-rect"
                        style={{
                            left: `${p.left}px`,
                            top: `${p.top}px`,
                            width: `${p.w}px`,
                            height: `${p.h}px`,
                            'background-color': p.color,
                        }}
                    />
                )}
            </For>
        </div>
    )
}

export default HighlightLayer
