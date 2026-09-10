// app/src/editor/InkOverlay.tsx
// Note ink: a transparent stroke layer over the CodeMirror editor. Rendered by Editor.tsx inside
// its `wrapper` (position:relative), covering the editor viewport with two canvases (committed
// base + live draft — the DrawingCanvas dual-canvas model). Strokes are CAPTURED in a LOGICAL
// content space: the editor's 680px reading column (INK_LOGICAL_W) with a uniform display scale
// s = contentDOM.width / 680, so pane-width changes rescale ink + stroke width proportionally.
// (What a fence STORES is a different question with a different answer for attached ink — see
// below.) Scrolling never moves the canvases — each repaint reads contentDOM's live rect, so the
// paint offset tracks the scroll for free. Every repaint is coalesced into the EDITOR'S measure
// phase rather than a bare animation frame — see `repaint`, which carries the measurement that
// forced it.
//
// ── Where the ink LIVES (this is the part that changed) ─────────────────────────────────────
// The strokes are in the note. Each inked block carries a ```draw fence holding its own ink,
// base64 + deflate (core/src/drawing/inkCodec.ts), hidden and height-reserved by drawBlock.ts.
// There is no `.ink/<note>.ink` sidecar any more and no per-stroke `a: {p, y}` anchor: a fence
// is anchored by its own position in the document, which the document already tracks, so an
// insertion above it needs no remapping of anything.
//
// "Follows the text" is not free, though, and saying so was wrong. A document SHIFT is free; a
// REFLOW and a RESCALE are not, and both had to be paid for explicitly — an attached fence
// anchors to the TOP of the block it decorates (not its bottom, which a typed line moves) and
// stores its y in unscaled PIXELS (not the logical column, which a pane resize rescales while
// line heights stay put). Measured drift before those two: 18px on one typed line, 37px at 55%
// pane width. After: 0.00px and 0.50px — and that half pixel is the PROBE's quantization (it
// reads whole device rows at DPR 1), not any residual movement. The contract lives in
// inkCommit.ts.
// (INK_LOGICAL_W now lives in core/src/drawing/model.ts alongside the rest of the block model.)
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
    type ChangeDesc,
    type Text,
} from '@codemirror/state'
import {
    blockFirstLine,
    drawFenceLineSet,
    scanDrawBlocks,
    type DrawBlock,
} from '../../../core/src/drawing/drawBlocks'
import { INK_LOGICAL_W } from '../../../core/src/drawing/model'
import type { Stroke } from '../../../core/src/drawing/model'
import { drawStroke, type Ctx2D } from '../../../core/src/drawing/render2d'
import { themeColors } from '../../../core/src/drawing/theme'
import { smoothStrokePoints } from '../../../core/src/drawing/smooth'
import { widthFor, isRealPressure } from '../drawing/input'
import { Toolbar } from '../drawing/Toolbar'
import type { ToolState } from '../drawing/DrawingCanvas'
import {
    clampDelta,
    clampScale,
    pickOwningBlock,
    scaleStrokes,
    selectionBounds,
    translateStrokes,
} from '../drawing/lasso'
import type { InkBounds } from './drawBlockGeometry'
import { STANDALONE_PAD } from './drawBlock'
import {
    planCommitStrokes,
    planErase,
    planStrokeEdit,
    resolveStrokeIndex,
    type Plan,
    type Seam,
    type StrokeRef,
} from './inkCommit'
import { remapAnchorLine, remapSeams } from './inkRemap'
import { minimalChange } from './normalizeFrontmatter'
import { extractFrontmatterBoundary } from './frontmatterUtils'
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
 *  pops the last entry; the log is turned into text once, at flush.
 *
 *  An erase carries a {@link StrokeRef} rather than a bare `(fromLine, index)` pair because the
 *  log outlives up to COMMIT_DELAY of other people's edits — see inkRemap.ts. `ref.fromLine` is
 *  rewritten in place by `remapSession` on every foreign change; `ref.stroke` never changes and
 *  is what resolves the index at flush. */
type InkOp = { kind: 'add'; stroke: Stroke } | { kind: 'erase'; ref: StrokeRef }

/** A plan that could not apply is dropped, and dropping it silently is the defect this whole
 *  path was rewritten for. There is no user-facing channel from inside the overlay, so the
 *  console is the loud part — but the STRUCTURAL guarantee is the one that matters: the op is
 *  only ever dropped after the document has been consulted, never applied to a guess. */
const dropped = (what: string, reason: string, detail: unknown): void => {
    console.warn(`[ink] dropped a pending ${what}: ${reason}`, detail)
}

/** What `undo` pushed, so `redo` can put it back in the right order — an op-drop and a text
 *  restore interleave, so one LIFO stack is the only way to replay them faithfully. */
type RedoEntry = { kind: 'op'; op: InkOp } | { kind: 'text'; text: string }

