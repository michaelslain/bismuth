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
import {
    children,
    createEffect,
    createMemo,
    createSignal,
    Index,
    on,
    onCleanup,
    Show,
    type JSX,
} from 'solid-js'
import EmptyState, { Loading } from '../ui/EmptyState'
import type { OutlineNode, PdfPagesController } from './annotationTypes'
import { resolveOutline, type RawOutlineItem } from './pdfOutline'
import {
    currentPageIndex,
    layoutPages,
    scrollTopForPage,
    visiblePageRange,
    type PageBox,
    type PageSize,
} from './pageLayout'
import PdfPageCanvas from './PdfPageCanvas'
import { PDF_PAGE_PAPER, PDF_PAGE_RULE } from '../../../core/src/theme/tokens'
import styles from './PdfPages.module.css'

const GAP = 16 // px between stacked pages
const OVERSCAN = 1 // pages rendered beyond the viewport on each side

// The margin is PAPER, like the PDF page it extends — never the app's own ground (dark on the ink
// theme), and never a THEME surface either: the PDF page itself is pdf.js's own raster, always
// painted on WHITE regardless of the active app theme, so the margin has to match THAT fixed white
// to read as a continuation of the page rather than a mismatched surface. PageInk still resolves
// ink against the LIGHT theme bucket (dark ink on paper) — that's unrelated to this fill, which is
// the page's own white, not a theme colour. Sourced from core/src/theme/tokens.ts, never a
// hand-typed hex.

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
}

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

let pdfjsPromise: Promise<PdfjsModule> | undefined

/** Load pdfjs-dist + its worker (see pdfjsSetup.ts for why that's a separate module), exactly
 *  once per session, behind a dynamic import so pdfjs stays out of the boot bundle. */
function loadPdfjs(): Promise<PdfjsModule> {
    pdfjsPromise ??= import('./pdfjsSetup').then(m => m.pdfjs)
    return pdfjsPromise
}

type Status = 'loading' | 'ready' | 'error'

