// app/src/editor/InkOverlay.tsx
// Note ink: a transparent stroke layer over the CodeMirror editor. Rendered by Editor.tsx inside
// its `wrapper` (position:relative), covering the editor viewport with two canvases (committed
// base + live draft — the DrawingCanvas dual-canvas model). Strokes are captured in a LOGICAL
// content space: the editor's 680px reading column (INK_LOGICAL_W) with a uniform display scale
// s = contentDOM.width / 680, so pane-width changes rescale ink + stroke width proportionally.
// Scrolling never moves the canvases — each repaint reads contentDOM's live rect, so the paint
// offset tracks the scroll for free (rAF-coalesced).
//
// ── Where the ink LIVES (this is the part that changed) ─────────────────────────────────────
// The strokes are in the note. Each inked block carries a ```draw fence holding its own ink,
// base64 + deflate (core/src/drawing/inkCodec.ts), hidden and height-reserved by drawBlock.ts.
// There is no `.ink/<note>.ink` sidecar any more and no per-stroke `a: {p, y}` anchor: a fence's
// payload is stored relative to the top of its own replaced range, so the ink is anchored by the
// fence's position in the document, which the document already tracks. Insert a paragraph above
// and the fence moves with the block it decorates; the ink follows with no remapping at all.
// (core/src/drawing/ink.ts is still on disk for INK_LOGICAL_W; a later task retires the rest.)
//
// ── What that costs, and how it is paid ─────────────────────────────────────────────────────
// Drawing now EDITS the note, where before it never touched it. Three consequences, all handled
// here and all of them user-visible if they are not:
//
//  1. A stroke must not be a document transaction. Strokes accumulate in a session op log and
//     land as ONE transaction, debounced (COMMIT_DELAY) and flushed on draw-mode exit, note
//     switch, window blur and unmount.
//  2. Text undo must not swallow drawings. Every ink transaction carries
//     `Transaction.addToHistory.of(false)`, so cmd+Z in the editor restores the user's typing
//     and never their ink — the same invariant reconcileDispatch.ts holds for disk reloads.
//  3. Drawing undo must not swallow typing. The drawing tool keeps its OWN stack, and that stack
//     is session-scoped: it is cleared on draw-mode exit and on any document change this overlay
//     did not make, so a drawing undo can never restore a text snapshot from before the user
//     typed.
import {
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    Show,
    untrack,
} from 'solid-js'
import { EditorView } from '@codemirror/view'
import {
    Annotation,
    Compartment,
    StateEffect,
    Transaction,
} from '@codemirror/state'
import {
    scanDrawBlocks,
    type DrawBlock,
} from '../../../core/src/drawing/drawBlocks'
import { INK_LOGICAL_W } from '../../../core/src/drawing/ink'
import type { Stroke } from '../../../core/src/drawing/model'
import { drawStroke, type Ctx2D } from '../../../core/src/drawing/render2d'
import { themeColors } from '../../../core/src/drawing/theme'
import { smoothStrokePoints } from '../../../core/src/drawing/smooth'
import { widthFor, isRealPressure } from '../drawing/input'
import { Toolbar } from '../drawing/Toolbar'
import type { ToolState } from '../drawing/DrawingCanvas'
import { STANDALONE_PAD } from './drawBlock'
import { planCommitStrokes, planErase, type Seam } from './inkCommit'
import { minimalChange } from './normalizeFrontmatter'
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

/** Marks a transaction as this overlay's own ink commit. Two readers: the update listener (a
 *  document change WITHOUT this annotation came from somewhere else, so the drawing session's
 *  text snapshots are no longer safe to restore), and nothing else. Deliberately NOT
 *  reconcileDispatch's `ExternalReload` — that one makes Editor.tsx's autosave skip the
 *  transaction, and an ink commit is exactly a change that must reach the disk. */
const InkEdit = Annotation.define<boolean>()

/** One drawing session's worth of uncommitted intent, in the order the user produced it. Undo
 *  pops the last entry; the log is turned into text once, at flush. */
type InkOp =
    | { kind: 'add'; stroke: Stroke }
    | { kind: 'erase'; fromLine: number; index: number }

