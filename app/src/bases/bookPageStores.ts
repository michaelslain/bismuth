// The annotation side of an open book: one `createAnnotationStore` per page FILE that is on
// screen (never one per leaf, never one for a page that has been turned away from), the pure
// geometry that says where each shown page sits, a one-shot reader of every page file's sidecar
// for the bookmark list, and the book-wide undo order across those stores.
//
// The stores are made by an injected `make` so this module stays plain TypeScript: BookView hands
// in the real factory (createAnnotationStore under its own root), a test hands in a recorder.
import { createSignal } from 'solid-js'
import { parseDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import { containRect } from '../../../core/src/drawing/pageInk'
import { inkSidecarFor } from '../../../core/src/fileKinds'
import { leafBookmarkTarget } from '../../../core/src/bases/bookBookmarks'
import type { BookLeaf } from '../../../core/src/bases/bookPages'
import type { AnnotationStore } from '../preview/annotationTypes'

export type PageStoreHandle = { store: AnnotationStore; dispose: () => void }

export type PageStores = {
    /** Makes the stores of `files` that are missing and flushes then disposes the ones no longer listed. */
    sync: (files: readonly string[]) => void
    /** The live store of a file, or undefined once it has been turned away from. Reactive. */
    get: (file: string) => AnnotationStore | undefined
    /** The files that have a live store. Reactive. */
    files: () => string[]
    /** Flushes and disposes everything. */
    close: () => Promise<void>
    /** Resolves once every store of `file` that is being retired (flushing, then disposing) has
     *  finished; resolved already when none is. */
    settled: (file: string) => Promise<void>
}

export type PageStoresOptions = {
    /** Called, synchronously, as a file's store is retired (turned away from, or closed). */
    onRetire?: (file: string) => void
}

export function createPageStores(
    make: (file: string) => PageStoreHandle,
    opts: PageStoresOptions = {},
): PageStores {
    const live = new Map<string, PageStoreHandle>()
    const retiring = new Map<string, Promise<void>>()
    const [version, setVersion] = createSignal(0)
    const flushThenDispose = (h: PageStoreHandle): Promise<void> =>
        h.store
            .flush()
            .catch(() => {})
            .then(h.dispose)
    /** Retires a file's store and records it as pending until it has settled. */
    const retire = (file: string, h: PageStoreHandle): Promise<void> => {
        opts.onRetire?.(file)
        const prev = retiring.get(file)
        const mine = flushThenDispose(h)
        const p = prev ? Promise.all([prev, mine]).then(() => {}) : mine
        retiring.set(file, p)
        void p.then(() => {
            if (retiring.get(file) === p) retiring.delete(file)
        })
        return p
    }

    return {
        sync(files) {
            const want = new Set(files)
            let changed = false
            for (const [file, h] of [...live]) {
                if (want.has(file)) continue
                live.delete(file)
                void retire(file, h)
                changed = true
            }
            for (const file of want) {
                if (live.has(file)) continue
                live.set(file, make(file))
                changed = true
            }
            if (changed) setVersion(v => v + 1)
        },
        get(file) {
            version()
            return live.get(file)?.store
        },
        files() {
            version()
            return [...live.keys()]
        },
        async close() {
            const all = [...live]
            live.clear()
            setVersion(v => v + 1)
            await Promise.all(all.map(([file, h]) => retire(file, h)))
        },
        settled: file => retiring.get(file) ?? Promise.resolve(),
    }
}

/** Every distinct page file's sidecar, read once each and in parallel; a missing or unreadable one is null. */
export async function readSidecars(
    files: readonly string[],
    read: (path: string) => Promise<string>,
): Promise<Map<string, DrawingDoc | null>> {
    const distinct = [...new Set(files)]
    const docs = await Promise.all(
        distinct.map(async file => {
            try {
                const text = await read(inkSidecarFor(file))
                return text.trim() ? parseDoc(text) : null
            } catch {
                return null
            }
        }),
    )
    return new Map(distinct.map((f, i) => [f, docs[i]]))
}

/** A page of the still spread: whose store it edits, which sidecar page, and where its image sits. */
export type PageSlot = {
    leaf: number
    file: string
    /** 0-based page in the sidecar. */
    docPage: number
    /** The image's natural size; only its aspect matters. */
    nat: { w: number; h: number }
    /** Where the image paints, in the book box's pixels. */
    rendered: { left: number; top: number; w: number; h: number }
}

/** The pages on screen with the box each paints into. `pageSize` is one page, `sizes` the natural size of each face. */
export function pageSlots(args: {
    spread: { left?: number; right?: number }
    layout: 'spread' | 'single'
    pageSize: { w: number; h: number }
    leaves: readonly BookLeaf[]
    sizes: { left?: { w: number; h: number }; right?: { w: number; h: number } }
}): PageSlot[] {
    const { spread, layout, pageSize, leaves, sizes } = args
    const out: PageSlot[] = []
    const add = (leaf: number | undefined, nat: { w: number; h: number } | undefined, x: number) => {
        const l = leaf === undefined ? undefined : leaves[leaf]
        if (leaf === undefined || !l || !nat || !(nat.w > 0 && nat.h > 0)) return
        const target = leafBookmarkTarget(l)
        out.push({
            leaf,
            file: target.file,
            docPage: target.page,
            nat,
            rendered: containRect({ left: x, top: 0, w: pageSize.w, h: pageSize.h }, nat.w, nat.h),
        })
    }
    if (layout === 'spread') {
        add(spread.left, sizes.left, 0)
        add(spread.right, sizes.right, pageSize.w)
    } else add(spread.right, sizes.right, 0)
    return out
}

/** Mod+Z order across the stores of the pages on screen: the file edited last is undone first. */
export function createEditHistory() {
    const done: string[] = []
    const undone: string[] = []
    const step = (from: string[], to: string[], get: (file: string) => AnnotationStore | undefined, redo: boolean) => {
        while (from.length) {
            const file = from.pop()!
            const store = get(file)
            if (!store) continue
            if (redo) store.redo()
            else store.undo()
            to.push(file)
            return true
        }
        return false
    }
    const drop = (list: string[], file: string) => {
        for (let i = list.length - 1; i >= 0; i--) if (list[i] === file) list.splice(i, 1)
    }
    return {
        record(file: string) {
            done.push(file)
            undone.length = 0
        },
        /** Drops every entry of `file`: its store was retired, so undoing it would pop a dead entry. */
        forget(file: string) {
            drop(done, file)
            drop(undone, file)
        },
        undo: (get: (file: string) => AnnotationStore | undefined) => step(done, undone, get, false),
        redo: (get: (file: string) => AnnotationStore | undefined) => step(undone, done, get, true),
    }
}