/** A block's ink plus how to place it, as the affine map `paintedY = storedY * yScale + dy`,
 *  both in ink-logical units.
 *
 *  ATTACHED fences store their y in unscaled PIXELS against the TOP of the block they decorate,
 *  so `yScale` is `1 / contentScale` and `dy` is that block's top in logical units. STANDALONE
 *  fences are on the uniform logical scale against their own widget top, so `yScale` is 1. See
 *  inkCommit.ts's coordinate contract for why those two differ. */
interface PaintedBlock {
    fromLine: number
    dy: number
    yScale: number
    strokes: Stroke[]
    /** Where a lasso MOVE of this block's ink is allowed to end up, in painted ink-logical
     *  coordinates: the reading column horizontally, and the block's own band vertically. A
     *  stroke belongs to exactly one block, so dragging a paragraph's annotation down onto the
     *  next paragraph has to stop at the seam. */
    limit: InkBounds
    /** True for a standalone drawing, whose box is sized from its own ink. A RESIZE therefore
     *  takes the box with it and is not capped below — where an attached fence's band is fixed
     *  by the text it decorates and caps both. */
    growsDown: boolean
}

/** Attached ink's y has to be divided by the live content scale before it can be drawn under the
 *  overlay's uniform transform — transforming the POINTS rather than the canvas is what keeps a
 *  pen nib round instead of stretching it into an ellipse. Cached by the stroke array, whose
 *  identity is stable per document version, so a scroll does not rebuild every point array sixty
 *  times a second. THE STROKES A FENCE DECODES TO ARE FROZEN: mutating one in place would leave
 *  this cache serving the old points under the same array identity, and nothing enforces that,
 *  so any future edit path must produce new arrays rather than writing through these. */
const scaledCache = new WeakMap<Stroke[], { yScale: number; out: Stroke[] }>()
function scaleStrokeY(strokes: Stroke[], yScale: number): Stroke[] {
    if (yScale === 1) return strokes
    const hit = scaledCache.get(strokes)
    if (hit && hit.yScale === yScale) return hit.out
    const out = strokes.map(s => ({
        ...s,
        pts: s.pts.map((n, i) => (i % 3 === 1 ? n * yScale : n)),
    }))
    scaledCache.set(strokes, { yScale, out })
    return out
}

/** One debounced write per drawing session, per Decision 9 of the design. Short enough that a
 *  note switch mid-sketch rarely races it, long enough that a burst of quick strokes is one
 *  transaction rather than ten. */
const COMMIT_DELAY = 500

const erasedKey = (fromLine: number, index: number) => `${fromLine}:${index}`

/** A block's band as a clamp limit: the full reading column horizontally, the block's own rect
 *  vertically. */
const bandLimit = (top: number, bottom: number): InkBounds => ({
    minX: 0,
    minY: top,
    maxX: INK_LOGICAL_W,
    maxY: bottom,
})

/** Which strokes of which block are selected. Indices address the fence's stroke list as it
 *  stands in the document, so the session is flushed before a lasso runs — the same reason the
 *  eraser flushes first. */
interface InkSelection {
    fromLine: number
    indices: number[]
}

/** A selection gesture in flight, in PAINTED ink-logical coordinates. Held in a signal because
 *  the committed-ink canvas repaints from it: the drag has to be visible before it is written.
 *
 *  A resize's origin y is always the selection's TOP edge, never the corner opposite the grabbed
 *  handle. Markdown flows downward, so a block's top is the edge that cannot move — it is the
 *  same reason an attached fence anchors to its block's top and a standalone widget reserves its
 *  height downward. Scaling about a bottom edge would need the content ABOVE the ink to shift,
 *  which the document has no way to do, so the two handles sit on the bottom corners. */
type InkPreview =
    | { kind: 'move'; dx: number; dy: number }
    | { kind: 'scale'; ox: number; oy: number; factor: number }

/** Screen-constant sizes for the selection chrome. Divided by the live content scale before use,
 *  so a handle stays the same size on screen whatever width the pane is. */
const HANDLE_PX = 9
const HANDLE_GRAB_PX = 14

