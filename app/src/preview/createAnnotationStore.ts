// app/src/preview/createAnnotationStore.ts
// The ONE owner of a binary's `.draw` sidecar while its preview is open (annotationTypes.ts's
// AnnotationStore). Moved verbatim out of PageInk.tsx, which used to run this persistence
// inline: `api.read` on path change, a 600ms debounced `api.saveDrawing`, flush-then-reload on
// a path switch, flush on cleanup, and a registerSidecarFlush hook keyed by the binary so
// FileTree's move/delete protocol can await a pending save before it acts. Extracted so ink,
// highlights and bookmarks (task 3/4) can all edit through one debounce/undo/writer instead of
// each component running its own.
//
// WHERE A PDF'S HIGHLIGHTS SAVE. The doc in memory always holds them (so undo/redo, HighlightLayer,
// extend-on-overlap and dark mode work one way), but for a PDF they are stored IN THE PDF: a flush
// diffs them against the last saved/loaded PDF set (highlightSaveDiff.ts) and sends the edits
// through `api.editPdfHighlights`, and the sidecar is written WITHOUT any `highlights` key, only
// when its other content changed. A sidecar that still holds highlights is moved into the PDF once,
// on open (`api.migratePdfHighlights`). A PDF Bismuth cannot rewrite (encrypted, signed; the server
// answers 409 PDF_NOT_WRITABLE) keeps them in the sidecar exactly as an image does
// (`highlightStore() === 'sidecar'`). PdfPages hands the PDF's own highlights over through
// `setPdfHighlights`.
//
// A highlight Bismuth makes (or extends) keeps its in-memory id after a save. The PDF knows it by
// `pdfHighlightId` over the quads of its rects, so each successful add records that id
// (`Session.fileIds`) and a later REMOVE is sent under it; an id with no record is translated from
// the rects the PDF was last given for it.
//
// In sidecar mode on a PDF, the highlights other apps embedded in it show next to the sidecar's
// (`Session.pdfOnly`) and `saveSidecar` keeps them out of the file.
//
// A migrate on open races the document PdfPages is loading, which may have been read before the
// move. Whichever of the migrate answer and the document's highlight report lands first, the doc
// ends up holding the report plus every moved highlight it lacks, matched by the id the PDF stores
// each under (`withMigrated`). `highlightsSettled` turns true once that report is taken in.
//
// Must be called under a Solid owner (a component body, or createRoot) — it registers effects
// and cleanup that need somewhere to be disposed.
import {
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    untrack,
} from 'solid-js'
import type { Accessor } from 'solid-js'
import { api } from '../api'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
    type Highlight,
    type HighlightRect,
} from '../../../core/src/drawing/model'
import {
    ensurePages,
    fitImage,
    pageBoxFor,
} from '../../../core/src/drawing/pageInk'
import { resolveHighlightColor } from '../../../core/src/drawing/pageHighlights'
import { PDF_HIGHLIGHT_YELLOW } from '../../../core/src/theme/tokens'
import type {
    PdfHighlightEdits,
    PdfPageGeom,
} from '../../../core/src/drawing/pdfHighlights'
import { pushToast } from '../ui/ToastHost'
import { registerSidecarFlush } from '../editorRegistry'
import { cancelSelfWrite, expectSelfWrite } from './pdfDocCache'
import {
    applyEditsToPages,
    diffHighlights,
    isEmptyEdits,
} from './highlightSaveDiff'
import type { AnnotationLoadState, AnnotationStore } from './annotationTypes'

/** Same debounce DrawingPage uses for a `.draw` file. */
const SAVE_DELAY = 600
/** A save that keeps failing retries at 600ms, doubling, up to this. */
const RETRY_CAP = 30000

/** A sidecar created by the in-place surface: blank paper (the source IS the surface), and no
 *  embedded image — see the contract in PageInk.tsx's header. */
const freshDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    return d
}

const isPdfPath = (p: string) => /\.pdf$/i.test(p)

/** The doc's highlights per page (index = page), the shape the diff works on. */
const highlightsOf = (d: DrawingDoc): Highlight[][] =>
    d.pages.map(p => p.highlights ?? [])

/** `d` without any highlight — what a PDF's sidecar holds. */
function stripHighlights(d: DrawingDoc): DrawingDoc {
    return {
        ...d,
        pages: d.pages.map(p => {
            if (!p.highlights) return p
            const { highlights: _gone, ...rest } = p
            return rest
        }),
    }
}

