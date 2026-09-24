import { batch, createMemo, createSignal, onCleanup } from 'solid-js'
import { columnDropIndex } from './kanbanColumnOrder'
import {
    cardDropIndex,
    cardFlipTransform,
    columnFlipTransform,
    isAfterMidpoint,
    playFlipFrom,
    snapshotFlip,
} from './kanbanFlip'
import { isDismissKey } from '../ui/widgetKeys'

/** A committed card drop, read off the drag state at pointerup. `id`/`targetKey` are null when
 *  the drag never resolved a target; `from` is the column the card was lifted out of. */
export type KanbanCardDrop = {
    id: string | null
    insertAt: number
    targetKey: string | null
    from: string | null
}

export type KanbanDragOptions = {
    /** The board's root element — the scope every FLIP query runs against. */
    root: () => HTMLElement | undefined
    /** Drags only arm on an editable board. */
    editable: () => boolean
    /** The rendered column KEY order (optimistic order folded in) — the drop-gap placeholder
     *  resolves its slot against it. */
    columnKeys: () => string[]
    /** Commit a card move. Called (not awaited) on pointerup of a committed card drag. */
    dropCard: (drop: KanbanCardDrop) => Promise<void>
    /** Commit a column reorder: drop `from` beside `over`, AFTER it when `after`. */
    reorderColumns: (
        from: string,
        over: string,
        after: boolean,
    ) => Promise<void>
}

export type KanbanDrag = ReturnType<typeof createKanbanDrag>

/** The kanban's pointer-drag engine: card + column drag state, the arm/move/up handlers, the
 *  floating ghost, and the FLIP animations. KanbanView reads the returned accessors in its JSX
 *  and wires `startCardDrag`/`startColDrag` onto pointerdown; the writes a drop implies are the
 *  view's, handed in through `opts`. */
