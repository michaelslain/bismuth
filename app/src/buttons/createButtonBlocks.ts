// app/src/buttons/createButtonBlocks.ts — mounts a live ButtonBlockView over every
// `[data-bismuth-buttons]` placeholder inside rendered markdown HTML. renderNoteBody emits the
// placeholder (inert `[label]` text, the fence body in the attribute) for every surface; a surface
// that can run buttons adopts them AFTER the string lands, one Solid root per placeholder, the way
// typeTables.ts adopts tables.
import { createEffect, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import type { ButtonHost } from '../../../core/src/buttons/buttonTypes'
import ButtonBlockView from './ButtonBlockView'

/** Mount a ButtonBlockView onto every placeholder under `host`. Returns a disposer for the roots. */
export function mountButtonBlocks(
    host: HTMLElement,
    buttonHost: ButtonHost,
    onSend: (text: string) => void,
): () => void {
    const disposers: (() => void)[] = []
    for (const slot of Array.from(
        host.querySelectorAll<HTMLElement>('[data-bismuth-buttons]'),
    )) {
        const body = slot.getAttribute('data-bismuth-buttons') ?? ''
        slot.textContent = '' // drop the inert row; the live one takes its place
        // Called directly (no JSX) so this stays a plain .ts module.
        disposers.push(
            render(
                () => ButtonBlockView({ host: buttonHost, body, onSend }),
                slot,
            ),
        )
    }
    return () => disposers.forEach(d => d())
}

/** In a component whose element takes rendered markdown through `innerHTML`: make its button
 *  fences live each time `source` changes. `buttonHost` / `onSend` undefined = leave them inert.
 *  Call it AFTER the element is built, so the effect runs after the `innerHTML` binding and tears
 *  its roots down before the next pass. */
export function createButtonBlocks(
    host: () => HTMLElement | undefined,
    source: () => unknown,
    buttonHost: () => ButtonHost | undefined,
    onSend: () => ((text: string) => void) | undefined,
): void {
    createEffect(() => {
        void source()
        const el = host()
        const bh = buttonHost()
        const send = onSend()
        if (el && bh && send) onCleanup(mountButtonBlocks(el, bh, send))
    })
}