/** The two resize handles' painted positions: the bottom corners of the selection box. */
const handlePoints = (box: InkBounds) => [
    { id: 'sw' as const, x: box.minX, y: box.maxY, ox: box.maxX, oy: box.minY },
    { id: 'se' as const, x: box.maxX, y: box.maxY, ox: box.minX, oy: box.minY },
]

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
    // Lasso state. `selection` outlives a gesture (the box stays up so it can be dragged again);
    // `preview` lives only while the pointer is down and is what the committed-ink canvas paints
    // through, so the drag is visible before it is written.
    const [selection, setSelection] = createSignal<InkSelection | null>(null)
    const [preview, setPreview] = createSignal<InkPreview | null>(null)
    // Marching ants. Advanced by an interval that exists ONLY while something is selected, so an
    // ordinary note pays nothing — a permanent rAF loop for a dashed rectangle would be the
    // costliest thing in this file.
    const [dashPhase, setDashPhase] = createSignal(0)
    // The polygon being drawn, in painted ink-logical coordinates, as flat (x, y) pairs. Not a
    // signal: only the live canvas draws it, and that repaints per pointermove anyway.
    let lassoPath: number[] | null = null
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
    // The view the current session's strokes were drawn on, held so a flush can still reach it
    // after `props.view()` has been nulled by a teardown that has not destroyed it yet.
    let sessionView: EditorView | undefined

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
    /** The `fromLine:index` keys the canvas must NOT paint, resolved against the document as it
     *  stands rather than against the indices the ops were recorded with.
     *
     *  It has to resolve by the same rule the flush does, or screen and file disagree about
     *  which stroke is going: a foreign rewrite of a fence's payload would otherwise leave the
     *  canvas hiding whatever stroke happened to inherit that index while the flush removed the
     *  right one. An op whose stroke is no longer in its fence suppresses NOTHING — there is
     *  nothing left to hide, and the flush will drop it for the same reason. */
    const erased = (): Set<string> => {
        const s = new Set<string>()
        const bs = blocks()
        for (const o of ops()) {
            if (o.kind !== 'erase') continue
            const b = bs.find(x => x.fromLine === o.ref.fromLine)
            const i = b ? resolveStrokeIndex(b.strokes, o.ref) : null
            if (i !== null) s.add(erasedKey(o.ref.fromLine, i))
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

    /** The 1-based line where the markdown block ending at `lastLine` BEGINS — the edge an
     *  attached fence's ink is anchored to. Used by BOTH the seam table and the paint, so the
     *  two cannot disagree about which edge a fence is stored against — and shared with the
     *  EXPORT (app/src/export/inkHtml.ts) through `blockFirstLine` for the same reason, one
     *  layer out: a second copy of this rule is how ink lands on the right words on screen and
     *  the wrong ones in the PDF. The accessor form is what lets that shared helper avoid
     *  splitting the whole document on every repaint. */
    const runFirstLine = (
        doc: Text,
        lastLine: number,
        fenceLines: Set<number>,
        frontmatterClose: number,
    ): number =>
        blockFirstLine(
            lastLine,
            doc.lines,
            n => doc.line(n).text,
            fenceLines,
            frontmatterClose,
        )

    /** Every line covered by a draw fence, and the note's frontmatter close (0 when it has none)
     *  — the two things `runFirstLine` needs, computed once per call site. */
    const runBounds = (v: EditorView) => {
        const doc = v.state.doc
        const fenceLines = drawFenceLineSet(blocks(), doc.lines)
        const fm = extractFrontmatterBoundary(doc.toString())
        let frontmatterClose = 0
        if (fm) {
            const firstBody = doc.lineAt(fm.from).number
            const lastBody =
                fm.to > fm.from ? doc.lineAt(fm.to).number : firstBody - 1
            frontmatterClose = Math.min(lastBody + 1, doc.lines)
        }
        return { fenceLines, frontmatterClose }
    }

    /** Every draw fence in the note, with the map that places its payload on screen.
     *
     *  ATTACHED fences anchor to the TOP of the block they decorate, in unscaled pixels. Top,
     *  because markdown grows downward: typing into an annotated paragraph moves its bottom by a
     *  line pitch and leaves its top alone. Pixels, because line heights do not rescale with pane
     *  width but a logical offset does. Both halves are inkCommit.ts's contract, read back.
     *
     *  STANDALONE fences have no block above to anchor to — the widget IS the block — so they
     *  use their own top in the uniform logical space, which the seam table also reports from
     *  this same measurement. */
    const paintedBlocks = (): PaintedBlock[] => {
        const cg = contentGeom()
        if (!cg) return []
        const doc = cg.v.state.doc
        const { fenceLines, frontmatterClose } = runBounds(cg.v)
        const out: PaintedBlock[] = []
        for (const b of blocks()) {
            if (b.fromLine > doc.lines) continue
            const anchored =
                !b.standalone &&
                b.attachedToLine !== null &&
                b.attachedToLine <= doc.lines
            // lineBlockAt reads the HEIGHT MAP, which covers the whole document; coordsAtPos
            // would return null for anything outside the rendered viewport and silently snap
            // ink to 0 in a long note.
            if (anchored) {
                const first = runFirstLine(
                    doc,
                    b.attachedToLine!,
                    fenceLines,
                    frontmatterClose,
                )
                const topPx =
                    cg.padTop + cg.v.lineBlockAt(doc.line(first).from).top
                const bottomPx =
                    cg.padTop +
                    cg.v.lineBlockAt(doc.line(b.attachedToLine!).from).bottom
                out.push({
                    fromLine: b.fromLine,
                    dy: topPx / cg.s,
                    yScale: 1 / cg.s,
                    strokes: b.strokes,
                    limit: bandLimit(topPx / cg.s, bottomPx / cg.s),
                    growsDown: false,
                })
                continue
            }
            const blk = cg.v.lineBlockAt(doc.line(b.fromLine).from)
            out.push({
                fromLine: b.fromLine,
                dy: (cg.padTop + blk.top) / cg.s,
                yScale: 1,
                strokes: b.strokes,
                limit: bandLimit(
                    (cg.padTop + blk.top) / cg.s,
                    (cg.padTop + blk.bottom) / cg.s,
                ),
                growsDown: true,
            })
        }
        return out
    }

    // ── Lasso selection ─────────────────────────────────────────────────────────────────────
    /** The block the current selection lives in, as it is painted right now. */
    const selectedBlock = (): PaintedBlock | undefined => {
        const sel = selection()
        if (!sel) return undefined
        return paintedBlocks().find(pb => pb.fromLine === sel.fromLine)
    }

    /** One block's strokes as the canvas paints them, BEFORE the `dy` translate: y-scaled into
     *  the painted logical space, with any in-flight lasso transform folded into the selected
     *  ones. Single definition of "where this ink is right now" — the paint, the selection box,
     *  the eraser's hit test and the lasso all read it, so none of them can disagree with the
     *  others about where a stroke is. */
    const shownStrokes = (pb: PaintedBlock): Stroke[] => {
        const base = scaleStrokeY(pb.strokes, pb.yScale)
        const pv = preview()
        const sel = selection()
        if (!pv || !sel || sel.fromLine !== pb.fromLine) return base
        const out = base.slice()
        for (const i of sel.indices) {
            if (i < 0 || i >= out.length) continue
            out[i] =
                pv.kind === 'move'
                    ? translateStrokes([base[i]], pv.dx, pv.dy)[0]
                    : scaleStrokes(
                          [base[i]],
                          pv.ox,
                          pv.oy - pb.dy,
                          pv.factor,
                      )[0]
        }
        return out
    }

    /** The selection's bounding box in ABSOLUTE painted coordinates (`dy` applied), or null when
     *  nothing is selected. */
    const selectionBox = (): InkBounds | null => {
        const sel = selection()
        const pb = selectedBlock()
        if (!sel || !pb) return null
        const b = selectionBounds(shownStrokes(pb), sel.indices)
        if (!b) return null
        return { ...b, minY: b.minY + pb.dy, maxY: b.maxY + pb.dy }
    }

    /** What the pointer is doing to a selection, captured at pen-down so every frame's transform
     *  is absolute rather than accumulated — an incremental delta drifts by a rounding error per
     *  frame and cannot be clamped honestly. */
    type LassoGesture =
        | { kind: 'lasso' }
        | { kind: 'move'; fromX: number; fromY: number; box: InkBounds }
        | {
              kind: 'scale'
              ox: number
              oy: number
              box: InkBounds
              start: number
          }
    let lassoGesture: LassoGesture | null = null

    const beginLasso = (p: { x: number; y: number }) => {
        // Like the eraser: the lasso addresses committed strokes BY INDEX inside their fence, so
        // the session has to land first or the indices name strokes that are not there yet.
        flushNow()
        const box = selectionBox()
        const pb = selectedBlock()
        const cg = contentGeom()
        if (box && pb && cg) {
            const grab = HANDLE_GRAB_PX / cg.s
            const handle = handlePoints(box).find(
                h =>
                    Math.abs(h.x - p.x) <= grab && Math.abs(h.y - p.y) <= grab,
            )
            const start = handle
                ? Math.hypot(p.x - handle.ox, p.y - handle.oy)
                : 0
            if (handle && start > 1e-6) {
                lassoGesture = {
                    kind: 'scale',
                    ox: handle.ox,
                    oy: handle.oy,
                    box,
                    start,
                }
                return
            }
            if (
                p.x >= box.minX &&
                p.x <= box.maxX &&
                p.y >= box.minY &&
                p.y <= box.maxY
            ) {
                lassoGesture = { kind: 'move', fromX: p.x, fromY: p.y, box }
                return
            }
        }
        setSelection(null)
        setPreview(null)
        lassoGesture = { kind: 'lasso' }
        lassoPath = [p.x, p.y]
    }

    const moveLasso = (p: { x: number; y: number }) => {
        const g = lassoGesture
        if (!g) return
        if (g.kind === 'lasso') {
            lassoPath?.push(p.x, p.y)
            paintLive()
            return
        }
        const pb = selectedBlock()
        if (!pb) return
        if (g.kind === 'move') {
            const d = clampDelta(g.box, p.x - g.fromX, p.y - g.fromY, pb.limit)
            setPreview({ kind: 'move', dx: d.dx, dy: d.dy })
            return
        }
        // A standalone drawing's box is sized from its own ink, so growing it grows the box and
        // there is nothing below to bump into; an attached fence's band is fixed by the text it
        // decorates, so both edges cap.
        const limit = pb.growsDown ? { ...pb.limit, maxY: Infinity } : pb.limit
        const reach = Math.hypot(p.x - g.ox, p.y - g.oy)
        setPreview({
            kind: 'scale',
            ox: g.ox,
            oy: g.oy,
            factor: clampScale(g.box, g.ox, g.oy, reach / g.start, limit),
        })
    }

    /** Turn the in-flight transform into a document edit. This is where PAINTED coordinates
     *  become STORED ones, and the conversion is not uniform: a y delta divides by the block's
     *  `yScale` (an attached fence stores pixels, not logical units) and a scale ORIGIN has to
     *  shed the block's paint offset before it does. The FACTOR needs no conversion at all —
     *  scaling is linear, so it is the same number in both spaces. */
    const commitSelectionEdit = () => {
        const pv = untrack(preview)
        const sel = untrack(selection)
        setPreview(null)
        if (!pv || !sel) return
        const pb = paintedBlocks().find(b => b.fromLine === sel.fromLine)
        const v = untrack(props.view) ?? sessionView
        if (!pb || !v || !v.dom.isConnected) return
        const before = v.state.doc.toString()
        const plan: Plan = planStrokeEdit(
            before,
            sel.fromLine,
            sel.indices,
            strokes =>
                pv.kind === 'move'
                    ? translateStrokes(strokes, pv.dx, pv.dy / pb.yScale)
                    : scaleStrokes(
                          strokes,
                          pv.ox,
                          (pv.oy - pb.dy) / pb.yScale,
                          pv.factor,
                      ),
        )
        if (!plan.ok) {
            // A drag that writes nothing looks to the user exactly like ink snapping back, so
            // this says why rather than comparing against `before` and returning.
            dropped('lasso edit', plan.reason, sel)
            return
        }
        if (plan.text === before) return
        textUndo.push(before)
        applyText(v, plan.text)
    }

    const endLasso = () => {
        const g = lassoGesture
        lassoGesture = null
        if (!g) return
        if (g.kind !== 'lasso') {
            commitSelectionEdit()
            paintLive()
            return
        }
        const poly = lassoPath
        lassoPath = null
        // Three points is the least that can enclose anything; a tap produces one.
        if (poly && poly.length >= 6) {
            setSelection(
                pickOwningBlock(
                    paintedBlocks().map(pb => ({
                        fromLine: pb.fromLine,
                        strokes: translateStrokes(shownStrokes(pb), 0, pb.dy),
                    })),
                    poly,
                ),
            )
        }
        paintLive()
    }

    /** One entry per markdown block, ascending by `y`. A block is a run of consecutive non-blank
     *  lines (blank lines separate blocks — the design's "paragraph boundaries, never line
     *  boundaries"), walked over CodeMirror's own height-map blocks so a fence already replaced
     *  by a widget counts once, at its real height.
     *
     *  FRONTMATTER IS NOT A BLOCK. A fence attached to the closing `---` is flipped to standalone
     *  by the autosave's own frontmatter normalizer within about 800ms, so ink must never be
     *  assigned to that band in the first place; leaving it out means ink drawn over the
     *  frontmatter belongs to the first real block instead. (inkCommit.ts carries the same guard
     *  as defence in depth, for a seam table built anywhere else.)
     *
     *  An ATTACHED fence contributes no band of its own — it is zero-height and the run it
     *  decorates already reports the edge its ink is stored against — but it does CLOSE that
     *  run. A STANDALONE fence is a band of its own. Which one a fence is comes from its info
     *  string, not from the whitespace around it. */
    const buildSeams = (): Seam[] => {
        const cg = contentGeom()
        if (!cg) return []
        const { v, s, padTop } = cg
        const doc = v.state.doc
        const yOf = (top: number) => (padTop + top) / s
        const byFrom = new Map<number, DrawBlock>()
        for (const b of blocks()) byFrom.set(b.fromLine, b)
        const { fenceLines, frontmatterClose } = runBounds(v)

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
            if (fromLine <= frontmatterClose) {
                flushRun()
            } else if (draw) {
                // ENDS the open run either way. An attached fence sits after the block it
                // decorates, so that block is finished; letting the run continue past it merged
                // the NEXT paragraph into the same band whenever no blank line separated them,
                // and a stroke drawn on paragraph A was then committed into paragraph B's fence
                // — painting correctly, but tied to the wrong block from then on.
                flushRun()
                if (draw.standalone) {
                    out.push({
                        y: yOf(blk.bottom),
                        afterLine: Math.max(0, draw.fromLine - 1),
                        origin: yOf(blk.top),
                        scale: 1,
                        standalone: true,
                    })
                }
            } else if (doc.lineAt(blk.from).text.trim() === '') {
                flushRun()
            } else {
                const lastLine = doc.lineAt(Math.min(blk.to, doc.length)).number
                const first = runFirstLine(
                    doc,
                    lastLine,
                    fenceLines,
                    frontmatterClose,
                )
                run = {
                    y: yOf(blk.bottom),
                    afterLine: lastLine,
                    origin: padTop + v.lineBlockAt(doc.line(first).from).top,
                    scale: s,
                    standalone: false,
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

    /** Paint the committed-ink canvas. Called only by `repaint`, which owns the WHEN; the guard
     *  makes it idempotent per scheduling, so the two schedulers below can both point at it and
     *  only the one that gets there first does any work. */
    let paintPending = false
    const paintNow = () => {
        if (!paintPending) return
        paintPending = false
        if (!base) return
        const g = geom()
        const bx = ctxOf(base)
        bx.setTransform(1, 0, 0, 1, 0, 0)
        bx.clearRect(0, 0, base.width, base.height)
        if (!g) return
        bx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY)
        const t = theme()
        const gone = erased()
        for (const pb of paintedBlocks()) {
            const shown = shownStrokes(pb)
            for (let i = 0; i < shown.length; i++) {
                if (gone.has(erasedKey(pb.fromLine, i))) continue
                bx.save()
                bx.translate(0, pb.dy)
                drawStroke(bx, shown[i], t)
                bx.restore()
            }
        }
        // Strokes drawn since the last flush are still in absolute capture coordinates —
        // the same space `dy + storedY` resolves to — so they need no shift and do not jump
        // when the flush finally lands.
        for (const st of pendingStrokes()) drawStroke(bx, st, t)
        paintLive()
    }

    /** One outstanding measure request per overlay. `EditorView.requestMeasure` dedupes on this,
     *  and giving each overlay its own object keeps two split panes from replacing each other's. */
    const paintKey = {}

    /** Schedule one paint, IN THE EDITOR'S MEASURE PHASE.
     *
     *  THE RULE: the overlay never paints against geometry the editor has not finished measuring.
     *  `paintedBlocks()` gets every block top from `view.lineBlockAt`, which reads CodeMirror's
     *  HEIGHT MAP, and that map is only true after a measure. A bare `requestAnimationFrame` gave
     *  no such guarantee and reliably lost the race, which is the whole of the user's *"the
     *  position for a sec goes off, and then reutrns to the correctr posiition"*:
     *
     *   - A document change rebuilds `drawBlockField`, so EVERY ```draw widget in the note is
     *     destroyed and re-created — `DrawBlockWidget.eq()` compares the strokes array by
     *     reference and `scanDrawBlocks` returns a fresh one each scan, so it is never equal.
     *     Until the next measure each of those widgets occupies a DEFAULT LINE HEIGHT rather
     *     than the zero (attached) or reserved (standalone) height it is about to have.
     *   - `flushNow` clears the op log — a signal this component's paint effect reads — BEFORE it
     *     dispatches that change, so the overlay's frame callback was registered ahead of
     *     CodeMirror's, and ran ahead of it too.
     *
     *  Measured in the running app: four annotations, sampled every animation frame across each
     *  commit, sat at 135/216/270/383 and on three single frames read 135/243/324/464 — every
     *  drawing below a fence one 27px line lower per fence above it, for exactly one frame.
     *
     *  `requestMeasure`'s `read` runs inside `EditorView.measure()` AFTER `viewState.measure()`
     *  has re-measured the DOM and settled the height map, and before the browser paints — so the
     *  geometry read and the pixels written describe the same layout. The canvas work happens in
     *  `read` rather than `write` on purpose: it is neither a DOM read nor a DOM write, so it
     *  cannot dirty layout and start a measure loop, and keeping it in `read` means no other
     *  extension's write phase can move the editor between the measurement and the paint.
     *
     *  THIS COVERS SCROLL TOO, deliberately. A scroll repaint had the same hazard for the same
     *  reason (scrolling renders lines whose heights were estimates), and one scheduler that is
     *  right for both beats two that can disagree. It costs nothing: `requestMeasure` rides the
     *  animation frame CodeMirror was already going to schedule.
     *
     *  The bare frame stays as a FALLBACK, never as the primary. A view destroyed between here
     *  and the frame would never run its measure requests, and `paintPending` would latch on
     *  forever — the same permanent-stall shape the stories' header describes for a hidden tab.
     *  It cannot double-paint: `paintNow` consumes the flag. And it cannot beat the measure phase
     *  to it, because `requestMeasure` either finds CodeMirror's frame callback already
     *  registered or registers it one line before this one. */
    const repaint = () => {
        if (paintPending || !base) return
        paintPending = true
        const v = props.view()
        if (v && v.dom.isConnected) {
            v.requestMeasure({ key: paintKey, read: paintNow })
        }
        requestAnimationFrame(paintNow)
    }
    const paintLive = () => {
        if (!live) return
        const lx = ctxOf(live)
        lx.setTransform(1, 0, 0, 1, 0, 0)
        lx.clearRect(0, 0, live.width, live.height)
        const g = geom()
        if (!g) return
        lx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY)
        if (current) drawStroke(lx, current, theme())
        paintSelection(lx, g.s)
    }

    /** The lasso's own chrome: the polygon while it is being drawn, then a marching-ants box
     *  around what it caught with a resize handle on each bottom corner.
     *
     *  Every size here is divided by the live content scale before use, because the canvas
     *  transform multiplies by it — without that, the selection outline and its handles would
     *  grow and shrink with the pane while the pointer tolerance stayed a screen constant, and
     *  the two would stop agreeing about what "on the handle" means. */
    const paintSelection = (
        lx: Ctx2D & CanvasRenderingContext2D,
        s: number,
    ) => {
        const t = theme()
        if (lassoPath && lassoPath.length >= 4) {
            lx.save()
            lx.strokeStyle = t.fg
            lx.globalAlpha = 0.7
            lx.lineWidth = 1 / s
            lx.setLineDash([4 / s, 4 / s])
            lx.beginPath()
            lx.moveTo(lassoPath[0], lassoPath[1])
            for (let i = 2; i + 1 < lassoPath.length; i += 2) {
                lx.lineTo(lassoPath[i], lassoPath[i + 1])
            }
            lx.closePath()
            lx.stroke()
            lx.restore()
        }
        const box = selectionBox()
        if (!box) return
        lx.save()
        lx.strokeStyle = t.fg
        lx.lineWidth = 1 / s
        lx.setLineDash([5 / s, 4 / s])
        lx.lineDashOffset = -dashPhase() / s
        lx.strokeRect(
            box.minX,
            box.minY,
            box.maxX - box.minX,
            box.maxY - box.minY,
        )
        lx.setLineDash([])
        lx.fillStyle = t.bg
        const half = HANDLE_PX / (2 * s)
        for (const h of handlePoints(box)) {
            lx.fillRect(h.x - half, h.y - half, half * 2, half * 2)
            lx.strokeRect(h.x - half, h.y - half, half * 2, half * 2)
        }
        lx.restore()
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
    // Repaint when the ink, its geometry, the uncommitted session, or an in-flight lasso drag
    // changes. `preview()` is in here rather than only on the live canvas because a lasso move
    // shifts COMMITTED ink, which lives on the base canvas.
    createEffect(() => {
        blocks()
        geomTick()
        ops()
        preview()
        selection()
        repaint()
    })

    // The ants crawl only while there is a box to crawl around.
    createEffect(() => {
        if (!selection()) return
        const id = setInterval(() => {
            setDashPhase(p => (p + 2) % 18)
            paintLive()
        }, 90)
        onCleanup(() => clearInterval(id))
    })

    // Switching away from the lasso drops the selection: the box would otherwise sit there
    // catching pointer events that the pen tool is meant to receive.
    createEffect(() => {
        if (tools().tool === 'lasso') return
        setSelection(null)
        setPreview(null)
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

    /** Turn the session's op log into one document edit.
     *
     *  Erases go first, each resolved against the text AS IT STANDS at that point in the loop —
     *  which is what replaced the old "group by fence, splice highest index first" ordering.
     *  That ordering existed so one splice could not shift the next one's target; addressing a
     *  stroke by its own content makes the question moot, because the second op re-finds its
     *  stroke wherever the first splice left it. Every added stroke then goes in through a
     *  single planCommitStrokes call, which orders the fence inserts bottom-up for itself.
     *
     *  **Nothing is discarded until the plan is known.** The op log used to be emptied at the
     *  top of this function, before anything had been consulted, so an erase that could not
     *  apply was gone with no write and no report. */
    const flushNow = (): void => {
        clearTimeout(commitTimer)
        const pending = untrack(ops)
        if (!pending.length) return
        // `sessionView` is the fallback, and it is the whole answer to a class of silent data
        // loss. On a NOTE SWITCH Solid runs the parent's cleanup first: Editor.tsx destroys the
        // view and nulls the signal BEFORE this component's own cleanup runs, so `props.view()`
        // is already undefined by the time a path-change flush is attempted, and everything drawn
        // in the last COMMIT_DELAY milliseconds went in the bin. Holding the view we drew ON lets
        // that flush still land whenever the view is merely un-referenced rather than destroyed.
        // The real defence is flushing EARLIER — see the focusout handler, which fires on the
        // very click that goes on to change the note, while everything is still alive.
        const v = untrack(props.view) ?? sessionView
        if (!v || !v.dom.isConnected) return

        const before = v.state.doc.toString()
        let text = before
        for (const op of pending) {
            if (op.kind !== 'erase') continue
            const plan = planErase(text, op.ref)
            if (plan.ok) {
                text = plan.text
                continue
            }
            // Its fence moved out from under it, or another writer had already taken that
            // stroke. Either way there is nothing here to erase, and erasing whatever now sits
            // at that index would remove ink the user never pointed at.
            dropped('erase', plan.reason, op.ref)
        }
        text = planCommitStrokes(
            text,
            pending.flatMap(o => (o.kind === 'add' ? [o.stroke] : [])),
            sessionSeams,
            STANDALONE_PAD,
        )

        // Only now — the ops have been spent against a real document, and whatever could not be
        // spent has been reported. Clearing them earlier is what made the failure silent.
        setOps([])
        redoLog = []
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

    /** Carry the whole pending session across a document change this overlay did not make.
     *
     *  Called from the update listener and nowhere else, because `changes` is the only thing
     *  that knows where a line went and it exists only there. It runs BEFORE the deferred flush,
     *  so by the time a plan is made every reference in the log describes the document the plan
     *  will be made against.
     *
     *  The rules — which reference is dropped and which is merely moved, and why `origin` is
     *  deliberately left alone — are in inkRemap.ts. This function is the wiring.
     *
     *  A note switch is NOT one of these: it does not change the document, it replaces it, and
     *  `props.path()`'s cleanup flushes against the old buffer instead. */
    const remapSession = (
        changes: ChangeDesc,
        beforeDoc: Text,
        afterDoc: Text,
    ): void => {
        // Not gated on `ops` being non-empty: a foreign change can land between pen-down (which
        // captures the table) and pen-up (which logs the stroke), and the stroke in flight is
        // committed against this table too.
        sessionSeams = remapSeams(changes, beforeDoc, afterDoc, sessionSeams)
        setOps(prev => {
            const out: InkOp[] = []
            let moved = false
            for (const op of prev) {
                if (op.kind !== 'erase') {
                    out.push(op)
                    continue
                }
                const fromLine = remapAnchorLine(
                    changes,
                    beforeDoc,
                    afterDoc,
                    op.ref.fromLine,
                )
                if (fromLine === null) {
                    // The change deleted across the fence. There is no line to carry this to,
                    // and the nearest surviving one would just be a guess at somebody else's
                    // fence — so the op goes, and it goes audibly.
                    dropped('erase', 'fence deleted by another writer', op.ref)
                    moved = true
                    continue
                }
                if (fromLine !== op.ref.fromLine) moved = true
                out.push({ kind: 'erase', ref: { ...op.ref, fromLine } })
            }
            // Identity in, identity out when nothing actually moved: this runs on every foreign
            // keystroke, and the canvases repaint off `ops()`.
            return moved ? out : prev
        })
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
        // A selection names stroke INDICES inside a fence, so it means nothing once the document
        // has moved under it — and a stale box would move the wrong ink on the next drag.
        setSelection(null)
        setPreview(null)
        lassoPath = null
        lassoGesture = null
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
                                // Somebody else moved the text under us. THE MAPPING IS ONLY
                                // KNOWABLE HERE — `u.changes` exists nowhere else — so the
                                // pending references are rewritten synchronously, before
                                // anything else gets a chance to run.
                                remapSession(
                                    u.changes,
                                    u.startState.doc,
                                    u.state.doc,
                                )
                                // Then commit what the user has drawn (deferred: dispatching
                                // from inside an update is forbidden) and drop the snapshots,
                                // which no longer describe this document.
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

    // Every other way a debounce window can end badly.
    //
    // `focusout` is the important one. While drawing, the host holds focus, so ANY navigation —
    // clicking the file tree, a tab, a wikilink, opening the palette — takes focus away from it
    // first, synchronously, on the very event that will go on to switch the note. Flushing there
    // means the commit lands while the view is unquestionably alive, which is what makes the
    // note-switch case safe rather than merely less likely.
    //
    // `beforeunload` + `pagehide` cover quitting or reloading, where no Solid cleanup runs at
    // all. HONEST LIMIT: Editor.tsx registers its OWN `beforeunload` disk flush when it mounts,
    // which is strictly before this effect can run, and same-target listeners fire in
    // registration order — so on a reload the note is written out before this commit lands and
    // the last debounce window is still lost. These two listeners buy the cases where the page
    // is hidden without Editor tearing down; they do not make a reload safe, and saying they did
    // would be worse than the gap.
    createEffect(() => {
        if (!props.active()) return
        const el = host()
        const onBlur = () => flushNow()
        const onFocusOut = (e: FocusEvent) => {
            // Moving between the overlay's own controls (the drawing toolbar lives inside the
            // host) is not leaving.
            const to = e.relatedTarget
            if (el && to instanceof Node && el.contains(to)) return
            flushNow()
        }
        window.addEventListener('blur', onBlur)
        window.addEventListener('beforeunload', onBlur)
        window.addEventListener('pagehide', onBlur)
        el?.addEventListener('focusout', onFocusOut)
        onCleanup(() => {
            window.removeEventListener('blur', onBlur)
            window.removeEventListener('beforeunload', onBlur)
            window.removeEventListener('pagehide', onBlur)
            el?.removeEventListener('focusout', onFocusOut)
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
            // The SAME geometry the paint used, or the eraser misses exactly the ink the user
            // is pointing at on any attached fence.
            const shown = shownStrokes(pb)
            for (let i = shown.length - 1; i >= 0; i--) {
                if (gone.has(erasedKey(pb.fromLine, i))) continue
                if (hits(shown[i], pb.dy, p, tol)) {
                    // `shown` is the PAINTED geometry (y-scaled, lasso preview folded in) and
                    // exists only to hit-test; the reference has to carry the STORED stroke,
                    // which is what a fence's payload will decode back to when the flush looks
                    // for it. Same index, same order — `shownStrokes` maps `pb.strokes` 1:1.
                    pushOp({
                        kind: 'erase',
                        ref: {
                            fromLine: pb.fromLine,
                            index: i,
                            stroke: pb.strokes[i],
                        },
                    })
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
        sessionView = v
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
        if (ts.tool === 'lasso') {
            beginLasso(p)
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
        if (ts.tool === 'lasso') {
            moveLasso(toLogical(e))
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
        if (lassoGesture) {
            endLasso()
            return
        }
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
                        lasso
                        onUndo={undo}
                        onRedo={redo}
                    />
                </Show>
            </div>
        </Show>
    )
}
