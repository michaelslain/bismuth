import { createEffect, createMemo, createSignal, Index, onCleanup, Show, type Component } from 'solid-js'
import type { AnnotationStore } from '../preview/annotationTypes'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import {
    fitImage,
    logicalToScreen,
    logicalToScreenScale,
    pageBoxFor,
    screenToLogical,
} from '../../../core/src/drawing/pageInk'
import {
    addHighlight,
    highlightAt,
    removeHighlight,
    resolveHighlightColor,
    restoreHighlight,
} from '../../../core/src/drawing/pageHighlights'
import { pushUndoToast } from '../undoToast'
import { isClick, setHighlightCursor, singleClick } from '../preview/highlightClick'
import type { PageSlot } from './bookPageStores'
import { regionInImage } from './bookRegion'
import styles from './BookHighlightLayer.module.css'

export type BookHighlightLayerProps = {
    /** The pages on screen, in the layer's pixels. */
    slots: PageSlot[]
    /** The live store of a page file. */
    store: (file: string) => AnnotationStore | undefined
    /** The highlight button is armed: a drag draws a box, a click on a box removes it. */
    armed: boolean
    /** The colour a new box stores (a PDF_HIGHLIGHT_COLORS `c`). */
    color: string
    /** Every edit goes through the book, which keeps the Mod+Z order. */
    edit: (file: string, fn: (d: DrawingDoc) => DrawingDoc) => void
    /** A box was made or removed while armed: the button disarms. */
    onHighlighted: () => void
    /** A new box, as fractions of the page image (0..1, origin top-left). */
    onRegion?: (e: { leaf: number; region: { x: number; y: number; w: number; h: number } }) => void
    className?: string
}

/** Pointer travel under which a press is a click, not a box. */
const SLOP = 4

type Painted = { key: string; id: string; left: number; top: number; w: number; h: number; color: string }
type Draft = { slot: PageSlot; x0: number; y0: number; x1: number; y1: number; id: number }

/** Highlight boxes over the pages of the still spread. Painting is unconditional; drawing only
 *  happens while armed. A box is removed by a click, armed or not; unarmed, the pointer over a box shows
 *  the delete cursor (highlightClick.ts). A box lives in the 816x1056 logical page space of the page
 *  file's sidecar, in the same box the PDF preview uses: a PDF's fit box, or the sidecar's own. */
