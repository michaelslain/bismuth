// app/src/preview/createCompanionStore.ts
// The ONE owner of a binary's companion note (`<file>.md`) while its preview is open
// (annotationTypes.ts's CompanionStore) — the tags frontmatter strip (CompanionFrontmatter.tsx)
// and the scratch-note blocks (ScratchTextLayer) both edit through it, so there is one reader, one
// debounced writer and one conflict path for that file.
//
// Moved out of CompanionFrontmatter.tsx, which used to run this persistence inline for the
// frontmatter half only: `api.read` on path change, debounced by `settings.editor.autoSaveDelay`,
// `api.writeChecked` against the last-known disk text, conflict -> reload + toast,
// `registerSidecarFlush` so FileTree's move/delete protocol can await a pending save, flush on
// path switch / window blur / beforeunload / pagehide / cleanup. This store keeps that shape and
// adds the scratch-block half: the file's BODY (everything after the frontmatter fence,
// companionDoc.ts's splitCompanion) is parsed/serialized by core/src/scratchNotes.ts, and a save
// writes frontmatter + blocks together — never two separate writes racing each other.
//
// Must be called under a Solid owner (a component body, or createRoot) — it registers effects and
// cleanup that need somewhere to be disposed.
import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import { api } from '../api'
import { companionPathFor } from '../../../core/src/fileKinds'
import {
    EMPTY_FRONTMATTER,
    joinCompanion,
    shouldWriteCompanionDoc,
    splitCompanion,
} from './companionDoc'
import {
    newScratchId,
    parseScratch,
    serializeScratch,
} from '../../../core/src/scratchNotes'
import type { ScratchBlock } from '../../../core/src/scratchTypes'
import type { AnnotationLoadState, CompanionStore } from './annotationTypes'
import { pushToast } from '../Toast'
import { settings } from '../settings'
import { registerSidecarFlush } from '../editorRegistry'

