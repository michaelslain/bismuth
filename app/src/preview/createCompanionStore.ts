// app/src/preview/createCompanionStore.ts
// The ONE owner of a binary's companion note (`<file>.md`) while its preview is open
// (annotationTypes.ts's CompanionStore) — the tags frontmatter strip (CompanionFrontmatter.tsx)
// and the scratch-note blocks (task 2's ScratchTextLayer) both edit through it, so there is one
// reader, one debounced writer and one conflict path for that file.
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
    // The full last-known-on-disk text (frontmatter + body), used both as api.writeChecked's
    // `baseText` and as shouldWriteCompanionDoc's "does a companion already exist" signal.
    let existingRaw = ''
    // The hand-written portion of the body (companionDoc.ts's body, minus scratch regions) —
    // never edited by this store, only carried through a write untouched.
    let bodyRest = ''
    let dirty = false
    let loadToken = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined

    /** Replace all loaded state from a disk read (initial load, or a conflict's `current`) and
     *  bump `revision` so a view keyed on it (task 2's per-block editors) re-seeds. */
    const applyLoadedText = (text: string) => {
        existingRaw = text
        const split = splitCompanion(text)
        const parsed = parseScratch(split.body)
        bodyRest = parsed.rest
        setFrontmatterText(split.frontmatter || EMPTY_FRONTMATTER)
        setBlocks(parsed.blocks)
        setRevision(r => r + 1)
    }

    // Returns a Promise so it can be AWAITED — both by FileTree's flush-before-move/delete
    // protocol (registered below via registerSidecarFlush) and a consumer's own cleanup — rather
    // than merely scheduled.
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
        if (!shouldWriteCompanionDoc(existingRaw, nextFrontmatter, nextBlocks))
            return Promise.resolve()
        const baseText = existingRaw
        // A companion missing until now, written only because a block carries text, still gets a
        // real frontmatter fence rather than none at all.
        const frontmatterOut = nextFrontmatter || EMPTY_FRONTMATTER
        const joined = joinCompanion(
            frontmatterOut,
            serializeScratch(bodyRest, nextBlocks),
        )
        return api.writeChecked(path, joined, baseText).then(
            res => {
                if (token !== loadToken) return // a different binary loaded meanwhile
                if (res.conflict) {
                    applyLoadedText(res.current)
                    pushToast(
                        `${path.split('/').pop()} changed elsewhere — reloaded its notes.`,
                    )
                    return
                }
                existingRaw = joined
            },
            (e: unknown) => {
                if (token !== loadToken) return
                dirty = true // the edit is still live in memory — retry on the next debounce
                pushToast(`Couldn't save notes: ${(e as Error).message}`)
            },
        )
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
                    existingRaw = ''
                    bodyRest = ''
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
