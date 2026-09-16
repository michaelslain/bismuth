// app/src/preview/PdfPages.tsx
// Renders a PDF as a vertically-stacked, fit-width page stack (pdf.js), replacing the old
// `<iframe>` embed in PreviewView. Only pages in the current scroll viewport (+ overscan) are
// rasterized — see `pageLayout.ts` for the pure layout/visibility math this drives.
//
// DATA SEAM: `load()` returns the PDF's bytes — PreviewView passes `fetch(assetUrl).arrayBuffer()`;
// a story feeds it a PDF built in-browser with jspdf. This is what lets a Storybook story render
// real pages without hitting `/asset` (the fake transport's base is `fake://storybook`, so a
// `src`-shaped prop could never load there).
//
// LAZY pdf.js: this component IS imported statically by PreviewView, so pdf.js itself is loaded
// via a dynamic `import('./pdfjsSetup')` here (not a top-level import) — that's what keeps the
// `pdfjs` manual chunk (vite.config.ts) off the boot bundle. `pdfjsSetup.ts` sets up the worker
// via STATIC imports of pdfjs-dist + the worker `?url` asset — see that module's header for why
// the worker import specifically has to stay static rather than living inline in this dynamic
// import.
//
// NAVIGATION SEAMS (all optional): `onPageCount` + `onCurrentPage` report where the reader is,
// `onOutline` hands over the document's embedded outline with real page indices (pdfOutline.ts),
// and `controller` hands out `scrollToPage` once the scroll element exists. `marginRatio` adds
// drawable margin paper to the right of every page (pageLayout.ts has the geometry).
//
// PAGE FRAME: the stack sits on the scroll element's own `--surface-2` desk with a `pad`-px
// gutter on every side (pageLayout.ts's new `pad` parameter), so the desk stays visible around
// the page even at fit width. `pad` is read ONCE, from `--sp-6`'s resolved computed value on the
// scroll element itself (falling back to `16` if that ever fails to parse) — never a hand-typed
// literal, so it follows the token rather than a copy of it. `errorAction` is an optional extra
// control (e.g. PreviewView's "open in default app") rendered under the load-failure message.
import {
    children,
    createEffect,
    createMemo,
    createSignal,
    Index,
    on,
    onCleanup,
    Show,
    untrack,
    type JSX,
} from 'solid-js'
import EmptyState, { Loading } from '../ui/EmptyState'
import type {
    OutlineNode,
    PdfPagesController,
    PdfPosition,
} from './annotationTypes'
import { resolveOutline, type RawOutlineItem } from './pdfOutline'
import {
    currentPageIndex,
    layoutPages,
    positionAt,
    scrollTopForPage,
    scrollTopForPosition,
    visiblePageRange,
    type PageBox,
    type PageSize,
} from './pageLayout'
import { pdfCache, rasterStash, type LoadedPdf } from './pdfDocCache'
import PdfPageCanvas from './PdfPageCanvas'
import ScratchPaper from './ScratchPaper'
import styles from './PdfPages.module.css'

const GAP = 16 // px between stacked pages
const OVERSCAN = 1 // pages rendered beyond the viewport on each side

// The margin is the SCRATCH surface, not more of the page: it takes
// the note editor's own ground + hairline (ScratchPaper.tsx — `var(--editor)` / `var(--rule-soft)`)
// rather than matching the PDF page's own fixed white the way it used to. It still gets its
// position, drop shadow and left-edge clipping from THIS file's `.pdf-margin` class below, since
// those are page-stack layout concerns, not part of the reusable surface. PageInk resolves ink
// drawn on the page proper against the LIGHT theme bucket (dark ink on paper) and ink drawn on
// this strip against the DARK bucket (note ink) — see PageInk.tsx's header for why.