/** What `undo` pushed, so `redo` can put it back in the right order — an op-drop and a text
 *  restore interleave, so one LIFO stack is the only way to replay them faithfully. */
type RedoEntry = { kind: 'op'; op: InkOp } | { kind: 'text'; text: string }

/** A block's ink plus where it paints: `dy` is the top of the fence's own replaced range in
 *  ink-logical units, which is the origin every stroke in that fence is stored against. */
interface PaintedBlock {
    fromLine: number
    dy: number
    strokes: Stroke[]
}

/** One debounced write per drawing session, per Decision 9 of the design. Short enough that a
 *  note switch mid-sketch rarely races it, long enough that a burst of quick strokes is one
 *  transaction rather than ten. */
const COMMIT_DELAY = 500

const erasedKey = (fromLine: number, index: number) => `${fromLine}:${index}`

export function InkOverlay(props: {
    view: () => EditorView | undefined
    path: () => string | null
    active: () => boolean
    onExit: () => void
}) {
    let base!: HTMLCanvasElement
    let live!: HTMLCanvasElement
    // A SIGNAL, not a plain ref: `mounted()` and the <Show> that assigns this ref both react to
    // the same sources, and the effect below can run first — leaving `ro.observe(undefined)` to
    // throw and take the whole overlay down. Depending on the element itself removes the race
    // instead of papering over it with a microtask.
    const [host, setHost] = createSignal<HTMLDivElement | undefined>()
    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    const theme = () => themeColors('dark') // the app is dark-only (mirrors DrawingPage)

    // ── Session state ───────────────────────────────────────────────────────────────────────
    // `ops` is reactive because the canvases paint it; the undo/redo bookkeeping around it is
    // not, because nothing renders from it.
    const [ops, setOps] = createSignal<InkOp[]>([])
    let redoLog: RedoEntry[] = []
    let textUndo: string[] = []
    let commitTimer: ReturnType<typeof setTimeout> | undefined
    // The seam table is captured at pen-DOWN (the document is non-editable in draw mode, so it
    // cannot move mid-gesture) and reused for the whole flush, because nothing is dispatched
    // between the strokes of one session either. It MUST come from that moment: a stroke's
    // absolute coordinates only mean anything in the layout they were captured in. The one
    // reflow that is not a document edit is a late web-font load, which changes every line
    // height — draw during it and the commit is offset by the difference. Not defended against,
    // because it needs the user to be drawing inside the first paint of a cold load.
    let sessionSeams: Seam[] = []

    // Bumped by the CodeMirror update listener. Split in two on purpose: the fence SCAN only has
    // to re-run when the text changes, while a scroll or a widget re-measure only moves where
    // the same ink paints.
    const [docTick, setDocTick] = createSignal(0)
    const [geomTick, setGeomTick] = createSignal(0)

    const blocks = createMemo<DrawBlock[]>(() => {
        docTick()
        const v = props.view()
        if (!v) return []
        const text = v.state.doc.toString()
        // Same fast path computeBlockRegions uses: no fence, no scan.
        if (text.indexOf('```draw') === -1) return []
        return scanDrawBlocks(text)
    })

    const pendingStrokes = (): Stroke[] =>
        ops().flatMap(o => (o.kind === 'add' ? [o.stroke] : []))
    const erased = (): Set<string> => {
        const s = new Set<string>()
        for (const o of ops()) {
            if (o.kind === 'erase') s.add(erasedKey(o.fromLine, o.index))
        }
        return s
    }
    const hasInk = () => {
        if (pendingStrokes().length) return true
        const gone = erased()
        return blocks().some(b =>
            b.strokes.some((_, i) => !gone.has(erasedKey(b.fromLine, i))),
        )
    }
    // The overlay renders its canvases only when there's something to show or the user is
    // drawing — an ink-free note in normal mode pays nothing beyond the fence scan.
    const mounted = () => props.active() || hasInk()

    // ── Geometry ────────────────────────────────────────────────────────────────────────────
    // `padTop` converts CodeMirror's height-map coordinates (measured from `documentTop`, the
    // top of the FIRST LINE) into the ink-logical space the pointer handlers capture in (measured
    // from contentDOM's border box). Reading both live per paint makes scrolling correct with
    // zero bookkeeping.
    const contentGeom = () => {
        const v = props.view()
        if (!v) return null
        const cr = v.contentDOM.getBoundingClientRect()
        if (cr.width <= 0) return null
        return {
            v,
            cr,
            s: cr.width / INK_LOGICAL_W,
            padTop: v.documentTop - cr.top,
        }
    }
    const geom = () => {
        const cg = contentGeom()
        const el = host()
        if (!cg || !el) return null
        const hr = el.getBoundingClientRect()
        return {
            ...cg,
            offX: cg.cr.left - hr.left,
            offY: cg.cr.top - hr.top,
        }
    }

    /** Every draw fence in the note, with the logical y its payload is stored against.
     *
     *  ATTACHED fences anchor to the BOTTOM of the block they decorate rather than to the top of
     *  their own replaced range. Chrome reports those as the same number today (measured: widget
     *  top 54.4, preceding block bottom 54.4), so this is not a workaround for a discrepancy —
     *  it is what makes the two sides agree BY CONSTRUCTION. The commit side has no widget to
     *  measure (it is creating the fence), so it can only ever use the block bottom; reading the
     *  same edge back here means committed ink cannot drift from where it was drawn even if
     *  CodeMirror's height map ever stops making those two equal.
     *
     *  STANDALONE fences have no block above to anchor to — the widget IS the block — so they
     *  use their own top, which the seam table also reports from this same call. */
    const paintedBlocks = (): PaintedBlock[] => {
        const cg = contentGeom()
        if (!cg) return []
        const doc = cg.v.state.doc
        const out: PaintedBlock[] = []
        for (const b of blocks()) {
            if (b.fromLine > doc.lines) continue
            // lineBlockAt reads the HEIGHT MAP, which covers the whole document; coordsAtPos
            // would return null for anything outside the rendered viewport and silently snap
            // ink to 0 in a long note.
            const anchored =
                b.attachedToLine !== null && b.attachedToLine <= doc.lines
            const line = anchored ? b.attachedToLine! : b.fromLine
            const blk = cg.v.lineBlockAt(doc.line(line).from)
            const top = anchored ? blk.bottom : blk.top
            out.push({
                fromLine: b.fromLine,
                dy: (cg.padTop + top) / cg.s,
                strokes: b.strokes,
            })
        }
        return out
    }

    /** One entry per markdown block, ascending by `y`. A block is a run of consecutive non-blank
     *  lines (blank lines separate blocks — the design's "paragraph boundaries, never line
     *  boundaries"), walked over CodeMirror's own height-map blocks so a fence already replaced
     *  by a widget counts once, at its real height.
     *
     *  An ATTACHED fence is SKIPPED entirely: it is zero-height, it belongs to the run it
     *  decorates rather than being a band of its own, and the run already reports the edge that
     *  fence's ink is stored against (its own bottom — see paintedBlocks for why that edge and
     *  not the widget's reported top). A STANDALONE fence IS its own band, and hands back its
     *  widget top as the origin; its bottom, the cut, is a whole drawing further down. */
    const buildSeams = (): Seam[] => {
        const cg = contentGeom()
        if (!cg) return []
        const { v, s, padTop } = cg
        const doc = v.state.doc
        const yOf = (top: number) => (padTop + top) / s
        const byFrom = new Map<number, DrawBlock>()
        for (const b of blocks()) byFrom.set(b.fromLine, b)

        const out: Seam[] = []
        let run: Seam | null = null
        const flushRun = () => {
            if (run) out.push(run)
            run = null
        }

        let pos = 0
        for (;;) {
            const blk = v.lineBlockAt(pos)
            const fromLine = doc.lineAt(blk.from).number
            const draw = byFrom.get(fromLine)
            if (draw) {
                if (draw.attachedToLine === null) {
                    flushRun()
                    out.push({
                        y: yOf(blk.bottom),
                        afterLine: Math.max(0, draw.fromLine - 1),
                        origin: yOf(blk.top),
                    })
                }
                // An attached fence adds nothing: zero height, and the run it hangs off already
                // carries the edge its ink is stored against.
            } else if (doc.lineAt(blk.from).text.trim() === '') {
                flushRun()
            } else {
                const y = yOf(blk.bottom)
                run = {
                    y,
                    origin: y,
                    afterLine: doc.lineAt(Math.min(blk.to, doc.length)).number,
                }
            }
            if (blk.to >= doc.length) break
            pos = blk.to + 1
        }
        flushRun()

        // splitStrokeAtSeams walks the table by index assuming strict ascent, and returns
        // nonsense rather than throwing for anything else. A zero-height block (an empty
        // standalone fence) can tie with its neighbour, so drop ties rather than feed it one:
        // that band's ink falls into the next band, which for a zero-height block is where it
        // visually belongs anyway.
        const ascending: Seam[] = []
        for (const seam of out) {
            if (
                !ascending.length ||
                seam.y > ascending[ascending.length - 1].y
            ) {
                ascending.push(seam)
            }
        }
        return ascending
    }

    // ── Painting ────────────────────────────────────────────────────────────────────────────
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
            const gone = erased()
            for (const pb of paintedBlocks()) {
                for (let i = 0; i < pb.strokes.length; i++) {
                    if (gone.has(erasedKey(pb.fromLine, i))) continue
                    bx.save()
                    bx.translate(0, pb.dy)
                    drawStroke(bx, pb.strokes[i], t)
                    bx.restore()
                }
            }
            // Strokes drawn since the last flush are still in absolute capture coordinates —
            // the same space `dy + storedY` resolves to — so they need no shift and do not jump
            // when the flush finally lands.
            for (const st of pendingStrokes()) drawStroke(bx, st, t)
            paintLive()
        })
    }
    const paintLive = () => {
        if (!live) return
        const lx = ctxOf(live)
        lx.setTransform(1, 0, 0, 1, 0, 0)
        lx.clearRect(0, 0, live.width, live.height)
        const g = geom()
        if (!g || !current) return
        lx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY)
        drawStroke(lx, current, theme())
    }

    const resize = () => {
        const el = host()
        if (!base || !el) return
        const w = el.clientWidth,
            h = el.clientHeight
        for (const c of [base, live]) {
            if (c.width !== w * DPR || c.height !== h * DPR) {
                c.width = w * DPR
                c.height = h * DPR
            }
        }
        repaint()
    }

    // Once the host exists: observe it + the editor scroller so scroll/resize/reflow repaint.
    createEffect(() => {
        const el = host()
        if (!el) return
        const v = props.view()
        queueMicrotask(resize)
        const ro = new ResizeObserver(resize)
        ro.observe(el)
        const scroller = v?.scrollDOM
        const onScroll = () => repaint()
        scroller?.addEventListener('scroll', onScroll, { passive: true })
        onCleanup(() => {
            ro.disconnect()
            scroller?.removeEventListener('scroll', onScroll)
        })
    })
    // Repaint when the ink, its geometry, or the uncommitted session changes.
    createEffect(() => {
        blocks()
        geomTick()
        ops()
        repaint()
    })

    // ── Committing ──────────────────────────────────────────────────────────────────────────
    const applyText = (v: EditorView, next: string): void => {
        const cur = v.state.doc.toString()
        if (cur === next) return
        v.dispatch({
            // A minimal patch rather than a whole-document replace: still ONE transaction, but
            // it keeps the selection and does not remount every block widget in the note.
            changes: minimalChange(cur, next),
            annotations: [InkEdit.of(true), Transaction.addToHistory.of(false)],
        })
    }

    /** Turn the session's op log into one document edit. Erases go first and are applied per
     *  block from the highest index down, so one splice never shifts the next one's target;
     *  every added stroke then goes in through a single planCommitStrokes call, which orders
     *  the fence inserts bottom-up for itself. */
    const flushNow = (): void => {
        clearTimeout(commitTimer)
        const pending = untrack(ops)
        if (!pending.length) return
        const v = untrack(props.view)
        // No usable view: KEEP the ops rather than dropping the user's strokes on the floor —
        // Editor.tsx destroys and rebuilds the view for a settings change, and the next flush
        // will land them. `resetSession` is what clears them, and it runs at the genuine session
        // boundaries (note switch, draw-mode exit) so they can never leak into another buffer.
        if (!v || !v.dom.isConnected) return
        setOps([])
        redoLog = []

        const before = v.state.doc.toString()
        let text = before
        const byLine = new Map<number, number[]>()
        for (const op of pending) {
            if (op.kind !== 'erase') continue
            const list = byLine.get(op.fromLine) ?? []
            list.push(op.index)
            byLine.set(op.fromLine, list)
        }
        for (const [fromLine, indices] of byLine) {
            for (const i of [...indices].sort((a, b) => b - a)) {
                text = planErase(text, fromLine, i)
            }
        }
        text = planCommitStrokes(
            text,
            pending.flatMap(o => (o.kind === 'add' ? [o.stroke] : [])),
            sessionSeams,
            STANDALONE_PAD,
        )
        if (text === before) return
        textUndo.push(before)
        applyText(v, text)
    }
    const scheduleCommit = () => {
        clearTimeout(commitTimer)
        commitTimer = setTimeout(flushNow, COMMIT_DELAY)
    }
    const pushOp = (op: InkOp) => {
        redoLog = []
        setOps(o => [...o, op])
        scheduleCommit()
    }

    /** End the drawing session: drop everything the drawing tool could still undo, and anything
     *  it never managed to commit. Called on draw-mode exit, on a note switch, and on any
     *  document change this overlay did not make. Two guarantees come from it — a drawing undo
     *  can never restore a text snapshot taken before the user typed, and an uncommittable
     *  stroke can never follow the user into a different note. */
    const resetSession = () => {
        setOps([])
        redoLog = []
        textUndo = []
    }

    const undo = () => {
        const cur = untrack(ops)
        if (cur.length) {
            redoLog.push({ kind: 'op', op: cur[cur.length - 1] })
            setOps(cur.slice(0, -1))
            return
        }
        const v = untrack(props.view)
        const prev = textUndo.pop()
        if (!v || prev === undefined) return
        redoLog.push({ kind: 'text', text: v.state.doc.toString() })
        applyText(v, prev)
    }
    const redo = () => {
        const entry = redoLog.pop()
        if (!entry) return
        if (entry.kind === 'op') {
            setOps(o => [...o, entry.op])
            scheduleCommit()
            return
        }
        const v = untrack(props.view)
        if (!v) return
        textUndo.push(v.state.doc.toString())
        applyText(v, entry.text)
    }

    // ── CodeMirror wiring ───────────────────────────────────────────────────────────────────
    // CodeMirror has no subscribe-to-updates API outside its extension system, and this component
    // is HANDED a view it does not own (Editor.tsx builds it, and rebuilds it whenever an editor
    // setting changes). So the listener goes into the live config through a COMPARTMENT:
    // appendConfig on its own can never be taken back, and an overlay that outlived its listener
    // would leave a dead closure driving a view it no longer owns.
    const listenerSlot = new Compartment()
    createEffect(() => {
        const v = props.view()
        if (!v) return
        v.dispatch({
            effects: StateEffect.appendConfig.of(
                listenerSlot.of(
                    EditorView.updateListener.of(u => {
                        if (u.docChanged) {
                            setDocTick(n => n + 1)
                            if (
                                !u.transactions.some(tr =>
                                    tr.annotation(InkEdit),
                                )
                            ) {
                                // Somebody else moved the text under us. Commit what the user
                                // has drawn before the seam tables get any staler (deferred:
                                // dispatching from inside an update is forbidden), then drop
                                // the snapshots, which no longer describe this document.
                                queueMicrotask(() => {
                                    flushNow()
                                    resetSession()
                                })
                            }
                        }
                        if (u.geometryChanged || u.viewportChanged) {
                            setGeomTick(n => n + 1)
                        }
                    }),
                ),
            ),
        })
        onCleanup(() => {
            // The view may already be gone (Editor destroys it on a buffer/settings switch);
            // dispatching into a detached view throws, and there is nothing left to clean up.
            if (v.dom.isConnected) {
                flushNow()
                v.dispatch({ effects: listenerSlot.reconfigure([]) })
            }
        })
    })

    // A note switch rebinds everything: land whatever is pending against the buffer it was drawn
    // on, then start a fresh drawing-undo session.
    createEffect(() => {
        props.path()
        onCleanup(() => {
            flushNow()
            resetSession()
        })
    })

    // Leaving draw mode ends the drawing session: commit, then forget — the drawing tool's undo
    // is deliberately not reachable across a trip through the text editor.
    createEffect(() => {
        if (props.active()) {
            queueMicrotask(() => host()?.focus())
            return
        }
        flushNow()
        resetSession()
    })

    // Losing the window mid-sketch is the other way a debounce window ends badly.
    createEffect(() => {
        if (!props.active()) return
        const onBlur = () => flushNow()
        window.addEventListener('blur', onBlur)
        onCleanup(() => window.removeEventListener('blur', onBlur))
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

    /** Hit-test a stroke where it is PAINTED (`dy` shifted), not where its points are stored:
     *  a fence's ink has travelled with the block it decorates, and an eraser blind to that
     *  would miss exactly the ink the user is pointing at. */
    const hits = (
        st: Stroke,
        dy: number,
        p: { x: number; y: number },
        tol: number,
    ): boolean => {
        for (let j = 0; j + 1 < st.pts.length; j += 3) {
            if (Math.hypot(st.pts[j] - p.x, st.pts[j + 1] + dy - p.y) < tol) {
                return true
            }
        }
        return false
    }
    const eraseAt = (p: { x: number; y: number }) => {
        const tol = tools().size + 8
        const gone = erased()
        const painted = paintedBlocks()
        for (let bi = painted.length - 1; bi >= 0; bi--) {
            const pb = painted[bi]
            for (let i = pb.strokes.length - 1; i >= 0; i--) {
                if (gone.has(erasedKey(pb.fromLine, i))) continue
                if (hits(pb.strokes[i], pb.dy, p, tol)) {
                    pushOp({ kind: 'erase', fromLine: pb.fromLine, index: i })
                    return
                }
            }
        }
    }

    const onDown = (e: PointerEvent) => {
        const v = props.view()
        if (!v) return
        const ts = tools()
        drawing = true
        // A synthetic PointerEvent (a story, a test harness) carries no live pointer, so the
        // capture throws NotFoundError. Losing capture only costs tracking outside the canvas.
        try {
            live.setPointerCapture(e.pointerId)
        } catch {
            /* no live pointer to capture */
        }
        hasReal = isRealPressure(e.pressure)
        const p = toLogical(e)
        lastRaw = { x: p.x, y: p.y, t: e.timeStamp }
        if (ts.tool === 'eraser') {
            // The eraser addresses committed strokes BY INDEX inside their fence, so it works
            // against the document as it is now — flush first and the indices are real.
            flushNow()
            eraseAt(p)
            current = null
            return
        }
        // The document is non-editable in draw mode, so the seam table cannot move mid-gesture,
        // and nothing is dispatched between the strokes of one session either — so one table
        // serves the whole flush.
        sessionSeams = buildSeams()
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
        // A synthetic PointerEvent returns an EMPTY coalesced list rather than omitting the
        // method, so `?? [e]` alone would silently drop every move point.
        const coalesced = e.getCoalescedEvents?.()
        for (const ev of coalesced && coalesced.length ? coalesced : [e]) {
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
        if (current && current.pts.length >= 6) {
            if (!current.straight && tools().smoothMode === 'smooth') {
                current.pts = smoothStrokePoints(current.pts)
            }
            pushOp({ kind: 'add', stroke: current })
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
    // window-level capture that could hijack a sibling pane's keys. This is the DRAWING undo;
    // the editor's own history never sees an ink transaction (see InkEdit above).
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
            if (e.shiftKey) redo()
            else undo()
        }
    }

    onCleanup(() => {
        clearTimeout(holdTimer)
        flushNow()
    })

    return (
        <Show when={mounted()}>
            <div
                ref={setHost}
                class={styles['ink-host']}
                classList={{ [styles.active]: props.active() }}
                tabindex={-1}
                onKeyDown={onHostKey}
                onPointerDown={() => {
                    if (props.active()) host()?.focus()
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
                        onUndo={undo}
                        onRedo={redo}
                    />
                </Show>
            </div>
        </Show>
    )
}
