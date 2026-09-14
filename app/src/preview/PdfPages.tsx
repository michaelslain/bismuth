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
// the same way `drawing/pdfRaster.ts` does for the markup rasterizer, via STATIC imports of
// pdfjs-dist + the worker `?url` asset — see that module's header for why the worker import
// specifically has to stay static rather than living inline in this dynamic import.
import {
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onCleanup,
    onMount,
    Show,
    type JSX,
} from 'solid-js'
import EmptyState, { Loading } from '../ui/EmptyState'
import {
    layoutPages,
    visiblePageRange,
    type PageBox,
    type PageSize,
} from './pageLayout'
import styles from './PdfPages.module.css'

const GAP = 16 // px between stacked pages
const OVERSCAN = 1 // pages rendered beyond the viewport on each side

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

    async function boot() {
        const token = ++loadToken
        setStatus('loading')
        setSizes([])
        pages = []
        try {
            const [mod, bytes] = await Promise.all([loadPdfjs(), props.load()])
            if (token !== loadToken) return
            pdfjs = mod
            // getDocument transfers the buffer to the worker (detaching it) — hand it a copy so
            // a caller still holding `bytes` never sees it go detached out from under it.
            const data = new Uint8Array(bytes.slice(0))
            const doc = await mod.getDocument({ data }).promise
            if (token !== loadToken) return
            pages = await Promise.all(
                Array.from({ length: doc.numPages }, (_, i) =>
                    doc.getPage(i + 1),
                ),
            )
            if (token !== loadToken) return
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
    }

    const layout = createMemo(() =>
        layoutPages(sizes(), containerW(), props.zoom, GAP),
    )
    const visible = createMemo(() =>
        visiblePageRange(layout().boxes, scrollTop(), containerH(), OVERSCAN),
    )

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
                        <Show when={props.overlay}>
                            <div class={styles['pdf-overlay']}>
                                {props.overlay}
                            </div>
                        </Show>
                        <For each={layout().boxes}>
                            {(box, i) => (
                                <div
                                    class={styles['pdf-page']}
                                    data-pdf-page={i()}
                                    style={{
                                        top: `${box.top}px`,
                                        left: `${box.left}px`,
                                        width: `${box.w}px`,
                                        height: `${box.h}px`,
                                    }}
                                >
                                    <Show
                                        when={
                                            i() >= visible()[0] &&
                                            i() <= visible()[1]
                                        }
                                    >
                                        <PageCanvas
                                            index={i()}
                                            box={box}
                                            getPage={getPage}
                                            pdfjs={() => pdfjs}
                                        />
                                    </Show>
                                </div>
                            )}
                        </For>
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

/** One stacked page: a raster canvas (at devicePixelRatio) plus pdf.js's text layer for
 *  selection. Internal to PdfPages — not a reusable primitive, so it isn't its own file (no
 *  stylesheet of its own either; it draws from PdfPages.module.css). Mounted/unmounted by the
 *  parent's `<Show>` as the page enters/leaves `visiblePageRange`, which is what makes an
 *  in-flight render/text-layer task get cancelled on scroll — and on zoom, `layoutPages` returns
 *  a fresh `boxes` array so `<For>` recreates every row (and this component) at the new scale. */
function PageCanvas(props: {
    index: number
    box: PageBox
    getPage: (i: number) => PDFPageProxy
    pdfjs: () => PdfjsModule | undefined
}) {
    let canvasRef: HTMLCanvasElement | undefined
    let textRef: HTMLDivElement | undefined
    let cancelled = false
    let renderTask: ReturnType<PDFPageProxy['render']> | undefined
    let textLayer: InstanceType<PdfjsModule['TextLayer']> | undefined

    async function run() {
        const mod = props.pdfjs()
        if (!mod || !canvasRef) return
        const page = props.getPage(props.index)
        const dpr = window.devicePixelRatio || 1
        const natural = page.getViewport({ scale: 1 })
        const cssScale = natural.width > 0 ? props.box.w / natural.width : 1

        const renderViewport = page.getViewport({ scale: cssScale * dpr })
        canvasRef.width = Math.max(1, Math.round(renderViewport.width))
        canvasRef.height = Math.max(1, Math.round(renderViewport.height))
        canvasRef.style.width = `${props.box.w}px`
        canvasRef.style.height = `${props.box.h}px`

        const task = page.render({ canvas: canvasRef, viewport: renderViewport })
        renderTask = task
        try {
            await task.promise
        } catch {
            // A cancelled render (page scrolled away mid-paint, `renderTask.cancel()` in
            // onCleanup) is expected, not a failure. Any other per-page render error is likewise
            // just skipped — leave this one page's canvas blank rather than throwing and taking
            // down the whole stack over one bad page.
            return
        } finally {
            if (renderTask === task) renderTask = undefined
        }
        if (cancelled || !textRef) return

        // Best-effort text layer for selection/copy — a failure here must never blank the raster
        // that already rendered above it.
        try {
            const textViewport = page.getViewport({ scale: cssScale })
            textLayer = new mod.TextLayer({
                textContentSource: page.streamTextContent(),
                container: textRef,
                viewport: textViewport,
            })
            // pdf.js's own layer sizes itself via CSS custom properties (`--total-scale-factor`
            // + a `round()` expression tied to viewer-only vars we don't set up here); override
            // with the page's real CSS box directly so glyph positioning still tracks it.
            textRef.style.setProperty('--total-scale-factor', String(cssScale))
            textRef.style.setProperty('--scale-factor', String(cssScale))
            textRef.style.width = `${props.box.w}px`
            textRef.style.height = `${props.box.h}px`
            await textLayer.render()
        } catch {
            /* selection is a nice-to-have; the rendered page stands on its own without it */
        }
    }

    onMount(() => void run())
    onCleanup(() => {
        cancelled = true
        renderTask?.cancel()
        textLayer?.cancel()
    })

    return (
        <>
            <canvas class={styles['pdf-canvas']} ref={canvasRef} />
            <div class={styles['pdf-text-layer']} ref={textRef} />
        </>
    )
}
