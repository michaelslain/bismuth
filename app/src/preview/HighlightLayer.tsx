// app/src/preview/HighlightLayer.tsx
// In-place PDF text highlights. Mounted by PreviewView INSIDE PdfPages' `overlay`, BEFORE
// PageInk (so ink paints above highlights) — the two share the same host coordinate space
// PageInk.tsx documents: `inset: 0` over the element that positions the pages (PdfPages' scroll
// content for a PDF).
//
// Painting is unconditional (every highlight in the store's doc, on every page PdfPages laid
// out) — highlights are visible whether or not the highlight button is armed, same as ink.
//
// HIGHLIGHT IS ONE-SHOT, NOT A MODE (the user: "just press a button and highlight, then it turns
// off waiting for the next button click"). Two ways in, both ending in `onHighlighted()`:
//   • `controller.highlightSelection()` — PreviewView calls it when the button is pressed WITH a
//     text selection already inside the PDF: highlight it now, clear it, report true.
//   • `armed()` — the button was pressed with NO selection. The next pointerup on `contentEl`
//     highlights a non-empty selection, or removes the highlight under a collapsed click; either
//     edit calls `onHighlighted()` so PreviewView disarms. A pointerup that does neither (a stray
//     click on bare paper) leaves it armed.
// Both listen on/read `contentEl` (the scroll content PdfPages hands back via its own `onLayout`'s
// `scrollEl`), not on this layer's own host — the host stays `pointer-events: none` always, so
// text selection and scrolling are never blocked by it.
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
    /** The highlight button is armed: gates the pointerup listener on `contentEl`. Painting
     *  itself is unconditional. */
    armed: () => boolean
    /** Called after a highlight is created or removed while armed — PreviewView disarms on it. */
    onHighlighted: () => void
    /** Handed once at setup: `highlightSelection` highlights the current in-PDF selection, clears
     *  it and returns true; returns false (and edits nothing) when there is none. */
    controller?: (c: { highlightSelection: () => boolean }) => void
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

    // ── Interaction (armed() or the controller) ────────────────────────────────────────────────
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

    /** Highlights `sel` when it is a non-empty selection inside `contentEl` that lands on at least
     *  one laid-out page. True when it edited the store. */
    const handleSelection = (
        sel: Selection,
        hostOrigin: { left: number; top: number },
    ): boolean => {
        if (sel.rangeCount === 0 || sel.isCollapsed) return false
        const contentEl = props.contentEl()
        // No content element yet means the PDF has not laid out — nothing to highlight against.
        if (!contentEl) return false
        const range = sel.getRangeAt(0)
        if (!contentEl.contains(range.commonAncestorContainer)) return false
        const text = sel.toString()
        if (!text) return false
        const clientRects = Array.from(range.getClientRects())
        const pages = props.pages()
        const byPage = rectsToPages(clientRects, hostOrigin, pages, i =>
            boxFor(i, pages[i]!),
        )
        if (byPage.size === 0) return false
        props.store.edit(d => {
            let next = d
            for (const [page, rects] of byPage) {
                next = addHighlight(next, page, mergeLineRects(rects), { text })
            }
            return next
        })
        sel.removeAllRanges()
        return true
    }

    /** Removes the highlight under a collapsed click. True when it edited the store. */
    const handleClick = (
        e: PointerEvent,
        hostOrigin: { left: number; top: number },
    ): boolean => {
        const pt = { x: e.clientX - hostOrigin.left, y: e.clientY - hostOrigin.top }
        const pageIndex = pageAt(pt)
        if (pageIndex === -1) return false
        const page = props.pages()[pageIndex]!
        const box = boxFor(pageIndex, page)
        const logical = screenToLogical(pt, page.rendered, box)
        const hit = highlightAt(props.store.doc(), pageIndex, logical)
        if (!hit) return false
        props.store.edit(d => removeHighlight(d, pageIndex, hit.id))
        return true
    }

    props.controller?.({
        highlightSelection: () => {
            const sel = window.getSelection()
            if (!sel || !hostRef) return false
            return handleSelection(sel, hostRef.getBoundingClientRect())
        },
    })

    createEffect(() => {
        if (!props.armed()) return
        const el = props.contentEl()
        if (!el || !hostRef) return
        const host = hostRef
        const onPointerUp = (e: PointerEvent) => {
            const sel = window.getSelection()
            if (!sel) return
            const hostOrigin = host.getBoundingClientRect()
            const edited = sel.isCollapsed
                ? handleClick(e, hostOrigin)
                : handleSelection(sel, hostOrigin)
            if (edited) props.onHighlighted()
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
