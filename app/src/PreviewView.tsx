// app/src/PreviewView.tsx
// PREVIEW tab for non-note files: images, PDFs, and code/text open here by default. Every kind
// exposes "Open in default app" / "Reveal" (Tauri) so binary formats we can't render
// (PSD/Figma/…) are still reachable in Photoshop/Figma/etc. Routing lives in PaneContent;
// classification in previewKind.
//
// Ink (images + PDFs) is drawn IN PLACE, the way note ink is: the same `toggle-draw-mode`
// keybinding, caught on a capture-phase keydown of the preview root exactly like Find below,
// flips `preview/PageInk` interactive over the rendered page(s); outside draw mode it only
// paints. The strokes live in the file's `<file>.draw` sidecar (core/src/drawing/pageInk.ts has
// the coordinate contract). An image is ONE page measured off the `<img>`'s painted rect; a PDF
// hands PageInk to PdfPages as its `overlay`, fed from PdfPages' `onLayout` boxes.
//
// Annotations share ONE owner: a single `createAnnotationStore` over the `<file>.draw` sidecar,
// created while the file is an ink kind and handed to PageInk, HighlightLayer and BookmarksPanel
// — one debounce, one undo stack, one writer. The bar above every kind is preview/PreviewBar (one
// ViewBar, grouped by spacing). A PDF's trail reads, left to right: the page readout `p. N / M`
// (preview/PageReadout — click to go to a page); the zoom group `− 100% + FIT`; the annotate group
// HIGHLIGHT DRAW SCRATCH; then BOOKMARKS (a right-hand panel of the user's bookmarks above the
// PDF's own outline) and the native-app actions. An image's bar has the same DRAW toggle and file
// actions in the same places.
//   • HIGHLIGHT is ONE-SHOT, not a mode: pressed with text selected in the PDF it highlights that
//     selection and stays off; pressed with nothing selected it ARMS (shown selected) until the
//     next selection is highlighted — or an existing highlight is clicked away — then disarms.
//     Pressing it while armed disarms. Arming exits draw; entering draw disarms.
//   • DRAW enters/exits the same draw mode as the `toggle-draw-mode` key.
//   • SCRATCH is drawable scratch paper to the right of every page (the sidecar's `margin`).
// Narrow panes shed controls through the shared collapse ladder (global.css's `ui/ui.css` section) — never a second row.
// HIGHLIGHT, DRAW and SCRATCH stay disabled until the sidecar has loaded, because `store.edit` is
// a no-op before then.
//
// Find (Cmd/Ctrl+F, rebindable via settings.keybindings.find — same key the editor uses) is
// handled per content kind, on a capture-phase keydown of the preview root (App.tsx has NO
// global find handler, and the editor only binds it when the editor is focused, so mirroring
// that here is what makes Cmd+F work when a preview tab is focused):
//   • code/text — a real find bar: highlight every match, next/prev + count, scroll-to-active.
//   • pdf       — PdfPages renders pdf.js's own text layer per page (selectable/copyable text),
//                 but there is no find-bar UI over it yet, so Find shows a one-line note instead
//                 of pretending to search. DOCUMENTED LIMITATION: no in-app PDF text search.
//   • image / external — no searchable text, so Find is a graceful no-op (never crashes).
import {
    createEffect,
    createMemo,
    createResource,
    createSignal,
    Match,
    on,
    onCleanup,
    onMount,
    Show,
    Switch,
    untrack,
} from 'solid-js'
import { api, apiBase } from './api'
import type { NoteCandidate } from './editor/wikilink'
import { previewKind, type PreviewKind } from './preview/previewKind'
import { buildAssetUrl } from './preview/assetUrl'
import { highlightColor, setHighlightColor } from './preview/highlightColor'
import { findMatches, segmentText, stepMatchIndex } from './preview/findMatches'
import PdfPages from './preview/PdfPages'
import PageInk, { type PageInkPage } from './preview/PageInk'
import HighlightLayer from './preview/HighlightLayer'
import PreviewBar from './preview/PreviewBar'
import ScratchTextLayer from './preview/ScratchTextLayer'
import CodeFindBar from './preview/CodeFindBar'
import CodePane from './preview/CodePane'
import ImagePane from './preview/ImagePane'
import PreviewUnavailable from './preview/PreviewUnavailable'
import BookmarksPanel from './preview/BookmarksPanel'
import EdgeHandle from './shell/EdgeHandle'
import { dragWidth, widthBounds } from './edgeResize'
import { dragMarginRatio, fixedUnitLine, type ScratchLineAt } from './preview/scratchResize'
import createAnnotationStore from './preview/createAnnotationStore'
import { pdfCache } from './preview/pdfDocCache'
import type { PdfPageGeom } from '../../core/src/drawing/pdfHighlights'
import type { Highlight } from '../../core/src/drawing/model'
import createCompanionStore from './preview/createCompanionStore'
import type {
    AnnotationStore,
    CompanionStore,
    OutlineNode,
    PdfPagesController,
} from './preview/annotationTypes'
import CompanionFrontmatter from './preview/CompanionFrontmatter'
import { imageZoomLayout } from './preview/imageZoomLayout'
import createPreviewZoom from './preview/createPreviewZoom'
import { attachZoomGestures } from './preview/zoomGesture'
import { visiblePageRange, type PageBox, type PageSize } from './preview/pageLayout'
import {
    loadPreviewView,
    persistPreviewViewFor,
    savePreviewView,
} from './preview/previewViewMemory'
import { containRect } from '../../core/src/drawing/pageInk'
import {
    DEFAULT_MARGIN_RATIO,
    marginRatioOf,
    setMarginRatio,
} from '../../core/src/drawing/pageMargin'
import { darkOf, setDark } from '../../core/src/drawing/pageDark'
import { inkSidecarFor } from '../../core/src/fileKinds'
import { IconTextButton } from './ui/IconTextButton'
import { Loading } from './ui/EmptyState'
import { isTauri } from './platform'
import { openPathInDefaultApp, revealPath } from './appWindow'
import { pushToast } from './ui/ToastHost'
import {
    cancelConversion,
    convertPdf,
    isConverting,
    watchPdf,
} from './preview/pdfMarkdownJobs'
import { settings, setSettings } from './settings'
import { matchesKeybinding } from './keybindings'
import styles from './PreviewView.module.css'

const HEADER_ICON: Record<PreviewKind, string> = {
    image: 'Image',
    pdf: 'FileText',
    code: 'Code',
    external: 'File',
}

// Cap highlighted matches so a 1-char query in a huge file can't explode the DOM / stall
// the count. Beyond this we still show a "…+" count and highlight the first N.
const MAX_MATCHES = 2000