/** The default highlight colour is stored as the hex it resolves to in a PDF; in memory it stays
 *  'hl', so a new highlight still extends one read back from the file. */
const inMemoryColor = (h: Highlight): Highlight =>
    h.c.toLowerCase() === PDF_HIGHLIGHT_YELLOW.toLowerCase() ? { ...h, c: 'hl' } : h

/** `d` with its highlights replaced by `pages` (index = page); a PDF page past `pages` has none. */
function withPdfHighlights(d: DrawingDoc, pages: Highlight[][]): DrawingDoc {
    const base = ensurePages(d, pages.length)
    return {
        ...base,
        pages: base.pages.map((p, i) => {
            const hs = (pages[i] ?? []).map(inMemoryColor)
            if (hs.length) return { ...p, highlights: hs }
            if (!p.highlights) return p
            const { highlights: _gone, ...rest } = p
            return rest
        }),
    }
}

/** `d` without the highlights whose id is in `pages` (index = page). */
function withoutHighlightIds(d: DrawingDoc, pages: Highlight[][]): DrawingDoc {
    const ids = new Set(pages.flat().map(h => h.id))
    if (ids.size === 0) return d
    return {
        ...d,
        pages: d.pages.map(p => {
            if (!p.highlights?.some(h => ids.has(h.id))) return p
            const hs = p.highlights.filter(h => !ids.has(h.id))
            if (hs.length) return { ...p, highlights: hs }
            const { highlights: _gone, ...rest } = p
            return rest
        }),
    }
}

/** `d` plus every highlight of `pages` (index = page) whose id `d` does not already hold. */
function withForeignHighlights(d: DrawingDoc, pages: Highlight[][]): DrawingDoc {
    const have = new Set(d.pages.flatMap(p => (p.highlights ?? []).map(h => h.id)))
    if (!pages.some(p => p.some(h => !have.has(h.id)))) return d
    const base = ensurePages(d, pages.length)
    return {
        ...base,
        pages: base.pages.map((p, i) => {
            const extra = (pages[i] ?? []).filter(h => !have.has(h.id))
            return extra.length
                ? { ...p, highlights: [...(p.highlights ?? []), ...extra] }
                : p
        }),
    }
}

type Box = { x: number; y: number; w: number; h: number }

/** A rect in box `from` re-expressed in box `to`: what the migrate route does to a sidecar
 *  highlight when the sidecar's page box is not the PDF's fit box (core/src/pdfHighlightStore.ts). */
const rebox = (r: HighlightRect, from: Box, to: Box): HighlightRect => ({
    x: to.x + (r.x - from.x) * (to.w / from.w),
    y: to.y + (r.y - from.y) * (to.h / from.h),
    w: r.w * (to.w / from.w),
    h: r.h * (to.h / from.h),
})

type PdfHighlightsModule = typeof import('../../../core/src/drawing/pdfHighlights')

/** The sidecar highlights a migrate on open moved into the PDF (index = page), with the sidecar
 *  they came from (its page boxes) — kept until the open document's report takes them in. */
type Migrated = {
    from: DrawingDoc
    pages: Highlight[][]
    mod: PdfHighlightsModule
}

/** A save that meets a PDF the server cannot rewrite (409 PDF_NOT_WRITABLE) or does not have
 *  (404 ENOENT: a backend without that file) falls back to the sidecar. The HTTP transport throws
 *  `Error(<response text>)` and the response text is the AppError's message, so the match is on
 *  the code (a thrown AppError, as the fake transport does) or on that message. */
function isNotWritable(e: unknown): boolean {
    const code = (e as { code?: unknown } | null)?.code
    const text = `${typeof code === 'string' ? code : ''} ${
        e instanceof Error ? e.message : String(e)
    }`
    return /PDF_NOT_WRITABLE|cannot be rewritten|ENOENT|not found:/i.test(text)
}

/** Everything one loaded file's saves need, so a save still running when the path switches keeps
 *  working against the file it started on. */
