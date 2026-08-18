// app/src/Backlinks.tsx
// The one net-new piece of the editor redesign: notes that link to the open note, rendered
// below the prose column (mounted by FileView.tsx). Collapsed-empty — renders nothing when the
// open note has no backlinks, so it costs zero layout when absent. Derivation is pure + unit
// tested (backlinkGraph.ts); this component is just the fetch + render shell.
import { Show, createMemo, createResource } from 'solid-js'
import { api } from './api'
import type { GraphData } from '../../core/src/graph'
import { deriveBacklinks, pathToNoteId } from './backlinkGraph'
import { AsciiTree } from './ui/ascii/AsciiTree'
import './ui/ui.css'
import './Backlinks.css'

const EMPTY_GRAPH: GraphData = { nodes: [], edges: [] }

export function Backlinks(props: {
    path: string
    onOpen: (path: string) => void
}) {
    // Re-fetch per open note (the graph payload can change as the vault does), matching the
    // "already-fetched /graph data" the spec describes — this component owns its own fetch
    // rather than reaching into App.tsx's graph signal (out of this lane's file boundary).
    const [graph] = createResource(
        () => props.path,
        () => api.graph().catch(() => EMPTY_GRAPH),
    )
    const entries = createMemo(() =>
        deriveBacklinks(graph() ?? EMPTY_GRAPH, pathToNoteId(props.path)),
    )

    return (
        <Show when={entries().length > 0}>
            <div class="backlinks">
                <span class="asc-eyebrow">BACKLINKS {entries().length}</span>
                <AsciiTree
                    class="backlinks-tree"
                    rows={entries().map(e => ({ id: e.id, label: e.label }))}
                    onSelect={id => props.onOpen(`${id}.md`)}
                />
            </div>
        </Show>
    )
}