export function PreviewView(props: {
    path: string
    tagNames: () => string[]
    /** Vault notes for a scratch note's `[[wikilink]]` completion (ScratchTextLayer ->
     *  ScratchBlock -> MarkdownField), the same `NoteCandidate[]` shape App.tsx's `noteCandidates`
     *  already computes for the note editor. Absent = no note candidates (today's behaviour).
     *  Optional only so PreviewView.stories.tsx's ~18 unrelated call sites need not pass it; the
     *  ONLY production caller is PaneContent.tsx, where the same prop is REQUIRED — a new call
     *  site that omits it silently ships a dead completion popup. */
    noteNames?: () => NoteCandidate[]
    /** DATA SEAM (chunk-1 review): overrides the `<img>`'s `src`, normally `assetUrl()`. Storybook's
     *  fake transport can never serve `/asset` (`fake://storybook`), so `measureImage` — the only
     *  production code turning a real `<img>` into `imagePages` (padding/border subtraction +
     *  `containRect` letterboxing + body scroll/clientLeft) — had no story exercising it against a
     *  REAL loaded image; every other ink story hand-places a rect and skips this entirely. A
     *  story passes a real `data:image/png` URL here; production never sets this prop, so
     *  `assetUrl()` is always what actually ships. */
    imageSrc?: () => string
    /** DATA SEAM (Task 1): overrides the PDF bytes fetch normally done via `fetch(assetUrl())`,
     *  like `imageSrc` above for the image path. A story feeds a jspdf-built PDF through this;
     *  production never sets it, so `fetch(assetUrl())` is always what actually ships. */
    pdfLoad?: () => Promise<ArrayBuffer>
    /** DATA SEAM (Task 3): overrides `pdfMemoryKey()` below, normally `path()`. Task 2 made view
     *  memory (zoom/panel/position) skip entirely whenever `pdfLoad` is set, because several
     *  stories share one literal path with `pdfLoad` set and would otherwise leak state between
     *  them — see `pdfMemoryKey` below. A story that means to prove restore-across-remount passes
     *  a key unique to itself here, alongside `pdfLoad`, so view memory saves/restores against
     *  that key instead of being skipped; production never sets this prop, so `pdfMemoryKey()` is
     *  always `path()` there. */
    pdfViewKey?: string
    /** DATA SEAM: opts a `pdfLoad` story into PdfPages' session doc cache under a key unique to
     *  that story — the cache-hit remount is the path a user takes returning to a PDF tab, and
     *  `pdfLoad` alone (like `pdfViewKey`) deliberately gets no cache. Production never sets it,
     *  so the cache key is always `path()` there. */
    pdfCacheKey?: string
    /** DATA SEAM (final review — PdfViewBarNarrow measured the trail without these): defaults to
     *  `isTauri()`, which is always false in a Storybook browser tab, so a story measuring the
     *  ViewBar's collapse behaviour never saw the open-in-default-app / reveal icon buttons
     *  that DO render in the shipping desktop app. A story passes `true` to measure the real
     *  trail; production never sets this prop, so `isTauri()` is always what actually ships. */
    showNativeActions?: boolean
}) {
    // `props.path` arrives through a JSX getter chain rooted at App.tsx's `tabs` signal
    // (App -> PaneTree -> PaneContent -> here). App.tsx rebuilds the active tab's object on
    // every pane mousedown (to set `focusId`), even when the id doesn't change, which — absent
    // this memo — would make every `props.path` READ (not just a real path change) look like a
    // dependency change to anything computing off it. Wrapping it here means the rest of this
    // component keys off `path()`, a memo that only actually changes value when the PATH itself
    // does, so a click that merely refocuses a pane can never reboot the PDF/zoom/ink state below.
    const path = createMemo(() => props.path)
    const kind = (): PreviewKind => previewKind(path()) ?? 'external'

    // PDF → markdown: a conversion started from this PDF (here, in another pane, or before a
    // reload) shows in the bar while it runs; the job itself lives in preview/pdfMarkdownJobs.
    createEffect(() => {
        if (kind() !== 'pdf') return
        onCleanup(watchPdf(path()))
    })
    const name = () => path().split('/').pop() ?? path()
    // `src` for the image <img>: GET /asset, resolved filename-first by the backend. Built
    // through the pure, unit-tested `buildAssetUrl` so the space/U+202F/`/` encoding that lets
    // macOS-screenshot filenames load can never silently regress.
    const assetUrl = () => buildAssetUrl(apiBase(), path())
    const imgSrc = () => (props.imageSrc ? props.imageSrc() : assetUrl())
    const inkable = () => kind() === 'image' || kind() === 'pdf'
    // The bar's open-in-default-app / reveal buttons: real Tauri, or a story
    // forcing them on to measure the trail as it actually ships (see `showNativeActions` above).
    const nativeActions = () => props.showNativeActions ?? isTauri()

    // PdfPages' `load` data seam, as a MEMO rather than an inline closure: a plain
    // `() => fetch(assetUrl())…` function literal is a stable reference to Solid's compiler (a
    // function VALUE being passed, not a computed one), so it would never change identity when
    // switching between two PDFs while `kind()` stays 'pdf' — and PdfPages only reloads when
    // `props.load` itself changes identity. Wrapping the URL capture in `createMemo` forces a
    // brand-new closure exactly when `assetUrl()` (i.e. `path()`) actually changes, and a
    // stable one otherwise (e.g. across zoom changes, or a refocus that leaves the path alone).
    // `props.pdfLoad` is read only INSIDE the returned closure (not at memo-eval time), so its
    // presence can never itself force a new closure independent of the URL.
    const pdfLoad = createMemo(() => {
        const url = assetUrl()
        return () =>
            props.pdfLoad ? props.pdfLoad() : fetch(url).then(r => r.arrayBuffer())
    })

    // pdf.js loads the PDF from this URL itself (range requests, streamed). Not available for a
    // story's `pdfLoad` seam or a backend with no HTTP URL (mobile runs core in-process), which
    // keep the buffered `pdfLoad` above.
    const pdfUrl = () =>
        props.pdfLoad || !/^https?:/.test(apiBase()) ? undefined : assetUrl()

    // `previewViewMemory`'s key for the CURRENT path, or undefined when a story supplies `pdfLoad`
    // (same condition PdfPages' own `cacheKey` uses) — several PreviewView stories share one
    // literal path (`ANNOT_PDF_PATH`) across separate stories with `pdfLoad` set, so saving/
    // restoring zoom, panel-open or position under that path would leak one story's state
    // (e.g. PdfHighlightMarginBookmarks opening the bookmarks panel) into the next story mounted
    // at the same path. `props.pdfViewKey` (Task 3) is the one exception: a story that means to
    // prove restore-across-remount passes it alongside `pdfLoad` to opt back into view memory
    // under a key unique to that story. Production never sets either prop, so this is always
    // `path()` there.
    const pdfMemoryKey = () => (props.pdfViewKey ?? (props.pdfLoad ? undefined : path()))

    // Fold-state key for the companion frontmatter strip — same leak guard as `pdfMemoryKey`
    // above, extended to the `imageSrc` seam: several stories share one literal path with
    // `pdfLoad` OR `imageSrc` set, so persisting fold state under that path would leak one
    // story's fold into the next mounted at the same path. `props.pdfViewKey` opts back into a
    // real key (mirroring `pdfMemoryKey`'s own exception). Production never sets `pdfLoad` or
    // `imageSrc`, so this is always `path()` there.
    const foldKey = () =>
        props.pdfViewKey ?? (props.pdfLoad || props.imageSrc ? undefined : path())
    // An image's `previewViewMemory` key: the same leak guard as `foldKey`, for the same reason.
    const imageMemoryKey = foldKey

    // The view memory outlives a reload: production backs it with this vault's localStorage. A
    // story (`pdfLoad`/`imageSrc` set) never does, so a play() run cannot seed the next one.
    if (!props.pdfLoad && !props.imageSrc) persistPreviewViewFor(apiBase())

    // Image load failure (a moved/renamed/unresolved src → 404) must NOT be a silent blank pane
    // — surface a clear state + the Open-externally affordance instead. Reset on every path
    // change so switching to a fresh image re-attempts the load.
    const [imgFailed, setImgFailed] = createSignal(false)

    // PDF zoom — transient (not a `.settings` key, per the plan's ruling), restored per file
    // from `previewViewMemory` (fit-width the first time a file is opened). 1 = fit
    // width (PdfPages' own contract).
    // Pinch / ctrl+wheel apply at once, anchored at the pointer (PdfPages' `zoomAt`); the bar's
    // − / + / fit glide (preview/createPreviewZoom).
    const pdfZoomCtl = createPreviewZoom({
        min: 0.25,
        max: 4,
        anchor: (apply, x, y) =>
            pdfController ? pdfController.zoomAt(apply, x, y) : apply(),
    })
    const pdfZoom = pdfZoomCtl.zoom
    // Image zoom — restored per file from `previewViewMemory` with the picture point that was at
    // the centre of the view (fit the first time). Never below the fit: smaller than the pane shows
    // nothing more. Anchored by `imageZoomAt` below.
    // The picture point under the centre of the view, as fractions of the rendered picture, while
    // the image is laid out explicitly (zoomed or with scratch). Every explicit re-layout scrolls
    // back to it (`measureImage`), so the place survives a reflow — the companion strip settling
    // above the body after a reopen, a pane resize — and opening a file seeds it from
    // `previewViewMemory`. Each scroll of the body moves it.
    let imageAnchor: { fx: number; fy: number } | undefined
    const imageZoomCtl = createPreviewZoom({
        min: 1,
        max: 8,
        anchor: (apply, x, y) => imageZoomAt(apply, x, y),
    })
    const imageZoom = imageZoomCtl.zoom
    createEffect(
        on(path, () => {
            const key = pdfMemoryKey()
            pdfZoomCtl.set(key ? loadPreviewView(key)?.zoom ?? 1 : 1)
            const imgKey = imageMemoryKey()
            const saved = imgKey ? loadPreviewView(imgKey)?.image : undefined
            imageAnchor = saved ? { fx: saved.fx, fy: saved.fy } : undefined
            imageZoomCtl.set(saved?.zoom ?? 1)
        }),
    )
    const zoomCtl = () => (kind() === 'image' ? imageZoomCtl : pdfZoomCtl)

    // Fetch the text body only for code/text kinds (GET /file returns "" for a missing file).
    const [code] = createResource(
        () => (kind() === 'code' ? path() : undefined),
        p => api.read(p).catch(() => ''),
    )

    // --- Find state (code/text bar + pdf note) ---------------------------------------------
    const [findOpen, setFindOpen] = createSignal(false)
    const [query, setQuery] = createSignal('')
    const [caseSensitive, setCaseSensitive] = createSignal(false)
    const [activeIndex, setActiveIndex] = createSignal(0)

    let rootRef: HTMLDivElement | undefined
    let inputRef: HTMLInputElement | undefined
    let codeRef: HTMLPreElement | undefined
    let bodyRef: HTMLDivElement | undefined

    // --- In-place ink (image + pdf) ---------------------------------------------------------
    const [drawMode, setDrawMode] = createSignal(false)
    // The HIGHLIGHT button is ARMED: the next text selection on a PDF page becomes a highlight (see
    // `pressHighlight`). Never on together with draw mode — draw mode's canvases capture the
    // pointer, so a selection could not start anyway.
    const [highlightArmed, setHighlightArmed] = createSignal(false)
    // HighlightLayer hands this over at setup — highlights a selection that already exists.
    let highlighter: { highlightSelection: () => boolean } | undefined
    // One entry per rendered page, in PageInk's host coordinates (the host is `inset: 0` over
    // the body for an image, over PdfPages' scroll content for a PDF).
    const [imagePages, setImagePages] = createSignal<PageInkPage[]>([])
    // The image's scroll content while it is laid out explicitly (scratch on, or zoomed) — the
    // stage grows past the body once the picture does. undefined = the plain CSS-centred image.
    const [imageStage, setImageStage] = createSignal<{ w: number; h: number }>()
    // The `<img>` currently mounted (the plain and the explicit path each mount their own).
    let imgEl: HTMLImageElement | undefined
    const stageStyle = () => {
        const st = imageStage()
        return st ? { width: `${st.w}px`, height: `${st.h}px` } : undefined
    }
    const [pdfPages, setPdfPages] = createSignal<PageInkPage[]>([])
    // The pages PdfPages gives DOM to; the ink and highlight overlays window themselves to it.
    const [pdfVisibleRange, setPdfVisibleRange] = createSignal<[number, number]>([0, -1])
    // The loaded image's natural pixel size, for PreviewBar's readout slot — absent before load
    // and after a load error, matching the PDF page-count readout's own absent-until-known shape.
    const [imageSize, setImageSize] = createSignal<{ w: number; h: number }>()
    const enterDraw = () => {
        setHighlightArmed(false)
        setDrawMode(true)
    }
    const toggleDraw = () => (drawMode() ? exitDraw() : enterDraw())
    /** HIGHLIGHT is one-shot (the user: "highlighting should not be a mode. just press a button
     *  and highlight, then it turns off waiting for the next button click"). Armed → disarm. A
     *  selection already inside the PDF → highlight it now and stay off. Otherwise arm; the layer
     *  calls `onHighlighted` after the next highlight it creates or removes, which disarms. */
    const pressHighlight = () => {
        if (highlightArmed()) {
            setHighlightArmed(false)
            return
        }
        if (drawMode()) exitDraw()
        if (highlighter?.highlightSelection()) return
        setHighlightArmed(true)
    }
    /** A colour swatch picks the highlighter's colour, then presses highlight — unless it is
     *  already armed, where it only switches the colour the waiting highlight will take. */
    const pickHighlightColor = (c: string) => {
        setHighlightColor(c)
        if (!highlightArmed()) pressHighlight()
    }

    // --- Annotation store (image + pdf) ------------------------------------------------------
    // Keyed on a BOOLEAN memo, so the store is built once when the file becomes an ink kind and
    // disposed (its own cleanup flushes) when it stops being one — a switch between two ink files
    // keeps the same store, whose own `on(sidecarPath)` effect flushes the old file and loads the
    // new one. `untrack` keeps the store's setup reads out of this memo's dependencies.
    const inkableKind = createMemo(inkable)
    // The key PdfPages caches its document under; the store reads page geometry from that entry.
    const pdfDocKey = () =>
        props.pdfCacheKey ?? (props.pdfLoad ? undefined : path())
    /** A PDF page's `/MediaBox`+`/CropBox` view and `/Rotate`, which the PDF's highlight ids are
     *  hashed over: the shown document's own, reported by PdfPages on every load (cache hit or
     *  fresh), else the unrotated, origin-zero page the laid-out size implies until it reports. */
    let pdfGeoms: PdfPageGeom[] = []
    const pdfPageGeom = (page: number): PdfPageGeom | undefined => {
        const g = pdfGeoms[page]
        if (g) return g
        const nat = untrack(pdfPages)[page]?.nat
        return nat ? { view: [0, 0, nat.w, nat.h], rotate: 0 } : undefined
    }
    /** After a save into the PDF the cached document still carries the highlights it was loaded
     *  with; a returning tab reports those, so hand it the saved set instead. */
    const rememberPdfHighlights = (pages: Highlight[][]) => {
        const key = pdfDocKey()
        const hit = key ? pdfCache.acquire(key) : undefined
        if (!hit) return
        try {
            hit.value.doc.highlights = Promise.resolve(pages)
        } finally {
            hit.release()
        }
    }
    const store = createMemo<AnnotationStore | undefined>(() =>
        inkableKind()
            ? untrack(() =>
                  createAnnotationStore(() => inkSidecarFor(path()), path, {
                      pageGeom: pdfPageGeom,
                      onPdfSaved: rememberPdfHighlights,
                  }),
              )
            : undefined,
    )
    const annotReady = () => store()?.loadState() === 'ready'
    // A live drag of the page|strip line (scratchEdge below) previews its ratio here and writes the
    // sidecar once, on release — so one drag is one undo step, not one per pointer move.
    const [scratchDrag, setScratchDrag] = createSignal<number | null>(null)
    const marginRatio = createMemo(
        () => scratchDrag() ?? marginRatioOf(store()?.doc() ?? null),
    )
    // PDF dark mode is remembered PER FILE, in the sidecar's `dark` flag beside `margin`;
    // `appearance.pdfDarkMode` is only the default for a PDF that holds no flag yet. The moon
    // writes the flag through the same store as scratch paper, so it saves and undoes the same way.
    const pdfDark = () => darkOf(store()?.doc() ?? null, settings.appearance.pdfDarkMode)
    const togglePdfDark = () => store()?.edit(d => setDark(d, !pdfDark()))

    const toggleMargin = () =>
        store()?.edit(d =>
            setMarginRatio(
                d,
                marginRatioOf(d) > 0 ? 0 : DEFAULT_MARGIN_RATIO,
            ),
        )

    // --- Companion store (tags + scratch-note blocks, image + pdf) --------------------------
    // Same "built once on inkableKind(), untracked" shape as the annotation store above — one
    // companion store for as long as the file stays an ink kind, its own `on(binaryPath)` effect
    // flushing the old file and loading the new one on a switch between two ink files. Shared by
    // CompanionFrontmatter (tags) and ScratchTextLayer (blocks) below, so a save from either can
    // never drop the other's content (createCompanionStore.ts).
    const companion = createMemo<CompanionStore | undefined>(() =>
        inkableKind() ? untrack(() => createCompanionStore(path)) : undefined,
    )
    /** Blocks + the strip's click-to-place hit areas take pointer events only while scratch paper
     *  is on, outside draw mode / highlight-arming, and both stores are ready — the click-to-place
     *  interaction rule for scratch notes. */
    const scratchInteractive = () =>
        marginRatio() > 0 &&
        !drawMode() &&
        !highlightArmed() &&
        annotReady() &&
        companion()?.loadState() === 'ready'

    // --- PDF navigation (bookmarks panel) ------------------------------------------------------
    const [panelOpen, setPanelOpen] = createSignal(false)
    const [outline, setOutline] = createSignal<OutlineNode[]>([])
    const [currentPage, setCurrentPage] = createSignal(0)
    const [pageCount, setPageCount] = createSignal(0)
    const [pdfScrollEl, setPdfScrollEl] = createSignal<HTMLElement>()
    // Raw PdfPages boxes (top/left/w/h/marginW per page, host px), kept ALONGSIDE `pdfPages`
    // below — `scratchVisibleRange` needs them in `pageLayout.ts`'s own `PageBox` shape to call
    // `visiblePageRange` directly, the same math PdfPages uses internally for its own canvas
    // windowing (final review, finding 2).
    const [pdfBoxes, setPdfBoxes] = createSignal<PageBox[]>([])
    // Bumped on every scroll of the PDF's own scroll element, so `scratchVisibleRange` (a plain
    // function, not a memo) recomputes reactively when read inside ScratchTextLayer's JSX —
    // `pdfScrollEl()`/`scrollTop` themselves are DOM reads, not signals, so nothing would
    // otherwise notify on scroll.
    const [scrollTick, setScrollTick] = createSignal(0)
    createEffect(
        on(pdfScrollEl, el => {
            if (!el) return
            const onScroll = () => setScrollTick(t => t + 1)
            el.addEventListener('scroll', onScroll, { passive: true })
            onCleanup(() => el.removeEventListener('scroll', onScroll))
        }),
    )
    let pdfController: PdfPagesController | undefined

    const exitDraw = () => {
        setDrawMode(false)
        // Focus was on the ink host (or fell to body): hand it back to the preview root so the
        // toggle key works again immediately — but never steal it from another pane.
        const ae = document.activeElement
        if (ae === document.body || (ae && rootRef?.contains(ae))) {
            rootRef?.focus({ preventScroll: true })
        }
    }
    createEffect(
        on(
            path,
            () => {
                setDrawMode(false)
                setHighlightArmed(false)
                const key = pdfMemoryKey()
                setPanelOpen(!!(key && loadPreviewView(key)?.panelOpen))
                setOutline([])
                setCurrentPage(0)
                setPageCount(0)
                setImagePages([])
                setPdfPages([])
                pdfGeoms = []
                setPdfBoxes([])
                setScratchDrag(null)
            },
        ),
    )

    // Remember zoom + panel-open per PDF, so switching away and back restores them instead of
    // resetting to fit-width/closed. On a path change the restore effects above run first (creation
    // order) and this one runs once, coalesced, with the restored values; `defer: true` only keeps
    // the mount run from writing a default memory entry for a file nobody has zoomed yet.
    createEffect(
        on(
            [path, pdfZoom, panelOpen],
            ([, z, open]) => {
                const key = pdfMemoryKey()
                if (kind() === 'pdf' && key) savePreviewView(key, { zoom: z, panelOpen: open })
            },
            { defer: true },
        ),
    )

    /** Where the `<img>` actually paints its pixels, relative to the body. `.preview-image`
     *  carries padding and `object-fit: contain`, so its border box is NOT the picture — the
     *  content box is, letterboxed to the natural aspect ratio.
     *
     *  With SCRATCH on (`marginRatio() > 0`) the picture no longer free-sizes via CSS alone — a
     *  strip needs room beside it, laid out as one centred unit (`imageScratchLayout.ts`), so
     *  this measures the BODY's own content box (never the image's, which this render is about to
     *  size explicitly) and lays image + strip out in host coordinates, the same body-relative
     *  space PageInk's `pages()` already use. ZOOMED (`imageZoom() !== 1`) takes the same explicit
     *  path, scaled about that fit (`imageZoomLayout.ts`), and sizes the stage so the body scrolls
     *  to pan. With SCRATCH off at zoom 1 this is UNCHANGED from before —
     *  `ImageInkLandsAtRealMeasuredRect` (PreviewView.stories.tsx) depends on that exact math. */
    const measureImage = (img: HTMLImageElement) => {
        const body = bodyRef
        // Falls back to the size the last load reported (`imageSize`): a zoom that crosses 1 swaps
        // in a fresh `<img>`, which may not report its own natural size for a frame.
        const natW = img.naturalWidth || imageSize()?.w || 0
        const natH = img.naturalHeight || imageSize()?.h || 0
        if (!body || !img.isConnected || !natW || !natH) return
        const ratio = marginRatio()
        if (ratio > 0 || imageZoom() !== 1) {
            // The fixed gutter `.preview-image` used to carry as its own CSS padding, now the
            // gutter of the AREA the image+strip unit centres inside (read off the body itself so
            // it never depends on the image's own — now overridden — style).
            const gutter =
                parseFloat(
                    getComputedStyle(body).getPropertyValue('--sp-6'),
                ) || 0
            const { rendered, marginW, stage } = imageZoomLayout(
                { w: body.clientWidth, h: body.clientHeight },
                gutter,
                natW,
                natH,
                ratio,
                imageZoom(),
            )
            setImageStage(stage)
            setImagePages([
                {
                    rendered,
                    nat: { w: natW, h: natH },
                    ...(ratio > 0 ? { marginW } : {}),
                },
            ])
            if (imageAnchor) scrollToImageAnchor(body, rendered, imageAnchor)
            return
        }
        imageAnchor = undefined
        setImageStage(undefined)
        const br = body.getBoundingClientRect()
        const ir = img.getBoundingClientRect()
        const cs = getComputedStyle(img)
        const px = (v: string) => parseFloat(v) || 0
        const padL = px(cs.borderLeftWidth) + px(cs.paddingLeft)
        const padT = px(cs.borderTopWidth) + px(cs.paddingTop)
        const padR = px(cs.borderRightWidth) + px(cs.paddingRight)
        const padB = px(cs.borderBottomWidth) + px(cs.paddingBottom)
        const content = {
            left: ir.left - br.left - body.clientLeft + body.scrollLeft + padL,
            top: ir.top - br.top - body.clientTop + body.scrollTop + padT,
            w: ir.width - padL - padR,
            h: ir.height - padT - padB,
        }
        setImagePages([
            {
                rendered: containRect(content, natW, natH),
                nat: { w: natW, h: natH },
            },
        ])
    }
    type Rect = { left: number; top: number; w: number; h: number }
    // Where `scrollToImageAnchor` last left the body. The browser clamps an offset past the end, so
    // during a transient layout (a taller body before the strip above it settles) this is not the
    // anchor's own spot; the scroll event that echoes it must not move the anchor.
    let anchorScroll: { left: number; top: number } | undefined
    /** Scroll the body so the picture point `a` sits at the centre of the view. */
    const scrollToImageAnchor = (
        body: HTMLElement,
        rendered: Rect,
        a: { fx: number; fy: number },
    ) => {
        body.scrollLeft =
            rendered.left + a.fx * rendered.w - body.clientWidth / 2
        body.scrollTop =
            rendered.top + a.fy * rendered.h - body.clientHeight / 2
        anchorScroll = { left: body.scrollLeft, top: body.scrollTop }
    }
    /** The picture point at the centre of the body's view, as fractions of the rendered picture,
     *  or undefined when the body is detached or unmeasured (a teardown reports a scroll of 0) or
     *  the picture is not laid out. */
    const imageCentre = () => {
        const body = bodyRef
        const page = imagePages()[0]
        if (
            !body?.isConnected ||
            body.clientWidth <= 0 ||
            body.clientHeight <= 0
        )
            return undefined
        if (!page || page.rendered.w <= 0 || page.rendered.h <= 0)
            return undefined
        // Not clamped to 0..1: scrolled against an edge, the centre sits in the gutter past the
        // picture, and only the unclamped fraction scrolls back to that edge.
        const { left, top, w, h } = page.rendered
        return {
            fx: (body.scrollLeft + body.clientWidth / 2 - left) / w,
            fy: (body.scrollTop + body.clientHeight / 2 - top) / h,
        }
    }
    /** A scroll of the body: move the anchor at once (unless it is the echo of the anchor's own
     *  scroll), and remember zoom + anchor at most once a frame. */
    let imageSaveRaf: number | undefined
    const onImageScroll = () => {
        const body = bodyRef
        if (kind() !== 'image' || !body) return
        const echo =
            anchorScroll?.left === body.scrollLeft &&
            anchorScroll.top === body.scrollTop
        anchorScroll = undefined
        if (imageStage() && !echo) imageAnchor = imageCentre() ?? imageAnchor
        scheduleImageSave()
    }
    const scheduleImageSave = () => {
        if (imageSaveRaf !== undefined || kind() !== 'image') return
        const key = imageMemoryKey()
        if (!key) return
        imageSaveRaf = requestAnimationFrame(() => {
            imageSaveRaf = undefined
            if (key !== imageMemoryKey() || kind() !== 'image') return
            const zoom = imageZoom()
            // At the fit nothing scrolls: the anchor is meaningless, the centre stands in for it.
            const at = zoom === 1 ? { fx: 0.5, fy: 0.5 } : imageAnchor
            if (at) savePreviewView(key, { image: { zoom, ...at } })
        })
    }
    onCleanup(() => {
        if (imageSaveRaf !== undefined) cancelAnimationFrame(imageSaveRaf)
    })
    createEffect(on(imageZoom, scheduleImageSave, { defer: true }))
    /** The image's ref: re-measure on load and whenever it or the body resizes (a pane resize
     *  can re-centre the picture without changing its size, hence both). */
    const attachImage = (img: HTMLImageElement) => {
        imgEl = img
        const ro = new ResizeObserver(() => measureImage(img))
        ro.observe(img)
        if (bodyRef) ro.observe(bodyRef)
        onCleanup(() => ro.disconnect())
    }
    // A ratio change with the strip already on (an edge drag, an undo) keeps the same `<img>`, so
    // neither its ref nor its ResizeObserver fires: re-lay the picture + strip out here.
    createEffect(
        on(
            marginRatio,
            () => {
                if (imgEl && kind() === 'image') measureImage(imgEl)
            },
            { defer: true },
        ),
    )
    /** Run `apply` (a zoom change), re-lay the image out at once, and scroll so the picture point
     *  under client (`x`, `y`) — the body's centre for a button glide — stays put. */
    const imageZoomAt = (apply: () => void, x?: number, y?: number) => {
        const body = bodyRef
        const page = imagePages()[0]
        if (!body || !page || page.rendered.w <= 0 || page.rendered.h <= 0) {
            apply()
            if (imgEl) measureImage(imgEl)
            return
        }
        const r = body.getBoundingClientRect()
        const vx = x === undefined ? body.clientWidth / 2 : x - r.left - body.clientLeft
        const vy = y === undefined ? body.clientHeight / 2 : y - r.top - body.clientTop
        const fx = (body.scrollLeft + vx - page.rendered.left) / page.rendered.w
        const fy = (body.scrollTop + vy - page.rendered.top) / page.rendered.h
        apply()
        if (imgEl) measureImage(imgEl)
        const next = imagePages()[0]
        if (!next) return
        body.scrollLeft = next.rendered.left + fx * next.rendered.w - vx
        body.scrollTop = next.rendered.top + fy * next.rendered.h - vy
    }
    const onPdfLayout = (l: {
        boxes: PageBox[]
        sizes: PageSize[]
        scrollEl: HTMLElement
    }) => {
        setPdfScrollEl(l.scrollEl)
        setPdfBoxes(l.boxes)
        setPdfPages(
            l.boxes.map((b, i) => ({
                rendered: { left: b.left, top: b.top, w: b.w, h: b.h },
                nat: l.sizes[i] ?? { w: b.w, h: b.h },
                marginW: b.marginW,
            })),
        )
    }
    /** Pages a scratch block editor is actually mounted for — the pages that actually intersect
     *  the SCROLLED VIEWPORT (`pageLayout.ts`'s own `visiblePageRange`, the same math PdfPages
     *  uses for its own canvas windowing), not just "current page ± 2": at low zoom a 900-1400px
     *  pane can show 5-7 pages at once, and a fixed ±2 window left a blank strip on any page
     *  beyond that (final review, finding 2). `scrollTick` forces this to be read again on every
     *  scroll of the PDF's own scroll element (a plain DOM read otherwise has nothing to notify
     *  Solid that it changed). Overscan 2, matching the old window's reach either side. */
    const scratchVisibleRange = createMemo(
        (): [number, number] => {
            scrollTick()
            const el = pdfScrollEl()
            const boxes = pdfBoxes()
            if (!el || !boxes.length) return [0, -1]
            return visiblePageRange(boxes, el.scrollTop, el.clientHeight, 2)
        },
        undefined,
        // Equal ranges do not notify, so a scroll only re-runs what reads this when a page
        // actually enters or leaves the range — not once per scroll event.
        { equals: (a, b) => a[0] === b[0] && a[1] === b[1] },
    )

    // Matches + segmented render, only for code/text with a live query.
    const matches = createMemo(() =>
        kind() === 'code' && query()
            ? findMatches(code() ?? '', query(), caseSensitive(), MAX_MATCHES)
            : [],
    )
    const capped = () => matches().length >= MAX_MATCHES
    const segments = createMemo(() =>
        kind() === 'code' && query() && matches().length
            ? segmentText(code() ?? '', matches())
            : null,
    )

    // Reset the active match + any prior image-load failure when the file (or its text) changes
    // so stale state never lingers and a new image re-attempts its load.
    createEffect(
        on([path, code], () => {
            setActiveIndex(0)
            setImgFailed(false)
            setImageSize(undefined)
        }),
    )
    // Keep the active index in range as the query narrows the match set.
    createEffect(() => {
        if (activeIndex() >= matches().length) setActiveIndex(0)
    })
    // Scroll the active match into view whenever it (or the query) changes.
    createEffect(() => {
        activeIndex()
        segments()
        if (kind() !== 'code' || !findOpen()) return
        queueMicrotask(() =>
            codeRef
                ?.querySelector<HTMLElement>('[data-find-match][data-active]')
                ?.scrollIntoView({
                    block: 'center',
                    inline: 'nearest',
                }),
        )
    })

    const step = (dir: 1 | -1) => {
        const n = matches().length
        if (n) setActiveIndex(stepMatchIndex(activeIndex(), n, dir))
    }

    const closeFind = () => {
        setFindOpen(false)
        rootRef?.focus()
    }

    const countLabel = () => {
        if (!query()) return ''
        const n = matches().length
        if (n === 0) return 'No results'
        return `${activeIndex() + 1}/${n}${capped() ? '+' : ''}`
    }

    // Focus the input whenever the code find bar opens (element mounts after the signal flips).
    createEffect(() => {
        if (findOpen() && kind() === 'code') {
            queueMicrotask(() => {
                inputRef?.focus()
                inputRef?.select()
            })
        }
    })

    // Cmd/Ctrl+F and toggle-draw-mode on the focused preview. Capture phase + stop/preventDefault
    // so they win before App.tsx's window-level shortcut handler and (dev) the browser's native
    // find. The ink host lives inside the root, so the toggle still lands here while drawing.
    const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return
        // GATED, not stopPropagation-from-the-strip: this listener is registered CAPTURE-phase
        // below (`addEventListener('keydown', onKey, true)`), which fires top-down — by the time
        // a keystroke reaches CompanionFrontmatter's CodeMirror field or a scratch-note block's
        // (both descendants of rootRef), THIS handler has already run. A `stopPropagation()`
        // inside either could only stop the event from continuing further down/back up; it cannot
        // undo a check that already happened at this ancestor. So both are exempted here instead,
        // by `data-*` hooks (never a class — the hashing trap under CLAUDE.md's Styling section)
        // on their wrappers: typing (including the toggle-draw-mode / find / undo combos, e.g. a
        // tag or a note literally containing them) inside either field must always just edit
        // text, never toggle draw mode, open Find, or undo an ink stroke.
        if (
            (e.target as HTMLElement | null)?.closest?.(
                '[data-companion-frontmatter], [data-scratch-text]',
            )
        )
            return
        if (
            inkable() &&
            matchesKeybinding(e, settings.keybindings['toggle-draw-mode'])
        ) {
            e.preventDefault()
            e.stopPropagation()
            toggleDraw()
            return
        }
        // Undo/redo for highlights, bookmarks and the margin toggle — the one-click edits that
        // have no OTHER way back (chunk-1 + final review). PageInk's own host `onHostKey` binds
        // `ink-undo`/`ink-redo` the same way while draw mode is ON; this is the
        // outside-draw-mode half, so the shared undo stack (createAnnotationStore.ts) is
        // reachable no matter which control made the edit. Gated on `inkable()` (only ink kinds
        // have a store) and `!drawMode()` (PageInk already owns these keys while drawing —
        // handling them again here would just double up).
        if (
            inkable() &&
            !drawMode() &&
            matchesKeybinding(e, settings.keybindings['ink-undo'])
        ) {
            e.preventDefault()
            e.stopPropagation()
            store()?.undo()
            return
        }
        if (
            inkable() &&
            !drawMode() &&
            matchesKeybinding(e, settings.keybindings['ink-redo'])
        ) {
            e.preventDefault()
            e.stopPropagation()
            store()?.redo()
            return
        }
        if (!matchesKeybinding(e, settings.keybindings.find)) return
        const k = kind()
        if (k === 'image' || k === 'external') return // no text — graceful no-op

        e.preventDefault()
        e.stopPropagation()
        if (k === 'pdf') {
            setFindOpen(true) // no in-app PDF search yet — see the note below
            return
        }
        // code/text
        if (findOpen()) {
            inputRef?.focus()
            inputRef?.select()
        } else {
            setFindOpen(true)
        }
    }
    onMount(() => {
        rootRef?.addEventListener('keydown', onKey, true)
        onCleanup(() => rootRef?.removeEventListener('keydown', onKey, true))
        // Focus the root so Cmd+F works immediately, before any click (mirrors Editor.tsx).
        queueMicrotask(() => rootRef?.focus())
    })

    // Resolve to an absolute path (backend, filename-first) then hand off to the OS opener.
    async function openExternal(reveal: boolean) {
        try {
            const { path: absPath } = await api.absPath(path())
            const ok = await (reveal
                ? revealPath(absPath)
                : openPathInDefaultApp(absPath))
            if (!ok) pushToast("Couldn't open — see console")
        } catch (e) {
            pushToast(`Couldn't open: ${(e as Error).message}`)
        }
    }

    // --- Panel edges (shell/EdgeHandle, the sidebar's own grab strip) -------------------------
    // SCRATCH: one strip on every page|scratch line (each PDF page's, the image's). Dragging moves
    // the line. Clicking hides scratch on a PDF; an image's line only resizes, since the bar has
    // no scratch toggle for images to bring a hidden strip back. Absent while drawing or arming a
    // highlight, so it never takes a stroke or a selection that starts on the line.
    const scratchEditable = () => annotReady() && !drawMode() && !highlightArmed()
    // The line's layout at press time (ratio → its x) and where it sat; the drag solves for the
    // ratio whose line lands under the pointer (preview/scratchResize.ts).
    let scratchLineAt: ScratchLineAt | undefined
    let scratchStartLine = 0
    const startScratchResize = (index: number) => {
        scratchLineAt = undefined
        if (kind() === 'pdf') {
            const box = pdfBoxes()[index]
            if (box) scratchLineAt = fixedUnitLine(box.w, box.marginW)
        } else {
            const body = bodyRef
            const natW = imgEl?.naturalWidth || imageSize()?.w || 0
            const natH = imgEl?.naturalHeight || imageSize()?.h || 0
            if (body && natW && natH) {
                // The same layout measureImage runs, at any ratio.
                const area = { w: body.clientWidth, h: body.clientHeight }
                const gutter = parseFloat(getComputedStyle(body).getPropertyValue('--sp-6')) || 0
                const zoom = imageZoom()
                scratchLineAt = ratio => {
                    const { rendered } = imageZoomLayout(area, gutter, natW, natH, ratio, zoom)
                    return rendered.left + rendered.w
                }
            }
        }
        scratchStartLine = scratchLineAt?.(marginRatio()) ?? 0
        setScratchDrag(marginRatio())
    }
    const resizeScratch = (dx: number) => {
        if (scratchLineAt) setScratchDrag(dragMarginRatio(scratchLineAt, scratchStartLine, dx))
    }
    const endScratchResize = () => {
        const ratio = scratchDrag()
        if (ratio !== null && ratio !== marginRatioOf(store()?.doc() ?? null))
            store()?.edit(d => setMarginRatio(d, ratio))
        setScratchDrag(null)
    }
    const scratchEdge = (index: number) => (
        <EdgeHandle
            panel="scratch"
            edge="right"
            open
            className={styles['panel-edge']}
            onResizeStart={() => startScratchResize(index)}
            onResize={resizeScratch}
            onResizeEnd={endScratchResize}
            onActivate={kind() === 'pdf' ? toggleMargin : undefined}
        />
    )
    // BOOKMARKS: the column's left edge. Dragging writes `appearance.pdfBookmarksWidth` live (the
    // settings store debounces the save, as for the sidebar), capped at 60% of the preview so the
    // stored width is always the width on screen; clicking hides the column.
    let bookmarksStartW = 0
    const resizeBookmarks = (dx: number) => {
        const [min] = widthBounds('pdfBookmarksWidth')
        const cap = Math.max(min, Math.floor((bodyRef?.clientWidth ?? Infinity) * 0.6))
        setSettings(
            'appearance',
            'pdfBookmarksWidth',
            Math.min(cap, dragWidth('pdfBookmarksWidth', bookmarksStartW, dx, -1)),
        )
    }

    return (
        <div class={styles['preview-app']} tabindex={-1} ref={rootRef}>
            <PreviewBar
                kind={kind}
                name={name}
                icon={() => HEADER_ICON[kind()]}
                currentPage={currentPage}
                pageCount={pageCount}
                onGoToPage={i => pdfController?.scrollToPage(i)}
                zoom={() => zoomCtl().zoom()}
                onZoomBy={f => zoomCtl().stepBy(f)}
                onFit={() => zoomCtl().fit()}
                annotReady={annotReady}
                drawMode={drawMode}
                onToggleDraw={toggleDraw}
                highlightArmed={highlightArmed}
                onHighlight={pressHighlight}
                highlightColor={highlightColor}
                onHighlightColor={pickHighlightColor}
                scratchOn={() => marginRatio() > 0}
                onToggleScratch={toggleMargin}
                darkOn={pdfDark}
                onToggleDark={togglePdfDark}
                drawKey={() => settings.keybindings['toggle-draw-mode']}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen(v => !v)}
                converting={() => isConverting(path())}
                onConvert={() => void convertPdf(path())}
                onCancelConvert={() => void cancelConversion(path())}
                nativeActions={nativeActions}
                onOpenExternal={reveal => void openExternal(reveal)}
                imageSize={imageSize}
            />

            {/* Tags live on the binary's companion note (core/src/fileKinds.ts's
                companionPathFor) — image/pdf only, mounted under the ViewBar so it reads like a
                note's own frontmatter sitting above the body. `data-companion-frontmatter` is the
                RUNTIME hook onKey above gates on — see its comment for why a class can't do this
                job and stopPropagation from inside the strip wouldn't either. */}
            <Show when={inkable()}>
                <div
                    data-companion-frontmatter
                    class={styles['preview-frontmatter']}
                >
                    <CompanionFrontmatter
                        store={companion()}
                        tagNames={props.tagNames}
                        foldKey={foldKey()}
                    />
                </div>
            </Show>

            <div
                classList={{
                    [styles['preview-body']]: true,
                    [styles['preview-body--desk']]: inkable(),
                }}
                data-testid="preview-body"
                ref={el => {
                    bodyRef = el
                    el.addEventListener('scroll', onImageScroll, {
                        passive: true,
                    })
                    onCleanup(() =>
                        el.removeEventListener('scroll', onImageScroll),
                    )
                    // Pinch / ctrl+wheel on an image or PDF zooms it; anything else keeps the
                    // webview's own behaviour (the listener only claims events for those kinds).
                    onCleanup(
                        attachZoomGestures(
                            el,
                            (f, x, y) => zoomCtl().pinch(f, x, y),
                            inkable,
                        ),
                    )
                }}
            >
                {/* Find bar / note, overlaid top-right of the body (never for image/external). */}
                <Show
                    when={findOpen() && (kind() === 'code' || kind() === 'pdf')}
                >
                    <CodeFindBar
                        mode={kind() === 'pdf' ? 'pdf' : 'code'}
                        query={query()}
                        onQuery={value => {
                            setActiveIndex(0)
                            setQuery(value)
                        }}
                        count={countLabel()}
                        noResults={query() !== '' && matches().length === 0}
                        matchCount={matches().length}
                        caseSensitive={caseSensitive()}
                        onToggleCase={() => setCaseSensitive(v => !v)}
                        onStep={step}
                        onClose={closeFind}
                        inputRef={el => (inputRef = el)}
                    />
                </Show>

                <Switch>
                    <Match when={kind() === 'image'}>
                        <Show
                            when={!imgFailed()}
                            fallback={
                                <PreviewUnavailable
                                    title="Couldn't load image"
                                    what={`"${name()}" could not be displayed.`}
                                    verb="view it"
                                    onOpenExternal={() => void openExternal(false)}
                                />
                            }
                        >
                            <ImagePane
                                src={imgSrc()}
                                name={name()}
                                scratch={marginRatio() > 0 || imageZoom() !== 1}
                                page={imagePages()[0]}
                                hasPages={imagePages().length > 0}
                                stageStyle={stageStyle()}
                                imgRef={attachImage}
                                onLoad={img => {
                                    setImageSize({
                                        w: img.naturalWidth,
                                        h: img.naturalHeight,
                                    })
                                    measureImage(img)
                                }}
                                scratchEdge={scratchEditable() ? scratchEdge(0) : undefined}
                                onError={() => {
                                    setImgFailed(true)
                                    setImageSize(undefined)
                                    setImagePages([])
                                }}
                                overlay={
                                    <>
                                        <Show when={companion()}>
                                            <ScratchTextLayer
                                                store={companion()!}
                                                pages={imagePages}
                                                doc={() => store()?.doc() ?? null}
                                                interactive={scratchInteractive}
                                                noteNames={props.noteNames}
                                                tagNames={props.tagNames}
                                                notePath={null}
                                            />
                                        </Show>
                                        <PageInk
                                            sidecarPath={inkSidecarFor(path())}
                                            binaryPath={path()}
                                            pages={imagePages}
                                            active={drawMode}
                                            onExit={exitDraw}
                                            store={store()}
                                        />
                                    </>
                                }
                            />
                        </Show>
                    </Match>
                    <Match when={kind() === 'pdf'}>
                        {/* One pdf.js canvas per page, fit-width by default (zoom 1), driven by
                            the ViewBar's zoom controls + Ctrl/Cmd+wheel below. `overlay` is
                            resolved once inside PdfPages via `children()`, so a plain inline
                            element here mounts exactly one ink layer (fix 2). Highlights go
                            BELOW the ink, so a stroke over highlighted text stays on top. With
                            the bookmarks panel open the body's row gives the page stack the
                            flexible width and the panel a fixed column on the right. */}
                        <PdfPages
                            class={styles['preview-pdf']}
                            load={pdfLoad()}
                            url={pdfUrl()}
                            zoom={pdfZoom()}
                            marginRatio={marginRatio()}
                            scratchEdge={scratchEditable() ? scratchEdge : undefined}
                            // The doc cache is keyed on the REAL path only, never `pdfViewKey` — a
                            // story proving view-memory restore (`pdfViewKey` set) must still get
                            // no cache, exactly like every other `pdfLoad` story, so it only ever
                            // proves the memory seam it asked for. `pdfCacheKey` is the separate,
                            // explicit opt-in for a story that means to exercise the cache.
                            cacheKey={pdfDocKey()}
                            highlightsPath={path()}
                            onPageGeoms={g => (pdfGeoms = g)}
                            dark={pdfDark()}
                            initialPosition={
                                pdfMemoryKey()
                                    ? loadPreviewView(pdfMemoryKey()!)?.position
                                    : undefined
                            }
                            onPosition={pos => {
                                const key = pdfMemoryKey()
                                if (key) savePreviewView(key, { position: pos })
                            }}
                            onLayout={onPdfLayout}
                            onVisibleRange={setPdfVisibleRange}
                            onPdfHighlights={pages => store()?.setPdfHighlights(pages)}
                            controller={c => (pdfController = c)}
                            onOutline={o => setOutline(o)}
                            onCurrentPage={setCurrentPage}
                            onPageCount={setPageCount}
                            errorAction={
                                nativeActions() ? (
                                    <IconTextButton
                                        icon="ExternalLink"
                                        onClick={() => void openExternal(false)}
                                    >
                                        open in default app
                                    </IconTextButton>
                                ) : undefined
                            }
                            overlay={
                                <>
                                    <HighlightLayer
                                        store={store()!}
                                        pages={pdfPages}
                                        armed={highlightArmed}
                                        color={highlightColor}
                                        onHighlighted={() => setHighlightArmed(false)}
                                        controller={c => (highlighter = c)}
                                        contentEl={pdfScrollEl}
                                        dark={pdfDark}
                                        visibleRange={pdfVisibleRange}
                                    />
                                    <Show when={companion()}>
                                        <ScratchTextLayer
                                            store={companion()!}
                                            pages={pdfPages}
                                            doc={() => store()?.doc() ?? null}
                                            interactive={scratchInteractive}
                                            visibleRange={scratchVisibleRange}
                                            noteNames={props.noteNames}
                                            tagNames={props.tagNames}
                                            notePath={null}
                                        />
                                    </Show>
                                    <PageInk
                                        sidecarPath={inkSidecarFor(path())}
                                        binaryPath={path()}
                                        pages={pdfPages}
                                        active={drawMode}
                                        onExit={exitDraw}
                                        store={store()}
                                        darkPage={pdfDark}
                                        visibleRange={pdfVisibleRange}
                                    />
                                </>
                            }
                        />
                        <Show when={panelOpen()}>
                            <div
                                class={styles['preview-bookmarks']}
                                style={{
                                    '--bookmarks-w': `${settings.appearance.pdfBookmarksWidth}px`,
                                }}
                            >
                                <EdgeHandle
                                    panel="bookmarks"
                                    edge="right"
                                    open
                                    className={styles['panel-edge']}
                                    onResizeStart={() =>
                                        (bookmarksStartW = settings.appearance.pdfBookmarksWidth)
                                    }
                                    onResize={resizeBookmarks}
                                    onActivate={() => setPanelOpen(false)}
                                />
                                <BookmarksPanel
                                    store={store()!}
                                    outline={outline}
                                    currentPage={currentPage}
                                    onJump={i => pdfController?.scrollToPage(i)}
                                />
                            </div>
                        </Show>
                    </Match>
                    <Match when={kind() === 'code'}>
                        <Show when={!code.loading} fallback={<Loading />}>
                            <CodePane
                                code={code() ?? ''}
                                segments={segments() ?? undefined}
                                activeIndex={activeIndex()}
                                codeRef={el => (codeRef = el)}
                            />
                        </Show>
                    </Match>
                    <Match when={kind() === 'external'}>
                        <PreviewUnavailable
                            title="Preview not available"
                            what={`This ${extLabel(name())} file can't be previewed here.`}
                            verb="view or edit it"
                            onOpenExternal={() => void openExternal(false)}
                        />
                    </Match>
                </Switch>
            </div>
        </div>
    )
}

/** Uppercased extension for the "This .PSD file …" copy, or "binary" when there's none. */
function extLabel(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `.${name.slice(dot + 1).toUpperCase()}` : 'binary'
}