export default function createCompanionStore(
    binaryPath: Accessor<string>,
): CompanionStore {
    const [frontmatterText, setFrontmatterText] =
        createSignal(EMPTY_FRONTMATTER)
    const [blocks, setBlocks] = createSignal<ScratchBlock[]>([])
    const [loadState, setLoadState] =
        createSignal<AnnotationLoadState>('loading')
    const [revision, setRevision] = createSignal(0)

    let companionPath = ''
    // The RAW frontmatter as actually read from disk — '' when the file has none, never coerced
    // to EMPTY_FRONTMATTER the way `frontmatterText` (the display/edit signal) is. Used at write
    // time so a companion whose frontmatter was genuinely absent doesn't gain the template fence
    // merely because BLOCKS changed underneath it (see `frontmatterEdited` below).
    let loadedFrontmatterRaw = ''
    // The hand-written portion of the body (companionDoc.ts's body, minus scratch regions) —
    // never edited by this store, only carried through a write untouched.
    let bodyRest = ''
    let dirty = false
    // True only once the user has actually called setFrontmatter this load — distinguishes "the
    // frontmatter itself was edited" from "blocks changed and dirty happened to be true too",
    // which matters for the missing-frontmatter case above. Reset on every load.
    let frontmatterEdited = false
    let loadToken = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    // The write-ordering chain: resolves to the text NOW on disk, best as this store knows it — the
    // one signal `flushSave` reads for both "does a companion already exist" and a write's
    // `baseText`. A flush that fires while a previous one is still in flight chains onto this
    // rather than reading any synchronously-captured "what's on disk" variable, so both decisions
    // see the PRIOR write's outcome — fixing a self-conflict where two debounced saves both
    // captured the same stale base and the second one's write against it always read as a (fake)
    // conflict, and fixing a second flush wrongly treating a companion as still-missing while an
    // earlier create-write for it is still in flight. Reset on every load (a new load supersedes
    // whatever chain the previous one was mid-write on).
    let pendingBaseText: Promise<string> = Promise.resolve('')

    /** Replace all loaded state from a disk read (initial load, or a conflict's `current`) and
     *  bump `revision` so a view keyed on it (ScratchTextLayer's per-block editors) re-seeds. */
    const applyLoadedText = (text: string) => {
        pendingBaseText = Promise.resolve(text)
        const split = splitCompanion(text)
        const parsed = parseScratch(split.body)
        loadedFrontmatterRaw = split.frontmatter
        bodyRest = parsed.rest
        frontmatterEdited = false
        setFrontmatterText(split.frontmatter || EMPTY_FRONTMATTER)
        setBlocks(parsed.blocks)
        setRevision(r => r + 1)
    }

    // Returns a Promise so it can be AWAITED — both by FileTree's flush-before-move/delete
    // protocol (registered below via registerSidecarFlush) and a consumer's own cleanup — rather
    // than merely scheduled.
    //
    // `path` and this flush's BODY content (`nextFrontmatter`, `nextBlocks`, `serializedBody`) are
    // captured SYNCHRONOUSLY, right here — that is what makes the path-switch flush
    // (registerSidecarFlush's onCleanup call, below) correct: `companionPath`/`frontmatterText()`/
    // `blocks()` are single shared variables the NEXT binary's load effect reassigns synchronously
    // and immediately after cleanup runs, so capturing them any later would risk this flush
    // silently writing the wrong (new) binary's edit to the wrong (old) path, or vice versa. Only
    // whether a companion "already exists" and which frontmatter to write back — both of which
    // need to reflect a PRIOR write's result, not just "whatever's true right now" — are decided
    // from `baseText`, threaded through `pendingBaseText` and read once this flush's turn in that
    // chain arrives (see the comment inside the `.then` below for why a synchronously-captured
    // "what's on disk" snapshot is the wrong signal for that).
    const flushSave = (): Promise<void> => {
        clearTimeout(saveTimer)
        saveTimer = undefined
        if (!dirty) return Promise.resolve()
        // A read that failed (403, network error — NOT a missing file, which GET /file answers
        // with 200 + '' and is the ordinary "no companion yet" case) never writes: risking a
        // clobber of a file this session never actually saw is worse than dropping the edit.
        if (loadState() !== 'ready') return Promise.resolve()
        dirty = false
        const path = companionPath
        const token = loadToken
        const nextFrontmatter = frontmatterText()
        const nextBlocks = blocks()
        // The BODY half of what a write would contain is safe to build now: it only depends on
        // this flush's own captured `nextBlocks`/`bodyRest`, never on what's landing on disk from
        // an earlier flush still in flight. What ISN'T safe to decide yet is whether a companion
        // "already exists" and which frontmatter to write back — those must be read from the text
        // actually on disk AHEAD of this flush in the write chain (`baseText`, below), not from a
        // variable captured at this flush's own call time: any such snapshot only updates once an
        // earlier write's own `.then` callback runs, so a flush issued while that earlier write is
        // still in flight would otherwise see the stale pre-write state and could wrongly conclude
        // "still missing, nothing worth writing" — silently dropping an edit (e.g. clearing a
        // block) that should have overwritten what the first write is about to create.
        const serializedBody = serializeScratch(bodyRest, nextBlocks)

        const run: Promise<string> = pendingBaseText.then(baseText => {
            if (!shouldWriteCompanionDoc(baseText, nextFrontmatter, nextBlocks))
                return baseText
            // A companion missing until now, written only because a block carries text, still
            // gets a real frontmatter fence rather than none at all (`baseText === ''`).
            // Otherwise — the companion already exists on disk ahead of this flush — write
            // EMPTY_FRONTMATTER/`nextFrontmatter` only if the user actually edited the
            // frontmatter THIS load; if only blocks changed and the file genuinely had no
            // frontmatter fence, write it back out exactly as absent (`loadedFrontmatterRaw`),
            // rather than letting the display signal's EMPTY_FRONTMATTER default leak into the
            // file.
            const frontmatterOut =
                frontmatterEdited || baseText === ''
                    ? nextFrontmatter || EMPTY_FRONTMATTER
                    : loadedFrontmatterRaw
            const joined = joinCompanion(frontmatterOut, serializedBody)
            // A no-op in disguise (e.g. a blank block added then removed before this flush ran,
            // or added and left untyped — serializeScratch drops blank blocks either way): the
            // bytes this save would write are identical to what's already on disk, so skip the
            // round trip rather than sending a write (and touching mtime/history) for nothing.
            if (joined === baseText) return baseText
            return api.writeChecked(path, joined, baseText).then(
                res => {
                    // A different binary loaded meanwhile: still report what THIS write produced
                    // so the chain stays coherent for anyone still awaiting it, but never let a
                    // stale result touch the CURRENT load's displayed state.
                    if (token !== loadToken)
                        return res.conflict ? res.current : joined
                    if (res.conflict) {
                        applyLoadedText(res.current)
                        pushToast(
                            `${path.split('/').pop()} changed elsewhere — reloaded its notes.`,
                        )
                        return res.current
                    }
                    return joined
                },
                (e: unknown) => {
                    if (token === loadToken) {
                        dirty = true // the edit is still live in memory — retry on next debounce
                        pushToast(`Couldn't save notes: ${(e as Error).message}`)
                    }
                    return baseText
                },
            )
        })
        pendingBaseText = run
        return run.then(() => undefined)
    }
    const scheduleSave = () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(flushSave, settings.editor.autoSaveDelay)
    }

    createEffect(
        on(binaryPath, path => {
            const token = ++loadToken
            companionPath = companionPathFor(path)
            dirty = false
            setLoadState('loading')
            api.read(companionPath).then(
                text => {
                    if (token !== loadToken) return
                    applyLoadedText(text)
                    setLoadState('ready')
                },
                () => {
                    if (token !== loadToken) return
                    pendingBaseText = Promise.resolve('')
                    loadedFrontmatterRaw = ''
                    bodyRest = ''
                    frontmatterEdited = false
                    setFrontmatterText(EMPTY_FRONTMATTER)
                    setBlocks([])
                    setRevision(r => r + 1)
                    setLoadState('failed')
                },
            )
            // Register this binary's flush with the global registry so FileTree's
            // flush-before-move/delete protocol (flushSidecarsAtOrUnder) can find and await it —
            // this writer has no EditorView, so it takes no part in the CodeMirror-only flushers
            // otherwise.
            const unregister = registerSidecarFlush(path, flushSave)
            // Flush the OLD path's pending edit (if any) before switching to the new one, and on
            // unmount — mirrors createAnnotationStore.ts's identical lifecycle. Unregister AFTER
            // the flush settles (not before), so a flush FileTree triggers mid-teardown can still
            // find this entry.
            onCleanup(() => {
                void flushSave().then(unregister)
            })
        }),
    )

    // Every other way a debounce window can end badly (PageInk's list, minus the pane-focus
    // specifics — this store has no separate "draw mode" to exit).
    createEffect(() => {
        window.addEventListener('blur', flushSave)
        window.addEventListener('beforeunload', flushSave)
        window.addEventListener('pagehide', flushSave)
        onCleanup(() => {
            window.removeEventListener('blur', flushSave)
            window.removeEventListener('beforeunload', flushSave)
            window.removeEventListener('pagehide', flushSave)
        })
    })

    const setFrontmatter = (text: string) => {
        setFrontmatterText(text)
        frontmatterEdited = true
        dirty = true
        scheduleSave()
    }
    const addBlock = (b: Omit<ScratchBlock, 'id'>): string => {
        const id = newScratchId(blocks().map(x => x.id))
        setBlocks(prev => [...prev, { ...b, id }])
        dirty = true
        scheduleSave()
        return id
    }
    const updateBlock = (
        id: string,
        patch: Partial<Omit<ScratchBlock, 'id'>>,
    ) => {
        setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))
        dirty = true
        scheduleSave()
    }
    const removeBlock = (id: string) => {
        setBlocks(prev => prev.filter(b => b.id !== id))
        dirty = true
        scheduleSave()
    }

    return {
        loadState,
        frontmatter: frontmatterText,
        setFrontmatter,
        blocks,
        revision,
        addBlock,
        updateBlock,
        removeBlock,
        flush: flushSave,
    }
}