type Session = {
    sidecar: string
    binary: string
    mode: 'pdf' | 'sidecar'
    /** The PDF's highlights as last loaded from or saved to it (index = page). */
    saved: Highlight[][]
    /** The serialized highlight-free doc last known to be in the sidecar (PDF mode). */
    sidecarKey: string | null
    /** Highlights made here -> the id the PDF stores them under, for the ones whose rects changed
     *  after they were read from the PDF (an extend keeps the old in-memory id). */
    fileIds: Map<string, string>
    /** Highlights that live in the PDF only (sidecar mode on a PDF Bismuth cannot rewrite): shown
     *  from the doc, never written to the sidecar. */
    pdfOnly: Highlight[][] | null
    /** Moved from the sidecar on open; the first PDF report afterwards is merged with them. */
    migrated: Migrated | null
}

/** Saves still running per sidecar path. A store that mounts (a tab returning) waits for the
 *  previous store's saves of its sidecar before it reads it, so it never reads a stale copy. */
const pendingSaves = new Map<string, Promise<void>>()

export type AnnotationStoreOptions = {
    /** Called with the PDF's highlights as of each successful save into it (index = page). */
    onPdfSaved?: (pages: Highlight[][]) => void
    /** The geometry (pdf.js `page.view` + `/Rotate`) of a 0-based page, for translating a
     *  Bismuth-made highlight's id to the one the PDF gives it. Absent or undefined = keep the id. */
    pageGeom?: (page: number) => PdfPageGeom | undefined
}

