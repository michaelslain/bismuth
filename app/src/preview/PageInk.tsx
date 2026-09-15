// app/src/preview/PageInk.tsx
// In-place ink over an image or PDF preview. PreviewView mounts it over the `<img>` (one page)
// or hands it to PdfPages as its `overlay` (one page per PDF page), and it paints the strokes of
// the file's sidecar `<file>.draw` onto each page where that page is actually rendered.
//
// THE CONTRACT (core/src/drawing/pageInk.ts owns the math): sidecar page i ↔ source page i, the
// source page occupies `pageBoxFor(doc, i, nat)` inside the 816x1056 logical page, and a screen
// point maps through the page's rendered rect. That is what makes every annotation drawn on the
// retired ANNOTATE surface (which stored that box as `images[0]`) land in the same place here.
// A sidecar CREATED here carries strokes only — no embedded `data:` copy of the source.
//
// Mirrors editor/InkOverlay.tsx where it can, without importing it (that drags CodeMirror in):
//   • dual canvas per page — a committed base + a live draft for the stroke in flight;
//   • paint-only unless `active()`, and draw-mode keys (Escape, Mod+Z, Mod+Shift+Z) handled on
//     the focused host — scoped to this pane by focus, never a window-level key listener;
//   • its OWN undo stack, cleared when draw mode exits.
//
// Differences that are deliberate:
//   • It PAINTS SYNCHRONOUSLY from effects, never through requestAnimationFrame. There is no
//     editor measure phase to wait for here (the geometry comes in as props), and a rAF-gated
//     paint would stall in a backgrounded tab.
//   • Canvases exist only for pages near the viewport (an IntersectionObserver per page slot):
//     a 100-page PDF at DPR 2 would otherwise hold hundreds of megabytes of empty canvas.
//   • The toolbar docks through a zero-height `position: sticky` element at the bottom of the
//     host, because in a PDF the host is as tall as the WHOLE page stack — a plain absolute
//     `bottom` would put the toolbar under the last page.
//
// Persistence lives in createAnnotationStore.ts (annotationTypes.ts's AnnotationStore) — the
// ONE owner of the sidecar while a preview is open, so ink, highlights and bookmarks share one
// debounce/undo/writer. A caller that already owns a store (PreviewView, which shares one with
// HighlightLayer and BookmarksPanel) passes it in; absent that, this component makes its own so
// it keeps working standalone.
//
// Margin: PageInkPage.marginW is host px of drawable margin to the right of `rendered`. The
// slot, both canvases and pointer capture all span `rendered.w + marginW`, but the logical
// scale stays `rendered.w / box.w` — computed from the page's own width, never the margin-
// widened element — so a stroke drawn in the margin lands at logical x beyond `box.x + box.w`
// at the SAME density as the page itself, rather than being stretched by the extra canvas.
import {
    createEffect,
    createSignal,
    Index,
    onCleanup,
    Show,
    untrack,
} from 'solid-js'
import {
    emptyDoc,
    type DrawingDoc,
    type Stroke,
} from '../../../core/src/drawing/model'
import {
    ensurePages,
    pageBoxFor,
    screenToLogical,
    type LogicalBox,
    type ScreenRect,
} from '../../../core/src/drawing/pageInk'
import { drawStroke, type Ctx2D } from '../../../core/src/drawing/render2d'
import { themeColors } from '../../../core/src/drawing/theme'
import { smoothStrokePoints } from '../../../core/src/drawing/smooth'
import { widthFor, isRealPressure } from '../drawing/input'
import { Toolbar } from '../drawing/Toolbar'
import type { ToolState } from '../drawing/DrawingCanvas'
import { pushToast } from '../Toast'
import createAnnotationStore from './createAnnotationStore'
import type { AnnotationStore } from './annotationTypes'
import styles from './PageInk.module.css'

/** One source page as PreviewView measured it: where it renders, in the HOST's coordinate space
 *  (the host is `inset: 0` over the element that positions the pages), and its natural size. */
export type PageInkPage = {
    rendered: ScreenRect
    nat: { w: number; h: number }
    /** Host px of drawable margin to the right of `rendered` — 0/absent means no margin. */
    marginW?: number
}

export type PageInkProps = {
    /** `inkSidecarFor(binary)` — the `.draw` the strokes live in. */
    sidecarPath: string
    /** The binary itself (never the sidecar) — the key FileTree's flush-before-move/delete
     *  protocol registers/looks this writer up by (editorRegistry.ts's `registerSidecarFlush`),
     *  since the sidecar's own path doesn't match the binary under `isUnder`'s folder-prefix
     *  semantics. */
    binaryPath: string
    pages: () => PageInkPage[]
    /** Draw mode. */
    active: () => boolean
    onExit: () => void
    class?: string
    /** The sidecar's owner, when one already exists (e.g. PreviewView also drives highlights or
     *  bookmarks off it). Absent means this component creates its own — see the header. */
    store?: AnnotationStore
}