export type PdfPagesProps = {
    load: () => Promise<ArrayBuffer> // data seam — PreviewView passes fetch(assetUrl).arrayBuffer()
    zoom: number // 1 = fit width
    class?: string
    /** Called whenever layout changes; Task 5 positions one ink canvas per page from these. */
    onLayout?: (layout: {
        boxes: PageBox[]
        sizes: PageSize[]
        scrollEl: HTMLElement
    }) => void
    /** Rendered INSIDE the scroll content, above the page canvases, so it scrolls with them. */
    overlay?: JSX.Element
    /** Margin paper to the right of every page, as a fraction of the page's rendered width.
     *  Page + margin together keep the `zoom` width. 0 / omitted = no margin. */
    marginRatio?: number
    /** Once per loaded document: its embedded outline, `[]` when it has none. */
    onOutline?: (outline: OutlineNode[]) => void
    /** The page one third down the viewport (0-based); fires when it changes, and once per
     *  loaded document. */
    onCurrentPage?: (index: number) => void
    /** The loaded document's page count, once per document. */
    onPageCount?: (n: number) => void
    /** Handed the navigation controller once the scroll element exists (again after a reload
     *  recreates it). */
    controller?: (c: PdfPagesController) => void
    /** Extra action rendered under the "Couldn't load PDF" message (e.g. PreviewView's "open in
     *  default app" for a Tauri-only format pdf.js can't parse). Absent renders nothing extra. */
    errorAction?: JSX.Element
    /** When set, the loaded document survives unmount in a session cache keyed by this string,
     *  so a remount with the same key skips fetch + parse and paints its last frame at once. */
    cacheKey?: string
    /** Applied once per loaded document, as soon as the scroll element is measured. */
    initialPosition?: PdfPosition
    /** Fires on every scroll of the ready scroll element and after a jump or restore. Never fires
     *  from a load's reset to the top, never for a document that is no longer current, never
     *  while an `initialPosition` restore is still pending, and never from a scroll element that
     *  is detached, unmeasured (zero width/height) or has no laid-out pages — so a teardown can
     *  never overwrite a remembered position with `{ index: 0, yFraction: 0 }`. */
    onPosition?: (p: PdfPosition) => void
}

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

type PdfjsSetupModule = typeof import('./pdfjsSetup')
let pdfjsSetupPromise: Promise<PdfjsSetupModule> | undefined

/** Load pdfjs-dist + its shared worker (see pdfjsSetup.ts), exactly once per session, behind a
 *  dynamic import so pdfjs stays out of the boot bundle. */
function loadPdfjsSetup(): Promise<PdfjsSetupModule> {
    pdfjsSetupPromise ??= import('./pdfjsSetup')
    return pdfjsSetupPromise
}

type Status = 'loading' | 'ready' | 'error'

// Identity of one loaded document (see `LoadedPdf.id`): minted per miss, carried by the cache
// entry so a hit reuses it. Keys the scroll element + page rows and tags stashed rasters.
let nextDocId = 1