export default function createAnnotationStore(
    sidecarPath: Accessor<string>,
    binaryPath: Accessor<string>,
    opts?: AnnotationStoreOptions,
): AnnotationStore {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(null)
    const [loadState, setLoadState] =
        createSignal<AnnotationLoadState>('loading')
    const [highlightStore, setHighlightStore] = createSignal<'pdf' | 'sidecar'>(
        'sidecar',
    )
    const [highlightsSettled, setHighlightsSettled] = createSignal(false)

    // ── Persistence ─────────────────────────────────────────────────────────────────────────
    let loadToken = 0
    let dirty = false
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let session: Session = {
        sidecar: '',
        binary: '',
        mode: 'sidecar',
        saved: [],
        sidecarKey: null,
        fileIds: new Map(),
        pdfOnly: null,
        migrated: null,
    }
    // Saves run one after another: two overlapping read-modify-writes of one PDF would lose edits.
    let saveChain: Promise<void> = Promise.resolve()
    let saving = 0
    // The PDF's highlights that arrived (setPdfHighlights) before the sidecar finished loading.
    let pendingPdf: Highlight[][] | null = null

    const setMode = (sess: Session, mode: 'pdf' | 'sidecar') => {
        sess.mode = mode
        if (sess === session) setHighlightStore(mode)
    }

    const saveSidecar = (sess: Session, d: DrawingDoc): Promise<void> =>
        api.saveDrawing(
            sess.sidecar,
            sess.pdfOnly ? withoutHighlightIds(d, sess.pdfOnly) : d,
        ).then(
            () => {},
            (e: unknown) => {
                pushToast(`Couldn't save ink: ${(e as Error).message}`)
            },
        )

    /** The id the PDF stores `h` under, or undefined when the page geometry is not known. */
    const fileIdOf = (
        m: typeof import('../../../core/src/drawing/pdfHighlights'),
        page: number,
        h: Highlight,
    ): string | undefined => {
        const g = opts?.pageGeom?.(page)
        if (!g) return undefined
        return m.pdfHighlightId(
            page,
            m.rectsToQuads(h.rects, g),
            resolveHighlightColor(h.c).toLowerCase(),
        )
    }

    /** `edits` with every remove translated to the id the PDF knows the highlight by. */
    async function withPdfIds(
        sess: Session,
        edits: PdfHighlightEdits,
    ): Promise<PdfHighlightEdits> {
        if (edits.remove.length === 0) return edits
        const m = await import('../../../core/src/drawing/pdfHighlights')
        return {
            ...edits,
            remove: edits.remove.map(r => {
                const known = sess.fileIds.get(r.id)
                if (known) return { ...r, id: known }
                if (r.id.startsWith('pdf-')) return r
                const h = sess.saved[r.page]?.find(x => x.id === r.id)
                const id = h ? fileIdOf(m, r.page, h) : undefined
                return id ? { ...r, id } : r
            }),
        }
    }

    /** Backoff state for a save that keeps failing for a reason other than a conflict. */
    let failStreak = false
    let retryDelay = SAVE_DELAY

    /** One save of `d`. Never rejects. */
    async function persist(sess: Session, d: DrawingDoc): Promise<void> {
        if (sess.mode === 'sidecar') return saveSidecar(sess, d)
        const next = highlightsOf(d)
        const edits = diffHighlights(sess.saved, next)
        if (!isEmptyEdits(edits)) {
            try {
                const sent = await withPdfIds(sess, edits)
                expectSelfWrite(sess.binary)
                await api.editPdfHighlights(sess.binary, sent)
                failStreak = false
                retryDelay = SAVE_DELAY
                sess.saved = next
                // An add whose id the PDF will not keep (a Bismuth-made one, or an extended one)
                // is known by the id the PDF gives it from now on.
                const m = await import('../../../core/src/drawing/pdfHighlights')
                for (const a of edits.add) {
                    const id = fileIdOf(m, a.page, a.highlight)
                    if (id) sess.fileIds.set(a.highlight.id, id)
                }
                opts?.onPdfSaved?.(
                    next.map(p => p.map(h => ({ ...h, id: sess.fileIds.get(h.id) ?? h.id }))),
                )
            } catch (e) {
                // The write failed, so the server publishes no change for it: disarm the gate or
                // it would swallow the next real external change.
                cancelSelfWrite(sess.binary)
                if (isNotWritable(e)) {
                    // Everything, highlights included, goes to the sidecar from here on. The
                    // highlights the PDF already holds stay out of the sidecar.
                    sess.pdfOnly = sess.saved
                    setMode(sess, 'sidecar')
                    return saveSidecar(sess, d)
                }
                // One toast per streak of failures, not one per retry.
                if (!failStreak) pushToast(`Couldn't save highlights: ${(e as Error).message}`)
                failStreak = true
                // Neither store has the edit yet: keep it pending and retry with backoff.
                if (sess === session) {
                    dirty = true
                    scheduleSave(retryDelay)
                    retryDelay = Math.min(retryDelay * 2, RETRY_CAP)
                }
            }
        }
        const stripped = stripHighlights(d)
        const key = serializeDoc(stripped)
        if (key === sess.sidecarKey) return
        sess.sidecarKey = key
        return saveSidecar(sess, stripped)
    }

    // Returns a Promise so it can be AWAITED — both by FileTree's flush-before-move/delete
    // protocol (registered below via registerSidecarFlush) and a consumer's own cleanup —
    // rather than merely scheduled. It settles once every earlier save has too.
    const flush = (): Promise<void> => {
        clearTimeout(saveTimer)
        saveTimer = undefined
        if (dirty) {
            const d = untrack(doc)
            dirty = false
            if (d) {
                const sess = session
                saving++
                saveChain = saveChain
                    .then(() => persist(sess, d))
                    .catch(() => {})
                    .finally(() => {
                        saving--
                    })
                pendingSaves.set(sess.sidecar, saveChain)
                const mine = saveChain
                void mine.then(() => {
                    if (pendingSaves.get(sess.sidecar) === mine)
                        pendingSaves.delete(sess.sidecar)
                })
            }
        }
        return saveChain
    }
    const scheduleSave = (delay = SAVE_DELAY) => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(flush, delay)
    }

    /** Takes the PDF's highlights as the doc's, with no undo entry and a fresh history. */
    const applyPdfHighlights = (pages: Highlight[][]) => {
        const cur = untrack(doc)
        resetHistory()
        // Every id in the doc is now the PDF's own.
        session.fileIds.clear()
        if (!cur && pages.every(p => p.length === 0)) {
            session.saved = []
            return
        }
        const next = withPdfHighlights(cur ?? freshDoc(), pages)
        session.saved = highlightsOf(next)
        setDoc(next)
    }

    /** Sidecar mode on a PDF: the PDF's own highlights show next to the sidecar's, without an undo
     *  entry, and `saveSidecar` keeps them out of the file. */
    const applyForeignHighlights = (pages: Highlight[][]) => {
        const cur = untrack(doc)
        const prev = session.pdfOnly
        session.pdfOnly = pages
        if (!cur && pages.every(p => p.length === 0)) return
        const base = (cur && prev ? withoutHighlightIds(cur, prev) : cur) ?? freshDoc()
        const next = withForeignHighlights(base, pages)
        if (next !== cur) setDoc(next)
    }

    /** `pages` (a PDF report) plus each migrated highlight it does not hold, matched by the id the
     *  PDF stores it under: a document read before the move and one read after it give the same
     *  set. A page whose geometry is unknown keeps the sidecar's rects and ids as they are. */
    const withMigrated = (mig: Migrated, pages: Highlight[][]): Highlight[][] =>
        pages.map((hs, i) => {
            const moved = mig.pages[i]
            if (!moved?.length) return hs
            const g = opts?.pageGeom?.(i)
            const have = new Set(hs.map(h => h.id))
            const asPdf = moved.map(h => {
                if (!g) return h
                const nat = mig.mod.pageNatSize(g)
                const own = pageBoxFor(mig.from, i, nat.w, nat.h)
                const fit = fitImage(nat.w, nat.h)
                const rects = h.rects.map(r => rebox(r, own, fit))
                const id = mig.mod.pdfHighlightId(i, mig.mod.rectsToQuads(rects, g))
                return { ...h, rects, id }
            })
            return [...hs, ...asPdf.filter(h => !have.has(h.id))]
        })

    /** Merges a pending migrate into a PDF report, once; the merged set is what the PDF holds, so
     *  a returning tab's cached document is handed it too. */
    const takeMigrated = (sess: Session, pages: Highlight[][]): Highlight[][] => {
        const mig = sess.migrated
        if (!mig) return pages
        sess.migrated = null
        const merged = withMigrated(mig, pages)
        opts?.onPdfSaved?.(merged)
        return merged
    }

    const setPdfHighlights = (pages: Highlight[][]) => {
        const state = untrack(loadState)
        // A cached document reports before the sidecar has loaded: keep it for the end of the load.
        if (state === 'loading') {
            pendingPdf = pages
            return
        }
        if (state !== 'ready') return
        if (session.mode === 'sidecar') {
            if (isPdfPath(session.binary)) applyForeignHighlights(pages)
            setHighlightsSettled(true)
            return
        }
        const token = loadToken
        pages = takeMigrated(session, pages)
        if (!dirty && saving === 0) {
            applyPdfHighlights(pages)
            setHighlightsSettled(true)
            return
        }
        // Unsaved edits: save them first, then show the PDF's set with those edits on top of it
        // (the PDF now holds both, and the reload their save causes is not announced).
        const cur = untrack(doc)
        const mine = cur ? diffHighlights(session.saved, highlightsOf(cur)) : null
        void flush().then(() => {
            if (token !== loadToken) return
            applyPdfHighlights(mine ? applyEditsToPages(pages, mine) : pages)
            setHighlightsSettled(true)
        })
    }

    // ── Undo (session-scoped) ───────────────────────────────────────────────────────────────
    let undoStack: DrawingDoc[] = []
    let redoStack: DrawingDoc[] = []
    const resetHistory = () => {
        undoStack = []
        redoStack = []
    }
    /** Apply a user edit: snapshot for undo, then save. No-op unless a doc has actually loaded
     *  (nothing to draw over yet, or the read failed and drawing is refused) — AND no-op when
     *  `fn` hands back its input unchanged (a caller like `addHighlight` with empty rects, or
     *  `removeHighlight`/`removeBookmark` with an id that isn't there): no undo entry, no dirty
     *  flag, no scheduled save. Without this, a no-op edit on a file with no sidecar yet writes
     *  an empty `.draw` into existence, breaking the "nothing is written until the user actually
     *  edits" contract (chunk-1 review). */
    const edit = (fn: (d: DrawingDoc) => DrawingDoc) => {
        if (untrack(loadState) !== 'ready') return
        // No document yet (no sidecar, or one that was not a drawing): undoing the first stroke
        // goes back to an empty page, not to nothing.
        const cur = untrack(doc) ?? freshDoc()
        const next = fn(cur)
        if (next === cur) return
        undoStack.push(cur)
        redoStack = []
        setDoc(next)
        dirty = true
        scheduleSave()
    }
    const undo = () => {
        const prev = undoStack.pop()
        const cur = untrack(doc)
        if (!prev || !cur) return
        redoStack.push(cur)
        setDoc(prev)
        dirty = true
        scheduleSave()
    }
    const redo = () => {
        const next = redoStack.pop()
        const cur = untrack(doc)
        if (!next || !cur) return
        undoStack.push(cur)
        setDoc(next)
        dirty = true
        scheduleSave()
    }

    // Memoized: `on()` has NO equality check of its own (chunk-1 review) — it re-runs `fn`
    // whenever the accessor it wraps is NOTIFIED, not when the value it returns actually
    // changes. `sidecarPath`/`binaryPath` are caller-supplied accessors that may sit downstream
    // of a signal that fires on every re-render (a parent memo that isn't itself equality-
    // checked); without memoizing here, a re-notify carrying the SAME path string would still
    // flush, reset undo and re-read the sidecar mid-session, silently dropping an edit made
    // during the resulting 'loading' window. `createMemo` gives the primitive-equality check
    // `on(sidecarPath, …)` needs, regardless of what the caller's own accessor does.
    const sidecar = createMemo(sidecarPath)
    const binary = createMemo(binaryPath)

    createEffect(
        on(sidecar, path => {
            const token = ++loadToken
            dirty = false
            pendingPdf = null
            resetHistory()
            setDoc(null)
            setLoadState('loading')
            setHighlightsSettled(false)
            const bin = binary()
            const sess: Session = {
                sidecar: path,
                binary: bin,
                mode: 'sidecar',
                saved: [],
                sidecarKey: null,
                fileIds: new Map(),
                pdfOnly: null,
                migrated: null,
            }
            session = sess
            setHighlightStore('sidecar')
            const finishLoad = async (text: string) => {
                if (token !== loadToken) return
                let parsed: DrawingDoc | null = null
                if (text.trim()) {
                    try {
                        parsed = parseDoc(text)
                    } catch {
                        // Present but unreadable: fail the load so edit() (which no-ops
                        // unless 'ready') can never overwrite the sidecar with a fresh doc.
                        console.warn(`[page-ink] ${path} is not a drawing; left untouched`)
                        setLoadState('failed')
                        return
                    }
                }
                setDoc(parsed)
                if (!isPdfPath(bin)) {
                    setLoadState('ready')
                    setHighlightsSettled(true)
                    return
                }
                // A PDF: its highlights live in the PDF. The sidecar keeps everything else.
                setMode(sess, 'pdf')
                sess.sidecarKey = serializeDoc(stripHighlights(parsed ?? freshDoc()))
                if (parsed?.pages.some(p => p.highlights?.length)) {
                    // The sidecar still holds highlights: move them into the PDF, once. They stay
                    // on screen from the doc until the reloaded PDF hands its own set over.
                    expectSelfWrite(bin)
                    const moved = await api
                        .migratePdfHighlights(bin)
                        .catch(() => ({ moved: 0, writable: false }))
                    if (token !== loadToken) return
                    if (!moved.writable || moved.moved === 0) cancelSelfWrite(bin)
                    if (moved.writable) {
                        // The PDF now holds the sidecar's highlights and its own: show both, from
                        // the document's report whenever it lands (before this, or after).
                        const sidecarSet = highlightsOf(parsed)
                        sess.saved = sidecarSet
                        const mod = await import('../../../core/src/drawing/pdfHighlights')
                        if (token !== loadToken) return
                        sess.migrated = { from: parsed, pages: sidecarSet, mod }
                        if (pendingPdf) {
                            applyPdfHighlights(takeMigrated(sess, pendingPdf))
                            setHighlightsSettled(true)
                        }
                        pendingPdf = null
                    } else {
                        setMode(sess, 'sidecar')
                        if (pendingPdf) {
                            applyForeignHighlights(pendingPdf)
                            setHighlightsSettled(true)
                        }
                        pendingPdf = null
                    }
                } else if (pendingPdf) {
                    applyPdfHighlights(pendingPdf)
                    setHighlightsSettled(true)
                    pendingPdf = null
                }
                setLoadState('ready')
            }
            ;(pendingSaves.get(path) ?? Promise.resolve())
                .then(() => api.read(path))
                .then(finishLoad, () => {
                if (token === loadToken) setLoadState('failed')
            })
            // Register this binary's flush with the global registry so FileTree's
            // flush-before-move/delete protocol (flushSidecarsAtOrUnder) can find and await
            // it — this writer has no EditorView, so it takes no part in the CodeMirror-only
            // flushers otherwise (chunk-1 review).
            const unregister = registerSidecarFlush(binary(), flush)
            // Runs before the next sidecar loads (and on this store's own cleanup): land the
            // old file's edits against the old path while `loadedPath` and `doc` still describe
            // it. Unregister AFTER the flush settles (not before), so a flush FileTree triggers
            // mid-teardown can still find this entry.
            onCleanup(() => {
                void flush().then(unregister)
            })
        }),
    )

    return {
        doc,
        loadState,
        edit,
        undo,
        redo,
        resetHistory,
        flush,
        setPdfHighlights,
        highlightStore,
        highlightsSettled,
    }
}
