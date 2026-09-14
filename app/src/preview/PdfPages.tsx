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
import {
    children,
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onCleanup,
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
import PdfPageCanvas from './PdfPageCanvas'
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
                        <Show when={overlay()}>
                            <div class={styles['pdf-overlay']}>{overlay()}</div>
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
                                        <PdfPageCanvas
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