function PdfPages(props: PdfPagesProps) {
    let scrollRef: HTMLDivElement | undefined

    // Resolved ONCE via Solid's `children()` helper. `props.overlay` is a getter (an inline
    // `overlay={<X/>}` at the call site compiles to one), and reading a getter prop twice — once
    // for `<Show when>`, once to insert — creates TWO instances of X, each mounting and running
    // its own effects (fix 2). `children()` memoizes the resolved JSX so both the presence check
    // and the insert read the SAME node.
    const overlay = children(() => props.overlay)

    const [status, setStatus] = createSignal<Status>('loading')
    const [sizes, setSizes] = createSignal<PageSize[]>([])
    const [containerW, setContainerW] = createSignal(0)
    const [containerH, setContainerH] = createSignal(0)
    const [scrollTop, setScrollTop] = createSignal(0)

    let pdfjs: PdfjsModule | undefined
    let pages: PDFPageProxy[] = []
    // Bumped on every (re)load so a slow load() that resolves after a newer one started can't
    // clobber state it no longer owns.
    let loadToken = 0
    // The in-flight/most recent `getDocument()` task. pdf.js spins up a dedicated Worker (a real
    // Web Worker) per `getDocument()` call when no shared `workerPort` is configured — only
    // `destroy()` (on the task, which forwards to the resolved document) terminates it. Left
    // running, every PDF opened — and every PDF→PDF switch in a reused pane — leaks a worker
    // thread plus the parsed document's caches. The retired `pdfRaster.ts` destroyed its task in
    // a `finally`, as its own doc said; this mirrors that.
    let loadingTask: ReturnType<PdfjsModule['getDocument']> | undefined

    async function boot() {
        const token = ++loadToken
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
            const [mod, bytes] = await Promise.all([loadPdfjs(), props.load()])
            if (token !== loadToken) return
            pdfjs = mod
            // getDocument transfers the buffer to the worker (detaching it) — hand it a copy so
            // a caller still holding `bytes` never sees it go detached out from under it.
            const data = new Uint8Array(bytes.slice(0))
            const task = mod.getDocument({ data })
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
            // The outline resolves in the background — the pages never wait on it.
            if (props.onOutline) {
                void resolveOutline({
                    getOutline: () =>
                        doc.getOutline() as Promise<RawOutlineItem[] | null>,
                    getDestination: id => doc.getDestination(id),
                    getPageIndex: ref =>
                        doc.getPageIndex(
                            ref as Parameters<typeof doc.getPageIndex>[0],
                        ),
                }).then(outline => {
                    if (token === loadToken) props.onOutline?.(outline)
                })
            }
            setSizes(
                pages.map(p => {
                    const v = p.getViewport({ scale: 1 })
                    return { w: v.width, h: v.height }
                }),
            )
            setStatus('ready')
        } catch {
            if (token === loadToken) setStatus('error')
        }
    }
    onCleanup(() => {
        const task = loadingTask
        loadingTask = undefined
        if (task) void task.destroy()
    })

    // Runs once immediately (mirrors onMount) and again whenever PreviewView hands over a fresh
    // `load` closure (a different file was opened).
    createEffect(on(() => props.load, () => void boot()))

    // ResizeObserver setup lives in the scroll div's REF CALLBACK, not a plain `onMount` — the
    // div itself only exists once `status()` is 'ready' (it's inside `<Show>` below), and
    // `onMount` fires once at component creation, while `status` still reads 'loading' (boot()
    // is async). A plain onMount there would silently observe nothing, forever, on every mount.
    // A ref callback runs exactly when THIS element is created, and `onCleanup` called from
    // inside it still attaches to the enclosing `<Show>` branch's owner, disposing the observer
    // when that branch tears down (an error, or a reload that briefly flips back to 'loading').
    const setScrollRef = (el: HTMLDivElement) => {
        scrollRef = el
        const ro = new ResizeObserver(entries => {
            const e = entries[0]
            if (!e) return
            setContainerW(e.contentRect.width)
            setContainerH(e.contentRect.height)
        })
        ro.observe(el)
        onCleanup(() => ro.disconnect())
        props.controller?.(controller)
    }

    const zoom = createMemo(() => props.zoom)
    const marginRatio = createMemo(() => props.marginRatio ?? 0)
    const layout = createMemo(() =>
        layoutPages(sizes(), containerW(), zoom(), GAP, marginRatio()),
    )
    const visible = createMemo(() =>
        visiblePageRange(layout().boxes, scrollTop(), containerH(), OVERSCAN),
    )

    // -1 while nothing is loaded, so the first real value of every document is a change.
    const currentPage = createMemo(() =>
        status() === 'ready'
            ? currentPageIndex(layout().boxes, scrollTop(), containerH())
            : -1,
    )
    createEffect(
        on(currentPage, i => {
            if (i >= 0) props.onCurrentPage?.(i)
        }),
    )
    createEffect(
        on(status, s => {
            if (s === 'ready') props.onPageCount?.(sizes().length)
        }),
    )

    // A jump requested before the scroll element has been measured (boxes still zero-height)
    // would land at 0 — hold it until the first real width arrives, then apply it.
    const [pendingJump, setPendingJump] = createSignal<
        { index: number; yFraction?: number } | undefined
    >()
    const applyJump = (index: number, yFraction?: number) => {
        if (!scrollRef) return
        const top = scrollTopForPage(layout().boxes, index, yFraction)
        scrollRef.scrollTop = top
        // Mirror the (browser-clamped) offset now rather than waiting for the async scroll event,
        // so the visible range and current page follow the jump immediately.
        setScrollTop(scrollRef.scrollTop)
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
        applyJump(jump.index, jump.yFraction)
    })

    createEffect(() => {
        if (status() !== 'ready' || !scrollRef) return
        props.onLayout?.({
            boxes: layout().boxes,
            sizes: sizes(),
            scrollEl: scrollRef,
        })
    })

    const getPage = (i: number): PDFPageProxy => {
        const p = pages[i]
        if (!p) throw new Error(`PdfPages: page ${i} not loaded`)
        return p
    }

    return (
        <div class={`${styles['pdf-pages']} ${props.class ?? ''}`}>
            <Show when={status() === 'ready'}>
                <div
                    class={styles['pdf-scroll']}
                    ref={setScrollRef}
                    onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
                >
                    <div
                        class={styles['pdf-content']}
                        style={{ height: `${layout().contentH}px` }}
                    >
                        <Show when={overlay()}>
                            <div class={styles['pdf-overlay']}>{overlay()}</div>
                        </Show>
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
                                        />
                                    </Show>
                                    <Show when={box().marginW > 0}>
                                        <div
                                            class={styles['pdf-margin']}
                                            data-pdf-margin={i}
                                            style={{
                                                width: `${box().marginW}px`,
                                                background: PDF_PAGE_PAPER,
                                                'border-left': `1px solid ${PDF_PAGE_RULE}`,
                                            }}
                                        />
                                    </Show>
                                </div>
                            )}
                        </Index>
                    </div>
                </div>
            </Show>
            <Show when={status() === 'loading'}>
                <Loading />
            </Show>
            <Show when={status() === 'error'}>
                <div class={styles['pdf-error']}>
                    <EmptyState title="Couldn't load PDF">
                        The document could not be opened.
                    </EmptyState>
                </div>
            </Show>
        </div>
    )
}

export default PdfPages
