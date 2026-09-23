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
// Narrow panes shed controls through the shared collapse ladder (ui/ui.css) — never a second row.
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
    For,
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
import { findMatches, segmentText, stepMatchIndex } from './preview/findMatches'
import PdfPages from './preview/PdfPages'
import PageInk, { type PageInkPage } from './preview/PageInk'
import HighlightLayer from './preview/HighlightLayer'
import PreviewBar from './preview/PreviewBar'
import ScratchTextLayer from './preview/ScratchTextLayer'
import ScratchPaper from './preview/ScratchPaper'
import BookmarksPanel from './preview/BookmarksPanel'
import createAnnotationStore from './preview/createAnnotationStore'
import createCompanionStore from './preview/createCompanionStore'
import type {
    AnnotationStore,
    CompanionStore,
    OutlineNode,
    PdfPagesController,
} from './preview/annotationTypes'
import CompanionFrontmatter from './preview/CompanionFrontmatter'
import { imageScratchLayout } from './preview/imageScratchLayout'
import { visiblePageRange, type PageBox, type PageSize } from './preview/pageLayout'
import { loadPdfView, savePdfView } from './preview/pdfViewMemory'
import { containRect } from '../../core/src/drawing/pageInk'
import {
    DEFAULT_MARGIN_RATIO,
    marginRatioOf,
    setMarginRatio,
} from '../../core/src/drawing/pageMargin'
import { inkSidecarFor } from '../../core/src/fileKinds'
import { Icon } from './icons/Icon'
import { IconButton } from './ui/IconButton'
import PlainButton from './ui/PlainButton'
import { IconTextButton } from './ui/IconTextButton'
import SearchBar from './ui/SearchBar'
import Text from './ui/Text'
import EmptyState, { Loading } from './ui/EmptyState'
import { isTauri } from './nativeMenu'
import { openPathInDefaultApp, revealPath } from './appWindow'
import { pushToast } from './Toast'
import { settings } from './settings'
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

    // `pdfViewMemory`'s key for the CURRENT path, or undefined when a story supplies `pdfLoad`
    // (same condition PdfPages' own `cacheKey` uses) — several PreviewView stories share one
    // literal path (`ANNOT_PDF_PATH`) across separate stories with `pdfLoad` set, so saving/
    // restoring zoom, panel-open or position under that path would leak one story's state
    // (e.g. PdfHighlightMarginBookmarks opening the bookmarks panel) into the next story mounted
    // at the same path. `props.pdfViewKey` (Task 3) is the one exception: a story that means to
    // prove restore-across-remount passes it alongside `pdfLoad` to opt back into view memory
    // under a key unique to that story. Production never sets either prop, so this is always
    // `path()` there.
    const pdfMemoryKey = () => (props.pdfViewKey ?? (props.pdfLoad ? undefined : path()))

    // Image load failure (a moved/renamed/unresolved src → 404) must NOT be a silent blank pane
    // — surface a clear state + the Open-externally affordance instead. Reset on every path
    // change so switching to a fresh image re-attempts the load.
    const [imgFailed, setImgFailed] = createSignal(false)

    // PDF zoom — transient (not a `.settings` key, per the plan's ruling), restored per file
    // from `pdfViewMemory` (fit-width the first time a file is opened this session). 1 = fit
    // width (PdfPages' own contract).
    const PDF_ZOOM_MIN = 0.25
    const PDF_ZOOM_MAX = 4
    const [pdfZoom, setPdfZoom] = createSignal(1)
    const zoomBy = (factor: number) =>
        setPdfZoom(z =>
            Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, z * factor)),
        )
    createEffect(
        on(path, () => {
            const key = pdfMemoryKey()
            setPdfZoom(key ? loadPdfView(key)?.zoom ?? 1 : 1)
        }),
    )

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
    const [pdfPages, setPdfPages] = createSignal<PageInkPage[]>([])
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

    // --- Annotation store (image + pdf) ------------------------------------------------------
    // Keyed on a BOOLEAN memo, so the store is built once when the file becomes an ink kind and
    // disposed (its own cleanup flushes) when it stops being one — a switch between two ink files
    // keeps the same store, whose own `on(sidecarPath)` effect flushes the old file and loads the
    // new one. `untrack` keeps the store's setup reads out of this memo's dependencies.
    const inkableKind = createMemo(inkable)
    const store = createMemo<AnnotationStore | undefined>(() =>
        inkableKind()
            ? untrack(() =>
                  createAnnotationStore(() => inkSidecarFor(path()), path),
              )
            : undefined,
    )
    const annotReady = () => store()?.loadState() === 'ready'
    const marginRatio = createMemo(() => marginRatioOf(store()?.doc() ?? null))
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
                setPanelOpen(!!(key && loadPdfView(key)?.panelOpen))
                setOutline([])
                setCurrentPage(0)
                setPageCount(0)
                setImagePages([])
                setPdfPages([])
                setPdfBoxes([])
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
                if (kind() === 'pdf' && key) savePdfView(key, { zoom: z, panelOpen: open })
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
     *  space PageInk's `pages()` already use. With SCRATCH off this is UNCHANGED from before —
     *  `ImageInkLandsAtRealMeasuredRect` (PreviewView.stories.tsx) depends on that exact math. */
    const measureImage = (img: HTMLImageElement) => {
        const body = bodyRef
        const natW = img.naturalWidth
        const natH = img.naturalHeight
        if (!body || !img.isConnected || !natW || !natH) return
        const ratio = marginRatio()
        if (ratio > 0) {
            // The fixed gutter `.preview-image` used to carry as its own CSS padding, now the
            // gutter of the AREA the image+strip unit centres inside (read off the body itself so
            // it never depends on the image's own — now overridden — style).
            const gutter =
                parseFloat(
                    getComputedStyle(body).getPropertyValue('--sp-6'),
                ) || 0
            const area = {
                left: gutter,
                top: gutter,
                w: Math.max(0, body.clientWidth - 2 * gutter),
                h: Math.max(0, body.clientHeight - 2 * gutter),
            }
            const { rendered, marginW } = imageScratchLayout(
                area,
                natW,
                natH,
                ratio,
            )
            setImagePages([{ rendered, nat: { w: natW, h: natH }, marginW }])
            return
        }
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
    /** The image's ref: re-measure on load and whenever it or the body resizes (a pane resize
     *  can re-centre the picture without changing its size, hence both). */
    const attachImage = (img: HTMLImageElement) => {
        const ro = new ResizeObserver(() => measureImage(img))
        ro.observe(img)
        if (bodyRef) ro.observe(bodyRef)
        onCleanup(() => ro.disconnect())
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
    const scratchVisibleRange = (): [number, number] => {
        scrollTick()
        const el = pdfScrollEl()
        const boxes = pdfBoxes()
        if (!el || !boxes.length) return [0, -1]
        return visiblePageRange(boxes, el.scrollTop, el.clientHeight, 2)
    }

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

    return (
        <div class={styles['preview-app']} tabindex={-1} ref={rootRef}>
            <PreviewBar
                kind={kind}
                name={name}
                icon={() => HEADER_ICON[kind()]}
                currentPage={currentPage}
                pageCount={pageCount}
                onGoToPage={i => pdfController?.scrollToPage(i)}
                zoom={pdfZoom}
                onZoomBy={zoomBy}
                onFit={() => setPdfZoom(1)}
                annotReady={annotReady}
                drawMode={drawMode}
                onToggleDraw={toggleDraw}
                highlightArmed={highlightArmed}
                onHighlight={pressHighlight}
                scratchOn={() => marginRatio() > 0}
                onToggleScratch={toggleMargin}
                drawKey={() => settings.keybindings['toggle-draw-mode']}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen(v => !v)}
                nativeActions={nativeActions}
                onOpenExternal={reveal => void openExternal(reveal)}
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
                    />
                </div>
            </Show>

            <div
                class={styles['preview-body']}
                data-testid="preview-body"
                ref={bodyRef}
                onWheel={e => {
                    if (kind() !== 'pdf' || !(e.ctrlKey || e.metaKey)) return
                    e.preventDefault()
                    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)
                }}
            >
                {/* Find bar / note, overlaid top-right of the body (never for image/external). */}
                <Show
                    when={findOpen() && (kind() === 'code' || kind() === 'pdf')}
                >
                    <Switch>
                        <Match when={kind() === 'code'}>
                            {/* stopPropagation on this wrapper (not SearchBar itself — its
                                onKeyDown prop reaches only the input) is what kept the app's
                                capture-phase global keydown handler from seeing ANY key pressed
                                anywhere in the find bar, including the trailing buttons — restated
                                here rather than dropped in the SearchBar swap. */}
                            <div
                                class={styles['preview-find']}
                                onKeyDown={e => e.stopPropagation()}
                            >
                                <SearchBar
                                    size="compact"
                                    placeholder="Find"
                                    aria-label="Find in file"
                                    value={query()}
                                    onInput={value => {
                                        setActiveIndex(0)
                                        setQuery(value)
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            step(e.shiftKey ? -1 : 1)
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault()
                                            closeFind()
                                        }
                                    }}
                                    inputRef={el => (inputRef = el)}
                                >
                                    <Text
                                        as="span"
                                        size="inherit"
                                        tone="inherit"
                                        weight="inherit"
                                        class={styles['preview-find-count']}
                                        classList={{
                                            [styles['is-empty']]:
                                                query() !== '' &&
                                                matches().length === 0,
                                        }}
                                    >
                                        {countLabel()}
                                    </Text>
                                    <IconButton
                                        icon="ChevronUp"
                                        label="Previous match (Shift+Enter)"
                                        iconSize={15}
                                        disabled={matches().length === 0}
                                        onClick={() => {
                                            step(-1)
                                            inputRef?.focus()
                                        }}
                                    />
                                    <IconButton
                                        icon="ChevronDown"
                                        label="Next match (Enter)"
                                        iconSize={15}
                                        disabled={matches().length === 0}
                                        onClick={() => {
                                            step(1)
                                            inputRef?.focus()
                                        }}
                                    />
                                    <PlainButton
                                        class={styles['preview-find-case']}
                                        data-state={
                                            caseSensitive()
                                                ? 'selected'
                                                : 'unselected'
                                        }
                                        title="Match case"
                                        aria-label="Match case"
                                        aria-pressed={caseSensitive()}
                                        onClick={() => {
                                            setCaseSensitive(v => !v)
                                            inputRef?.focus()
                                        }}
                                    >
                                        Aa
                                    </PlainButton>
                                    <IconButton
                                        icon="X"
                                        label="Close (Esc)"
                                        iconSize={15}
                                        onClick={closeFind}
                                    />
                                </SearchBar>
                            </div>
                        </Match>
                        <Match when={kind() === 'pdf'}>
                            {/* PdfPages renders pdf.js's text layer (selectable/copyable per
                                page), but there is no find-bar UI over it yet — say so plainly
                                rather than pretending to search. */}
                            <div
                                class={`${styles['preview-find']} ${styles['preview-find-note']}`}
                                onKeyDown={e => e.stopPropagation()}
                            >
                                <Icon value="Search" size={14} />
                                <Text
                                    as="span"
                                    size="inherit"
                                    tone="inherit"
                                    weight="inherit"
                                    class={styles['preview-find-note-text']}
                                >
                                    In-app PDF search isn't available yet.
                                </Text>
                                <IconButton
                                    icon="X"
                                    label="Dismiss"
                                    iconSize={15}
                                    onClick={closeFind}
                                />
                            </div>
                        </Match>
                    </Switch>
                </Show>

                <Switch>
                    <Match when={kind() === 'image'}>
                        <Show
                            when={!imgFailed()}
                            fallback={
                                <div class={styles['preview-external']}>
                                    <EmptyState title="Couldn't load image">
                                        {`"${name()}" could not be displayed.`}
                                        {isTauri()
                                            ? ' Open it in its default app to view it.'
                                            : ' Open it externally to view it.'}
                                    </EmptyState>
                                    <Show when={isTauri()}>
                                        <IconTextButton
                                            icon="ExternalLink"
                                            onClick={() =>
                                                void openExternal(false)
                                            }
                                        >
                                            open in default app
                                        </IconTextButton>
                                    </Show>
                                </div>
                            }
                        >
                            {/* SCRATCH on: image + strip are laid out together in host px by
                                measureImage/imageScratchLayout.ts, positioned absolutely inside a
                                host that mirrors PageInk's own (`inset: 0` over `.preview-body`) —
                                the SAME rendered rect `imagePages()` carries, so the ink layer and
                                this layout agree on where the picture sits. With SCRATCH off the
                                `<img>` below is byte-for-byte the old markup: plain CSS auto-
                                centring/`object-fit: contain`, no wrapper, no inline sizing — the
                                path `ImageInkLandsAtRealMeasuredRect` measures. */}
                            <Show
                                when={marginRatio() > 0}
                                fallback={
                                    <img
                                        ref={attachImage}
                                        class={styles['preview-image']}
                                        src={imgSrc()}
                                        alt={name()}
                                        onLoad={e =>
                                            measureImage(e.currentTarget)
                                        }
                                        onError={() => {
                                            setImgFailed(true)
                                            setImagePages([])
                                        }}
                                    />
                                }
                            >
                                <div class={styles['preview-image-host']}>
                                    <img
                                        ref={attachImage}
                                        class={`${styles['preview-image']} ${styles['preview-image--scratch']}`}
                                        src={imgSrc()}
                                        alt={name()}
                                        onLoad={e =>
                                            measureImage(e.currentTarget)
                                        }
                                        onError={() => {
                                            setImgFailed(true)
                                            setImagePages([])
                                        }}
                                        style={
                                            imagePages()[0]
                                                ? {
                                                      left: `${imagePages()[0]!.rendered.left}px`,
                                                      top: `${imagePages()[0]!.rendered.top}px`,
                                                      width: `${imagePages()[0]!.rendered.w}px`,
                                                      height: `${imagePages()[0]!.rendered.h}px`,
                                                  }
                                                // Before the first measurement this `<img>` has no
                                                // inline size (position: absolute, from
                                                // `.preview-image--scratch`) and would otherwise
                                                // paint at its natural size, pinned to the host's
                                                // (0,0) corner, for one frame — hidden until
                                                // `imagePages()[0]` exists instead (final review,
                                                // finding 8).
                                                : { visibility: 'hidden' }
                                        }
                                    />
                                    <Show
                                        when={
                                            (imagePages()[0]?.marginW ?? 0) >
                                            0
                                        }
                                    >
                                        <ScratchPaper
                                            index={0}
                                            class={styles['preview-image-margin']}
                                            style={{
                                                position: 'absolute',
                                                left: `${
                                                    imagePages()[0]!.rendered
                                                        .left +
                                                    imagePages()[0]!.rendered
                                                        .w
                                                }px`,
                                                top: `${imagePages()[0]!.rendered.top}px`,
                                                width: `${imagePages()[0]!.marginW}px`,
                                                height: `${imagePages()[0]!.rendered.h}px`,
                                            }}
                                        />
                                    </Show>
                                </div>
                            </Show>
                            {/* ScratchTextLayer BEFORE PageInk, matching the PDF overlay order
                                below (HighlightLayer, ScratchTextLayer, PageInk) — PageInk stays
                                topmost in DOM order so draw-mode ink paints over everything,
                                including the strip's note blocks (final review, finding 4: this
                                used to mount in the opposite order, so ink on an image painted
                                UNDER the text layer). */}
                            <Show when={imagePages().length > 0}>
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
                            </Show>
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
                            zoom={pdfZoom()}
                            marginRatio={marginRatio()}
                            // The doc cache is keyed on the REAL path only, never `pdfViewKey` — a
                            // story proving view-memory restore (`pdfViewKey` set) must still get
                            // no cache, exactly like every other `pdfLoad` story, so it only ever
                            // proves the memory seam it asked for.
                            cacheKey={props.pdfLoad ? undefined : path()}
                            initialPosition={
                                pdfMemoryKey()
                                    ? loadPdfView(pdfMemoryKey()!)?.position
                                    : undefined
                            }
                            onPosition={pos => {
                                const key = pdfMemoryKey()
                                if (key) savePdfView(key, { position: pos })
                            }}
                            onLayout={onPdfLayout}
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
                                        onHighlighted={() => setHighlightArmed(false)}
                                        controller={c => (highlighter = c)}
                                        contentEl={pdfScrollEl}
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
                                    />
                                </>
                            }
                        />
                        <Show when={panelOpen()}>
                            <BookmarksPanel
                                class={styles['preview-bookmarks']}
                                store={store()!}
                                outline={outline}
                                currentPage={currentPage}
                                onJump={i => pdfController?.scrollToPage(i)}
                            />
                        </Show>
                    </Match>
                    <Match when={kind() === 'code'}>
                        <Show when={!code.loading} fallback={<Loading />}>
                            <pre
                                class={styles['preview-code']}
                                tabindex={0}
                                ref={codeRef}
                            >
                                <Show when={segments()} fallback={code() ?? ''}>
                                    <For each={segments()!}>
                                        {seg =>
                                            seg.matchIndex >= 0 ? (
                                                <mark
                                                    class={styles['preview-find-match']}
                                                    classList={{
                                                        [styles['is-active']]:
                                                            seg.matchIndex ===
                                                            activeIndex(),
                                                    }}
                                                    data-find-match
                                                    data-active={
                                                        seg.matchIndex ===
                                                        activeIndex()
                                                            ? true
                                                            : undefined
                                                    }
                                                >
                                                    {seg.text}
                                                </mark>
                                            ) : (
                                                seg.text
                                            )
                                        }
                                    </For>
                                </Show>
                            </pre>
                        </Show>
                    </Match>
                    <Match when={kind() === 'external'}>
                        <div class={styles['preview-external']}>
                            <EmptyState title="Preview not available">
                                {`This ${extLabel(name())} file can't be previewed here.`}
                                {isTauri()
                                    ? ' Open it in its default app to view or edit it.'
                                    : ' Open it externally to view or edit it.'}
                            </EmptyState>
                            <Show when={isTauri()}>
                                <IconTextButton
                                    icon="ExternalLink"
                                    onClick={() => void openExternal(false)}
                                >
                                    open in default app
                                </IconTextButton>
                            </Show>
                        </div>
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
