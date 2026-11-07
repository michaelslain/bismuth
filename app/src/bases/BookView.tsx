import {
    batch,
    createComputed,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
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
import { highlightColor, setHighlightColor } from '../preview/highlightColor'
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
import { PDF_HIGHLIGHT_COLORS } from '../../../core/src/theme/tokens'
import type { Bookmark, DrawingDoc } from '../../../core/src/drawing/model'
import { addBookmark, removeBookmark, renameBookmark } from '../../../core/src/drawing/pageBookmarks'
import type { TranscriptEngine } from '../../../core/src/transcript'
import { looksLikeMath } from '../../../core/src/mathDetect'
import { createFaceLoader, defaultFaceDeps, faceDeps, forgetPdf, type Face } from './bookFaces'
import { darkenPixels, darkHex, tintOf } from './darkPage'
import BookPageEditor, { type EditTile } from './BookPageEditor'
import TranscriptEditor from './TranscriptEditor'
import { isFileDrag } from './cardImageDrop'
import { intakeFiles, readNativeBytes } from './bookIntake'
import { planDeletes, planMoves } from './bookRowPlan'
import { pushUndoToast } from '../undoToast'
import { basename } from '../fileIntake'
import { createTranscribeQueue } from './transcribeQueue'
import MathPrompt, { type MathChoice } from './MathPrompt'
import BookBookmarksPanel from './BookBookmarksPanel'
import BookHighlightLayer from './BookHighlightLayer'
import { createEditHistory, createPageStores, pageSlots, readSidecars } from './bookPageStores'
import { clampAspect, fitBook, folioFor, PAGE_ASPECT, PAGE_MIN_W, readingAspect, readoutFor, retargetLeaf, stepFromKey } from './bookNav'
import { BOOK_TEXT_INK, BOOK_TEXT_MUTED, PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'
import BookSpread from './BookSpread'
import BookScroll from './BookScroll'
import ReadModeSwitch, { type ReadMode } from './ReadModeSwitch'
import { TEXT_FONT_FAMILY, TEXT_SCALES, TEXT_STYLE, leafOnTextPages, paginateText, textPageForLeaf, textPageForWord, type TextPage } from './bookText'
import { mathRaster, mathReady, measureMath, prepareMathRasters, primeMath } from './bookMath'
import type { BookQuote } from './bookSelection'
import { rasterTextPage, texOf } from './bookTextRaster'
import TextSpread, { type TextSpreadReader } from './TextSpread'
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
    /** Pages still being transcribed; the readout ends `// transcribing 3 of 12`. */
    transcribing?: { done: number; total: number }
    /** Read these page files instead of the rows' page column: an image or PDF opened on its own. */
    files?: string[]
    /** Set when something else owns the reading mode (the PDF and image preview): a pick on the
     *  `scroll | pages | text` switch, or a layout pick, goes here and nothing is written to a base. */
    onReadMode?: (mode: ReadMode) => void
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

/** The faces of a spread; in text mode also the typeset pages the still spread is drawn from. */
type Faces = { left?: Face; right?: Face; text?: [TextPage | null, TextPage | null] }
type BookMode = 'pages' | 'text'
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
 *  contribution (readout, the `pages | text` switch, the tool icons and the `Aa` display panel) goes up through `onBarSlots`. */
const BookView: Component<BookViewProps> = props => {
    const loader = createFaceLoader(defaultFaceDeps)
    let host!: HTMLDivElement

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
    // In text mode a "leaf" is a text page: the position, spread and turn maths below are the same
    // either way, over whichever list of pages the mode shows.
    const count = () => (mode() === 'text' ? textPages().length : leaves().length)

    // ── transcripts: loaded for every page file, since text mode sets them all ──
    type Transcript = { engine?: TranscriptEngine; at?: string; pages: { page: number; text: string }[] }
    const [transcripts, setTranscripts] = createSignal<ReadonlyMap<string, Transcript>>(new Map())

    // ── mode: the notebook pages, or their transcriptions set as text ──
    const [modeReq, setModeReq] = createSignal<BookMode>(props.view.bookMode === 'text' ? 'text' : 'pages')
    // Scroll is a third way to read beside pages and text; the turn maths below never see it.
    const [scrolling, setScrolling] = createSignal(props.view.bookMode === 'scroll')
    createEffect(
        on(
            () => props.view.bookMode,
            v => {
                setScrolling(v === 'scroll')
                if (v !== 'scroll') setModeReq(v === 'text' ? 'text' : 'pages')
            },
            { defer: true },
        ),
    )
    const textAvailable = () => {
        for (const t of transcripts().values()) if (t.pages.some(p => p.text.trim())) return true
        return false
    }
    // A file opened on its own goes to text even before it has any: its page shows as not yet
    // transcribed while the transcription runs.
    const textAllowed = () => textAvailable() || !!props.files
    const mode = (): BookMode => (modeReq() === 'text' && textAllowed() && !scrolling() ? 'text' : 'pages')
    const readMode = (): ReadMode => (scrolling() ? 'scroll' : mode())

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
    const paper = () => (dark() ? darkHex(PDF_PAGE_PAPER) : PDF_PAGE_PAPER)
    const ink = () => (dark() ? darkHex(BOOK_TEXT_INK) : BOOK_TEXT_INK)
    const muted = () => (dark() ? darkHex(BOOK_TEXT_MUTED) : BOOK_TEXT_MUTED)
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
            darkCopies.set(f.source as object, c)
            darkMade.add(c)
        }
        return { kind: 'ready', source: c }
    }
    /** The tint behind a highlighted word: the highlighter's current colour, translucent. */
    const markTint = () => {
        const hex = (PDF_HIGHLIGHT_COLORS.find(c => c.c === highlightColor()) ?? PDF_HIGHLIGHT_COLORS[0]).hex
        return tintOf(hex, 0.45, dark())
    }
    const chooseMode = (next: ReadMode) => {
        if (props.onReadMode) return props.onReadMode(next)
        setScrolling(next === 'scroll')
        if (next !== 'scroll') setModeReq(next)
        const path = props.basePath
        if (path) void api.setProperty(path, 'bookMode', next).then(() => props.onChange())
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
    const [leaf, setLeaf] = createSignal(
        props.start && props.view.bookMode !== 'text' ? props.start.leaf : (leafMemory.get(memoryKey() ?? '') ?? 0),
    )
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
            // text mode keeps the scans' sheet when it is a reading page; wide photos get a reading page
            mode() === 'text' ? readingAspect(pageAspect()) : spreadAspect(),
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

    // ── text pages: every page file's transcript, typeset to the page size ──
    const pageTextOf = (l: { ref: { file: string }; pdfPage?: number }) =>
        transcripts().get(l.ref.file)?.pages.find(p => p.page === (l.pdfPage ?? 1))?.text ?? ''
    let lastText: TextPage[] = []
    let textRev = 0
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
    const textStyle = () => TEXT_STYLE(fit().pageSize, textScale())
    /** Text mode's face: the prose font the notes are set in (`appearance.proseFont`). */
    const family = () => FONT_STACKS[settings.appearance.proseFont] ?? FONT_STACKS['Libron'] ?? TEXT_FONT_FAMILY
    // The canvas measures with whatever face is loaded, so the pages set again once the prose face is in.
    const [fontRev, setFontRev] = createSignal(0)
    createEffect(() => {
        const f = family()
        const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
        if (!fonts) return
        void Promise.all([fonts.load(`16px ${f}`), fonts.load(`bold 16px ${f}`)]).then(
            () => setFontRev(n => n + 1),
            () => undefined,
        )
    })
    /** How many words a notebook page's text has: the unit the typeset lines count `start` in. */
    const wordsOf = (leafIndex: number) => {
        const l = untrack(leaves)[leafIndex]
        return l ? pageTextOf(l).split(/\s+/).filter(Boolean).length : 0
    }
    const textPages = createMemo<TextPage[]>(() => {
        if (mode() !== 'text' || !measured()) return []
        mathReady() // the pages set again with real formula boxes once KaTeX lands
        fontRev()
        const size = fit().pageSize
        const style = TEXT_STYLE(size, textScale())
        const blocks = leaves()
            .map((l, i) => {
                const source = { file: l.ref.file, pdfPage: l.pdfPage, leaf: i }
                const text = pageTextOf(l)
                return text.trim()
                    ? { source, text }
                    : { source, text: `page ${i + 1} isn't transcribed yet`, placeholder: true as const }
            })
        const g = document.createElement('canvas').getContext('2d')!
        const font = `${style.fontPx}px ${family()}`
        // a word's width is measured once a typesetting: a line is tried word by word
        const widths = new Map<string, number>()
        const text = (str: string, bold?: boolean) => {
            const key = bold ? `b|${str}` : str
            let w = widths.get(key)
            if (w === undefined) {
                g.font = bold ? `bold ${font}` : font
                w = g.measureText(str).width
                widths.set(key, w)
            }
            return w
        }
        // every formula in the book measured in one layout pass, before the typesetter asks
        primeMath(
            blocks.flatMap(b =>
                [...b.text.matchAll(/\$\$([\s\S]+?)\$\$|\$(?!\$)([^$\n]+?)\$/g)].map(m =>
                    m[1] !== undefined ? { tex: m[1].trim(), display: true } : { tex: m[2], display: false },
                ),
            ),
            family(),
        )
        const pages = paginateText(
            blocks,
            size,
            { text, math: (tex, display) => measureMath(tex, display, style.fontPx, family(), text) },
            style,
            // each notebook page starts a page of text, so switching modes lands at the top of one
            { breakPerBlock: true },
        )
        textRev++
        return (lastText = pages)
    })
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
        if (key && mode() === 'pages') leafMemory.set(key, cur())
    })
    let prevLayout = layout()
    createComputed(() => {
        const l = layout()
        if (!measured() || l === prevLayout) return
        setLeaf(retargetLeaf(untrack(cur), untrack(count), prevLayout, l))
        prevLayout = l
    })
    const spread = createMemo(() => spreadFor(cur(), count(), layout()))

    // The page to open when text mode starts: the one holding this notebook page's text, or the next
    // that has any; or, switching straight back, exactly the text page the reader left.
    let entering: { leaf: number; frac?: number } | { textPage: number } | undefined = props.start && props.view.bookMode === 'text' ? { leaf: props.start.leaf, frac: props.start.frac } : undefined
    // Where the last switch came from and where it landed, so a switch straight back (no page
    // turned in between) returns to exactly the same place instead of re-deriving it.
    let back: { mode: BookMode; pos: number; there: number | undefined } | undefined
    const applyEntering = () => {
        const pages = untrack(textPages)
        if (entering === undefined || pages.length === 0) return
        let at = 0
        if ('textPage' in entering) at = Math.max(0, Math.min(entering.textPage, pages.length - 1))
        else if (entering.frac && wordsOf(entering.leaf) > 0)
            at = textPageForWord(pages, entering.leaf, Math.floor(entering.frac * wordsOf(entering.leaf)))
        else
            for (let l = entering.leaf; l < untrack(leaves).length; l++) {
                if (pages.some(p => p.lines.some(x => x.source.leaf === l))) {
                    at = textPageForLeaf(pages, l)
                    break
                }
            }
        entering = undefined
        if (back) back.there = at
        setLeaf(at)
    }
    const sameSpread = (a: number, b: number, n: number) => {
        const sa = spreadFor(Math.max(0, Math.min(a, n - 1)), n, untrack(layout))
        const sb = spreadFor(Math.max(0, Math.min(b, n - 1)), n, untrack(layout))
        return sa.left === sb.left && sa.right === sb.right
    }
    createComputed(
        on(
            mode,
            (m, prev) => {
                if (m === prev || !prev) return
                // A turn still running lands where it was going, counted in the mode it started in,
                // and is dropped here so it cannot finish later into the other mode's pages.
                const t = untrack(turn)
                const pos = t ? t.target : untrack(leaf)
                if (t)
                    batch(() => {
                        setTurn(null)
                        setDrag(null)
                        setTurnState('settled')
                    })
                const n = prev === 'text' ? lastText.length : untrack(leaves).length
                const exact = back && back.mode === m && back.there !== undefined && sameSpread(pos, back.there, n) ? back.pos : undefined
                back = { mode: prev, pos, there: undefined }
                if (m === 'text') {
                    const s = spreadFor(Math.max(0, Math.min(pos, n - 1)), n, untrack(layout))
                    entering = exact !== undefined ? { textPage: exact } : { leaf: s.left ?? s.right ?? 0 }
                    applyEntering()
                } else {
                    const s = spreadFor(Math.max(0, Math.min(pos, n - 1)), n, untrack(layout))
                    entering = undefined
                    const to = exact ?? leafOnTextPages(lastText, [s.left, s.right], 0)
                    back.there = to
                    setLeaf(to)
                }
            },
            // Not deferred: the first run records the mode, so the first switch has one to compare.
        ),
    )
    // A resize or a changed transcript re-typesets the book; the reader stays on the same words.
    createComputed(
        on(textPages, (now, prev) => {
            if (entering !== undefined) return applyEntering()
            if (!prev || prev.length === 0 || now.length === 0) return
            const s = spreadFor(Math.max(0, Math.min(untrack(leaf), prev.length - 1)), prev.length, untrack(layout))
            const first = prev[s.left ?? s.right ?? 0]?.lines[0]
            if (first) setLeaf(textPageForWord(now, first.source.leaf, first.start))
        }),
    )

    // ── faces ──
    const [shown, setShown] = createSignal<Shown | undefined>()
    // Bumped when a batch of formula pictures is drawn, so the spread on screen draws its faces again.
    const [pictures, setPictures] = createSignal(0)
    const keyOf = (s: Spread) =>
        mode() === 'text'
            ? `text${textRev}.${pictures()}|${markTint()}|${[s.left, s.right].map(i => i ?? '-').join('|')}`
            : (dark() ? 'dark|' : '') +
              [s.left, s.right]
                  .map(i => (i === undefined ? '-' : `${leaves()[i]?.ref.file}#${leaves()[i]?.pdfPage ?? 0}`))
                  .join('|')
    // Text pages are drawn, not loaded: the canvas faces the curl turns, and the typeset pages the still spread shows.
    const rasters = new Map<string, Face>()
    const textFaces = (s: Spread): Faces => {
        const pages = textPages()
        const size = fit().pageSize
        const style = textStyle()
        const face = (i: number | undefined): Face | undefined => {
            if (i === undefined || !pages[i]) return undefined
            const key = `${textRev}|${markTint()}|${dark() ? 'd' : ''}|${i}`
            let f = rasters.get(key)
            if (!f) {
                if (rasters.size > 12) rasters.clear()
                const colors = { bg: paper(), fg: ink(), mark: markTint(), muted: muted() }
                const font = `${style.fontPx}px ${family()}`
                const g = document.createElement('canvas').getContext('2d')!
                g.font = font
                const math = (tex: string, display: boolean) => ({
                    w: measureMath(tex, display, style.fontPx, family(), str => g.measureText(str).width).w,
                    picture: mathRaster(tex, display, style.fontPx, colors.fg),
                })
                f = { kind: 'ready', source: rasterTextPage(pages[i], size, colors, font, math) }
                rasters.set(key, f)
            }
            return f
        }
        return {
            left: face(s.left),
            right: face(s.right),
            text: [s.left === undefined ? null : (pages[s.left] ?? null), s.right === undefined ? null : (pages[s.right] ?? null)],
        }
    }
    // Formulas are rendered and measured ahead, in idle time and small batches, so the first switch
    // to text does not stall on a book's worth of KaTeX.
    createEffect(() => {
        const t = transcripts()
        if (!mathReady()) return
        const items = [...t.values()].flatMap(tr =>
            tr.pages.flatMap(p =>
                [...p.text.matchAll(/\$\$([\s\S]+?)\$\$|\$(?!\$)([^$\n]+?)\$/g)].map(m =>
                    m[1] !== undefined ? { tex: m[1].trim(), display: true } : { tex: m[2], display: false },
                ),
            ),
        )
        const step = (from: number) => {
            if (from >= items.length) return
            primeMath(items.slice(from, from + 12), family())
            whenIdle(() => step(from + 12))
        }
        whenIdle(() => step(0))
    })
    // Formulas draw on the curl from pictures made ahead, off the turn's path: those on the spread
    // on screen and two pages either side, as the reader moves. Until a picture is ready its place is blank
    // on the curl. A drawn set drops the cached faces so the next turn uses it.
    createEffect(() => {
        const pages = textPages()
        if (pages.length === 0 || !mathReady() || mode() !== 'text') return
        const s = spread()
        const lo = Math.max(0, (s.left ?? s.right ?? 0) - 2)
        const hi = Math.min(pages.length - 1, (s.right ?? s.left ?? 0) + 2)
        const fontPx = textStyle().fontPx
        const fg = ink()
        const items = pages
            .slice(lo, hi + 1)
            .flatMap(p => p.lines.flatMap(l => l.runs.filter(r => r.math).map(r => ({ tex: texOf(r), display: r.math === 'display' }))))
        void prepareMathRasters(items, fontPx, family(), fg).then(drew => {
            if (!drew) return
            rasters.clear()
            setPictures(n => n + 1)
        })
    })
    const loadSpread = async (s: Spread): Promise<Faces> => {
        if (mode() === 'text') return textFaces(s)
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
        if (mode() === 'text') return textFaces(s)
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
        textPages()
        const s = spread()
        const lay = layout()
        const n = count()
        const key = keyOf(s)
        if (n === 0) return setShown(undefined)
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
        if (e.button !== 0 || drag() || turn() || mode() === 'text') return
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

    // ── transcription ──
    // A page's text is its transcription. A run with no engine uses the vault's `transcription.engine`;
    // only the right-click redo names one.
    const [qTick, setQTick] = createSignal(0)
    const loadTranscript = (file: string) =>
        api.storedTranscript(file).then(
            t => setTranscripts(m => new Map(m).set(file, t)),
            () => undefined,
        )
    // Pages that look like math. With `transcription.math` at `ask`, a run reads them fast first and
    // collects them here; the prompt then asks whether to read them properly.
    const [mathPending, setMathPending] = createSignal<Map<string, number[]>>(new Map())
    const mathSetting = () => settings.transcription.math
    const queue = createTranscribeQueue(async (file, job) => {
        try {
            const math = job.math ?? (mathSetting() === 'careful' ? 'careful' : 'fast')
            const r = await api.transcribe({
                file,
                book: props.basePath,
                ...(job.engine ? { engine: job.engine } : {}),
                ...(job.pages ? { pages: job.pages } : {}),
                ...(job.engine ? {} : { math }),
                // automatic and button runs fill the gaps; a redo replaces the page
                onlyMissing: !job.engine && !job.pages,
            })
            if (r.math?.length && math === 'fast' && mathSetting() === 'ask')
                setMathPending(m => new Map(m).set(file, [...new Set([...(m.get(file) ?? []), ...r.math!])]))
        } catch (e) {
            if (job.engine || job.math) pushToast(e instanceof Error ? e.message : String(e))
        }
        await loadTranscript(file)
    })
    const mathPages = () => [...mathPending().values()].reduce((n, p) => n + p.length, 0)
    // Marker, the local math reader: whether it is installed (asked when the prompt shows), and the
    // install running in the background once a careful read needs it.
    const [markerMissing, setMarkerMissing] = createSignal(false)
    const [installing, setInstalling] = createSignal(false)
    createEffect(() => {
        if (mathPages() === 0) return
        void api.markerSetup().then(s => setMarkerMissing(!s.installed), () => setMarkerMissing(false))
    })
    let installPoll: ReturnType<typeof setInterval> | undefined
    onCleanup(() => clearInterval(installPoll))
    /** Install Marker, then run `then`: a failed install says why and runs it anyway (math pages
     *  then go to ai). */
    const installMarker = (then: () => void) => {
        setInstalling(true)
        const finish = (error?: string) => {
            clearInterval(installPoll)
            setInstalling(false)
            if (error) pushToast(`the math reader did not install: ${error}`)
            then()
        }
        void api.startMarkerSetup().then(
            first => {
                if (first.state === 'done') return finish()
                if (first.state === 'failed') return finish(first.error)
                installPoll = setInterval(() => {
                    void api.markerSetup().then(s => {
                        if (s.job.state === 'done') finish()
                        else if (s.job.state === 'failed') finish(s.job.error)
                    })
                }, 2000)
            },
            e => finish(e instanceof Error ? e.message : String(e)),
        )
    }
    const chooseMath = (choice: MathChoice, remember: boolean) => {
        const pending = mathPending()
        setMathPending(new Map())
        if (remember) setSettings('transcription', 'math', choice)
        if (choice !== 'careful') return
        const reread = () => {
            for (const [file, pages] of pending) queue.add(file, { pages, math: 'careful' })
        }
        if (markerMissing()) installMarker(reread)
        else reread()
    }
    onCleanup(queue.subscribe(() => setQTick(n => n + 1)))
    const snapshot = () => (qTick(), queue.snapshot())
    const transcribing = () => {
        if (props.transcribing) return props.transcribing
        const s = snapshot()
        return s.total > 0 ? { done: Math.min(s.total, s.done + s.runningCount), total: s.total } : undefined
    }
    const autoTranscribe = () => settings.transcription.auto
    const loaded = new Set<string>()
    createEffect(() => {
        for (const r of refs()) {
            if (loaded.has(r.file)) continue
            loaded.add(r.file)
            void loadTranscript(r.file)
        }
    })
    // Automatic transcription tries each file once per session; a page that stays empty then shows the button.
    const autoTried = new Set<string>()
    createEffect(() => {
        if (!autoTranscribe()) return
        const t = transcripts()
        for (const l of leaves()) {
            if (!t.has(l.ref.file) || autoTried.has(l.ref.file) || pageTextOf(l).trim()) continue
            autoTried.add(l.ref.file)
            queue.add(l.ref.file)
        }
    })
    // Pages the built-in reader transcribed before math was looked for keep its garbled formulas.
    // Once per file a session, those that look like math are treated like a fresh run's: asked
    // about (`ask`), re-read (`careful`), or left (`fast`).
    const mathChecked = new Set<string>()
    createEffect(() => {
        const t = transcripts()
        const setting = mathSetting()
        if (setting === 'fast') return
        for (const [file, tr] of t) {
            if (mathChecked.has(file) || tr.engine !== 'on-device') continue
            mathChecked.add(file)
            const pages = tr.pages.filter(p => looksLikeMath(p.text)).map(p => p.page)
            if (pages.length === 0) continue
            if (setting === 'careful') queue.add(file, { pages, math: 'careful' })
            else setMathPending(m => new Map(m).set(file, [...new Set([...(m.get(file) ?? []), ...pages])]))
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
        for (const [f, pages] of byFile) queue.add(f, { pages })
    }
    // Right-click offers one row, `transcribe again with ai`, for the notebook page under the pointer.
    const [redoMenu, setRedoMenu] = createSignal<{ x: number; y: number; leaf: number } | null>(null)
    const redoWithAi = (leafIndex: number) => {
        const l = leaves()[leafIndex]
        if (l) queue.add(l.ref.file, { engine: 'ai', pages: [l.pdfPage ?? 1] })
    }
    const onBoxContextMenu = (e: MouseEvent) => {
        if (mode() !== 'pages' || turn() || armed()) return
        const sp = spread()
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const right = (e.clientX - box.left) / box.width >= 0.5
        const leafIndex = layout() === 'spread' ? (right ? sp.right : sp.left) : (sp.left ?? sp.right)
        if (leafIndex === undefined || !leaves()[leafIndex]) return
        openPageMenu(e, leafIndex)
    }
    /** A page's own rows: fix its text, or read it again with ai. */
    const pageMenuItems = (leafIndex: number): MenuItem[] => [
        { label: 'edit text', icon: 'Pencil', onSelect: () => openTextEditor(leafIndex) },
        { label: 'transcribe again with ai', icon: 'Sparkles', onSelect: () => redoWithAi(leafIndex) },
    ]
    /** Inside a pane the page's rows join the pane's own menu (split, close): one menu every time.
     *  On its own (a story) the book shows them itself. */
    const openPageMenu = (e: MouseEvent, leafIndex: number) => {
        if (host.closest('[data-pane-leaf]')) return addPaneMenuItems(e, pageMenuItems(leafIndex))
        e.preventDefault()
        e.stopPropagation()
        setRedoMenu({ x: e.clientX, y: e.clientY, leaf: leafIndex })
    }
    // The notebook pages on screen: the spread's own leaves, or in text mode the pages its text came from.
    const visibleLeaves = createMemo(() => {
        const s = spread()
        const on = [s.left, s.right].filter((i): i is number => i !== undefined)
        if (mode() !== 'text') return on
        const seen = new Set<number>()
        for (const i of on) for (const line of textPages()[i]?.lines ?? []) seen.add(line.source.leaf)
        return [...seen].sort((a, b) => a - b)
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

    // text highlights: a selection becomes `==marks==` in each notebook page it touches
    let readSelection: TextSpreadReader | undefined
    const markQuotes = async (quotes: BookQuote[], remove = false) => {
        const files = new Set<string>()
        try {
            for (const q of quotes) {
                await api.markTranscript({ file: q.file, page: q.page, ...(remove ? { remove: [q.quote] } : { add: [q.quote] }) })
                files.add(q.file)
            }
        } finally {
            for (const f of files) await loadTranscript(f)
        }
    }
    const highlightSelection = () => {
        const quotes = readSelection?.() ?? []
        if (quotes.length === 0) return false
        window.getSelection()?.removeAllRanges()
        void markQuotes(quotes)
        return true
    }
    const onHighlightClick = () => {
        // text selected: highlight it at once; otherwise arm for the next selection (or a click on a highlight)
        if (mode() === 'text' && !armed() && highlightSelection()) return
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
    const jump = (page: number) => setLeaf(mode() === 'text' ? textPageForLeaf(textPages(), page) : page)
    const firstLeaf = () => visibleLeaves()[0]
    const bookmarksReady = () => {
        const i = firstLeaf()
        const f = i === undefined ? undefined : leaves()[i]?.ref.file
        return !!f && pageStores.get(f)?.loadState() === 'ready'
    }
    const addBookmarkHere = () => {
        const i = firstLeaf()
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
    type Staged = { key: string; kind: 'page'; at: number } | { key: string; kind: 'file'; file: File } | { key: string; kind: 'blank' }
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
        setEditingText(null)
    }
    // a remove's undo only means something while the sorter is open
    let undoToasts: number[] = []
    const closePageEditor = () => {
        for (const id of undoToasts) dismissToast(id)
        undoToasts = []
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
                              : { data: await base64Of(st.file), name: st.file.name },
                    ),
                )
                // unsaved ink or boxes go first, so nothing writes the old page order after
                await flushAnnotationStore(file)
                await api.pdfPages(file, order)
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

    // ── edit text: one notebook page's transcript, by hand ──
    const [editingText, setEditingText] = createSignal<{ leaf: number } | null>(null)
    const [savingText, setSavingText] = createSignal(false)
    const openTextEditor = (leafIndex: number) => {
        if (!leaves()[leafIndex]) return
        setStaged(null)
        setEditingText({ leaf: leafIndex })
    }
    const saveText = async (text: string) => {
        const at = editingText()
        const l = at && leaves()[at.leaf]
        if (!l) return
        setSavingText(true)
        try {
            await api.setTranscriptPage(l.ref.file, l.pdfPage ?? 1, text)
            await loadTranscript(l.ref.file)
            setEditingText(null)
        } catch (e) {
            pushToast(`couldn't save the text: ${(e as Error).message}`)
        } finally {
            setSavingText(false)
        }
    }

    // ── where the reader is, for the caller that opened it ──
    createEffect(() => {
        if (!props.onPosition || leaves().length === 0) return
        if (scrolling()) return props.onPosition({ leaf: cur(), frac: 0 })
        const s = spread()
        if (mode() !== 'text') return props.onPosition({ leaf: s.left ?? s.right ?? 0, frac: 0 })
        const pages = textPages()
        if (pages.length === 0) return
        const at = leafOnTextPages(pages, [s.left, s.right], 0)
        const first = [s.left, s.right].flatMap(i => (i === undefined ? [] : (pages[i]?.lines ?? []))).find(l => l.source.leaf === at)
        const words = untrack(() => wordsOf(at))
        props.onPosition({ leaf: at, frac: first && words ? first.start / words : 0 })
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
                                {scrolling() ? `page ${cur() + 1} // ${leaves().length}` : readoutFor(spread(), count())}
                                {transcribing()
                                    ? ` // transcribing ${transcribing()!.done} of ${transcribing()!.total}`
                                    : installing()
                                      ? ' // setting up the math reader'
                                      : ''}
                            </>,
                        ]}
                    />
                </Show>
            ),
            config: (
                <Show when={leaves().length > 0}>
                    <ReadModeSwitch
                        value={readMode()}
                        onChange={chooseMode}
                        textUnavailable={textAllowed() ? undefined : 'no page is transcribed yet'}
                    />
                </Show>
            ),
            actions: (
                <>
                    <Show when={emptyLeaves().length > 0 && !transcribing()}>
                        <Text as="span" inherit data-bar-drop="3" data-bar-menu-label="transcribe">
                            <TextButton onClick={transcribeAll}>
                                {`transcribe ${emptyLeaves().length} ${emptyLeaves().length === 1 ? 'page' : 'pages'}`}
                            </TextButton>
                        </Text>
                    </Show>
                    <IconButton
                        icon="Highlighter"
                        label="highlight"
                        title={
                            mode() === 'text'
                                ? armed()
                                    ? 'select words to highlight them, click a highlight to remove it (click to cancel, right-click for colours)'
                                    : 'highlight the selected words, or arm it and select (right-click for colours)'
                                : armed()
                                  ? 'drag on a page to highlight a region, click a box to remove it (click to cancel, right-click for colours)'
                                  : 'highlight a region of a page (right-click for colours)'
                        }
                        variant={armed() ? 'selected' : 'unselected'}
                        disabled={leaves().length === 0}
                        onClick={onHighlightClick}
                        onContextMenu={(e: MouseEvent) => {
                            e.preventDefault()
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
                    <Show when={leaves().length > 0}>
                        <BarSettings
                            glyph="Aa"
                            label="display"
                            rows={[
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
            <div class={styles.main}>
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
                            dirty={stagedDirty()}
                            busy={savingPages()}
                            onMove={moveStaged}
                            onRemove={removeStaged}
                            onAddFiles={addStaged}
                            onAddBlank={addBlank}
                            onSave={() => void savePages()}
                            onCancel={closePageEditor}
                        />
                    </Show>
                    <Show when={!staged() && editingText()}>
                        {at => (
                            <TranscriptEditor
                                title={`page ${at().leaf + 1}`}
                                text={untrack(() => pageTextOf(leaves()[at().leaf]))}
                                busy={savingText()}
                                onSave={text => void saveText(text)}
                                onCancel={() => setEditingText(null)}
                            />
                        )}
                    </Show>
                    <Show when={scrolling() && !staged() && !editingText()}>
                        <BookScroll
                            leaves={leaves()}
                            face={l => loader.face(l).then(f => shade(f)!)}
                            aspect={pageAspect()}
                            target={cur()}
                            onPage={setLeaf}
                        />
                    </Show>
                    <div ref={observe} class={styles.stage} classList={{ [styles.hidden]: scrolling() || !!staged() || !!editingText() }}>
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
                                            <Show
                                                when={mode() === 'text'}
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
                                                <TextSpread
                                                    pages={s().faces.text ?? [null, null]}
                                                    layout={layout()}
                                                    pageSize={fit().pageSize}
                                                    textScale={textScale()}
                                                    markColor={markTint()}
                                                    onTurn={turnBy}
                                                    readerRef={read => (readSelection = read)}
                                                    onSelectEnd={() => armed() && highlightSelection() && setArmed(false)}
                                                    onLineContextMenu={openPageMenu}
                                                    fontFamily={family()}
                                                    colors={{ paper: paper(), ink: ink(), muted: muted() }}
                                                    onMarkClick={armed() ? q => void markQuotes([q], true) : undefined}
                                                />
                                            </Show>
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
            <Show when={redoMenu()}>
                {m => (
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        items={pageMenuItems(m().leaf)}
                        onClose={() => setRedoMenu(null)}
                    />
                )}
            </Show>
            {/* asked once the queue is idle, so one prompt covers the whole run */}
            <Show when={mathPages() > 0 && !snapshot().running && snapshot().total === 0}>
                <MathPrompt pages={mathPages()} install={markerMissing()} onChoose={chooseMath} />
            </Show>
        </div>
    )
}

export default BookView