function PdfPages(props: PdfPagesProps) {
    let scrollRef: HTMLDivElement | undefined

    // Resolved ONCE via Solid's `children()` helper. `props.overlay` is a getter (an inline
    // `overlay={<X/>}` at the call site compiles to one), and reading a getter prop twice — once
    // for `<Show when>`, once to insert — creates TWO instances of X, each mounting and running
    // its own effects (fix 2). `children()` memoizes the resolved JSX so both the presence check
    // and the insert read the SAME node.
    const overlay = children(() => props.overlay)
    // Same reasoning as `overlay` above: `props.errorAction` is a getter, so the presence check and
    // the insert in the error branch below must both read THIS resolved value — reading the prop
    // directly (as a leftover `<Show when={props.errorAction}>` from a parallel stub did) mints a
    // new instance per read.
    const errorAction = children(() => props.errorAction)

    const [status, setStatus] = createSignal<Status>('loading')
    const [sizes, setSizes] = createSignal<PageSize[]>([])
    const [containerW, setContainerW] = createSignal(0)
    const [containerH, setContainerH] = createSignal(0)
    const [scrollTop, setScrollTop] = createSignal(0)
    // The document currently shown (0 = none yet). A cache HIT switching A→B never leaves
    // 'ready', so without this key the `<Show>`/`<Index>` below would REUSE A's scroll element
    // (native offset still A's) and A's page canvases, whose only re-render trigger is a box SIZE
    // change — two letter-size PDFs would keep A's pixels on screen under B.
    const [docId, setDocId] = createSignal(0)
    // Page-frame gutter, in px. Read ONCE from the scroll element's own computed style (so it
    // follows whatever `--sp-6` resolves to for this app instance) as soon as it's connected to
    // the document; `16` is both the initial guess (rendering starts before that microtask runs,
    // matching the resolved `--sp-6`) and the fallback if the custom property is ever missing/
    // unparseable — see setScrollRef.
    const [pad, setPad] = createSignal(16)

    let pdfjs: PdfjsModule | undefined
    let pages: PDFPageProxy[] = []
    // Bumped on every (re)load so a slow load() that resolves after a newer one started can't
    // clobber state it no longer owns.
    let loadToken = 0
    // The in-flight/most recent `getDocument()` task. Every task runs on the session's ONE shared
    // worker (`pdfjsSetup.ts`'s `sharedWorker()`), so `destroy()` (on the task, which forwards to
    // the resolved document) frees that document and its transport and leaves the shared worker
    // alive. Left undestroyed, every uncached PDF opened — and every PDF→PDF switch in a reused
    // pane — leaks the parsed document's caches.
    let loadingTask: ReturnType<PdfjsModule['getDocument']> | undefined
    // The document CURRENTLY shown, i.e. the `loadToken` value active when boot() last reached
    // 'ready' — `report()` (onPosition) guards on this so a superseded document (a newer boot()
    // already in flight) never reports a position for the one that's about to disappear.
    let readyToken = -1
    // Handle to the currently-acquired `pdfCache` entry (cache-hit or freshly-`put` path),
    // released — never destroyed directly, that's the cache's call — on the next boot() and on
    // unmount.
    let cacheRelease: (() => void) | undefined

    async function boot() {
        const token = ++loadToken
        const staleRelease = cacheRelease
        cacheRelease = undefined
        staleRelease?.()

        const cacheKey = props.cacheKey
        const hit = cacheKey ? pdfCache.acquire(cacheKey) : undefined
        if (hit) {
            // SYNCHRONOUS hit path — no `await` before 'ready', so a remount with the same key
            // never renders <Loading/>, never calls props.load, and re-reports onPageCount/
            // onOutline/onCurrentPage exactly as a first load would (the effects below key off
            // `status`/`sizes` regardless of how they got set).
            cacheRelease = hit.release
            pdfjs = hit.value.doc.pdfjs
            pages = hit.value.doc.pages
            setSizes(hit.value.doc.sizes)
            setScrollTop(0)
            readyToken = token
            // A different document than the one shown recreates the scroll element + rows (a
            // fresh element starts at offset 0); the same document re-acquired keeps them.
            setDocId(hit.value.doc.id)
            setStatus('ready')
            if (props.initialPosition) setPendingJump({ restore: true })
            void hit.value.doc.outline.then(o => {
                if (token === loadToken) props.onOutline?.(o)
            })
            return
        }

        setStatus('loading')
        setSizes([])
        pages = []
        // A PDF→PDF switch in a reused pane does not remount this component — reset the scroll
        // OFFSET along with the DOM (the `<Show>` below unmounts/remounts the scroll div while
        // status leaves 'ready', which already resets its native scrollTop to 0). Without this,
        // `visiblePageRange` keeps computing against the OLD document's scroll position, so the
        // new document's first pages stay blank until the user manually scrolls.
        setScrollTop(0)
        const staleTask = loadingTask
        loadingTask = undefined
        if (staleTask) void staleTask.destroy()
        try {
            const [setup, bytes] = await Promise.all([
                loadPdfjsSetup(),
                props.load(),
            ])
            if (token !== loadToken) return
            const mod = setup.pdfjs
            pdfjs = mod
            // getDocument transfers the buffer to the worker (detaching it) — hand it a copy so
            // a caller still holding `bytes` never sees it go detached out from under it.
            const data = new Uint8Array(bytes.slice(0))
            const task = mod.getDocument({ data, worker: setup.sharedWorker() })
            loadingTask = task
            const doc = await task.promise
            if (token !== loadToken) {
                // A newer boot() already started (and destroyed whatever `loadingTask` held when
                // IT ran) — this task lost the race, so destroy it directly rather than leaving
                // it to the next boot() (which only knows about the CURRENT `loadingTask`).
                void task.destroy()
                return
            }
            pages = await Promise.all(
                Array.from({ length: doc.numPages }, (_, i) =>
                    doc.getPage(i + 1),
                ),
            )
            if (token !== loadToken) return
            // Resolved in the background — the pages never wait on it. Computed whenever a
            // caller wants it NOW (onOutline) or LATER (a future cache-hit remount that passes
            // onOutline even if this particular load didn't).
            const outline =
                props.onOutline || cacheKey
                    ? resolveOutline({
                          getOutline: () =>
                              doc.getOutline() as Promise<RawOutlineItem[] | null>,
                          getDestination: id => doc.getDestination(id),
                          getPageIndex: ref =>
                              doc.getPageIndex(
                                  ref as Parameters<typeof doc.getPageIndex>[0],
                              ),
                      })
                    : Promise.resolve<OutlineNode[]>([])
            if (props.onOutline) {
                void outline.then(o => {
                    if (token === loadToken) props.onOutline?.(o)
                })
            }
            const loadedSizes = pages.map(p => {
                const v = p.getViewport({ scale: 1 })
                return { w: v.width, h: v.height }
            })
            setSizes(loadedSizes)
            const id = nextDocId++
            if (cacheKey) {
                const entry: LoadedPdf = {
                    id,
                    pdfjs: mod,
                    pages,
                    sizes: loadedSizes,
                    outline,
                }
                cacheRelease = pdfCache.put(cacheKey, {
                    doc: entry,
                    destroy: () => void task.destroy(),
                })
                // Ownership of the task's lifecycle now belongs to the cache entry's `destroy`
                // (called on eviction/invalidate once nothing retains it) — this component's own
                // cleanup/reload paths must not also destroy it.
                loadingTask = undefined
            }
            readyToken = token
            setDocId(id)
            setStatus('ready')
            if (props.initialPosition) setPendingJump({ restore: true })
        } catch {
            if (token === loadToken) setStatus('error')
        }
    }
    onCleanup(() => {
        // Supersede any boot() still awaiting load()/getDocument(): without this it resumes after
        // unmount, `put`s a retained cache entry nobody will ever release (pinned forever, never
        // evicted or destroyed), and `report()`'s readyToken guard would still pass.
        loadToken++
        const task = loadingTask
        loadingTask = undefined
        if (task) void task.destroy()
        // Never destroy a cached task on cleanup — the cache decides that (LRU/invalidate), not
        // this component going away.
        const release = cacheRelease
        cacheRelease = undefined
        release?.()
    })

    // Runs once immediately (mirrors onMount) and again whenever PreviewView hands over a fresh
    // `load` closure (a different file was opened) OR a fresh `cacheKey`. In production the key
    // only changes together with `load`; this also re-runs for a caller (e.g. a story) that
    // changes `cacheKey` alone.
    createEffect(on([() => props.load, () => props.cacheKey], () => void boot()))

    // ResizeObserver setup lives in the scroll div's REF CALLBACK, not a plain `onMount` — the
    // div itself only exists once `status()` is 'ready' (it's inside `<Show>` below), and
    // `onMount` fires once at component creation, while `status` still reads 'loading' (boot()
    // is async). A plain onMount there would silently observe nothing, forever, on every mount.
    // A ref callback runs exactly when THIS element is created, and `onCleanup` called from
    // inside it still attaches to the enclosing `<Show>` branch's owner, disposing the observer
    // when that branch tears down (an error, or a reload that briefly flips back to 'loading').
    const setScrollRef = (el: HTMLDivElement) => {
        scrollRef = el
        // A microtask, not a synchronous read here: Solid calls a ref as soon as its element
        // exists, which can be before that element (and the ancestors `--sp-6` cascades from) is
        // actually connected to the document — `getComputedStyle` on a detached node resolves
        // custom properties against nothing. By the next microtask this `<Show>` branch has
        // finished mounting into the document, and `--sp-6` resolves for real.
        queueMicrotask(() => {
            if (scrollRef !== el) return // a reload swapped the element before this ran
            const raw = getComputedStyle(el).getPropertyValue('--sp-6').trim()
            const parsed = parseFloat(raw)
            setPad(Number.isFinite(parsed) ? parsed : 16)
        })
        const ro = new ResizeObserver(entries => {
            const e = entries[0]
            if (!e) return
            setContainerW(e.contentRect.width)
            setContainerH(e.contentRect.height)
        })
        ro.observe(el)
        onCleanup(() => {
            ro.disconnect()
            // A coalesced flush scheduled for this element's last scroll event must not fire once
            // it's torn down — belt-and-suspenders alongside `scheduleScrollFlush`'s own
            // `if (!scrollRef) return`, since the branch can dispose before the next animation
            // frame paints.
            if (scrollRafId !== undefined) {
                cancelAnimationFrame(scrollRafId)
                scrollRafId = undefined
            }
            // Forget the element as soon as its branch is torn down. Detaching a scrolled element
            // resets its offset to 0 and Chrome then fires one more `scroll` at it, AFTER this
            // cleanup — measured: `isConnected: false`, `clientHeight: 0`, `scrollTop: 0`, with
            // every page still laid out. Reported, that became `{ index: 0, yFraction: 0 }` and
            // overwrote the remembered position a moment before the next mount read it back.
            if (scrollRef === el) scrollRef = undefined
        })
        props.controller?.(controller)
    }

    const zoom = createMemo(() => props.zoom)
    const marginRatio = createMemo(() => props.marginRatio ?? 0)
    const layout = createMemo(() =>
        layoutPages(sizes(), containerW(), zoom(), GAP, marginRatio(), pad()),
    )
    // Overscan BY DISTANCE, not a fixed page count (task-5-brief.md lever 1): `visiblePageRange`'s
    // `overscan` param stays pages, as pageLayout.ts's signature must — this derives how many of
    // them cover at least one viewport height beyond each edge, from the stack's own average page
    // height, and keeps `pageLayout.ts` itself pure (no viewport concept in there). A pane whose
    // pages render SHORTER than its own viewport (a narrow, tall reading pane at fit-width — the
    // common case bench/pdfScroll.ts's `ManyPages` fixture is built to reproduce) needs more than
    // one page of overscan for a page to already be rendered before it's reached, not as it
    // arrives; a pane whose pages render taller than the viewport still gets at least `OVERSCAN`.
    const overscanPages = createMemo(() => {
        const { boxes, contentH } = layout()
        if (boxes.length === 0) return OVERSCAN
        const avgPageH = contentH / boxes.length
        if (avgPageH <= 0) return OVERSCAN
        return Math.max(OVERSCAN, Math.ceil(containerH() / avgPageH))
    })
    const visible = createMemo(() =>
        visiblePageRange(layout().boxes, scrollTop(), containerH(), overscanPages()),
    )

    // -1 while nothing is loaded, so the first real value of every document is a change.
    const currentPage = createMemo(() =>
        status() === 'ready'
            ? currentPageIndex(layout().boxes, scrollTop(), containerH())
            : -1,
    )
    // Keyed on the document too: a cached A→B switch stays 'ready' (and may land on the same
    // page index), yet B must still report its own page count and current page once.
    createEffect(
        on([currentPage, docId], ([i]) => {
            if (i >= 0) props.onCurrentPage?.(i)
        }),
    )
    createEffect(
        on([status, docId], ([s]) => {
            if (s === 'ready') props.onPageCount?.(untrack(sizes).length)
        }),
    )

    // A jump requested before the scroll element has been measured (boxes still zero-height)
    // would land at 0 — hold it until the first real width arrives, then apply it. `restore` is
    // the initial-position seam: it carries no snapshot of `props.initialPosition` — the effect
    // below reads that prop LIVE at apply time, so a PDF→PDF switch that queues a fresh restore
    // (boot() calls this again on the new document) always restores the NEW document's position
    // even if the queue-to-apply gap crossed a boot().
    const [pendingJump, setPendingJump] = createSignal<
        { index: number; yFraction?: number } | { restore: true } | undefined
    >()
    const applyJump = (
        index: number,
        yFraction: number | undefined,
        opts?: { exact?: boolean; xFraction?: number },
    ) => {
        if (!scrollRef) return
        const top = opts?.exact
            ? scrollTopForPosition(layout().boxes, index, yFraction ?? 0, pad())
            : scrollTopForPage(layout().boxes, index, yFraction, pad())
        scrollRef.scrollTop = top
        // Mirror the (browser-clamped) offset now rather than waiting for the async scroll event,
        // so the visible range and current page follow the jump immediately.
        setScrollTop(scrollRef.scrollTop)
        if (opts?.exact) {
            const sw = scrollRef.scrollWidth
            const cw = scrollRef.clientWidth
            scrollRef.scrollLeft = (opts.xFraction ?? 0) * Math.max(0, sw - cw)
        }
        report()
    }
    const controller: PdfPagesController = {
        scrollToPage: (index, yFraction) => {
            if (status() !== 'ready' || containerW() <= 0) {
                setPendingJump({ index, yFraction })
                return
            }
            applyJump(index, yFraction)
        },
    }
    createEffect(() => {
        const jump = pendingJump()
        if (!jump || status() !== 'ready' || containerW() <= 0) return
        setPendingJump(undefined)
        if ('restore' in jump) {
            const pos = props.initialPosition
            if (pos) {
                applyJump(pos.index, pos.yFraction, {
                    exact: true,
                    xFraction: pos.xFraction,
                })
            }
            return
        }
        applyJump(jump.index, jump.yFraction)
    })

    /** Reports the live scroll offset as a `PdfPosition` — but only one measured against a real,
     *  laid-out, still-mounted document. A document superseded by a newer boot() never reports
     *  (readyToken !== loadToken once a new boot() — or unmount — has bumped loadToken past it);
     *  neither does a detached or zero-sized scroll element, a layout with no pages or no
     *  measured width, or a document whose `initialPosition` restore has not applied yet (its
     *  offset is still the load's reset, not where the reader is). */
    function report() {
        const el = scrollRef
        if (!el || !el.isConnected) return
        if (status() !== 'ready' || readyToken !== loadToken) return
        if (el.clientWidth <= 0 || el.clientHeight <= 0 || containerW() <= 0) return
        const boxes = layout().boxes
        if (boxes.length === 0) return
        const jump = untrack(pendingJump)
        if (jump && 'restore' in jump) return
        const sw = el.scrollWidth
        const cw = el.clientWidth
        const xFraction = sw > cw ? el.scrollLeft / (sw - cw) : 0
        const pos = positionAt(boxes, el.scrollTop, pad())
        props.onPosition?.({ index: pos.index, yFraction: pos.yFraction, xFraction })
    }

    createEffect(() => {
        if (status() !== 'ready' || !scrollRef) return
        props.onLayout?.({
            boxes: layout().boxes,
            sizes: sizes(),
            scrollEl: scrollRef,
        })
    })

    // Batch the scroll-driven work to one frame (task-5-brief.md lever 3): the native `scroll`
    // handler used to run `setScrollTop` + `report()` synchronously for EVERY scroll event, which
    // on a real trackpad/wheel can fire many times inside one animation frame — each call
    // recomputing `layout()`'s dependents (`visible`, `currentPage`) and running `report()`'s own
    // work for a scrollTop value that's about to be superseded before the browser ever paints it.
    // Coalescing to a `requestAnimationFrame` means the visible-range memo and `onPosition` run at
    // most once per painted frame, always against the LATEST scrollTop at the time it fires (read
    // live off `scrollRef`, not captured from the triggering event).
    let scrollRafId: number | undefined
    function scheduleScrollFlush() {
        if (scrollRafId !== undefined) return
        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = undefined
            if (!scrollRef) return
            setScrollTop(scrollRef.scrollTop)
            report()
        })
    }

    const getPage = (i: number): PDFPageProxy => {
        const p = pages[i]
        if (!p) throw new Error(`PdfPages: page ${i} not loaded`)
        return p
    }

    // Only wired up when this pane is cache-backed — an uncached PdfPages keeps today's
    // lifecycle exactly (no stash reads/writes to a key that isn't stable across remounts).
    // Bound to the document shown: a raster is only ever reused for the SAME loaded document
    // (never B's pages painting A's pixels, never a re-read file painting its old version).
    // PdfPageCanvas captures this binding once at mount, so a canvas torn down after the key or
    // document moved on still stashes under the document it actually rendered.
    const stash = createMemo(() => {
        const key = props.cacheKey
        const doc = docId()
        if (!key) return undefined
        return {
            get: (i: number, w: number) => rasterStash.get(key, doc, i, w),
            put: (i: number, w: number, c: HTMLCanvasElement) =>
                rasterStash.put(key, doc, i, w, c),
        }
    })

    return (
        <div class={`${styles['pdf-pages']} ${props.class ?? ''}`}>
            {/* Keyed on the document: a new document gets a new scroll element and new rows. */}
            <Show when={status() === 'ready' ? docId() : undefined} keyed>
                {_doc => (
                    <div
                        class={styles['pdf-scroll']}
                        ref={setScrollRef}
                        onScroll={e => {
                            // A detached element's late scroll (see setScrollRef's cleanup) is not
                            // this document's offset — not even for the visible-range signal. This
                            // check runs at EVENT time, before the coalesced flush below ever
                            // schedules — `scrollRef` is already cleared by then for a torn-down
                            // element, so a stale scroll never even queues a frame.
                            if (e.currentTarget !== scrollRef) return
                            scheduleScrollFlush()
                        }}
                    >
                        <div
                            class={styles['pdf-content']}
                            style={{ height: `${layout().contentH}px` }}
                        >
                            {/* `<Index>`, not `<For>`: `layoutPages` returns fresh box objects on every
                                zoom/margin/width change, and `<For>` keys rows by object identity — it
                                would recreate every row, and with it every page canvas, blanking the
                                whole stack until pdf.js re-rendered. Keyed by position, a row survives
                                and PdfPageCanvas re-renders in place (see its header). The overscan
                                `<Show>` still unmounts far pages. */}
                            <Index each={layout().boxes}>
                                {(box, i) => (
                                    <div
                                        class={styles['pdf-page']}
                                        data-pdf-page={i}
                                        style={{
                                            top: `${box().top}px`,
                                            left: `${box().left}px`,
                                            width: `${box().w}px`,
                                            height: `${box().h}px`,
                                        }}
                                    >
                                        <Show
                                            when={
                                                i >= visible()[0] &&
                                                i <= visible()[1]
                                            }
                                        >
                                            <PdfPageCanvas
                                                index={i}
                                                box={box()}
                                                getPage={getPage}
                                                pdfjs={() => pdfjs}
                                                stash={stash()}
                                            />
                                        </Show>
                                        <Show when={box().marginW > 0}>
                                            <ScratchPaper
                                                index={i}
                                                class={styles['pdf-margin']}
                                                style={{
                                                    width: `${box().marginW}px`,
                                                }}
                                            />
                                        </Show>
                                    </div>
                                )}
                            </Index>
                            {/* AFTER every page, in DOM order — not before + z-index (see
                                PdfPages.module.css's `.pdf-overlay` comment): a highlight rect inside
                                `overlay()` uses `mix-blend-mode: multiply` against the page canvas
                                beneath it, which an explicit z-index stacking context would isolate
                                against. DOM order alone still paints this on top, since neither this
                                nor `.pdf-page` carries a z-index any more. */}
                            <Show when={overlay()}>
                                <div class={styles['pdf-overlay']}>{overlay()}</div>
                            </Show>
                        </div>
                    </div>
                )}
            </Show>
            <Show when={status() === 'loading'}>
                <Loading />
            </Show>
            <Show when={status() === 'error'}>
                {/* The action sits UNDER the message block, centred — a sibling of EmptyState in
                    this column, never inside its `<p>` (that set a button inline beside the
                    sentence). Same shape as PreviewView's own `.preview-external` fallback. */}
                <div class={styles['pdf-error']}>
                    <EmptyState title="Couldn't load PDF">
                        The document could not be opened.
                    </EmptyState>
                    <Show when={errorAction()}>{errorAction()}</Show>
                </div>
            </Show>
        </div>
    )
}

export default PdfPages