const BookHighlightLayer: Component<BookHighlightLayerProps> = props => {
    let host!: HTMLDivElement
    const [draft, setDraft] = createSignal<Draft | null>(null)
    /** `file#id` of the highlight under the pointer (unarmed, no press): its boxes deepen. */
    const [hovered, setHovered] = createSignal<string | null>(null)

    const boxFor = (slot: PageSlot, store: AnnotationStore) =>
        store.highlightStore() === 'pdf'
            ? fitImage(slot.nat.w, slot.nat.h)
            : pageBoxFor(store.doc() ?? emptyDoc(), slot.docPage, slot.nat.w, slot.nat.h)

    const painted = createMemo<Painted[]>(() => {
        const out: Painted[] = []
        for (const slot of props.slots) {
            const store = props.store(slot.file)
            const highlights = store?.doc()?.pages[slot.docPage]?.highlights
            if (!store || !highlights?.length) continue
            const box = boxFor(slot, store)
            const k = logicalToScreenScale(slot.rendered, box)
            for (const h of highlights) {
                const color = resolveHighlightColor(h.c)
                h.rects.forEach((r, i) => {
                    const p = logicalToScreen({ x: r.x, y: r.y }, slot.rendered, box)
                    out.push({ key: `${h.id}-${i}`, id: `${slot.file}#${h.id}`, left: p.x, top: p.y, w: r.w * k, h: r.h * k, color })
                })
            }
        }
        return out
    })

    const local = (e: PointerEvent) => {
        const r = host.getBoundingClientRect()
        return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const slotAt = (pt: { x: number; y: number }) =>
        props.slots.find(s => {
            const r = s.rendered
            return pt.x >= r.left && pt.x <= r.left + r.w && pt.y >= r.top && pt.y <= r.top + r.h
        })
    const clamp = (s: PageSlot, pt: { x: number; y: number }) => ({
        x: Math.min(Math.max(pt.x, s.rendered.left), s.rendered.left + s.rendered.w),
        y: Math.min(Math.max(pt.y, s.rendered.top), s.rendered.top + s.rendered.h),
    })

    const onPointerDown = (e: PointerEvent) => {
        if (!props.armed || e.button !== 0) return
        // The book's own gestures (turning by dragging a page) must not see this press.
        e.stopPropagation()
        const pt = local(e)
        const slot = slotAt(pt)
        if (!slot) return
        // A drag before the sidecar has loaded would write marks the doc has no page box for.
        const store = props.store(slot.file)
        if (store?.loadState() !== 'ready') return
        // A PDF's own highlights must be in first, or the new box lands beside a set it replaces.
        if (/\.pdf$/i.test(slot.file) && store.highlightsSettled?.() === false) return
        try {
            host.setPointerCapture(e.pointerId)
        } catch {
            // a synthetic pointer has nothing to capture
        }
        setDraft({ slot, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, id: e.pointerId })
    }
    const onPointerMove = (e: PointerEvent) => {
        const d = draft()
        if (!d || e.pointerId !== d.id) return
        e.stopPropagation()
        const p = clamp(d.slot, local(e))
        setDraft({ ...d, x1: p.x, y1: p.y })
    }
    const onPointerUp = (e: PointerEvent) => {
        const d = draft()
        if (!d || e.pointerId !== d.id) return
        e.stopPropagation()
        setDraft(null)
        const store = props.store(d.slot.file)
        if (!store) return
        const { slot } = d
        const box = boxFor(slot, store)
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < SLOP) {
            const at = screenToLogical({ x: d.x0, y: d.y0 }, slot.rendered, box)
            const hit = highlightAt(store.doc(), slot.docPage, at)
            if (!hit) return
            props.edit(slot.file, doc => removeHighlight(doc, slot.docPage, hit.id))
            props.onHighlighted()
            return
        }
        const a = screenToLogical({ x: d.x0, y: d.y0 }, slot.rendered, box)
        const b = screenToLogical({ x: d.x1, y: d.y1 }, slot.rendered, box)
        const rect = {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x),
            h: Math.abs(b.y - a.y),
        }
        props.edit(slot.file, doc => addHighlight(doc, slot.docPage, [rect], { c: props.color }))
        props.onRegion?.({
            leaf: slot.leaf,
            region: regionInImage(rect, fitImage(slot.nat.w, slot.nat.h)),
        })
        props.onHighlighted()
    }

    // ── Removing without arming: hover shows the delete cursor, a click deletes ───────────────
    // The layer takes no pointer events while unarmed (page turns pass through it), so the pointer
    // is followed on the window and hit-tested against the boxes here.
    const click = singleClick()
    onCleanup(() => {
        click.cancel()
        setHighlightCursor(false)
    })

    const hitAt = (clientX: number, clientY: number) => {
        const r = host.getBoundingClientRect()
        const pt = { x: clientX - r.left, y: clientY - r.top }
        const slot = slotAt(pt)
        const store = slot && props.store(slot.file)
        if (!slot || !store) return null
        const hit = highlightAt(store.doc(), slot.docPage, screenToLogical(pt, slot.rendered, boxFor(slot, store)))
        return hit ? { file: slot.file, docPage: slot.docPage, id: hit.id } : null
    }

    const remove = (file: string, docPage: number, id: string) => {
        const list = props.store(file)?.doc()?.pages[docPage]?.highlights ?? []
        const index = list.findIndex(h => h.id === id)
        const gone = list[index]
        setHighlightCursor(false)
        setHovered(null)
        if (!gone) return
        props.edit(file, doc => removeHighlight(doc, docPage, id))
        pushUndoToast('highlight removed', () => props.edit(file, doc => restoreHighlight(doc, docPage, gone, index)))
    }

    createEffect(() => {
        if (props.armed) {
            click.cancel()
            setHighlightCursor(false)
            return
        }
        let down: { x: number; y: number } | null = null
        let over = false
        const onMove = (e: PointerEvent) => {
            // a press in progress is a page being dragged, not a hover
            const hit = e.buttons === 0 ? hitAt(e.clientX, e.clientY) : null
            const now = !!hit
            setHovered(hit ? `${hit.file}#${hit.id}` : null)
            if (now !== over) setHighlightCursor((over = now))
        }
        const onDown = (e: PointerEvent) => {
            click.press()
            down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
        }
        const onUp = (e: PointerEvent) => {
            const d = down
            down = null
            if (!d || !isClick(d, { x: e.clientX, y: e.clientY })) return
            const hit = hitAt(e.clientX, e.clientY)
            if (hit) click.schedule(() => remove(hit.file, hit.docPage, hit.id))
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerdown', onDown)
        window.addEventListener('pointerup', onUp)
        onCleanup(() => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointerup', onUp)
            if (over) setHighlightCursor(false)
            setHovered(null)
        })
    })

    const draftStyle = () => {
        const d = draft()!
        return {
            left: `${Math.min(d.x0, d.x1)}px`,
            top: `${Math.min(d.y0, d.y1)}px`,
            width: `${Math.abs(d.x1 - d.x0)}px`,
            height: `${Math.abs(d.y1 - d.y0)}px`,
            'background-color': resolveHighlightColor(props.color),
        }
    }

    return (
        <div
            ref={host}
            class={[styles.layer, props.armed ? styles.armed : '', props.className ?? ''].filter(Boolean).join(' ')}
            data-book-highlights
            data-armed={props.armed ? '' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDraft(null)}
        >
            <Index each={painted()}>
                {p => (
                    <div
                        class={styles.rect}
                        classList={{ [styles.hover]: hovered() === p().id }}
                        data-book-highlight-rect
                        style={{
                            left: `${p().left}px`,
                            top: `${p().top}px`,
                            width: `${p().w}px`,
                            height: `${p().h}px`,
                            'background-color': p().color,
                        }}
                    />
                )}
            </Index>
            <Show when={draft()}>
                <div class={styles.draft} data-book-highlight-draft style={draftStyle()} />
            </Show>
        </div>
    )
}

export default BookHighlightLayer
