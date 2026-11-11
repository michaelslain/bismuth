import {
    batch,
    createComputed,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    mapArray,
    onMount,
    Show,
    untrack,
    type Component,
} from 'solid-js'
import { api } from '../api'
import { dismissToast, pushToast } from '../ui/toastStore'
import { matchesKeybinding } from '../keybindings'
import { claimNativeDrop } from '../nativeDropRouting'
import { pointInDropRect, type NativeDragDetail } from '../nativeDrop'
import { FONT_STACKS, settings, setSettings } from '../settings'
import { acquireAnnotationStore, flushAnnotationStore, retireAnnotationStore, storeEpoch, whenReady } from '../preview/sharedAnnotationStore'
import HighlightColorMenu from '../preview/HighlightColorMenu'
import { highlightColor, highlightTint, setHighlightColor } from '../preview/highlightColor'
import BarSettings from '../ui/BarSettings'
import IconButton from '../ui/IconButton'
import Readout from '../ui/Readout'
import SegmentedToggle from '../ui/SegmentedToggle'
import FilePicker from '../ui/FilePicker'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import ZoomSteps from '../ui/ZoomSteps'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import { addPaneMenuItems } from '../paneMenuExtras'
import { pdfReplaced } from '../preview/pdfDocCache'
import type { ViewBarSlots } from '../ui/ViewBar'
import {
    bookPageRefs,
    expandLeaves,
    kindOf,
    spreadFor,
    stepSpread,
    type BookLayout,
    type Spread,
} from '../../../core/src/bases/bookPages'
import { bookBookmarks, leafBookmarkTarget } from '../../../core/src/bases/bookBookmarks'
import type { Row, ViewConfig } from '../../../core/src/bases/types'
import { linesInRegion } from '../../../core/src/bookMarks'
import type { Bookmark, DrawingDoc } from '../../../core/src/drawing/model'
import { addBookmark, removeBookmark, renameBookmark } from '../../../core/src/drawing/pageBookmarks'
import type { PageText, TranscribeEngine, TranscriptEngine } from '../../../core/src/transcript'
import { looksLikeMath } from '../../../core/src/mathDetect'
import { createFaceLoader, defaultFaceDeps, faceDeps, forgetPdf, holdPdfBytes, releasePdfBytes, type Face } from './bookFaces'
import { darkenPixels } from './darkPage'
import { drawPhotos, photosIn } from '../preview/pdfDarkImages'
import BookPageEditor, { type EditTile } from './BookPageEditor'
import { isFileDrag } from './cardImageDrop'
import { intakeFiles, readNativeBytes } from './bookIntake'
import { planDeletes, planMoves } from './bookRowPlan'
import { pushUndoToast } from '../undoToast'
import { basename } from '../fileIntake'
import MathPrompt from './MathPrompt'
import BookBookmarksPanel from './BookBookmarksPanel'
import BookHighlightLayer from './BookHighlightLayer'
import { createEditHistory, createPageStores, pageSlots, readSidecars } from './bookPageStores'
import { clampAspect, fitBook, folioFor, PAGE_ASPECT, PAGE_MIN_W, pageCountsKnown, pageReadout, readoutFor, retargetLeaf, stepFromKey, transcriptChanged } from './bookNav'
import BookSpread from './BookSpread'
import BookScroll from './BookScroll'
import TextPageTurn from './TextPageTurn'
import { drawSpreadFace, drawTextFace } from './textFace'
import { lastChange } from '../serverVersion'
import ReadModeSwitch, { type ReadFlow, type ReadView } from './ReadModeSwitch'
import FlipNav from './FlipNav'
import FlowToggle from './FlowToggle'
import { TEXT_FONT_FAMILY, TEXT_SCALES } from './bookText'
import TranscriptDoc from './TranscriptDoc'
import CheckCrop from './CheckCrop'
import type { TranscriptPageHandle } from './TranscriptPage'
import TranscriptSection from './TranscriptSection'
import SideBySide, { type SideBySideRow } from './SideBySide'
import BookPageImage from './BookPageImage'
import PageReadout from '../preview/PageReadout'
import PageStatus from './PageStatus'
import TranscribeAll from './TranscribeAll'
import TranscribeProgress from './TranscribeProgress'
import type { LocateBox } from './LocateLayer'
import { boxesForQuote, lineAtPoint } from './transcriptLocate'
import { onceByKey } from './onceByKey'
import { createTranscription, type TranscriptionController } from './transcription'
import type { TextLine } from '../../../core/src/visionOcr'
import PageTurnLayer, { TURN_MS, type SpreadFaces } from './PageTurnLayer'
import styles from './BookView.module.css'

export type BookViewProps = {
    rows: Row[]
    view: ViewConfig
    basePath?: string
    ownsRows: boolean
    onChange: () => void
    onBarSlots: (slots: ViewBarSlots | undefined) => void
    /** The bar's add-pages button and the empty state's `[ + pages ]`. Unset until intake is wired. */
    onAddPages?: () => void
    /** The transcription controller; a story hands in one over a fake job client. Unset: the view makes its own. */
    transcription?: TranscriptionController
    /** Read these page files instead of the rows' page column: an image or PDF opened on its own. */
    files?: string[]
    /** Set when something else owns the reading mode (the PDF and image preview): a pick on the
     *  `pages | text | side by side` and `scroll | flip` pickers, or a layout pick, goes here and
     *  nothing is written to a base. */
    onReadView?: (view: ReadView) => void
    onReadFlow?: (flow: ReadFlow) => void
    onLayout?: (layout: BookLayout) => void
    /** Dark pages, owned by the caller (the preview keeps it per file in the sidecar). Unset: a
     *  base's `bookDark` key, else `appearance.pdfDarkMode`. */
    dark?: () => boolean
    onDark?: (on: boolean) => void
    /** Where to open: a notebook page, and how far down it the reader was (0..1). */
    start?: { leaf: number; frac?: number }
    /** Where the reader is, as a notebook page and how far into it, whenever that changes. */
    onPosition?: (at: { leaf: number; frac: number }) => void
}

/** The faces of a spread. */
type Faces = { left?: Face; right?: Face }
type Shown = { key: string; faces: Faces }
type Turn = {
    id: number
    /** Shorter while more turns wait behind this one, so a burst of presses keeps up. */
    durationMs?: number
    direction: 'forward' | 'back'
    from: SpreadFaces
    to: SpreadFaces
    target: number
    toShown: Shown
}

/** How many pages from the front set a book's page shape. Within the face cache, so sampling
 *  them costs no extra loads later. */
const PAGE_SHAPE_SAMPLE = 5

const medianOf = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Run `fn` when the browser is idle, or after a frame where it has no idle callback. */
const whenIdle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 300 })
    else setTimeout(fn, 16)
}

/** The leaf each book was last on, for the session. */
const leafMemory = new Map<string, number>()

const PAD = 32
/** Turns that may wait behind the one running; presses past it are dropped. */
const MAX_WAITING = 4
/** A turn's length with `waiting` more behind it: the full turn alone, down to under half in a burst. */
const turnMsFor = (waiting: number) => Math.round(TURN_MS / (1 + 0.5 * Math.min(waiting + 1, 3)))
/** Pages built ahead of a side by side flip, each way: two, so a quick second turn finds its picture drawn. */
const FLIP_AHEAD = 2
/** Pointer travel before a press on a page becomes a drag instead of a click. */
const DRAG_SLOP = 6

const asLayer = (f: Faces): SpreadFaces => ({
    left: f.left?.kind === 'ready' ? f.left.source : null,
    right: f.right?.kind === 'ready' ? f.right.source : null,
})

const missingName = (f: Face | undefined): string | undefined =>
    f?.kind === 'missing' ? f.name : undefined

/** True when a key press is aimed at something the user is typing into. */
function typingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    return !!el.closest('input, textarea, select, [contenteditable="true"]')
}
/** An open book: two pages meeting at a spine (one page when the pane is narrow), turned by
 *  dragging a page toward the spine, clicking its outer third, or the page-turn keys. The bar
 *  contribution (readout, the tool icons and the display panel) goes up through `onBarSlots`. */
