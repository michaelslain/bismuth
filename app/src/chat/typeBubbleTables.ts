// app/src/chat/typeBubbleTables.ts — mounts a ChatTable onto every markdown table inside a rendered
// chat bubble. The bubble's body is an HTML STRING (renderNoteBody → innerHTML), which cannot hold a
// Solid component, and the same renderer feeds notes, cards and exports where nothing could mount
// one — so each `<table>` is adopted by a ChatTable AFTER the string lands, one Solid root per table,
// in the table's own place. ChatTable types it as the shared markdown table and frames it.
import { render } from 'solid-js/web'
import ChatTable from './ChatTable'

/** Mount a ChatTable onto every table under `host`. Returns a disposer for those roots. */
export function typeBubbleTables(host: HTMLElement): () => void {
    const disposers: (() => void)[] = []
    for (const table of Array.from(host.querySelectorAll('table'))) {
        // `display: contents`, so the frame lays out as if it sat where the table did
        const mount = document.createElement('div')
        mount.style.display = 'contents'
        table.replaceWith(mount)
        // A component is a function of its props: called directly (no JSX), so this stays a plain
        // .ts module.
        disposers.push(render(() => ChatTable({ table }), mount))
    }
    return () => disposers.forEach(d => d())
}
