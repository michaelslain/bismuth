// app/src/preview/createAnnotationStore.ts
// The ONE owner of a binary's `.draw` sidecar while its preview is open (annotationTypes.ts's
// AnnotationStore). Moved verbatim out of PageInk.tsx, which used to run this persistence
// inline: `api.read` on path change, a 600ms debounced `api.saveDrawing`, flush-then-reload on
// a path switch, flush on cleanup, and a registerSidecarFlush hook keyed by the binary so
// FileTree's move/delete protocol can await a pending save before it acts. Extracted so ink,
// highlights and bookmarks (task 3/4) can all edit through one debounce/undo/writer instead of
// each component running its own.
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
import { emptyDoc, parseDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import { pushToast } from '../Toast'
import { registerSidecarFlush } from '../editorRegistry'
import type { AnnotationLoadState, AnnotationStore } from './annotationTypes'

/** Same debounce DrawingPage uses for a `.draw` file. */
const SAVE_DELAY = 600

/** A sidecar created by the in-place surface: blank paper (the source IS the surface), and no
 *  embedded image — see the contract in PageInk.tsx's header. */
const freshDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    return d
}

export default function createAnnotationStore(
    sidecarPath: Accessor<string>,
    binaryPath: Accessor<string>,
): AnnotationStore {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(null)
    const [loadState, setLoadState] =
        createSignal<AnnotationLoadState>('loading')

    // ── Persistence ─────────────────────────────────────────────────────────────────────────
    let loadedPath = ''
    let loadToken = 0
    let dirty = false
    let saveTimer: ReturnType<typeof setTimeout> | undefined

    // Returns a Promise so it can be AWAITED — both by FileTree's flush-before-move/delete
    // protocol (registered below via registerSidecarFlush) and a consumer's own cleanup —
    // rather than merely scheduled.
    const flush = (): Promise<void> => {
        clearTimeout(saveTimer)
        saveTimer = undefined
        if (!dirty) return Promise.resolve()
        const d = untrack(doc)
        if (!d) return Promise.resolve()
        dirty = false
        const path = loadedPath
        return api.saveDrawing(path, d).then(
            () => {},
            (e: unknown) => {
                pushToast(`Couldn't save ink: ${(e as Error).message}`)
            },
        )
    }
    const scheduleSave = () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(flush, SAVE_DELAY)
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
            loadedPath = path
            dirty = false
            resetHistory()
            setDoc(null)
            setLoadState('loading')
            api.read(path).then(
                text => {
                    if (token !== loadToken) return
                    if (text.trim()) {
                        try {
                            setDoc(parseDoc(text))
                        } catch {
                            // Present but not a drawing: paint nothing and write nothing —
                            // the file is only replaced if the user actually draws.
                            console.warn(
                                `[page-ink] ${path} is not a drawing; left untouched until drawn on`,
                            )
                        }
                    }
                    setLoadState('ready')
                },
                () => {
                    if (token === loadToken) setLoadState('failed')
                },
            )
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

    return { doc, loadState, edit, undo, redo, resetHistory, flush }
}