// Tool choice follows the user across previews for the session, like note ink's.
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

const DPR_CAP = 2

/** A sidecar created by the in-place surface: blank paper (the source IS the surface), and no
 *  embedded image — see the contract above. */
const freshDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    return d
}

const ctxOf = (c: HTMLCanvasElement) =>
    c.getContext('2d') as (Ctx2D & CanvasRenderingContext2D) | null

function PageInk(props: PageInkProps) {
    // Unlike note ink (InkOverlay, DrawingPage), which paints over the app's own dark chrome and
    // always resolves `fg` against the dark bucket, this surface paints ONTO the source page —
    // an image or a PDF page, both of which render as light/white content. Resolving `fg` against
    // the dark bucket here would pick the dark theme's light-coloured ink, nearly invisible on a
    // white page (fix 1). So the page is treated as paper: light bucket, always — independent of
    // the app's own live appearance.
    const theme = () => themeColors('light')
    const dpr = () => Math.min(window.devicePixelRatio || 1, DPR_CAP)

    const [host, setHost] = createSignal<HTMLDivElement | undefined>()

    // ── Persistence ─────────────────────────────────────────────────────────────────────────
    const store: AnnotationStore =
        props.store ??
        createAnnotationStore(
            () => props.sidecarPath,
            () => props.binaryPath,
        )

    /** Draw mode ended: commit, then forget the drawing undo. */
    createEffect(() => {
        if (props.active()) {
            queueMicrotask(() => host()?.focus({ preventScroll: true }))
            return
        }
        // store.flush() already catches its own save failures (toasts, then resolves) — see
        // createAnnotationStore.ts.
        store.flush()
        store.resetHistory()
    })

    // Every other way a debounce window can end badly (InkOverlay's list, minus the CodeMirror
    // specifics): focus leaving the pane is the one that fires on the very click that navigates.
    createEffect(() => {
        if (!props.active()) return
        const el = host()
        const onFocusOut = (e: FocusEvent) => {
            const to = e.relatedTarget
            if (el && to instanceof Node && el.contains(to)) return
            store.flush()
        }
        window.addEventListener('blur', store.flush)
        window.addEventListener('beforeunload', store.flush)
        window.addEventListener('pagehide', store.flush)
        el?.addEventListener('focusout', onFocusOut)
        onCleanup(() => {
            window.removeEventListener('blur', store.flush)
            window.removeEventListener('beforeunload', store.flush)
            window.removeEventListener('pagehide', store.flush)
            el?.removeEventListener('focusout', onFocusOut)
        })
    })

    // ── Geometry ────────────────────────────────────────────────────────────────────────────
    const boxOf = (i: number, page: PageInkPage): LogicalBox =>
        pageBoxFor(store.doc() ?? freshDoc(), i, page.nat.w, page.nat.h)

    /** Size a canvas to its page (plus margin) at the device ratio and set the logical → canvas
     *  transform. The transform's scale comes from `page.rendered.w` ALONE — never the wider,
     *  margin-inclusive canvas — so ink in the margin sits at the same density as the page. */
    const prepare = (
        c: HTMLCanvasElement,
        page: PageInkPage,
        box: LogicalBox,
    ): (Ctx2D & CanvasRenderingContext2D) | null => {
        const r = dpr()
        const totalW = page.rendered.w + (page.marginW ?? 0)
        const w = Math.max(1, Math.round(totalW * r))
        const h = Math.max(1, Math.round(page.rendered.h * r))
        if (c.width !== w) c.width = w
        if (c.height !== h) c.height = h
        const ctx = ctxOf(c)
        if (!ctx) return null
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, w, h)
        // Canvas px per logical unit, from the PAGE's own rendered width — screenToLogical's
        // inverse scale times the device ratio, rounding included. Using `totalW` here instead
        // would stretch the page's own ink whenever a margin is present.
        const rw = Math.max(1, Math.round(page.rendered.w * r))
        const k = rw / box.w
        ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k)
        return ctx
    }

    // ── Visibility: canvases only for pages near the viewport ──────────────────────────────
    const nearSetters = new Map<Element, (v: boolean) => void>()
    const io = new IntersectionObserver(
        entries => {
            for (const e of entries) {
                nearSetters.get(e.target)?.(e.isIntersecting)
            }
        },
        { rootMargin: '50% 0px' },
    )
    onCleanup(() => io.disconnect())

    // ── Stroke capture (DrawingCanvas's state machine, in logical page coordinates) ─────────
    let drawingPage: number | null = null
    let hasReal = false
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    let lastRaw = { x: 0, y: 0, t: 0 }
    let current: Stroke | null = null
    const liveCanvases = new Map<number, HTMLCanvasElement>()

    const canDraw = () =>
        untrack(props.active) && untrack(store.loadState) === 'ready'

    const toLogical = (e: PointerEvent, i: number, el: HTMLElement) => {
        const page = untrack(props.pages)[i]
        const r = el.getBoundingClientRect()
        if (!page) return { x: 0, y: 0 }
        // The reference rect's width is the PAGE's own rendered width, not the element's actual
        // (margin-widened) bounding width — see the header note on the transform.
        return screenToLogical(
            { x: e.clientX, y: e.clientY },
            { left: r.left, top: r.top, w: page.rendered.w, h: r.height },
            untrack(() => boxOf(i, page)),
        )
    }

    const paintLive = (i: number) => {
        const c = liveCanvases.get(i)
        const page = untrack(props.pages)[i]
        if (!c || !page) return
        const ctx = prepare(
            c,
            page,
            untrack(() => boxOf(i, page)),
        )
        if (ctx && current && drawingPage === i) {
            drawStroke(ctx, current, theme())
        }
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
    const armHold = (i: number) => {
        clearTimeout(holdTimer)
        const ts = tools()
        if (!ts.holdToStraighten || ts.tool !== 'pen') return
        holdTimer = setTimeout(() => {
            if (current && current.pts.length > 9) {
                current.straight = true
                current.pts = [
                    current.pts[0],
                    current.pts[1],
                    255,
                    lastRaw.x,
                    lastRaw.y,
                    255,
                ]
                paintLive(i)
            }
        }, ts.holdDelayMs)
    }

    /** Remove the topmost stroke on page `i` within the eraser's reach of `p`. */
    const eraseAt = (i: number, p: { x: number; y: number }) => {
        const d = untrack(store.doc)
        const strokes = d?.pages[i]?.strokes
        if (!d || !strokes) return
        const tol = tools().size + 8
        for (let s = strokes.length - 1; s >= 0; s--) {
            const pts = strokes[s].pts
            for (let j = 0; j + 1 < pts.length; j += 3) {
                if (Math.hypot(pts[j] - p.x, pts[j + 1] - p.y) < tol) {
                    store.edit(cur => {
                        const pages = cur.pages.slice()
                        pages[i] = {
                            ...pages[i],
                            strokes: pages[i].strokes.filter(
                                (_, k) => k !== s,
                            ),
                        }
                        return { ...cur, pages }
                    })
                    return
                }
            }
        }
    }

    const commitStroke = (i: number, stroke: Stroke) => {
        store.edit(d => {
            const base = ensurePages(d, i + 1)
            const pages = base.pages.slice()
            pages[i] = { ...pages[i], strokes: [...pages[i].strokes, stroke] }
            return { ...base, pages }
        })
    }

    const onDown = (e: PointerEvent, i: number) => {
        if (!canDraw()) {
            if (untrack(store.loadState) === 'failed') {
                pushToast("Couldn't read this file's ink, so drawing is off")
            }
            return
        }
        const el = e.currentTarget as HTMLCanvasElement
        try {
            el.setPointerCapture(e.pointerId)
        } catch {
            /* a synthetic event has no live pointer to capture */
        }
        drawingPage = i
        hasReal = isRealPressure(e.pressure)
        const p = toLogical(e, i, el)
        lastRaw = { x: p.x, y: p.y, t: e.timeStamp }
        const ts = tools()
        if (ts.tool === 'eraser') {
            current = null
            eraseAt(i, p)
            return
        }
        if (ts.tool === 'lasso') {
            // Not offered here (the Toolbar renders no lasso segment), but the tool state is
            // shared with note ink, so a lasso carried over from a note is a no-op, not a pen.
            drawingPage = null
            return
        }
        current = {
            t: ts.tool,
            c: ts.color,
            w: ts.size,
            pts: [p.x, p.y, pressureByte(e.pressure, 0)],
        }
        armHold(i)
    }
    const onMove = (e: PointerEvent, i: number) => {
        if (drawingPage !== i) return
        const el = e.currentTarget as HTMLCanvasElement
        if (tools().tool === 'eraser') {
            eraseAt(i, toLogical(e, i, el))
            return
        }
        // A synthetic PointerEvent returns an EMPTY coalesced list rather than omitting it.
        const coalesced = e.getCoalescedEvents?.()
        for (const ev of coalesced && coalesced.length ? coalesced : [e]) {
            const raw = toLogical(ev, i, el)
            const dt = Math.max(ev.timeStamp - lastRaw.t, 1)
            const dist = Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y)
            const speed = (dist / dt) * 16
            if (isRealPressure(ev.pressure)) hasReal = true
            if (current && !current.straight) {
                current.pts.push(raw.x, raw.y, pressureByte(ev.pressure, speed))
                if (dist > 3) armHold(i)
            }
            lastRaw = { x: raw.x, y: raw.y, t: ev.timeStamp }
        }
        if (current?.straight) {
            const raw = toLogical(e, i, el)
            current.pts[3] = raw.x
            current.pts[4] = raw.y
        }
        paintLive(i)
    }
    const onUp = (i: number) => {
        if (drawingPage !== i) return
        drawingPage = null
        clearTimeout(holdTimer)
        const stroke = current
        current = null
        if (stroke && stroke.pts.length >= 6) {
            if (!stroke.straight && tools().smoothMode === 'smooth') {
                stroke.pts = smoothStrokePoints(stroke.pts)
            }
            commitStroke(i, stroke)
        }
        paintLive(i)
    }

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
            if (e.shiftKey) store.redo()
            else store.undo()
        }
    }

    onCleanup(() => {
        clearTimeout(holdTimer)
        store.flush()
    })

    const hasInkOn = (i: number) =>
        (store.doc()?.pages[i]?.strokes.length ?? 0) > 0

    return (
        <div
            ref={setHost}
            class={`${styles['page-ink']} ${props.class ?? ''}`}
            classList={{ [styles.active]: props.active() }}
            data-testid="page-ink"
            tabindex={-1}
            onKeyDown={onHostKey}
            onPointerDown={() => {
                if (props.active()) host()?.focus({ preventScroll: true })
            }}
        >
            <Index each={props.pages()}>
                {(page, i) => {
                    const [near, setNear] = createSignal(false)
                    const [base, setBase] = createSignal<HTMLCanvasElement>()
                    const observe = (el: HTMLDivElement) => {
                        nearSetters.set(el, setNear)
                        io.observe(el)
                        onCleanup(() => {
                            io.unobserve(el)
                            nearSetters.delete(el)
                        })
                    }
                    // Paint the committed strokes whenever the ink, the page's geometry or the
                    // canvas itself changes.
                    createEffect(() => {
                        const c = base()
                        const pg = page()
                        const d = store.doc()
                        if (!c) return
                        const ctx = prepare(c, pg, boxOf(i, pg))
                        if (!ctx) return
                        const t = theme()
                        for (const s of d?.pages[i]?.strokes ?? []) {
                            drawStroke(ctx, s, t)
                        }
                    })
                    return (
                        <div
                            ref={observe}
                            class={styles['page-ink-slot']}
                            data-testid={`ink-page-${i}`}
                            style={{
                                left: `${page().rendered.left}px`,
                                top: `${page().rendered.top}px`,
                                width: `${
                                    page().rendered.w +
                                    (page().marginW ?? 0)
                                }px`,
                                height: `${page().rendered.h}px`,
                            }}
                        >
                            <Show
                                when={
                                    near() && (props.active() || hasInkOn(i))
                                }
                            >
                                <canvas
                                    ref={el => {
                                        setBase(el)
                                        onCleanup(() => setBase(undefined))
                                    }}
                                    class={styles['page-ink-canvas']}
                                    data-testid="ink-canvas-committed"
                                />
                                <canvas
                                    ref={el => {
                                        liveCanvases.set(i, el)
                                        onCleanup(() => {
                                            if (liveCanvases.get(i) === el) {
                                                liveCanvases.delete(i)
                                            }
                                        })
                                    }}
                                    class={`${styles['page-ink-canvas']} ${styles['page-ink-live']}`}
                                    data-testid="ink-canvas-live"
                                    onPointerDown={e => onDown(e, i)}
                                    onPointerMove={e => onMove(e, i)}
                                    onPointerUp={() => onUp(i)}
                                    onPointerCancel={() => onUp(i)}
                                />
                            </Show>
                        </div>
                    )
                }}
            </Index>
            <div class={styles['page-ink-dock']}>
                <Show when={props.active()}>
                    <Toolbar
                        tools={tools}
                        setTools={setTools}
                        onUndo={store.undo}
                        onRedo={store.redo}
                        fgColor={theme().fg}
                    />
                </Show>
            </div>
        </div>
    )
}

export default PageInk
