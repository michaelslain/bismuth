// app/src/editor/InkOverlay.tsx
// Draw-anywhere note ink: a transparent stroke layer over the CodeMirror editor. Rendered by
// Editor.tsx inside its `wrapper` (position:relative), covering the editor viewport with two
// canvases (committed base + live draft — the DrawingCanvas dual-canvas model). Strokes live in
// a LOGICAL content space: the editor's 680px reading column (INK_LOGICAL_W) with a uniform
// display scale s = contentDOM.width / 680, so pane-width changes rescale ink + stroke width
// proportionally (the same fixed-logical-space trick the page drawing uses). Scrolling never
// moves the canvases — each repaint reads contentDOM's live rect, so the paint offset tracks
// the scroll for free (rAF-coalesced).
//
// Anchoring: a stroke's y lives in that logical content space, and each stroke ALSO records the
// line it was drawn beside — `a: { p, y }`, a document position plus that line's top at draw time
// (core/src/drawing/ink.ts's InkAnchor). `p` is remapped through every document change, and the
// paint shifts the stroke by `lineTop(p) - y`, so inserting a line above moves the ink DOWN with
// the text it annotates. A stroke with NO anchor shifts by exactly 0 — every `.ink` sidecar
// written before anchors existed keeps the original paper-like behaviour, and that optional field
// is the entire migration story (there is no version bump and no rewrite).
// Mid-draw reflow can't happen (the doc is non-editable in draw mode).
//
// Persistence: a hidden `.ink/<note>.ink` sidecar (core/src/drawing/ink.ts), lazily created on
// the first stroke, debounce-saved, carried on rename/delete by files.ts, and classified by the
// server as dirty-to-nothing so an autosave costs no rebuilds anywhere.
import { createSignal, createEffect, onCleanup, Show, untrack } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { Compartment, StateEffect, type ChangeSet } from '@codemirror/state'
import { api } from '../api'
import { lastChange } from '../serverVersion'
import {
    emptyInkDoc,
    parseInkDoc,
    serializeInkDoc,
    inkPathFor,
    INK_LOGICAL_W,
    type InkDoc,
    type InkAnchor,
    type InkStroke,
} from '../../../core/src/drawing/ink'
import type { DrawingDoc, Stroke } from '../../../core/src/drawing/model'
import { drawStroke, type Ctx2D } from '../../../core/src/drawing/render2d'
import { themeColors } from '../../../core/src/drawing/theme'
import { smoothStrokePoints } from '../../../core/src/drawing/smooth'
import { widthFor, isRealPressure } from '../drawing/input'
import { createDrawingStore } from '../drawing/store'
import { Toolbar } from '../drawing/Toolbar'
import type { ToolState } from '../drawing/DrawingCanvas'
import '../drawing/Drawing.css'
import styles from './InkOverlay.module.css'

// Tool state is module-level so the pen/color/size choice follows the user across notes for
// the session (same defaults as DrawingPage's DEFAULT_TOOLS).
const [tools, setToolsSig] = createSignal<ToolState>({
    tool: 'pen',
    color: 'fg',
    size: 5,
    smoothMode: 'smooth',
    holdToStraighten: true,
    holdDelayMs: 900,
})
const setTools = (patch: Partial<ToolState>) =>
    setToolsSig(t => ({ ...t, ...patch }))

/** A line's top in ink-logical units. `lineBlockAt` reads CodeMirror's HEIGHT MAP, which covers
 *  the WHOLE document; `coordsAtPos` would return null for any position outside the rendered
 *  viewport, silently unanchoring (and snapping) ink in a long note. The height map measures from
 *  the same origin ink's y does (contentDOM top, offset by a constant content padding), and every
 *  use below is a DIFFERENCE of two of these, so the constant cancels out. */
const lineTopLogical = (v: EditorView, pos: number, s: number): number => {
    const p = Math.max(0, Math.min(pos, v.state.doc.length))
    return v.lineBlockAt(p).top / s
}

/** How far a stroke has travelled since it was drawn. Exactly 0 for an unanchored stroke — the
 *  whole no-migration guarantee, in one expression. */
const shiftFor = (st: InkStroke, v: EditorView, s: number): number =>
    st.a ? lineTopLogical(v, st.a.p, s) - st.a.y : 0

/** Wrap an InkDoc's strokes as a single-page DrawingDoc so createDrawingStore (undo/redo/
 *  commit/erase) is reused verbatim; convert back only at the save boundary. */
