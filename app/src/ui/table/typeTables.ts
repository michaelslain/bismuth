// app/src/ui/table/typeTables.ts — mounts a MarkdownTable onto every table inside rendered markdown
// HTML: a chat bubble, a base card face, a markdown property, a `.md` transclusion. Those bodies are
// HTML STRINGS (renderMarkdown / renderNoteBody → innerHTML), which cannot hold a Solid component,
// so each `<table>` — a callout's included — is adopted AFTER the string lands, one Solid root per
// table, in the table's own place.
import { createEffect, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import MarkdownTable from './MarkdownTable'

/** Mount a MarkdownTable onto every table under `host`. Returns a disposer for those roots. */
export function typeTables(host: HTMLElement): () => void {
    const disposers: (() => void)[] = []
    for (const table of Array.from(host.querySelectorAll('table'))) {
        if (table.closest('[data-markdown-table]')) continue
        // `display: contents`, so the frame lays out as if it sat where the table did
        const mount = document.createElement('div')
        mount.style.display = 'contents'
        table.replaceWith(mount)
        // A component is a function of its props: called directly (no JSX), so this stays a plain
        // .ts module.
        disposers.push(render(() => MarkdownTable({ table }), mount))
    }
    return () => disposers.forEach(d => d())
}

/** In a component whose element takes rendered markdown through `innerHTML`: type its tables each
 *  time `source` changes. Call it AFTER the element is built, so the effect runs after the
 *  `innerHTML` binding and tears its roots down before the next pass. */
export function createTypedTables(
    host: () => HTMLElement | undefined,
    source: () => unknown,
): void {
    createEffect(() => {
        void source()
        const el = host()
        if (el) onCleanup(typeTables(el))
    })
}
