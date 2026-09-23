// app/src/icons/iconLibrary.ts
//
// Loads the full icon library (assets/icons/icon-library.json — every Phosphor Regular icon, see
// registry.ts) on demand, and exposes ONE Solid signal that flips when it lands, so every <Icon>
// and the picker's search re-render with no per-call-site wiring.
//
// Who triggers the load: <Icon> when it meets a name outside the 140 canonical ones (a note's
// `icon: Books`), iconMarkup for the same in imperative code, and the icon picker's source when it
// opens. The app's own chrome only ever uses the 140, so a vault that never picks a library icon
// never downloads the chunk.
//
// A failed load (a chunk missing from a stale build) settles to `failed`, and a pending name then
// draws the dashed fallback like any unknown name — never an empty box forever.
import { createSignal } from 'solid-js'
import {
    allIconNames,
    iconLibraryInstalled,
    installIconLibrary,
    type IconLibraryJson,
} from './registry'

export type IconLibraryState = 'idle' | 'loading' | 'loaded' | 'failed'

const [state, setState] = createSignal<IconLibraryState>(
    iconLibraryInstalled() ? 'loaded' : 'idle',
)

/** Reactive load state. Read it inside a computation to re-run when the library lands. */
export const iconLibraryState = state

let inflight: Promise<void> | null = null

/** Load + install the library once; later calls share the same promise. Never rejects. */
export function loadIconLibrary(): Promise<void> {
    if (iconLibraryInstalled()) {
        if (state() !== 'loaded') setState('loaded')
        return Promise.resolve()
    }
    if (inflight) return inflight
    setState('loading')
    inflight = import('../assets/icons/icon-library.json')
        .then(mod => {
            // JSON imports type rows as string[][]; the generator writes [name, body, terms].
            installIconLibrary(mod.default as unknown as IconLibraryJson)
            setState('loaded')
        })
        .catch(err => {
            console.error('[icons] could not load the icon library', err)
            setState('failed')
            inflight = null
        })
    return inflight
}

/** `allIconNames()` for autocomplete, starting the library load on first use — the first completion
 *  offers the 140 canonical names, and every one after the chunk lands offers the whole library. */
export function completionIconNames(): string[] {
    void loadIconLibrary()
    return allIconNames()
}
