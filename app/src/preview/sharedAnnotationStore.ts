// app/src/preview/sharedAnnotationStore.ts
// ONE annotation store per binary for every consumer that has it open. The PDF/image preview and
// an open book both edit the same `<file>.draw` sidecar (and, for a PDF, the highlights inside
// it); two stores over one file clobber each other's whole-doc saves and neither sees the other's
// edits. A consumer `acquire`s the binary's store and `release`s it when done; the last release
// flushes then disposes it.
//
// Each lease may bring its own `pageGeom` (the geometry a PDF's highlight ids are hashed over) and
// `onPdfSaved` (told the PDF's highlights after each save into it). The entry asks every live
// lease's `pageGeom` in order and uses the first answer, and calls EVERY lease's `onPdfSaved`; a
// lease's hooks leave with its `release`. Whoever holds the store, a save into the PDF also tells
// `onSaved` (the real one hands the cached document the saved highlights, since a self-write does
// not invalidate it).
import { createEffect, createRoot, createSignal, untrack } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { Highlight } from '../../../core/src/drawing/model'
import { inkSidecarFor } from '../../../core/src/fileKinds'
import createAnnotationStore, { type AnnotationStoreOptions } from './createAnnotationStore'
import type { AnnotationStore } from './annotationTypes'
import { rememberCachedHighlights } from './pdfDocCache'

export type { AnnotationStoreOptions }

export type AnnotationStoreFactory = (
    sidecarPath: Accessor<string>,
    binaryPath: Accessor<string>,
    opts?: AnnotationStoreOptions,
) => AnnotationStore

export type AnnotationLease = { store: AnnotationStore; release: () => Promise<void> }

type Entry = {
    store: AnnotationStore
    dispose: () => void
    refs: number
    leases: Set<AnnotationStoreOptions>
}

/** The acquire/release pair over a store factory; the real one is `acquireAnnotationStore`. */
export function createStoreShare(
    make: AnnotationStoreFactory,
    onSaved?: (binary: string, pages: Highlight[][]) => void,
) {
    const entries = new Map<string, Entry>()

    function acquire(binary: string, opts: AnnotationStoreOptions = {}): AnnotationLease {
        let entry = entries.get(binary)
        if (!entry) {
            const leases = new Set<AnnotationStoreOptions>()
            const hooks: AnnotationStoreOptions = {
                pageGeom: page => {
                    for (const l of leases) {
                        const g = l.pageGeom?.(page)
                        if (g) return g
                    }
                    return undefined
                },
                onPdfSaved: pages => {
                    onSaved?.(binary, pages)
                    for (const l of [...leases]) l.onPdfSaved?.(pages)
                },
            }
            let made!: { store: AnnotationStore; dispose: () => void }
            createRoot(dispose => {
                made = { store: make(() => inkSidecarFor(binary), () => binary, hooks), dispose }
            })
            entry = { ...made, refs: 0, leases }
            entries.set(binary, entry)
        }
        const e = entry
        e.refs++
        e.leases.add(opts)
        let released = false
        return {
            store: e.store,
            async release() {
                if (released) return
                released = true
                e.leases.delete(opts)
                if (--e.refs > 0) return
                // Gone from the map first: a consumer that acquires while the flush runs gets a
                // fresh store, which waits for this one's saves (createAnnotationStore pendingSaves).
                if (entries.get(binary) === e) entries.delete(binary)
                try {
                    await e.store.flush()
                } catch {
                    // a failed final save is the store's own to report
                } finally {
                    e.dispose()
                }
            },
        }
    }

    /** Saves whatever the live store of `binary` holds unsaved; resolves at once when none is open. */
    async function flush(binary: string): Promise<void> {
        await entries.get(binary)?.store.flush()
    }

    /** The file under `binary`'s store was rewritten (its pages moved): the next acquire gets a
     *  fresh store that reads the file again. Holders keep the old one until they release it, so
     *  flush it before the rewrite. */
    function retire(binary: string): void {
        entries.delete(binary)
    }

    return { acquire, flush, retire, size: () => entries.size }
}

const shared = createStoreShare(createAnnotationStore, rememberCachedHighlights)

/** The shared store of `binary` (a vault path), with the lease that gives it back. */
export function acquireAnnotationStore(binary: string, opts?: AnnotationStoreOptions): AnnotationLease {
    return shared.acquire(binary, opts)
}

const [epochs, setEpochs] = createSignal<ReadonlyMap<string, number>>(new Map())

/** Bumped each time `binary`'s store is retired. A holder reads it where it acquires, so it lets
 *  the old store go and takes a fresh one. Reactive. */
export function storeEpoch(binary: string): number {
    return epochs().get(binary) ?? 0
}

/** Save the open store of `binary` before something else rewrites the file under it. */
export function flushAnnotationStore(binary: string): Promise<void> {
    return shared.flush(binary)
}

/** `binary`'s pages were rewritten: every holder moves to a fresh store that reads the new file. */
export function retireAnnotationStore(binary: string): void {
    shared.retire(binary)
    setEpochs(m => new Map(m).set(binary, (m.get(binary) ?? 0) + 1))
}

/** Resolves once `store` has loaded its sidecar (at once when it already has); rejects when the load failed. */
export function whenReady(store: AnnotationStore): Promise<void> {
    const now = untrack(store.loadState)
    if (now === 'ready') return Promise.resolve()
    if (now === 'failed') return Promise.reject(new Error('annotation store failed to load'))
    return new Promise((resolve, reject) => {
        createRoot(dispose => {
            createEffect(() => {
                const state = store.loadState()
                if (state === 'loading') return
                dispose()
                if (state === 'ready') resolve()
                else reject(new Error('annotation store failed to load'))
            })
        })
    })
}