const wrapInk = (strokes: Stroke[]): DrawingDoc => ({
    v: 1,
    kind: 'drawing',
    paper: { bg: 'blank' },
    pages: [{ strokes }],
})

export function InkOverlay(props: {
    view: () => EditorView | undefined
    path: () => string | null
    active: () => boolean
    onExit: () => void
}) {
    let base!: HTMLCanvasElement
    let live!: HTMLCanvasElement
    let host!: HTMLDivElement
    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    const theme = () => themeColors('dark') // the app is dark-only (mirrors DrawingPage)

    // The per-note store. Recreated on every path switch (ink loads async; empty until then).
    const [store, setStore] = createSignal<ReturnType<
        typeof createDrawingStore
    > | null>(null)
    // The store is the generic `.draw` one, so it types strokes as `Stroke`. Note ink additionally
    // carries an optional line anchor, which the store preserves verbatim (structuredClone + object
    // spread); this narrows the READ side back to what actually lives in there.
    const strokes = (): InkStroke[] =>
        (store()?.doc().pages[0].strokes ?? []) as InkStroke[]
    const hasInk = () => strokes().length > 0
    // The overlay renders its canvases only when there's something to show or the user is
    // drawing — an ink-free note in normal mode pays nothing beyond the one async load probe.
    const mounted = () => props.active() || hasInk()

    // ── Persistence ─────────────────────────────────────────────────────────────────────────
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let lastSavedInk: string | undefined // recognize our own SSE echo
    let savePath: string | null = null // the path saves are bound to (frozen per buffer)
    const flushSave = (doc?: DrawingDoc) => {
        clearTimeout(saveTimer)
        const p = savePath
        const d = doc ?? untrack(() => store()?.doc())
        if (!p || !d) return
        const ink: InkDoc = { v: 1, kind: 'ink', strokes: d.pages[0].strokes }
        const text = serializeInkDoc(ink)
        if (text === lastSavedInk) return // nothing new (also skips the initial load state)
        lastSavedInk = text
        void api.saveNoteInk(p, ink)
    }
    const requestSave = (doc: DrawingDoc) => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => flushSave(doc), 600)
    }

    // Load (or reset) the ink whenever the buffer switches. The GET is async and off the open
    // path — the note renders immediately; ink pops in when the read lands (usually instantly).
    createEffect(() => {
        const p = props.path()
        // Flush the PREVIOUS buffer's pending save before rebinding (mirrors Editor's flushSave).
        onCleanup(() => flushSave())
        savePath = p
        lastSavedInk = undefined
        setStore(null)
        if (!p) return
        void (async () => {
            let doc = emptyInkDoc()
            try {
                const text = await api.read(inkPathFor(p))
                if (text.trim()) {
                    doc = parseInkDoc(text)
                    lastSavedInk = serializeInkDoc(doc)
                }
            } catch {
                /* unreadable/corrupt sidecar — start empty; the first stroke rewrites it */
            }
            if (props.path() !== p) return // buffer switched while loading
            setStore(createDrawingStore(wrapInk(doc.strokes), requestSave))
        })()
    })

    // Cross-pane sync: a split sibling saved this note's ink → refetch unless it's our own echo.
    createEffect(() => {
        const change = lastChange()
        const p = props.path()
        if (!p || !change.paths.includes(inkPathFor(p))) return
        void (async () => {
            try {
                const text = await api.read(inkPathFor(p))
                if (props.path() !== p || text === lastSavedInk || !text.trim())
                    return
                const doc = parseInkDoc(text)
                // Cancel any pending local flush FIRST: its closure holds a pre-reload snapshot, and
                // letting it fire after we adopt the sibling's content would silently overwrite the
                // sidecar with stale ink (erasing the other pane's strokes on disk). Concurrent draws
                // on both panes within one debounce window still resolve last-writer-wins — accepted;
                // this guard only removes the DESTRUCTIVE stale-clobber, not the need to take turns.
                clearTimeout(saveTimer)
                lastSavedInk = text
                setStore(createDrawingStore(wrapInk(doc.strokes), requestSave))
            } catch {
                /* ignore — next change retries */
            }
        })()
    })

    // ── Geometry + painting ─────────────────────────────────────────────────────────────────
    // Logical→viewport mapping, read fresh per paint: scale s = content width / 680, offsets =
    // contentDOM's rect relative to the overlay host (which fills the wrapper). Reading the live
    // rect per repaint makes scrolling correct with zero bookkeeping.
    const geom = () => {
        const v = props.view()
        if (!v) return null
        const cr = v.contentDOM.getBoundingClientRect()
        const hr = host.getBoundingClientRect()
        if (cr.width <= 0) return null
        return {
            s: cr.width / INK_LOGICAL_W,
            offX: cr.left - hr.left,
            offY: cr.top - hr.top,
        }
    }
    const ctxOf = (c: HTMLCanvasElement): Ctx2D & CanvasRenderingContext2D =>
        c.getContext('2d')! as Ctx2D & CanvasRenderingContext2D

    let rafPending = false
    const repaint = () => {
        if (rafPending || !base) return
        rafPending = true
        requestAnimationFrame(() => {
            rafPending = false
            if (!base) return
            const g = geom()
            const bx = ctxOf(base)
            bx.setTransform(1, 0, 0, 1, 0, 0)
            bx.clearRect(0, 0, base.width, base.height)
            if (!g) return
            bx.setTransform(
                DPR * g.s,
                0,
                0,
                DPR * g.s,
                DPR * g.offX,
                DPR * g.offY,
            )
            const t = theme()
            const v = props.view()
            // Cache the LINE TOP per anchor position — NOT the per-stroke shift. Two strokes on
            // the same line share a top but carry different `a.y`, so a shift cache would hand the
            // second stroke the first one's offset.
            const topCache = new Map<number, number>()
            for (const s of strokes()) {
                let dy = 0
                if (s.a && v) {
                    let top = topCache.get(s.a.p)
                    if (top === undefined) {
                        top = lineTopLogical(v, s.a.p, g.s)
                        topCache.set(s.a.p, top)
                    }
                    dy = top - s.a.y
                }
                bx.save()
                bx.translate(0, dy)
                drawStroke(bx, s, t)
                bx.restore()
            }
            paintLive()
        })
    }
    const paintLive = () => {
        if (!live) return
        const lx = ctxOf(live)
        lx.setTransform(1, 0, 0, 1, 0, 0)
        lx.clearRect(0, 0, live.width, live.height)
        const g = geom()
        const v = props.view()
        if (!g || !v || !current) return
        lx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY)
        // A stroke being drawn right now has no anchor yet, so this is always 0 — kept so the
        // live and committed paint paths cannot silently drift apart.
        lx.translate(0, shiftFor(current, v, g.s))
        drawStroke(lx, current, theme())
    }

    const resize = () => {
        if (!base || !host) return
        const w = host.clientWidth,
            h = host.clientHeight
        for (const c of [base, live]) {
            if (c.width !== w * DPR || c.height !== h * DPR) {
                c.width = w * DPR
                c.height = h * DPR
            }
        }
        repaint()
    }

    // While mounted: observe the host + the editor scroller so scroll/resize/reflow repaint.
    createEffect(() => {
        if (!mounted()) return
        const v = props.view()
        queueMicrotask(resize)
        const ro = new ResizeObserver(resize)
        ro.observe(host)
        const scroller = v?.scrollDOM
        const onScroll = () => repaint()
        scroller?.addEventListener('scroll', onScroll, { passive: true })
        onCleanup(() => {
            ro.disconnect()
            scroller?.removeEventListener('scroll', onScroll)
        })
    })
    // Repaint when the committed strokes change (store mutation / undo / reload).
    createEffect(() => {
        strokes()
        repaint()
    })

    // ── Anchor remapping ────────────────────────────────────────────────────────────────────
    // Every document change moves the text, so every anchor must move with it or it points at
    // stale positions after a single edit. assoc = 1 keeps the anchor AFTER text inserted exactly
    // at the line start — precisely what inserting a line above produces. Returning the stroke
    // BY REFERENCE when its position didn't move makes the whole call a no-op in the store, so
    // typing below the ink costs no document, no repaint and no save.
    const remapAnchors = (changes: ChangeSet) => {
        store()?.mapStrokes(0, (st: InkStroke) => {
            if (!st.a) return st
            const p = changes.mapPos(st.a.p, 1)
            return p === st.a.p ? st : { ...st, a: { ...st.a, p } }
        })
    }
    // CodeMirror has no subscribe-to-updates API outside its extension system, and this component
    // is HANDED a view it does not own (Editor.tsx builds it, and rebuilds it whenever an editor
    // setting changes). So the listener goes into the live config through a COMPARTMENT:
    // appendConfig on its own can never be taken back, and an overlay that outlived its listener
    // would leave a dead closure remapping a store it no longer owns. Deliberately not bolted
    // onto Editor.tsx's autosave listener — that would make the note editor know about ink purely
    // to hand a callback back down.
    const anchorSlot = new Compartment()
    createEffect(() => {
        const v = props.view()
        if (!v) return
        v.dispatch({
            effects: StateEffect.appendConfig.of(
                anchorSlot.of(
                    EditorView.updateListener.of(u => {
                        if (u.docChanged) remapAnchors(u.changes)
                    }),
                ),
            ),
        })
        onCleanup(() => {
            // The view may already be gone (Editor destroys it on a buffer/settings switch);
            // dispatching into a detached view throws, and there is nothing left to clean up.
            if (v.dom.isConnected) {
                v.dispatch({ effects: anchorSlot.reconfigure([]) })
            }
        })
    })

    // ── Stroke capture (mirrors DrawingCanvas's proven state machine, in logical coords) ────
    let drawing = false,
        hasReal = false,
        holdTimer: ReturnType<typeof setTimeout> | undefined
    let lastRaw = { x: 0, y: 0, t: 0 }
    let current: Stroke | null = null

    const toLogical = (e: PointerEvent) => {
        const v = props.view()!
        const cr = v.contentDOM.getBoundingClientRect()
        const s = cr.width > 0 ? cr.width / INK_LOGICAL_W : 1
        return { x: (e.clientX - cr.left) / s, y: (e.clientY - cr.top) / s }
    }
    /** The line anchor for a just-finished stroke: WHICH line its first point was drawn beside,
     *  and where that line's top sat at the time. `undefined` when the view or the geometry can't
     *  answer (no view, a zero-width content box, a point outside the text) — such a stroke simply
     *  keeps the pre-anchor behaviour of shifting by 0, forever. */
    const anchorFor = (st: Stroke): InkAnchor | undefined => {
        const v = props.view()
        if (!v) return undefined
        const cr = v.contentDOM.getBoundingClientRect()
        if (cr.width <= 0) return undefined
        const s = cr.width / INK_LOGICAL_W
        const pos = v.posAtCoords({
            x: cr.left + st.pts[0] * s,
            y: cr.top + st.pts[1] * s,
        })
        if (pos == null) return undefined
        // Anchor to the LINE START, not the exact position: a line start is stable under edits
        // WITHIN the line, so ink does not jitter sideways as you type on the line it sits beside.
        const from = v.state.doc.lineAt(pos).from
        return { p: from, y: lineTopLogical(v, from, s) }
    }

    const pressureByte = (pressure: number, speed: number): number => {
        const b = tools().size
        const w = widthFor({
            base: b,
            pressure,
            speed,
            hasRealPressure: hasReal,
        })
        return Math.round(Math.max(0, Math.min(1, w / (b * 1.75))) * 255)
    }
    const armHold = () => {
        clearTimeout(holdTimer)
        const ts = tools()
        if (!ts.holdToStraighten || ts.tool !== 'pen') return
        holdTimer = setTimeout(() => {
            if (current && current.pts.length > 9) {
                current.straight = true
                const x0 = current.pts[0],
                    y0 = current.pts[1]
                current.pts = [x0, y0, 255, lastRaw.x, lastRaw.y, 255]
                paintLive()
            }
        }, ts.holdDelayMs)
    }
    const eraseAt = (p: { x: number; y: number }) => {
        const st = store()
        if (!st) return
        const v = props.view()
        const g = geom()
        const list = strokes()
        const tol = tools().size + 8
        for (let i = list.length - 1; i >= 0; i--) {
            // Hit-test where the stroke is PAINTED, not where its points are stored: an anchored
            // stroke has travelled with its line, and an eraser blind to that would miss exactly
            // the ink the user is pointing at.
            const dy = v && g ? shiftFor(list[i], v, g.s) : 0
            const pts = list[i].pts
            for (let j = 0; j + 1 < pts.length; j += 3) {
                if (Math.hypot(pts[j] - p.x, pts[j + 1] + dy - p.y) < tol) {
                    st.eraseStroke(0, i)
                    return
                }
            }
        }
    }
    const onDown = (e: PointerEvent) => {
        if (!props.view() || !store()) return
        const ts = tools()
        drawing = true
        live.setPointerCapture(e.pointerId)
        hasReal = isRealPressure(e.pressure)
        const p = toLogical(e)
        lastRaw = { x: p.x, y: p.y, t: e.timeStamp }
        if (ts.tool === 'eraser') {
            eraseAt(p)
            current = null
            return
        }
        current = {
            t: ts.tool,
            c: ts.color,
            w: ts.size,
            pts: [p.x, p.y, pressureByte(e.pressure, 0)],
        }
        armHold()
    }
    const onMove = (e: PointerEvent) => {
        if (!drawing) return
        const ts = tools()
        if (ts.tool === 'eraser') {
            eraseAt(toLogical(e))
            return
        }
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
            const raw = toLogical(ev)
            const dt = Math.max(ev.timeStamp - lastRaw.t, 1)
            const dist = Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y)
            const speed = (dist / dt) * 16
            if (isRealPressure(ev.pressure)) hasReal = true
            if (current && !current.straight) {
                current.pts.push(raw.x, raw.y, pressureByte(ev.pressure, speed))
                if (dist > 3) armHold()
            }
            lastRaw = { x: raw.x, y: raw.y, t: ev.timeStamp }
        }
        if (current?.straight) {
            const raw = toLogical(e)
            current.pts[3] = raw.x
            current.pts[4] = raw.y
        }
        paintLive()
    }
    const onUp = () => {
        if (!drawing) return
        drawing = false
        clearTimeout(holdTimer)
        if (current && current.pts.length >= 3) {
            if (!current.straight && tools().smoothMode === 'smooth') {
                current.pts = smoothStrokePoints(current.pts)
            }
            const a = anchorFor(current)
            // Spread the anchor in CONDITIONALLY so an unanchorable stroke gets no `a` KEY at
            // all rather than `a: undefined` — the absence of the key is what makes it identical
            // to a pre-anchor stroke everywhere, not just after JSON.stringify drops it.
            const committed: InkStroke = a ? { ...current, a } : current
            store()?.commitStroke(0, committed)
        }
        current = null
        paintLive()
    }
    // The canvas sits over the scroller, so wheel events would otherwise dead-end in draw mode —
    // forward them so the note still scrolls under the pen.
    const onWheel = (e: WheelEvent) => {
        const scroller = props.view()?.scrollDOM
        if (!scroller) return
        scroller.scrollTop += e.deltaY
        scroller.scrollLeft += e.deltaX
        e.preventDefault()
    }

    // Draw-mode key handling: while active, the HOST (tabindex=-1) takes focus, so Escape and
    // Mod+Z / Mod+Shift+Z are handled right here — scoped to this pane by focus itself, never a
    // window-level capture that could hijack a sibling pane's keys. (The host sits inside the
    // editor wrapper, so the toggle-draw-mode combo still bubbles to Editor's wrapper listener.)
    const onHostKey = (e: KeyboardEvent) => {
        if (!props.active()) return
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            props.onExit()
            return
        }
        if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault()
            e.stopPropagation()
            if (e.shiftKey) store()?.redo()
            else store()?.undo()
        }
    }
    // Take focus on activation (and back after toolbar clicks steal it) so onHostKey sees keys.
    createEffect(() => {
        if (props.active()) queueMicrotask(() => host?.focus())
    })

    onCleanup(() => {
        clearTimeout(holdTimer)
        clearTimeout(saveTimer)
    })

    // On unload-ish flushes we rely on the 600ms debounce being short; a keepalive variant like
    // the note autosave's is unnecessary for ink (losing <600ms of strokes on force-quit is fine).

    return (
        <Show when={mounted()}>
            <div
                ref={host}
                class={styles['ink-host']}
                classList={{ [styles.active]: props.active() }}
                tabindex={-1}
                onKeyDown={onHostKey}
                onPointerDown={() => {
                    if (props.active()) host?.focus()
                }}
            >
                <canvas ref={base} class={styles['ink-canvas']} />
                <canvas
                    ref={live}
                    class={`${styles['ink-canvas']} ${styles['ink-live']}`}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    onWheel={onWheel}
                />
                <Show when={props.active()}>
                    <Toolbar
                        tools={tools}
                        setTools={setTools}
                        onUndo={() => store()?.undo()}
                        onRedo={() => store()?.redo()}
                    />
                </Show>
            </div>
        </Show>
    )
}