export function createKanbanDrag(opts: KanbanDragOptions) {
    const [overCol, setOverCol] = createSignal<string | null>(null)
    const [overIndex, setOverIndex] = createSignal(0)
    const [dragId, setDragId] = createSignal<string | null>(null)
    const [fromCol, setFromCol] = createSignal<string | null>(null)
    // Height of the card currently being dragged, so the drop placeholder is exactly its size
    // (not a fixed 46px). Projected onto the board as the `--kb-drag-h` CSS var.
    const [dragH, setDragH] = createSignal(46)

    // Column (header) drag-reorder state — distinct from card drag above.
    const [colDrag, setColDrag] = createSignal<string | null>(null)
    const [colOver, setColOver] = createSignal<string | null>(null)
    // Which half of the hovered column the cursor is in — drop AFTER it when true. Tracked live so
    // the drop-gap placeholder (below) and the eventual drop resolve to the exact same slot.
    const [colAfter, setColAfter] = createSignal(false)

    // FLIP (First-Last-Invert-Play): snapshot card rects, let Solid re-render, then
    // animate each card from its old position back to its new one. Without this the
    // placeholder pops open and the surrounding cards snap instantly — Trello slides.
    const prevRects = new Map<string, DOMRect>()
    function snapshotRects(): void {
        snapshotFlip(
            opts.root(),
            prevRects,
            '[data-kbcard][data-path]',
            el => el.dataset.path,
        )
    }
    function playFlip(): void {
        playFlipFrom(
            opts.root(),
            prevRects,
            '[data-kbcard][data-path]',
            el => el.dataset.path,
            cardFlipTransform,
            180,
        )
    }
    // Same FLIP, for whole COLUMNS on a header reorder (they only move horizontally).
    const prevColRects = new Map<string, DOMRect>()
    function snapshotColRects(): void {
        snapshotFlip(
            opts.root(),
            prevColRects,
            '[data-kbcol]',
            el => el.dataset.kbcol,
        )
    }
    function playColFlip(): void {
        playFlipFrom(
            opts.root(),
            prevColRects,
            '[data-kbcol]',
            el => el.dataset.kbcol,
            columnFlipTransform,
            200,
        )
    }

    function clearDrag(): void {
        batch(() => {
            setOverCol(null)
            setDragId(null)
            setFromCol(null)
            setColDrag(null)
            setColOver(null)
            setColAfter(false)
        })
    }

    // Tear any in-progress drag down if the view unmounts mid-drag (removes window listeners + ghost).
    onCleanup(() => endDrag())

    const dragActive = (): boolean => dragId() !== null

    // ── Column drop-gap placeholder ──
    // While a COLUMN header is being dragged, show a slim insertion bar in the slot the column will
    // land in — the horizontal analogue of the card `kanbanPlaceholder` gap (a card drag opens a gap;
    // a column drag opens a between-columns gap). `columnDropIndex` (pure, unit-tested) resolves the
    // insertion index among the OTHER columns from the hovered column + which half the cursor is in.
    const colDropIndex = (): number | null => {
        const from = colDrag()
        const over = colOver()
        if (from === null || over === null || over === from) return null
        return columnDropIndex(opts.columnKeys(), from, over, colAfter())
    }
    // The placeholder renders BEFORE the column at the drop index (or trailing when it lands last),
    // computed over the columns MINUS the dragged one so the index lines up with what's rendered.
    const colGap = createMemo(
        (): { before: string | null; trailing: boolean } => {
            const idx = colDropIndex()
            if (idx === null) return { before: null, trailing: false }
            const others = opts.columnKeys().filter(k => k !== colDrag())
            if (idx >= others.length) return { before: null, trailing: true }
            return { before: others[idx], trailing: false }
        },
    )

    // ── Pointer-based drag ──────────────────────────────────────────────────────────────────────
    // The packaged app runs in WKWebView, which has broken HTML5 drag-and-drop — so, like the rest of
    // Bismuth (dnd/viewDrag.ts drives the file tree), the kanban drags with POINTER events: arm on
    // pointerdown, commit past a small threshold, follow a cloned floating ghost, and resolve the drop
    // target under the cursor via elementFromPoint on the data-kbcol / data-kbcard attributes.
    const DRAG_THRESHOLD = 5
    let armMode: 'card' | 'col' | null = null
    let armId = ''
    let armColKey = ''
    let armOrigin = { x: 0, y: 0 }
    let armGrab = { dx: 0, dy: 0 }
    let armSourceEl: HTMLElement | null = null
    let ghostEl: HTMLElement | null = null

    function startCardDrag(e: PointerEvent, id: string, colKey: string): void {
        if (e.button !== 0 || !opts.editable()) return
        const t = e.target as HTMLElement
        if (t.closest('input, textarea, button') || t.isContentEditable) return // let fields/buttons work
        armMode = 'card'
        armId = id
        armColKey = colKey
        armSourceEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(
            '[data-kbcard]',
        )
        armPointer(e)
    }
    function startColDrag(e: PointerEvent, colKey: string): void {
        if (e.button !== 0 || !opts.editable()) return
        if ((e.target as HTMLElement).closest('button')) return // the color-dot picker button
        // AnchoredPopover portals its panel outside this header's DOM, but Solid delegates
        // pointerdown through the component tree, so a pointerdown inside the column menu's
        // popover (the rename TextInput, its padding) still reaches this handler — `closest`
        // above only exempts buttons. Bail on anything that isn't actually inside the header's
        // real DOM (the portaled popover content is outside it).
        if (!(e.currentTarget as Node).contains(e.target as Node)) return
        armMode = 'col'
        armColKey = colKey
        armSourceEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(
            '[data-kbcol]',
        )
        armPointer(e)
    }
    function armPointer(e: PointerEvent): void {
        if (!armSourceEl) {
            armMode = null
            return
        }
        const r = armSourceEl.getBoundingClientRect()
        armOrigin = { x: e.clientX, y: e.clientY }
        armGrab = { dx: e.clientX - r.left, dy: e.clientY - r.top }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', endDrag)
        window.addEventListener('keydown', onDragKey)
    }
    // A floating clone of the grabbed element that tracks the cursor (HTML5 DnD gave this for free).
    function beginGhost(): void {
        if (!armSourceEl) return
        const r = armSourceEl.getBoundingClientRect()
        const g = armSourceEl.cloneNode(true) as HTMLElement
        // Strip the data-* so the ghost isn't matched by the FLIP / drop-resolution queries.
        g.removeAttribute('data-kbcard')
        g.removeAttribute('data-path')
        g.removeAttribute('data-kbcol')
        g.querySelectorAll('[data-kbcard],[data-path]').forEach(n => {
            n.removeAttribute('data-kbcard')
            n.removeAttribute('data-path')
        })
        g.setAttribute('data-kbghost', '')
        Object.assign(g.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: `${r.width}px`,
            height: `${r.height}px`,
            margin: '0',
            pointerEvents: 'none',
            zIndex: '10000',
            opacity: '0.92',
            // A dragged card is genuinely floating (following the cursor above the board) —
            // the one legitimate elevation shadow in this view, read off the theme token.
            boxShadow: 'var(--lift)',
        } as CSSStyleDeclaration)
        document.body.appendChild(g)
        ghostEl = g
        moveGhost(armOrigin.x, armOrigin.y)
    }
    function moveGhost(x: number, y: number): void {
        if (ghostEl)
            ghostEl.style.transform = `translate(${x - armGrab.dx}px, ${y - armGrab.dy}px)`
    }
    function onPointerMove(e: PointerEvent): void {
        const committed = dragId() !== null || colDrag() !== null
        if (
            !committed &&
            Math.hypot(e.clientX - armOrigin.x, e.clientY - armOrigin.y) <
                DRAG_THRESHOLD
        )
            return
        e.preventDefault()
        if (!committed) {
            document.documentElement.classList.add('kb-dragging')
            beginGhost()
            if (armMode === 'card') {
                setDragH(armSourceEl ? armSourceEl.offsetHeight : 46)
                setFromCol(armColKey)
                setDragId(armId)
            } else {
                setColDrag(armColKey)
            }
        }
        moveGhost(e.clientX, e.clientY)
        if (armMode === 'card') resolveCardTarget(e.clientX, e.clientY)
        else resolveColTarget(e.clientX, e.clientY)
    }
    function resolveCardTarget(x: number, y: number): void {
        const colEl = (
            document.elementFromPoint(x, y) as HTMLElement | null
        )?.closest<HTMLElement>('[data-kbcol]')
        if (!colEl) return // off the board — keep the last valid slot
        const key = colEl.dataset.kbcol ?? ''
        const cardEls = [
            ...colEl.querySelectorAll<HTMLElement>('[data-kbcard]'),
        ].filter(el => el.getAttribute('data-path') !== dragId())
        const idx = cardDropIndex(cardEls, el => el.getBoundingClientRect(), y)
        const moved = overCol() !== key || overIndex() !== idx
        if (moved) snapshotRects()
        batch(() => {
            setOverCol(key)
            setOverIndex(idx)
        })
        if (moved) requestAnimationFrame(playFlip)
    }
    function resolveColTarget(x: number, y: number): void {
        const colEl = (
            document.elementFromPoint(x, y) as HTMLElement | null
        )?.closest<HTMLElement>('[data-kbcol]')
        if (!colEl) return // off the board — keep the last valid target so the placeholder holds
        const r = colEl.getBoundingClientRect()
        batch(() => {
            setColOver(colEl.dataset.kbcol ?? null)
            setColAfter(isAfterMidpoint(x, r))
        })
    }
    function onPointerUp(): void {
        if (armMode === 'card' && dragId() !== null) {
            void opts.dropCard({
                id: dragId(),
                insertAt: overIndex(),
                targetKey: overCol(),
                from: fromCol(),
            })
        } else if (armMode === 'col' && colDrag() !== null) {
            // Drop where the placeholder is showing — reuse the live-tracked target/half (set by
            // resolveColTarget on every move) so the column lands exactly in the gap the user saw.
            const from = colDrag()
            const over = colOver()
            if (from !== null && over !== null)
                void opts.reorderColumns(from, over, colAfter())
        }
        endDrag()
    }
    function onDragKey(e: KeyboardEvent): void {
        if (isDismissKey(e)) endDrag()
    }
    function endDrag(): void {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', endDrag)
        window.removeEventListener('keydown', onDragKey)
        document.documentElement.classList.remove('kb-dragging')
        if (ghostEl) {
            ghostEl.remove()
            ghostEl = null
        }
        armMode = null
        armSourceEl = null
        clearDrag()
    }

    return {
        overCol,
        overIndex,
        dragId,
        dragH,
        colDrag,
        colOver,
        colGap,
        dragActive,
        startCardDrag,
        startColDrag,
        snapshotRects,
        playFlip,
        snapshotColRects,
        playColFlip,
    }
}
