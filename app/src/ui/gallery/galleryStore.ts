// app/src/ui/gallery/galleryStore.ts
// A global, promise-based launcher for the SymbolGallery — so imperative call sites
// that live OUTSIDE the Solid reactive tree (notably CodeMirror completion `apply`
// handlers) can pop a gallery and await the picked value. Mirrors the Toast pattern:
// a single global signal drives one host mounted near the app root.
import { createSignal } from 'solid-js'
import { setGalleryOpen } from './galleryState'
import type { GallerySource } from './types'

type Pending = {
    source: GallerySource
    current?: string
    title?: string
    resolve: (value: string | null) => void
}

const [pending, setPending] = createSignal<Pending | null>(null)

/**
 * Open a gallery and resolve with the picked value, or `null` if dismissed.
 * Safe to call from anywhere (no Solid owner required) — it just sets a signal.
 * Only one gallery shows at a time; opening a second resolves the first as dismissed.
 */
export function openGallery(opts: {
    source: GallerySource
    current?: string
    title?: string
}): Promise<string | null> {
    return new Promise(resolve => {
        // Set the Solid-free flag BEFORE `setPending` renders the modal. `setPending` runs Solid's
        // render synchronously, and SymbolGallery's `onMount` steals focus (its search box) IN THAT SAME
        // call — blurring the table cell's nested editor and firing its `focusout` before control returns
        // here. The cell's teardown guard reads `isGalleryOpen()` in that focusout, so the flag must
        // already be true or the cell tears down (destroying the editor the deferred insert targets) —
        // the whole point of the guard (#49). Setting it first makes the ordering race-free.
        setGalleryOpen(true)
        setPending(prev => {
            prev?.resolve(null)
            return { ...opts, resolve }
        })
    })
}

/** The queue the host renders. Internal to the gallery pair — exported only so GalleryHost.tsx can
 *  read and clear it; nothing else should touch it. */
export { pending, setPending }
export type { Pending }

