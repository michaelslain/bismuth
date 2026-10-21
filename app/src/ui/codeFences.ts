// app/src/ui/codeFences.ts — mounts a CodeFence onto every fenced code block inside rendered
// markdown HTML (a chat message). The body is an HTML STRING (renderNoteBody → innerHTML), which
// cannot hold a Solid component, so each `<pre>` is adopted AFTER the string lands, one Solid root
// per fence, in the fence's own place — the same move typeTables.ts makes for tables.
import { createEffect, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import CodeFence from './CodeFence'

/** Mount a CodeFence onto every `<pre>` under `host`. Returns a disposer for those roots. */
export function codeFences(host: HTMLElement): () => void {
    const disposers: (() => void)[] = []
    for (const pre of Array.from(host.querySelectorAll('pre'))) {
        if (pre.closest('[data-code-fence]')) continue
        // `display: contents`, so the fence lays out as if it sat where the `<pre>` did
        const mount = document.createElement('div')
        mount.style.display = 'contents'
        pre.replaceWith(mount)
        // Called directly (no JSX), so this stays a plain .ts module.
        disposers.push(render(() => CodeFence({ pre }), mount))
    }
    return () => disposers.forEach(d => d())
}

/** In a component whose element takes rendered markdown through `innerHTML`: give its fences a
 *  CodeFence each time `source` changes. Call it AFTER the element is built, so the effect runs
 *  after the `innerHTML` binding and tears its roots down before the next pass. */
export function createCodeFences(
    host: () => HTMLElement | undefined,
    source: () => unknown,
): void {
    createEffect(() => {
        void source()
        const el = host()
        if (el) onCleanup(codeFences(el))
    })
}