const BookView: Component<BookViewProps> = props => {
    const loader = createFaceLoader(defaultFaceDeps)
    let host!: HTMLDivElement

    // ── transcription: the server runs a job per file; this view shows its progress and the text ──
    const ownTranscription = !props.transcription
    const transcription =
        props.transcription ??
        createTranscription({
            client: api,
            book: props.basePath,
            math: () => settings.transcription.math as 'ask' | 'careful' | 'fast',
            setMath: m => setSettings('transcription', 'math', m),
            toast: pushToast,
        })
    onCleanup(() => ownTranscription && transcription.dispose())


    // ── pages ──
    const refs = createMemo(() =>
        props.files
            ? props.files.flatMap((file, rowIndex) => {
                  const kind = kindOf(file)
                  return kind ? [{ file, kind, rowIndex }] : []
              })
            : bookPageRefs(props.rows, props.view),
    )
    const [counts, setCounts] = createSignal<ReadonlyMap<string, number>>(new Map())
    const asked = new Set<string>()
    // bumped when a file's pages were rewritten, so its page count is asked again
    const [recount, setRecount] = createSignal(0)
    createEffect(() => {
        recount()
        for (const r of refs()) {
            if (r.kind !== 'pdf' || asked.has(r.file)) continue
            asked.add(r.file)
            const done = (n: number) => setCounts(m => new Map(m).set(r.file, n))
            loader.pdfPageCount(r.file).then(done, () => done(0))
        }
    })
    const leaves = createMemo(() => expandLeaves(refs(), counts()))
    /** Until a PDF's page count arrives it holds one stand-in page, so the place cannot be told yet
     *  and nothing may read `cur()` as where the reader is. */
    const counted = createMemo(() => pageCountsKnown(refs(), counts()))
    const count = () => leaves().length


    // ── transcripts: loaded for every page file, since text mode sets them all ──
    type Transcript = { engine?: TranscriptEngine; at?: string; pages: PageText[] }
    const [transcripts, setTranscripts] = createSignal<ReadonlyMap<string, Transcript>>(new Map())

    // ── mode: what shows (the pages, their transcription, or each page beside its text) and how it
    // moves (one long column, or a page at a time) ──
    const asView = (v: unknown): ReadView => (v === 'text' || v === 'side' ? v : 'pages')
    // unset, the pages flip and text and side by side scroll; `bookMode: scroll` is the pages scrolled
    const asFlow = (mode: unknown, flow: unknown): ReadFlow =>
        flow === 'scroll' || flow === 'flip' ? flow : mode === 'scroll' || mode === 'text' || mode === 'side' ? 'scroll' : 'flip'
    const [viewReq, setViewReq] = createSignal<ReadView>(asView(props.view.bookMode))
    const [flow, setFlow] = createSignal<ReadFlow>(asFlow(props.view.bookMode, props.view.bookFlow))
    createEffect(
        on(
            () => [props.view.bookMode, props.view.bookFlow] as const,
            ([m, f]) => {
                setViewReq(asView(m))
                setFlow(asFlow(m, f))
            },
            { defer: true },
        ),
    )
    const textAvailable = () => {
        for (const t of transcripts().values()) if (t.pages.some(p => p.text.trim())) return true
        return false
    }
    // A file opened on its own may read as text before it has any: its pages show as not yet
    // transcribed while the transcription runs.
    const textAllowed = () => !!props.files || textAvailable() || transcription.progress() !== undefined
    /** What the stage and the page maths follow: scrolled pages keep the pages stage, hidden, under them. */
    const mode = (): ReadView => (viewReq() !== 'pages' && !textAllowed() ? 'pages' : viewReq())
    /** The pages scrolled, turned, or the text: where a switch keeps the place, it tells these apart. */
    const readMode = (): 'scroll' | ReadView => (mode() === 'pages' && flow() === 'scroll' ? 'scroll' : mode())
    const scrolling = () => readMode() === 'scroll'
    const texty = () => mode() !== 'pages'
    /** Text or side by side a page at a time. */
    const flipping = () => texty() && flow() === 'flip'


    // ── dark pages: the PDF viewer's dark mode, on scans and text pages alike ──
    const [darkPick, setDarkPick] = createSignal<boolean | undefined>()
    createEffect(on(() => props.view.bookDark, () => setDarkPick(undefined), { defer: true }))
    const dark = (): boolean =>
        props.dark ? props.dark() : (darkPick() ?? props.view.bookDark ?? settings.appearance.pdfDarkMode)
    const toggleDark = () => {
        const next = !dark()
        if (props.onDark) return props.onDark(next)
        setDarkPick(next)
        const path = props.basePath
        if (path) void api.setProperty(path, 'bookDark', next).then(() => props.onChange())
    }
    // One dark copy per page picture, made once: the still spread, the curl and scroll share it.
    const darkCopies = new WeakMap<object, HTMLCanvasElement>()
    // a face already turned dark is never turned again (that would turn it back toward light)
    const darkMade = new WeakSet<object>()
    const shade = (f: Face | undefined): Face | undefined => {
        if (!f || f.kind !== 'ready' || !dark() || darkMade.has(f.source as object)) return f
        let c = darkCopies.get(f.source as object)
        if (!c) {
            const src = f.source as { width: number; height: number }
            c = document.createElement('canvas')
            c.width = Math.max(1, Number(src.width))
            c.height = Math.max(1, Number(src.height))
            const g = c.getContext('2d', { willReadFrequently: true })!
            g.drawImage(f.source, 0, 0)
            const px = g.getImageData(0, 0, c.width, c.height)
            darkenPixels(px.data)
            g.putImageData(px, 0, 0)
            drawPhotos(g, f.source, photosIn(f.source as object), c.width, c.height)
            darkCopies.set(f.source as object, c)
            darkMade.add(c)
        }
        return { kind: 'ready', source: c }
    }
    const chooseView = (next: ReadView) => {
        if (props.onReadView) return props.onReadView(next)
        setViewReq(next)
        const path = props.basePath
        if (!path) return
        // the flow stays as it was: an unset one follows the view, so it is written down first
        const keep = props.view.bookFlow === undefined ? flow() : undefined
        void api
            .setProperty(path, 'bookMode', next)
            .then(() => (keep ? api.setProperty(path, 'bookFlow', keep) : undefined))
            .then(() => props.onChange())
    }
    const chooseFlow = (next: ReadFlow) => {
        if (props.onReadFlow) return props.onReadFlow(next)
        setFlow(next)
        const path = props.basePath
        if (path) void api.setProperty(path, 'bookFlow', next).then(() => props.onChange())
    }


    // ── layout ──
    const [requested, setRequested] = createSignal<BookLayout>(props.view.bookLayout ?? 'spread')
    createEffect(
        on(
            () => props.view.bookLayout,
            v => setRequested(v ?? 'spread'),
            { defer: true },
        ),
    )
    /** The book's key in the page memory: its base, or the file opened on its own. */
    const memoryKey = () => props.basePath ?? (props.files ? `file:${props.files.join('|')}` : undefined)
    const [leaf, setLeaf] = createSignal(props.start ? props.start.leaf : (leafMemory.get(memoryKey() ?? '') ?? 0))
    const [pane, setPane] = createSignal({ w: 0, h: 0 })
    // Every page's shape, as its face loads (width over height, keyed by file and PDF page).
    const [shapes, setShapes] = createSignal<ReadonlyMap<string, number>>(new Map())
    const shapeKey = (l: { ref: { file: string }; pdfPage?: number }) => `${l.ref.file}#${l.pdfPage ?? 0}`
    const noteShape = (l: { ref: { file: string }; pdfPage?: number } | undefined, f: Face | undefined) => {
        if (!l || f?.kind !== 'ready') return
        const src = f.source as { width?: number; height?: number }
        const w = Number(src.width)
        const h = Number(src.height)
        if (!(w > 0 && h > 0) || shapes().get(shapeKey(l)) === w / h) return
        setShapes(m => new Map(m).set(shapeKey(l), w / h))
    }
    /** The book's typical page shape: the median of every page shape known so far. */
    const pageAspect = createMemo(() => {
        const all = [...shapes().values()]
        return all.length ? clampAspect(medianOf(all)) : PAGE_ASPECT
    })
    /** In pages mode the pages on screen set the size: the wider of the two, so each fills its half
     *  and neither is cut. A page not loaded yet counts as the book's typical shape. */
    const spreadAspect = () => {
        const ls = leaves()
        if (ls.length === 0) return pageAspect()
        const lay: BookLayout = requested() === 'spread' && pane().w - PAD >= PAGE_MIN_W * 2 ? 'spread' : 'single'
        const s = spreadFor(Math.max(0, Math.min(leaf(), ls.length - 1)), ls.length, lay)
        const on = [s.left, s.right].flatMap(i => (i === undefined ? [] : [shapes().get(shapeKey(ls[i])) ?? pageAspect()]))
        return clampAspect(Math.max(...on))
    }
    const fit = createMemo(() =>
        fitBook(
            { w: Math.max(0, pane().w - PAD), h: Math.max(0, pane().h - PAD) },
            requested(),
            spreadAspect(),
        ),
    )
    const layout = () => fit().layout
    const measured = () => pane().w > 0 && pane().h > 0
    let observer: ResizeObserver | undefined
    const observe = (el: HTMLDivElement) => {
        observer ??= new ResizeObserver(entries => {
            const r = entries[0].contentRect
            setPane({ w: r.width, h: r.height })
        })
        observer.observe(el)
    }
    onCleanup(() => observer?.disconnect())

    // ── the text: every page file's transcript, by page ──
    const pageTextOf = (l: { ref: { file: string }; pdfPage?: number }) =>
        transcripts().get(l.ref.file)?.pages.find(p => p.page === (l.pdfPage ?? 1))?.text ?? ''
    /** The lines of a page flagged for review (an empty `line` flags the page as read empty). */
    const pageChecksOf = (l: { ref: { file: string }; pdfPage?: number }) =>
        transcripts().get(l.ref.file)?.pages.find(p => p.page === (l.pdfPage ?? 1))?.checks
    /** Text mode's type size: `reader.textScale`, kept on the steps `A-` and `A+` move between. */
    const textScale = () => {
        const v = settings.reader?.textScale
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(1.75, Math.max(0.8, v)) : 1
    }
    const stepText = (dir: 1 | -1) => {
        const now = textScale()
        const at = TEXT_SCALES.reduce((best, s, i) => (Math.abs(s - now) < Math.abs(TEXT_SCALES[best] - now) ? i : best), 0)
        const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, at + dir))]
        if (next !== now) setSettings('reader', 'textScale', next)
    }
    /** Text mode's face: the prose font the notes are set in (`appearance.proseFont`). */
    const family = () => FONT_STACKS[settings.appearance.proseFont] ?? FONT_STACKS['Libron'] ?? TEXT_FONT_FAMILY

    const chooseLayout = (next: BookLayout) => {
        setRequested(next)
        if (props.onLayout) return props.onLayout(next)
        const path = props.basePath
        if (!path) return
        // Absent is the default (two pages when they fit), so choosing it removes the key.
        const write = next === 'single' ? api.setProperty(path, 'bookLayout', 'single') : api.deleteProperty(path, 'bookLayout')
        void write.then(() => props.onChange())
    }

    // ── where we are ──
    const cur = () => Math.max(0, Math.min(leaf(), count() - 1))
    createEffect(() => {
        const key = memoryKey()
        if (key && counted()) leafMemory.set(key, cur())
    })

    let prevLayout = layout()
    createComputed(() => {
        const l = layout()
        if (!measured() || !counted() || l === prevLayout) return
        setLeaf(retargetLeaf(untrack(cur), untrack(count), prevLayout, l))
        prevLayout = l
    })
    const spread = createMemo(() => spreadFor(cur(), count(), layout()))

    // ── the place: shared by every mode, so a switch keeps the page ──
    const keyOfLeaf = (l: { ref: { file: string }; pdfPage?: number }) => `${l.ref.file}#${l.pdfPage ?? 0}`
    const leafIndexOf = (key: string) => untrack(leaves).findIndex(l => keyOfLeaf(l) === key)
    const [docAt, setDocAt] = createSignal<{ key: string; frac?: number }>()
    const [docFrac, setDocFrac] = createSignal(props.start?.frac ?? 0)
    let docKey: string | undefined
    /** A notebook page the next switch into text or side by side lands on (show on page). */
    let jumpTo: number | undefined
    const placeDoc = (index: number, frac = 0) => {
        const l = untrack(leaves)[index]
        if (!l) return
        docKey = keyOfLeaf(l)
        setDocFrac(frac)
        setDocAt({ key: docKey, frac })
    }
    const onDocAt = (a: { key: string; frac: number }) => {
        docKey = a.key
        setDocFrac(a.frac)
        const i = leafIndexOf(a.key)
        if (i >= 0) setLeaf(i)
    }
    /** Text and side by side: on to the page before or after the one in view. */
    const stepDoc = (dir: 1 | -1, animate = true) => {
        const next = Math.max(0, Math.min(count() - 1, cur() + dir))
        if (next === cur()) return
        batch(() => {
            if (flipping()) {
                docTurnId++
                if (animate) startTextTurn(docTurnId, dir === 1 ? 'forward' : 'back')
                else setTextTurn(null)
            }
            setLeaf(next)
            placeDoc(next)
        })
    }
    // ── a page turn in text and side by side: text alone curls as one page, side by side as an open book ──
    const [textTurn, setTextTurn] = createSignal<{
        id: number
        box: { left: number; top: number; w: number; h: number }
        from: HTMLCanvasElement
        to?: HTMLCanvasElement
        direction: 'forward' | 'back'
    } | null>(null)
    let docTurnId = 0
    let mainEl: HTMLDivElement | undefined
    /** What turns: the whole text pane, or side by side's row (its picture and text, an open book). */
    const textTurnEl = () => host.querySelector<HTMLElement>(mode() === 'side' ? '[data-side-by-side] [data-row-key]' : '[data-transcript-doc]')
    const pictureReady = (el: HTMLElement) => !el.querySelector('[data-page-image]:not([data-face-ready])')
    const turnFace = (el: HTMLElement) => {
        const text = el.querySelector<HTMLElement>('[data-side-text]')
        return text ? drawSpreadFace(el, text) : drawTextFace(el)
    }
    /** Up over the page now going, then the page arriving is drawn once it has laid out (an editor fills in a frame late). */
    const startTextTurn = (id: number, direction: 'forward' | 'back') => {
        setTextTurn(null)
        const el = textTurnEl()
        if (!el || !mainEl || !pictureReady(el)) return
        const [r, m] = [el.getBoundingClientRect(), mainEl.getBoundingClientRect()]
        if (r.width === 0 || r.height === 0) return
        setTextTurn({ id, box: { left: r.left - m.left, top: r.top - m.top, w: r.width, h: r.height }, from: turnFace(el), direction })
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                if (textTurn()?.id !== id) return
                const arriving = textTurnEl()
                // a page whose picture is still loading just appears, rather than curling in blank
                if (!arriving || !pictureReady(arriving)) return void setTextTurn(null)
                const to = turnFace(arriving)
                setTextTurn(t => (t?.id === id ? { ...t, to } : t))
            }),
        )
    }
    /** The page in view, which flipping shows on its own. */
    const curKey = createMemo(() => {
        const l = leaves()[cur()]
        return l ? keyOfLeaf(l) : undefined
    })
    // scroll ↔ flip keeps the page
    createEffect(on(flow, () => texty() && placeDoc(untrack(cur)), { defer: true }))
    createComputed(
        on(readMode, (m, prev) => {
            if (m === prev) return
            // opening before the pages are counted: the effect below places it once they are
            if (prev === undefined && !untrack(counted)) return
            const was = prev === 'text' || prev === 'side'
            if (m === 'text' || m === 'side') {
                if (jumpTo !== undefined) {
                    placeDoc(jumpTo)
                    jumpTo = undefined
                } else if (was && docKey !== undefined) setDocAt({ key: docKey, frac: untrack(docFrac) })
                else {
                    const s = untrack(spread)
                    placeDoc(prev === 'pages' ? (s.left ?? s.right ?? untrack(cur)) : untrack(cur), prev === undefined ? untrack(docFrac) : 0)
                }
            } else if (was && docKey !== undefined) {
                const i = leafIndexOf(docKey)
                if (i >= 0) setLeaf(i)
            }
        }),
    )
    // pages that arrive after the switch (a PDF's page count) can leave the place unset or unknown
    createEffect(() => {
        if (!texty() || !counted() || leaves().length === 0) return
        const at = untrack(docAt)
        if (!at || leafIndexOf(at.key) < 0) placeDoc(untrack(cur), at ? 0 : untrack(docFrac))
    })

    // ── faces ──
    const [shown, setShown] = createSignal<Shown | undefined>()
    const keyOf = (s: Spread) =>
        (dark() ? 'dark|' : '') +
        [s.left, s.right]
            .map(i => (i === undefined ? '-' : `${leaves()[i]?.ref.file}#${leaves()[i]?.pdfPage ?? 0}`))
            .join('|')
    const loadSpread = async (s: Spread): Promise<Faces> => {
        const l = leaves()
        const [left, right] = await Promise.all([
            s.left === undefined ? undefined : loader.face(l[s.left]),
            s.right === undefined ? undefined : loader.face(l[s.right]),
        ])
        noteShape(s.left === undefined ? undefined : l[s.left], left)
        noteShape(s.right === undefined ? undefined : l[s.right], right)
        return { left: shade(left), right: shade(right) }
    }
    const peekSpread = (s: Spread): Faces | null => {
        const l = leaves()
        const left = s.left === undefined ? undefined : loader.peek(l[s.left])
        const right = s.right === undefined ? undefined : loader.peek(l[s.right])
        if ((s.left !== undefined && !left) || (s.right !== undefined && !right)) return null
        return { left: shade(left), right: shade(right) }
    }

    // The first few pages' shapes are read at once, so the typical shape is known before turning.
    createEffect(() => {
        const sample = leaves().slice(0, PAGE_SHAPE_SAMPLE)
        for (const l of sample) void loader.face(l).then(f => noteShape(l, f))
    })
    let loadToken = 0
    const [prefetched, setPrefetched] = createSignal(false)
    createEffect(() => {
        setPrefetched(false)
        if (mode() !== 'pages') return

        const s = spread()
        const lay = layout()
        const n = count()
        const key = keyOf(s)
        if (n === 0) return setShown(undefined)
        if (!counted()) return
        const token = ++loadToken
        // The spreads either side load once the browser is idle, so the turn that just ended and
        // the pages on screen never wait behind them (a text page is drawn on the main thread).
        const prefetch = () =>
            whenIdle(() => {
                if (token !== loadToken) return
                const ps: Promise<unknown>[] = []
                for (const dir of [1, -1] as const) {
                    const t = stepSpread(cur(), n, lay, dir)
                    if (t !== cur()) ps.push(loadSpread(spreadFor(t, n, lay)))
                }
                void Promise.all(ps).then(() => token === loadToken && setPrefetched(true))
            })
        if (untrack(shown)?.key === key) return prefetch()
        void loadSpread(s).then(faces => {
            if (token !== loadToken) return
            setShown({ key, faces })
            prefetch()
        })
    })

    // ── turning ──
    const [turn, setTurn] = createSignal<Turn | null>(null)
    const [drag, setDrag] = createSignal<{ x: number; y: number } | null>(null)
    const [turnState, setTurnState] = createSignal<'idle' | 'turning' | 'settled'>('idle')
    let turnId = 0
    let starting = false

    const commit = (t: Turn) =>
        batch(() => {
            setLeaf(t.target)
            setShown(t.toShown)
            setTurn(null)
            setTurnState('settled')
        })
    const finishNow = () => {
        const t = turn()
        if (t && !drag()) commit(t)
    }

    const begin = async (dir: 1 | -1, at?: { x: number; y: number }): Promise<boolean> => {
        if (drag() || count() === 0) return false
        // a turn cut short takes the turns waiting behind it with it
        if (turn()) waiting.length = 0
        finishNow()
        const from = untrack(shown)
        const target = stepSpread(cur(), count(), layout(), dir)
        if (!from || target === cur()) return false
        const ts = spreadFor(target, count(), layout())
        let toFaces = peekSpread(ts)
        if (!toFaces) {
            starting = true
            const startedAt = cur()
            const startedIn = mode()
            try {
                toFaces = await loadSpread(ts)
            } finally {
                starting = false
            }
            // the pages loaded after a switch to the other mode: their spread no longer exists
            if (turn() || cur() !== startedAt || mode() !== startedIn) return false
        }
        batch(() => {
            setTurn({
                id: ++turnId,
                direction: dir === 1 ? 'forward' : 'back',
                from: asLayer(from.faces),
                to: asLayer(toFaces),
                target,
                toShown: { key: keyOf(ts), faces: toFaces },
            })
            setDrag(at ?? null)
            setTurnState('turning')
        })
        return true
    }

    // Key and click turns run one after another, so a burst of presses lands one spread each. A press
    // while a turn runs the same way waits behind it rather than cutting it short; the waiting turns
    // then run back to back on the same turn layer, quicker the more are waiting.
    let chain: Promise<unknown> = Promise.resolve()
    const waiting: (1 | -1)[] = []
    const dirOf = (t: Turn): 1 | -1 => (t.direction === 'forward' ? 1 : -1)
    /** Where the turn running now and every waiting one will have landed. */
    const landing = () => {
        const t = turn()
        let at = t ? t.target : cur()
        for (const d of waiting) at = stepSpread(at, count(), layout(), d)
        return at
    }
    const turnBy = (dir: 1 | -1) => {
        const t = turn()
        if (t && !drag() && dirOf(t) === dir) {
            if (waiting.length >= MAX_WAITING) return
            waiting.push(dir)
            // the spread it will land on loads now, so its turn starts the moment the one before ends
            void loadSpread(spreadFor(landing(), count(), layout()))
            return
        }
        waiting.length = 0
        chain = chain.then(() => begin(dir)).catch(() => false)
    }
    /** The next waiting turn, started on the layer the last one used, or false when its pages are not in yet. */
    const chainNext = (t: Turn, dir: 1 | -1): boolean => {
        const target = stepSpread(t.target, count(), layout(), dir)
        if (target === t.target) return false
        const ts = spreadFor(target, count(), layout())
        const toFaces = peekSpread(ts)
        if (!toFaces) return false
        batch(() => {
            setLeaf(t.target)
            setShown(t.toShown)
            setTurn({
                id: ++turnId,
                direction: dir === 1 ? 'forward' : 'back',
                from: asLayer(t.toShown.faces),
                to: asLayer(toFaces),
                target,
                toShown: { key: keyOf(ts), faces: toFaces },
                durationMs: turnMsFor(waiting.length),
            })
            setTurnState('turning')
        })
        return true
    }

    const onSettled = (t: Turn) => (committed: boolean) => {
        if (turn()?.id !== t.id) return
        if (!committed) {
            waiting.length = 0
            return batch(() => {
                setTurn(null)
                setTurnState('settled')
            })
        }
        const next = waiting.shift()
        if (next === undefined) return commit(t)
        if (chainNext(t, next)) return
        // its pages are not in yet: the layer holds the landed spread, flat, until they are, then
        // the burst goes on from there on the same layer
        const ts = spreadFor(stepSpread(t.target, count(), layout(), next), count(), layout())
        void loadSpread(ts).then(
            () => {
                if (turn()?.id !== t.id) return
                if (!chainNext(t, next)) {
                    waiting.length = 0
                    commit(t)
                }
            },
            () => {
                if (turn()?.id !== t.id) return
                waiting.length = 0
                commit(t)
            },
        )
    }

    // ── keys ──
    onMount(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || typingTarget(e.target) || host.offsetParent === null || scrolling()) return
            const dir = stepFromKey(
                e,
                {
                    next: settings.keybindings['book-next-page'],
                    prev: settings.keybindings['book-prev-page'],
                },
                matchesKeybinding,
            )
            if (!dir || drag()) return
            e.preventDefault()
            // text and side by side move a page through the column (or flip to it); the curl is the pages'
            // a held key runs through the pages: drawing and curling each one would only stutter
            if (texty()) return stepDoc(dir, !e.repeat)
            turnBy(dir)
        }
        window.addEventListener('keydown', onKey)
        onCleanup(() => window.removeEventListener('keydown', onKey))
    })

    // ── dragging ──
    let press: { x: number; y: number; dir: 1 | -1; id: number } | undefined
    const local = (e: PointerEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }
    }
    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0 || drag() || turn() || mode() !== 'pages') return
        const p = local(e)
        const f = p.x / p.w
        const dir: 1 | -1 | 0 =
            layout() === 'single' ? (f >= 0.5 ? 1 : -1) : f >= 0.75 ? 1 : f <= 0.25 ? -1 : 0
        if (dir === 0) return
        press = { x: p.x, y: p.y, dir, id: e.pointerId }
    }
    const onPointerMove = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        const p = local(e)
        if (drag()) return setDrag({ x: p.x, y: p.y })
        if (starting || turn() || Math.hypot(p.x - press.x, p.y - press.y) < DRAG_SLOP) return
        const el = e.currentTarget as HTMLElement
        const id = e.pointerId
        const dir = press.dir
        void begin(dir, { x: p.x, y: p.y }).then(ok => {
            if (!ok) {
                press = undefined
                return
            }
            // released while the next spread was loading: let the leaf settle on its own
            if (!press || press.id !== id) {
                setDrag(null)
                return
            }
            try {
                el.setPointerCapture(id)
            } catch {
                // a synthetic pointer has nothing to capture
            }
        })
    }
    const onPointerEnd = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        press = undefined
        if (drag()) setDrag(null)
    }


    // ── transcription: the text of each page, and what runs to fill it ──
    // A read that crosses a save could bring back the text from before it, so reads wait for the
    // file's saves and one overtaken by a save is made again.
    const savesInFlight = new Map<string, number>()
    const readAfterSaves = new Set<string>()
    let saveCount = 0
    const loadTranscript = (file: string): Promise<void> => {
        if (savesInFlight.get(file)) {
            readAfterSaves.add(file)
            return Promise.resolve()
        }
        const startedAt = saveCount
        return api.storedTranscript(file).then(
            t => {
                if (startedAt !== saveCount) return loadTranscript(file)
                setTranscripts(m => new Map(m).set(file, t))
            },
            () => undefined,
        )
    }
    onCleanup(transcription.onWrote(file => void loadTranscript(file)))
    const loaded = new Set<string>()
    // Its text changed from outside (an agent, another window): every page shows it, and a page with
    // typing not yet saved keeps that typing (TranscriptPage). Our own saves make no event.
    createEffect(
        on(
            lastChange,
            change => {
                for (const file of loaded) if (transcriptChanged(change.paths, file)) void loadTranscript(file)
            },
            { defer: true },
        ),
    )
    createEffect(() => {
        for (const r of refs()) {
            if (loaded.has(r.file)) continue
            loaded.add(r.file)
            void loadTranscript(r.file)
            transcription.adopt(r.file)
        }
    })
    // Automatic transcription tries each file once per session, silently; a page that stays empty shows the button.
    createEffect(() => {
        if (!settings.transcription.auto) return
        const t = transcripts()
        for (const l of leaves()) if (t.has(l.ref.file) && !pageTextOf(l).trim()) transcription.auto(l.ref.file)
    })
    // Pages the built-in reader transcribed before math was looked for keep its garbled formulas:
    // once per file a session those that look like math get the `transcription.math` treatment.
    createEffect(() => {
        for (const [file, tr] of transcripts()) {
            if (tr.engine !== 'on-device') continue
            const pages = tr.pages.filter(p => looksLikeMath(p.text)).map(p => p.page)
            if (pages.length > 0) transcription.storedMath(file, pages)
        }
    })
    /** Notebook pages that have no text, among files whose transcript has loaded. */
    const emptyLeaves = createMemo(() => {
        const t = transcripts()
        const out: number[] = []
        leaves().forEach((l, i) => {
            if (t.has(l.ref.file) && !pageTextOf(l).trim()) out.push(i)
        })
        return out
    })
    const transcribeAll = () => {
        const byFile = new Map<string, number[]>()
        for (const i of emptyLeaves()) {
            const l = leaves()[i]
            byFile.set(l.ref.file, [...(byFile.get(l.ref.file) ?? []), l.pdfPage ?? 1])
        }
        for (const [f, pages] of byFile) transcription.start(f, { pages })
    }
    const readAgain = (leafIndex: number, engine: TranscribeEngine) => {
        const l = leaves()[leafIndex]
        if (l) transcription.start(l.ref.file, { pages: [l.pdfPage ?? 1], engine })
    }

    // ── text mode and side by side: one editable section per page ──
    const handles = new Map<string, TranscriptPageHandle>()
    const pageRef = (key: string, h: TranscriptPageHandle | undefined) => {
        if (!h) return void handles.delete(key)
        handles.set(key, h)
    }
    const saveText = (key: string, text: string) => {
        const l = leaves()[leafIndexOf(key)]
        if (!l) return
        const page = l.pdfPage ?? 1
        setTranscripts(m => {
            const t = m.get(l.ref.file) ?? { pages: [] }
            const pages = t.pages.some(p => p.page === page)
                ? t.pages.map(p => (p.page === page ? { ...p, text } : p))
                : [...t.pages, { page, text }]
            return new Map(m).set(l.ref.file, { ...t, pages })
        })
        const file = l.ref.file
        saveCount++
        savesInFlight.set(file, (savesInFlight.get(file) ?? 0) + 1)
        api.setTranscriptPage(file, page, text)
            .catch(e => pushToast(`couldn't save the text: ${(e as Error).message}`))
            .finally(() => {
                const left = (savesInFlight.get(file) ?? 1) - 1
                if (left > 0) return void savesInFlight.set(file, left)
                savesInFlight.delete(file)
                if (readAfterSaves.delete(file)) void loadTranscript(file)
            })
    }
    /** `[ looks right ]` on a check: it goes from the page at once, then from the companion. */
    const approveCheck = (key: string, line: string) => {
        const l = leaves()[leafIndexOf(key)]
        if (!l) return
        const page = l.pdfPage ?? 1
        setTranscripts(m => {
            const t = m.get(l.ref.file)
            if (!t) return m
            const pages = t.pages.map(p => {
                if (p.page !== page || !p.checks) return p
                const at = p.checks.findIndex(c => c.line === line)
                return at < 0 ? p : { ...p, checks: p.checks.filter((_, i) => i !== at) }
            })
            return new Map(m).set(l.ref.file, { ...t, pages })
        })
        api.approveTranscriptCheck(l.ref.file, page, line).catch(e => pushToast(`couldn't approve the line: ${(e as Error).message}`))
    }
    /** The scan strip a flagged line was read from, found through the page's on-device line boxes. */
    const cropOf = (key: string, line: string) => {
        const l = leaves()[leafIndexOf(key)]
        if (!l || line === '') return undefined
        return (
            <CheckCrop
                face={() => loader.face(l).then(f => shade(f)!)}
                boxes={() => pageLines(l).then(lines => boxesForQuote(lines, line))}
            />
        )
    }
    const multiFile = createMemo(() => new Set(leaves().map(l => l.ref.file)).size > 1)
    const lonelyImage = createMemo(() => leaves().length === 1 && leaves()[0].ref.kind === 'image')
    /** Each page's section, made once per page: text and labels are read live, so an edit or a
     *  finished page never rebuilds a section (which would move the scroll and the caret). */
    const leafKeys = createMemo(() => leaves().map(keyOfLeaf), [], {
        equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]),
    })
    const docPages = (() => {
        const mapped = mapArray(leafKeys, (key, i) => {
            const l = () => leaves()[i()]
            const page = untrack(() => l().pdfPage ?? 1)
            const file = untrack(() => l().ref.file)
            const kind = untrack(() => l().ref.kind)
            const name = basename(file)
            const text = createMemo(() => pageTextOf(l()))
            const checks = createMemo(() => pageChecksOf(l()))
            const stateOf = () => transcription.pageState(file, page)
            return {
                key,
                get label() {
                    if (lonelyImage()) return undefined
                    if (kind === 'image') return multiFile() ? name : `page ${page}`
                    return multiFile() ? `${name} // page ${page}` : `page ${page}`
                },
                get text() {
                    return text()
                },
                get checks() {
                    return checks()
                },
                onApprove: (line: string) => approveCheck(key, line),
                crop: (line: string) => cropOf(key, line),
                status: (
                    <PageStatus
                        state={stateOf()}
                        empty={transcripts().has(file) && !text().trim() && !transcription.pageState(file, page) && !checks()?.some(c => c.line === '')}
                        onRetry={() => transcription.start(file, { pages: [page] })}
                    />
                ),
            }
        })
        return createMemo(() => mapped())
    })()
    const flipPages = createMemo(() => docPages().filter(p => p.key === curKey()))

    // ── locate: a selection in a section boxes its lines on the page image, and back ──
    // Dragging a selection asks for a page's lines on every update, and each read starts a helper.
    const loadPageLines = onceByKey(keyOfLeaf, async (l: { ref: { file: string }; pdfPage?: number }): Promise<TextLine[]> => {
        const page = l.pdfPage ?? 1
        const res = await api.transcriptLines(l.ref.file, [page])
        return res.pages.find(p => p.page === page)?.lines ?? []
    })
    const pageLines = (l: { ref: { file: string }; pdfPage?: number }): Promise<TextLine[]> =>
        loadPageLines(l).catch(() => [])
    const [located, setLocated] = createSignal<{ key: string; boxes: LocateBox[] }>()
    let locateToken = 0
    const onSideSelect = (leafIndex: number, selection: string) => {
        const l = leaves()[leafIndex]
        if (!l) return
        const key = keyOfLeaf(l)
        const token = ++locateToken
        if (!selection.trim()) return setLocated(cur => (cur?.key === key ? undefined : cur))
        void pageLines(l).then(lines => token === locateToken && setLocated({ key, boxes: boxesForQuote(lines, selection) }))
    }
    const onPagePoint = (leafIndex: number, x: number, y: number) => {
        const l = leaves()[leafIndex]
        if (!l) return
        void pageLines(l).then(lines => {
            const line = lineAtPoint(lines, x, y)
            if (line) handles.get(keyOfLeaf(l))?.reveal(line.text)
        })
    }
    const showOnPage = (leafIndex: number, selection: string) => {
        const l = leaves()[leafIndex]
        if (!l) return
        const key = keyOfLeaf(l)
        const token = ++locateToken
        void pageLines(l).then(lines => token === locateToken && setLocated({ key, boxes: boxesForQuote(lines, selection) }))
        jumpTo = leafIndex
        chooseView('side')
    }

    // ── a page's right-click menu ──
    const [pageMenu, setPageMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null)
    /** A page's own rows: read it again with a chosen reader. */
    const pageMenuItems = (leafIndex: number, extra: MenuItem[] = []): MenuItem[] => [
        ...extra,
        { label: 'read again on-device', icon: 'RefreshCw', onSelect: () => readAgain(leafIndex, 'on-device') },
        { label: 'read again with the math reader', icon: 'Sigma', onSelect: () => readAgain(leafIndex, 'marker') },
        { label: 'read again with ai', icon: 'Sparkles', onSelect: () => readAgain(leafIndex, 'ai') },
    ]
    /** Inside a pane the page's rows join the pane's own menu (split, close): one menu every time.
     *  On its own (a story) the book shows them itself. */
    const openPageMenu = (e: MouseEvent, items: MenuItem[]) => {
        if (host.closest('[data-pane-leaf]')) return addPaneMenuItems(e, items)
        e.preventDefault()
        e.stopPropagation()
        setPageMenu({ x: e.clientX, y: e.clientY, items })
    }
    const onBoxContextMenu = (e: MouseEvent) => {
        if (mode() !== 'pages' || turn() || armed()) return
        const sp = spread()
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const right = (e.clientX - box.left) / box.width >= 0.5
        const leafIndex = layout() === 'spread' ? (right ? sp.right : sp.left) : (sp.left ?? sp.right)
        if (leafIndex === undefined || !leaves()[leafIndex]) return
        openPageMenu(e, pageMenuItems(leafIndex))
    }
    const onSectionMenu = (e: MouseEvent, key: string, selection: string) => {
        const i = leafIndexOf(key)
        if (i < 0) return
        const extra: MenuItem[] =
            selection.trim() && mode() === 'text'
                ? [{ label: 'show on page', icon: 'Search', onSelect: () => showOnPage(i, selection) }]
                : []
        openPageMenu(e, pageMenuItems(i, extra))
    }
    // The notebook pages on screen: the spread's own leaves.
    const visibleLeaves = createMemo(() => {
        const s = spread()
        return [s.left, s.right].filter((i): i is number => i !== undefined)
    })


    // ── annotations: boxes and bookmarks go through the preview's annotation store ──
    // One store per page FILE on screen, shared with the PDF/image preview of the same file: it
    // loads the file's `.draw` sidecar, saves a PDF's boxes inside the PDF and an image's in the
    // sidecar, and owns that file's undo stack. A PDF's highlight ids hash its page geometry, which
    // the face loader records as it renders each page.
    const history = createEditHistory()
    const leaseStore = (file: string) => {
        const lease = acquireAnnotationStore(file, { pageGeom: i => loader.pdfPageGeom(file, i) })
        // A PDF holds its own highlights; take them in only when no holder of the shared store has,
        // since setting them again resets the store's undo history.
        if (/\.pdf$/i.test(file) && !untrack(() => lease.store.highlightsSettled?.()))
            void api.pdfHighlights(file).then(
                r => lease.store.setPdfHighlights(r.pages),
                () => undefined,
            )
        return lease
    }
    const pageStores = createPageStores(
        file => {
            const lease = leaseStore(file)
            return { store: lease.store, dispose: () => void lease.release() }
        },
        { onRetire: f => history.forget(f) },
    )
    let closed = false
    let lastEpochs = ''
    onCleanup(() => {
        closed = true
        void pageStores.close()
    })
    // A file's store is the shared one, which waits for any earlier holder's pending saves itself.
    createEffect(() => {
        const wanted = visibleLeaves()
            .map(i => leaves()[i]?.ref.file)
            .filter((f): f is string => !!f)
        // A file whose pages were rewritten has a fresh shared store: let the old one go first.
        const epochs = wanted.map(f => `${f}@${storeEpoch(f)}`).join('|')
        untrack(() => {
            if (closed) return
            if (epochs !== lastEpochs) {
                const before = new Set(lastEpochs.split('|'))
                const stale = wanted.filter(f => !before.has(`${f}@${storeEpoch(f)}`))
                if (stale.length) pageStores.sync(pageStores.files().filter(f => !stale.includes(f)))
                lastEpochs = epochs
            }
            pageStores.sync(wanted)
        })
    })
    const editFile = (file: string, fn: (d: DrawingDoc) => DrawingDoc) => {
        const store = pageStores.get(file)
        if (!store) return
        const before = untrack(store.doc)
        store.edit(fn)
        if (untrack(store.doc) !== before) history.record(file)
    }
    onMount(() => {
        const onUndoKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || typingTarget(e.target) || host.offsetParent === null) return
            const redo = matchesKeybinding(e, settings.keybindings['ink-redo'])
            if (!redo && !matchesKeybinding(e, settings.keybindings['ink-undo'])) return
            if (redo ? history.redo(pageStores.get) : history.undo(pageStores.get)) e.preventDefault()
        }
        window.addEventListener('keydown', onUndoKey)
        onCleanup(() => window.removeEventListener('keydown', onUndoKey))
    })

    // Settled seam: every page on screen has its sidecar loaded (and a PDF's own highlights taken
    // in, which resets the store's undo history), so an edit will take and stay undoable.
    const annotationsReady = () =>
        slots().length > 0 &&
        slots().every(sl => {
            const store = pageStores.get(sl.file)
            return store?.loadState() === 'ready' && (!/\.pdf$/i.test(sl.file) || store.highlightsSettled?.() !== false)
        })

    // region highlights
    const [armed, setArmed] = createSignal(false)
    const [colorMenu, setColorMenu] = createSignal<{ x: number; y: number } | null>(null)
    const sizeOf = (f: Face | undefined) => {
        if (f?.kind !== 'ready') return undefined
        const src = f.source as { width?: number; height?: number }
        return { w: Number(src.width), h: Number(src.height) }
    }
    const slots = createMemo(() => {
        const s = shown()
        const sp = spread()
        if (!s || s.key !== keyOf(sp)) return []
        return pageSlots({
            spread: sp,
            layout: layout(),
            pageSize: fit().pageSize,
            leaves: leaves(),
            sizes: { left: sizeOf(s.faces.left), right: sizeOf(s.faces.right) },
        })
    })
    // The transcript lines under a new box gain `==marks==`; where on-device recognition is
    // unavailable the box is all that saves.
    const markRegion = async (e: { leaf: number; region: { x: number; y: number; w: number; h: number } }) => {
        const l = leaves()[e.leaf]
        if (!l) return
        const page = l.pdfPage ?? 1
        try {
            const res = await api.transcriptLines(l.ref.file, [page])
            const lines = res.pages.find(p => p.page === page)?.lines ?? []
            const quotes = linesInRegion(lines, e.region)
            if (quotes.length === 0) return
            await api.markTranscript({ file: l.ref.file, page, add: quotes })
            await loadTranscript(l.ref.file)
        } catch {
            // no recognition here
        }
    }

    // text highlights: a selection inside a section becomes `==mark==`, or unwraps when it is inside one
    const onHighlightClick = () => {
        if (texty()) {
            // a flipped page's neighbours keep their editors, and any selection, while hidden
            const shown = flipping() ? [handles.get(curKey() ?? '')] : [...handles.values()]
            for (const h of shown) if (h?.selection()) return h.toggleMark()
            return
        }
        setArmed(v => !v)
    }


    // bookmarks
    const [bookmarksOpen, setBookmarksOpen] = createSignal(false)
    const toggleBookmarks = () => setBookmarksOpen(v => !v)
    const bookFiles = createMemo(() => [...new Set(leaves().map(l => leafBookmarkTarget(l).file))], [], {
        equals: (a, b) => a.join('\n') === b.join('\n'),
    })
    const [sidecars, setSidecars] = createSignal<ReadonlyMap<string, DrawingDoc | null>>(new Map())
    // One read per page file when the panel opens (or the file list changes, or a file's pages were
    // rewritten); no store is kept for a page off screen.
    createEffect(() => {
        if (!bookmarksOpen()) return
        sidecarsRev()
        void readSidecars(bookFiles(), api.read).then(fresh =>
            // a page on screen already holds a newer doc than the file does
            setSidecars(prev => {
                const m = new Map(fresh)
                for (const f of pageStores.files()) if (prev.has(f)) m.set(f, prev.get(f)!)
                return m
            }),
        )
    })
    // A page turned away from keeps its last doc here, since the file may not have caught up yet.
    createEffect(() => {
        for (const f of pageStores.files()) {
            const store = pageStores.get(f)
            if (store?.loadState() !== 'ready') continue
            const doc = store.doc()
            untrack(() => {
                if (sidecars().get(f) !== doc) setSidecars(m => new Map(m).set(f, doc))
            })
        }
    })
    const bookmarks = createMemo(() => {
        if (!bookmarksOpen()) return []
        const docs = new Map(sidecars())
        for (const f of pageStores.files()) {
            const store = pageStores.get(f)
            if (store?.loadState() === 'ready') docs.set(f, store.doc())
        }
        return bookBookmarks(docs, leaves())
    })
    // A row keeps its object while nothing about it changes, so the list does not rebuild its DOM
    // every time a store reports a doc.
    const rowCache = new Map<string, Bookmark>()
    const rows = createMemo<Bookmark[]>(() =>
        bookmarks().map(b => {
            const key = `${b.id}|${b.leaf}|${b.label}`
            let row = rowCache.get(key)
            if (!row) rowCache.set(key, (row = { id: b.id, page: b.leaf, label: b.label }))
            return row
        }),
    )
    /** Straight to a page (a bookmark, a typed number): any turn under way ends first. */
    const jump = (page: number) => {
        waiting.length = 0
        finishNow()
        batch(() => {
            docTurnId++
            setTextTurn(null)
            setLeaf(page)
            if (texty()) placeDoc(page)
        })
    }

    const firstLeaf = () => visibleLeaves()[0]
    const bookmarksReady = () => {
        const i = firstLeaf()
        const f = i === undefined ? undefined : leaves()[i]?.ref.file
        return !!f && pageStores.get(f)?.loadState() === 'ready'
    }
    const addBookmarkHere = () => {
        const i = mode() === 'pages' ? firstLeaf() : cur()
        const l = i === undefined ? undefined : leaves()[i]
        if (i === undefined || !l) return
        const t = leafBookmarkTarget(l)
        editFile(t.file, d => addBookmark(d, t.page, `Page ${i + 1}`))
    }
    // A bookmark on a page off screen has no store of the book's own.
    const editBookmark = (id: string, fn: (d: DrawingDoc) => DrawingDoc) => {
        const b = bookmarks().find(x => x.id === id)
        if (!b) return
        if (pageStores.get(b.file)) return editFile(b.file, fn)
        // Off screen: lease the shared store (so an open preview of the same file sees the edit),
        // apply it once the sidecar is in, and give the lease back (the last holder's release flushes).
        const lease = leaseStore(b.file)
        void whenReady(lease.store)
            .then(() => {
                lease.store.edit(fn)
                const doc = lease.store.doc()
                setSidecars(m => new Map(m).set(b.file, doc))
            })
            .catch(() => undefined)
            .finally(() => void lease.release())
    }

    const [sidecarsRev, setSidecarsRev] = createSignal(0)
    // ── edit pages: a sorter over the pages, saved at once on `save` ──
    // A PDF opened on its own edits the PDF itself, one page per tile; a book base edits its rows,
    // one tile per row (a PDF row is all of its pages), and never the files.
    type Staged =
        | { key: string; kind: 'page'; at: number }
        | { key: string; kind: 'file'; file: File }
        | { key: string; kind: 'blank' }
        // page `from` (0-based) of the newer version being merged in; `marksOf` = the page it replaces,
        // `textOf` = the same page, whose text it keeps (nothing new was written on it)
        | { key: string; kind: 'with'; from: number; marksOf?: number; textOf?: number }
    const [staged, setStaged] = createSignal<Staged[] | null>(null)
    const [stagedDirty, setStagedDirty] = createSignal(false)
    const [savingPages, setSavingPages] = createSignal(false)
    let stagedSeq = 0
    const pdfFile = () => (props.files?.length === 1 && kindOf(props.files[0]) === 'pdf' ? props.files[0] : undefined)
    const canEditPages = () => !!pdfFile() || (!props.files && !!props.basePath && props.ownsRows)
    const thumbs = createFaceLoader(faceDeps(200, 260), 400)
    const openPageEditor = () => {
        const n = pdfFile() ? leaves().length : refs().length
        setStaged(Array.from({ length: n }, (_, at) => ({ key: `p${at}`, kind: 'page' as const, at })))
        setStagedDirty(false)
    }
    // a remove's undo only means something while the sorter is open
    let undoToasts: number[] = []
    // ── merge a newer version: its pages are read from the picked bytes until save or cancel ──
    // `kept` 0: no page matched, so every page was paired by order
    type Merging = { key: string; name: string; data: string; kept: number }
    const [merging, setMerging] = createSignal<Merging | null>(null)
    let mergeSeq = 0
    // the name of the pdf being compared with this one, while its plan is worked out
    const [comparing, setComparing] = createSignal<string | null>(null)
    const endMerge = () => {
        const m = merging()
        if (m) releasePdfBytes(m.key)
        setMerging(null)
    }
    const closePageEditor = () => {
        for (const id of undoToasts) dismissToast(id)
        undoToasts = []
        endMerge()
        setStaged(null)
    }
    const stage = (next: Staged[]) => {
        setStaged(next)
        setStagedDirty(true)
    }
    const editTiles = createMemo<EditTile[]>(() =>
        (staged() ?? []).map((st, i) => {
            if (st.kind === 'file') return { key: st.key, label: st.file.name, pending: true }
            if (st.kind === 'blank') return { key: st.key, label: 'blank page', pending: true }
            if (st.kind === 'with') {
                const m = merging()
                const leaf = m ? { ref: { file: m.key, kind: 'pdf' as const, rowIndex: -1 }, pdfPage: st.from + 1 } : undefined
                return {
                    key: st.key,
                    label: st.textOf !== undefined ? `${i + 1}` : `${i + 1} // ${st.marksOf !== undefined ? 'updated' : 'new'}`,
                    face: leaf ? () => thumbs.face(leaf) : undefined,
                }
            }
            if (pdfFile()) {
                const l = leaves()[st.at]
                return { key: st.key, label: `${i + 1}`, face: l ? () => thumbs.face(l) : undefined }
            }
            const r = refs()[st.at]
            const own = leaves().filter(x => x.ref.rowIndex === r?.rowIndex)
            const label = r?.kind === 'pdf' ? `${basename(r.file)} // ${own.length} ${own.length === 1 ? 'page' : 'pages'}` : `${i + 1}`
            return { key: st.key, label, face: own[0] ? () => thumbs.face(own[0]) : undefined }
        }),
    )
    const moveStaged = (from: number, to: number) => {
        const next = [...(staged() ?? [])]
        const [m] = next.splice(from, 1)
        next.splice(to, 0, m)
        stage(next)
    }
    const removeStaged = (i: number) => {
        const before = staged() ?? []
        stage(before.filter((_, k) => k !== i))
        // nothing is written until save, so undo puts the sorter back as it was
        undoToasts.push(
            pushUndoToast(`removed page ${i + 1}`, () => {
                if (staged()) setStaged(before)
            }),
        )
    }
    const addStaged = (at: number, files: File[]) => {
        const ok = files.filter(f => /\.(png|jpe?g|pdf)$/i.test(f.name) || (!pdfFile() && kindOf(f.name)))
        if (ok.length < files.length)
            pushToast(pdfFile() ? 'only jpeg, png and pdf files can be added to a pdf' : 'only images and PDFs can be pages')
        const next = [...(staged() ?? [])]
        next.splice(at, 0, ...ok.map(file => ({ key: `f${++stagedSeq}`, kind: 'file' as const, file })))
        if (ok.length) stage(next)
    }
    /** The sorter as it was before the merge: `undo merge` puts it back. */
    let beforeMerge: Staged[] = []
    const mergeNote = createMemo(() => {
        const c = comparing()
        if (c) return `comparing pages with ${c}`
        const m = merging()
        if (!m) return undefined
        const list = staged() ?? []
        const updated = list.filter(st => st.kind === 'with' && st.marksOf !== undefined && st.textOf === undefined).length
        const added = list.filter(st => st.kind === 'with' && st.marksOf === undefined).length
        return `merging ${m.name}${m.kept ? '' : ' // no page matched, paired by order'} // ${updated} updated // ${added} new`
    })
    /** Plan the merge of `f` into the open PDF and lay the result out in the sorter, unsaved. */
    const mergeIn = async (f: File) => {
        const file = pdfFile()
        if (!file || savingPages() || comparing()) return
        if (!/\.pdf$/i.test(f.name)) return pushToast('only a pdf can be merged in')
        setComparing(f.name)
        try {
            const data = await base64Of(f)
            const plan = await api.pdfMergePlan(file, { data, name: f.name })
            beforeMerge = staged() ?? []
            endMerge()
            const key = `::merge/${++mergeSeq}/${f.name}`
            holdPdfBytes(key, new Uint8Array(await f.arrayBuffer()))
            setMerging({ key, name: f.name, data, kept: plan.kept })
            stage(
                plan.steps.map(s =>
                    s.kind === 'only'
                        ? { key: `p${s.page}`, kind: 'page' as const, at: s.page }
                        : s.kind === 'add'
                          ? { key: `w${s.from}`, kind: 'with' as const, from: s.from }
                          : // a kept page is the same page with nothing new on it: it keeps its text too
                            { key: `w${s.from}`, kind: 'with' as const, from: s.from, marksOf: s.page, ...(s.kind === 'keep' ? { textOf: s.page } : {}) },
                ),
            )
        } catch (e) {
            pushToast((e as Error).message)
        } finally {
            setComparing(null)
        }
    }
    const undoMerge = () => {
        setStaged(beforeMerge)
        setStagedDirty(false)
        endMerge()
    }
    const addBlank = (at: number) => {
        const next = [...(staged() ?? [])]
        next.splice(at, 0, { key: `b${++stagedSeq}`, kind: 'blank' })
        stage(next)
    }
    const base64Of = (f: File) =>
        new Promise<string>((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
            r.onerror = () => reject(r.error ?? new Error('could not read the file'))
            r.readAsDataURL(f)
        })
    /** Everything that held the old pages of `file` reads it again. */
    const afterRewrite = (file: string) => {
        loader.forget(file)
        thumbs.forget(file)
        forgetPdf(file)
        pdfReplaced(file)
        retireAnnotationStore(file)
        asked.delete(file)
        setCounts(m => {
            const n = new Map(m)
            n.delete(file)
            return n
        })
        setRecount(n => n + 1)
        setShown(undefined)
        void loadTranscript(file)
        setSidecarsRev(n => n + 1)
    }
    const saveRows = async (list: Staged[]) => {
        const base = props.basePath!
        // the base file's rows by their stored position; a page row is known by its ref
        const all = props.rows.map(r => r.index).filter((i): i is number => i !== undefined).sort((a, b) => a - b)
        const ids: (number | string)[] = [...all]
        const kept = new Set(list.flatMap(st => (st.kind === 'page' ? [st.at] : [])))
        const removed = new Set(
            refs().flatMap((r, at) => (kept.has(at) ? [] : [props.rows[r.rowIndex]?.index].filter((x): x is number => x !== undefined))),
        )
        const del = planDeletes(ids, removed)
        for (const o of del.ops) if (o.op === 'delete') await api.rowDelete(base, o.index)
        const rows = del.rows
        const order: (number | string)[] = []
        for (const st of list) {
            if (st.kind === 'page') {
                const idx = props.rows[refs()[st.at]?.rowIndex ?? -1]?.index
                if (idx !== undefined) order.push(idx)
            } else if (st.kind === 'file') {
                const landed = await intakeFiles({ files: [st.file] }, base)
                if (landed.length) {
                    rows.push(st.key)
                    order.push(st.key)
                }
            }
        }
        for (const o of planMoves(rows, order)) if (o.op === 'move') await api.rowReorder(base, o.from, o.to)
    }
    const savePages = async () => {
        const list = staged()
        if (!list || savingPages()) return
        setSavingPages(true)
        try {
            const file = pdfFile()
            if (file) {
                const order = await Promise.all(
                    list.map(async st =>
                        st.kind === 'page'
                            ? { page: st.at + 1 }
                            : st.kind === 'blank'
                              ? { blank: true as const }
                              : st.kind === 'with'
                                ? {
                                      with: st.from + 1,
                                      ...(st.marksOf !== undefined ? { marksOf: st.marksOf + 1 } : {}),
                                      ...(st.textOf !== undefined ? { textOf: st.textOf + 1 } : {}),
                                  }
                                : { data: await base64Of(st.file), name: st.file.name },
                    ),
                )
                const m = merging()
                // unsaved ink or boxes go first, so nothing writes the old page order after
                await flushAnnotationStore(file)
                await api.pdfPages(file, order, m && list.some(st => st.kind === 'with') ? { data: m.data, name: m.name } : undefined)
                afterRewrite(file)
            } else {
                await saveRows(list)
                props.onChange()
            }
            setLeaf(0)
            closePageEditor()
        } catch (e) {
            pushToast(`couldn't save the pages: ${(e as Error).message}`)
        } finally {
            setSavingPages(false)
        }
    }

    // ── where the reader is, for the caller that opened it ──
    createEffect(() => {
        if (!props.onPosition || !counted() || leaves().length === 0) return
        if (scrolling()) return props.onPosition({ leaf: cur(), frac: 0 })
        if (texty()) return props.onPosition({ leaf: cur(), frac: docFrac() })
        const s = spread()
        props.onPosition({ leaf: s.left ?? s.right ?? 0, frac: 0 })
    })


    // ── intake ──
    let picker: HTMLInputElement | undefined
    const takePages = async (input: { files?: File[]; paths?: string[] }) => {
        if (!props.basePath) return
        if (!props.ownsRows) {
            pushToast("this book's pages come from its source")
            return
        }
        // new pages are read by the transcript effect once the rows refresh
        const landed = await intakeFiles(input, props.basePath)
        if (landed.length) props.onChange()
    }
    const addPages = () => (props.onAddPages ? props.onAddPages() : picker?.click())
    const onDragOver = (e: DragEvent) => {
        if (isFileDrag(e.dataTransfer)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        void takePages({ files: Array.from(e.dataTransfer?.files ?? []) })
    }
    onMount(() => {
        const onNative = (e: Event) => {
            const d = (e as CustomEvent<NativeDragDetail>).detail
            if (d.type !== 'drop' || d.paths.length === 0) return
            if (!pointInDropRect(host.getBoundingClientRect(), d.x, d.y)) return
            if (!claimNativeDrop(d)) return
            // the sorter takes dropped files as pages to add, saved with the rest
            if (staged()) {
                void Promise.all(
                    d.paths.map(async p => new File([await readNativeBytes(p)], basename(p))),
                ).then(files => addStaged(staged()?.length ?? 0, files), () => pushToast("couldn't read the dropped files"))
                return
            }
            void takePages({ paths: d.paths })
        }
        window.addEventListener('bismuth-native-drag', onNative)
        onCleanup(() => window.removeEventListener('bismuth-native-drag', onNative))
    })

    // ── bar ──
    onMount(() => {
        props.onBarSlots({
            readouts: (
                <Show when={count() > 0}>
                    <Readout
                        parts={[
                            <>
                                <PageReadout
                                    current={() => (scrolling() || texty() ? cur() : (spread().left ?? spread().right ?? 0))}
                                    count={count}
                                    onGo={jump}
                                    label={() =>
                                        scrolling() || texty()
                                            ? pageReadout(cur() + 1, Math.max(leaves().length, transcription.progress()?.total ?? 0))
                                            : readoutFor(spread(), count())
                                    }
                                />
                                <TranscribeProgress transcription={transcription} />
                            </>,
                        ]}
                    />
                </Show>
            ),
            actions: (
                <>
                    <Show when={emptyLeaves().length > 0 && !transcription.progress()}>
                        <Text as="span" inherit data-bar-drop="3" data-bar-menu-label="transcribe">
                            <TextButton onClick={transcribeAll}>
                                {`transcribe ${emptyLeaves().length} ${emptyLeaves().length === 1 ? 'page' : 'pages'}`}
                            </TextButton>
                        </Text>
                    </Show>
                    <Show when={count() > 0}>
                        <Text as="span" inherit data-bar-drop="3" data-bar-menu-label="transcribe all">
                            <TranscribeAll files={[...new Set(refs().map(r => r.file))]} pages={count()} transcription={transcription} />
                        </Text>
                    </Show>
                    <IconButton
                        icon="Highlighter"
                        label="highlight"
                        tint={highlightTint(highlightColor())}
                        title={
                            texty()
                                ? 'highlight the selected words, or take the highlight off a selection inside one'
                                : armed()
                                  ? 'drag on a page to highlight a region, click a box to remove it (click to cancel, right-click for colours)'
                                  : 'highlight a region of a page (right-click for colours)'
                        }
                        variant={armed() && !texty() ? 'selected' : 'unselected'}
                        disabled={leaves().length === 0}
                        onClick={onHighlightClick}
                        // The right-click is this button's own: bubbling on to PaneLeaf would open
                        // the pane menu, which closes this one (activeMenu.ts).
                        onContextMenu={(e: MouseEvent) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (leaves().length > 0) setColorMenu({ x: e.clientX, y: e.clientY })
                        }}
                    />
                    <Show when={colorMenu()}>
                        {m => (
                            <HighlightColorMenu
                                x={m().x}
                                y={m().y}
                                value={highlightColor()}
                                onPick={c => {
                                    setHighlightColor(c)
                                    setArmed(true)
                                }}
                                onClose={() => setColorMenu(null)}
                            />
                        )}
                    </Show>
                    <Text as="span" inherit data-bar-drop="2" data-bar-menu-label="bookmarks">
                        <IconButton
                            icon="Bookmark"
                            label="bookmarks"
                            variant={bookmarksOpen() ? 'selected' : 'unselected'}
                            onClick={toggleBookmarks}
                        />
                    </Text>
                    <Text as="span" inherit data-bar-drop="2" data-bar-menu-label="dark pages">
                        <IconButton
                            icon="Moon"
                            label="dark pages"
                            variant={dark() ? 'selected' : 'unselected'}
                            onClick={toggleDark}
                        />
                    </Text>
                    <Show when={canEditPages()}>
                        <Text as="span" inherit data-bar-drop="3" data-bar-menu-label="edit pages">
                            <IconButton
                                icon="LayoutGrid"
                                label="edit pages"
                                title="add, move and remove pages"
                                variant={staged() ? 'selected' : 'unselected'}
                                onClick={() => (staged() ? closePageEditor() : openPageEditor())}
                            />
                        </Text>
                    </Show>
                    <Show when={!props.files}>
                        <Text as="span" inherit data-bar-drop="4" data-bar-menu-label="add pages">
                            <IconButton icon="Plus" label="add pages" onClick={addPages} />
                        </Text>
                    </Show>
                    <Show when={leaves().length > 0 && !staged()}>
                        <BarSettings
                            label="display"
                            rows={[
                                {
                                    label: 'show',
                                    control: (
                                        <ReadModeSwitch
                                            view={mode()}
                                            onView={chooseView}
                                            textUnavailable={textAllowed() ? undefined : 'no page is transcribed yet'}
                                        />
                                    ),
                                },
                                {
                                    label: 'move by',
                                    control: <FlowToggle flow={flow()} onFlow={chooseFlow} />,
                                },
                                {
                                    label: 'layout',
                                    control: (
                                        <SegmentedToggle<'auto' | 'single'>
                                            options={[
                                                {
                                                    id: 'auto',
                                                    label: 'auto',
                                                    title: 'two pages when the pane fits them, else one',
                                                },
                                                { id: 'single', label: 'single' },
                                            ]}
                                            value={requested() === 'single' ? 'single' : 'auto'}
                                            onChange={id => chooseLayout(id === 'single' ? 'single' : 'spread')}
                                        />
                                    ),
                                },
                                {
                                    label: 'text size',
                                    control: (
                                        <ZoomSteps
                                            zoom={textScale}
                                            onZoomOut={() => stepText(-1)}
                                            onZoomIn={() => stepText(1)}
                                            zoomOutDisabled={textScale() <= TEXT_SCALES[0]}
                                            zoomInDisabled={textScale() >= TEXT_SCALES[TEXT_SCALES.length - 1]}
                                            outLabel="smaller text"
                                            inLabel="larger text"
                                            menuLabel="text size"
                                            data-testid="book-text-size"
                                        />
                                    ),
                                },
                            ]}
                        />
                    </Show>
                </>
            ),
        })
    })
    onCleanup(() => props.onBarSlots(undefined))

    const sideRows = (() => {
        const mapped = mapArray(docPages, (p, i) => {
            const l = () => leaves()[i()]
            return {
                key: p.key,
                get aspect() {
                    return shapes().get(shapeKey(l())) ?? pageAspect()
                },
                get hidden() {
                    return flipping() && p.key !== curKey()
                },
                image: () => (
                    <BookPageImage
                        face={() => loader.face(l()).then(f => (noteShape(l(), f), shade(f)!))}
                        rev={dark() ? 1 : 0}
                        label={`page ${i() + 1}`}
                        boxes={located()?.key === p.key ? located()!.boxes : []}
                        onPoint={(x, y) => onPagePoint(i(), x, y)}
                        onContextMenu={e => openPageMenu(e, pageMenuItems(i()))}
                        eager={flipping()}
                    />
                ),
                text: () => (
                    <TranscriptSection
                        page={p}
                        onSave={saveText}
                        pageRef={pageRef}
                        fontFamily={family()}
                        textScale={textScale()}
                        onSelect={sel => onSideSelect(i(), sel)}
                        onContextMenu={onSectionMenu}
                    />
                ),
            } satisfies SideBySideRow
        })
        return createMemo(() => mapped())
    })()
    /** Flipped: the page in view and those either side, built ahead so a turn only swaps which shows. */
    const flipRows = createMemo(() => {
        const c = cur()
        return sideRows().filter((_, n) => Math.abs(n - c) <= FLIP_AHEAD)
    })

    const boxSize = () => ({
        w: layout() === 'spread' ? fit().pageSize.w * 2 : fit().pageSize.w,
        h: fit().pageSize.h,
    })

    return (
        <div
            ref={host}
            class={styles.book}
            data-book
            data-turn-state={turnState()}
            data-book-prefetched={prefetched() ? '' : undefined}
            data-book-annotations-ready={annotationsReady() ? '' : undefined}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <FilePicker
                ref={el => (picker = el)}
                accept="image/*,application/pdf"
                multiple
                onPick={files => void takePages({ files: Array.from(files) })}
            />
            <div class={styles.main} ref={mainEl}>
                <Show
                    when={leaves().length > 0}
                    fallback={
                        <div class={styles.empty} data-book-empty>
                            <Text tone="muted">drop photos, scans or PDFs here</Text>
                            <TextButton onClick={addPages}>+ pages</TextButton>
                        </div>
                    }
                >
                    <Show when={staged()}>
                        <BookPageEditor
                            tiles={editTiles()}
                            shade={shade}
                            canBlank={!!pdfFile()}
                            canMerge={!!pdfFile()}
                            note={mergeNote()}
                            onMerge={f => void mergeIn(f)}
                            onUndoMerge={merging() ? undoMerge : undefined}
                            dirty={stagedDirty()}
                            busy={savingPages()}
                            waiting={!!comparing()}
                            onMove={moveStaged}
                            onRemove={removeStaged}
                            onAddFiles={addStaged}
                            onAddBlank={addBlank}
                            onSave={() => void savePages()}
                            onCancel={closePageEditor}
                        />
                    </Show>
                    <Show when={!staged() && mode() === 'text'}>
                        <TranscriptDoc
                            className={styles.reader}
                            pages={flipping() ? flipPages() : docPages()}
                            onSave={saveText}
                            at={docAt()}
                            onAt={onDocAt}
                            pageRef={pageRef}
                            fontFamily={family()}
                            textScale={textScale()}
                            onContextMenu={onSectionMenu}
                        />
                    </Show>
                    <Show when={!staged() && mode() === 'side'}>
                        <SideBySide className={styles.reader} rows={flipping() ? flipRows() : sideRows()} flip={flipping()} at={docAt()} onAt={onDocAt} />
                    </Show>
                    <Show when={textTurn()}>
                        {t => (
                            <TextPageTurn
                                box={t().box}
                                from={t().from}
                                to={t().to}
                                direction={t().direction}
                                spread={mode() === 'side'}
                                turnKey={t().id}
                                onSettled={() => setTextTurn(c => (c?.id === t().id ? null : c))}
                            />
                        )}
                    </Show>
                    <Show when={!staged() && flipping()}>
                        <FlipNav
                            page={cur() + 1}
                            pages={count()}
                            onStep={stepDoc}
                            onGo={jump}
                        />
                    </Show>
                    <Show when={scrolling() && !staged()}>
                        <BookScroll
                            leaves={leaves()}
                            face={l => loader.face(l).then(f => shade(f)!)}
                            aspect={pageAspect()}
                            target={cur()}
                            onPage={setLeaf}
                        />
                    </Show>
                    <div ref={observe} class={styles.stage} classList={{ [styles.hidden]: scrolling() || texty() || !!staged() }}>
                        <Show when={measured() && shown()}>
                            {s => (
                                <div
                                    class={styles.box}
                                    style={{
                                        width: `${boxSize().w}px`,
                                        height: `${boxSize().h}px`,
                                    }}
                                    onPointerDown={onPointerDown}
                                    onPointerMove={onPointerMove}
                                    onPointerUp={onPointerEnd}
                                    onPointerCancel={onPointerEnd}
                                    onContextMenu={onBoxContextMenu}
                                >
                                    <Show
                                        when={turn()}
                                        fallback={
                                            <BookSpread
                                                faces={asLayer(s().faces)}
                                                layout={layout()}
                                                pageSize={fit().pageSize}
                                                missing={{
                                                    left: missingName(s().faces.left),
                                                    right: missingName(s().faces.right),
                                                }}
                                                onTurn={turnBy}
                                            />
                                        }
                                    >
                                        {t => (
                                            <PageTurnLayer
                                                width={boxSize().w}
                                                height={boxSize().h}
                                                layout={layout()}
                                                from={t().from}
                                                to={t().to}
                                                direction={t().direction}
                                                drag={drag()}
                                                onSettled={committed => onSettled(t())(committed)}
                                                turnKey={t().id}
                                                durationMs={t().durationMs}
                                            />
                                        )}
                                    </Show>
                                    <Show when={!turn() && mode() === 'pages'}>
                                        <BookHighlightLayer
                                            slots={slots()}
                                            store={pageStores.get}
                                            armed={armed()}
                                            color={highlightColor()}
                                            edit={editFile}
                                            onHighlighted={() => setArmed(false)}
                                            onRegion={e => void markRegion(e)}
                                        />
                                    </Show>
                                </div>
                            )}
                        </Show>
                        <Show when={measured() && shown()}>
                            <Text as="div" size="micro" tone="faint" class={styles.folio} data-book-folio>
                                {folioFor(spread(), count())}
                            </Text>
                        </Show>
                    </div>
                </Show>
            </div>
            <Show when={bookmarksOpen()}>
                <BookBookmarksPanel
                    bookmarks={rows()}
                    ready={bookmarksReady()}
                    onAdd={addBookmarkHere}
                    onJump={jump}
                    onRename={(id, label) => editBookmark(id, d => renameBookmark(d, id, label))}
                    onRemove={id => editBookmark(id, d => removeBookmark(d, id))}
                />
            </Show>
            <Show when={pageMenu()}>
                {m => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setPageMenu(null)} />}
            </Show>
            {/* asked as soon as a running job finds math, and again with a fuller count while it runs */}
            <Show when={transcription.mathPending() > 0}>
                <MathPrompt
                    pages={transcription.mathPending()}
                    install={transcription.markerMissing()}
                    running={transcription.progress() !== undefined}
                    onChoose={(choice, remember) => transcription.chooseMath(choice, remember)}
                />
            </Show>
        </div>
    )
}

export default BookView
