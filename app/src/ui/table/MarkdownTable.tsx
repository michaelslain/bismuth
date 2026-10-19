// app/src/ui/table/MarkdownTable.tsx — MarkdownTable.module.css is the ONLY importer of its module.
// One markdown table inside rendered markdown HTML: a chat message, a base card face, a markdown
// property, a `.md` transclusion. Those bodies are HTML strings, so the `<table>` already exists when
// this mounts: it is handed in and adopted, not rebuilt (typeTables.ts does the adopting). It is the
// same table a note renders — typeTable.ts types its grid, breaks its code paths, keeps its column
// alignment and gives it the shared cell rules (global.css's "Markdown tables" section). What is this
// component's own is the frame: a table too wide for its host squeezes to fit (fitTable.ts), and the
// frame scrolls sideways only as a fallback for content that cannot break, never widening the host.
import { onCleanup, onMount, type Component } from 'solid-js'
import { watchFitTable } from './fitTable'
import { watchScrollFade } from './scrollFade'
import { typeTable } from './typeTable'
import styles from './MarkdownTable.module.css'

export type MarkdownTableProps = {
    /** The rendered markdown `<table>`, adopted into the frame as-is. */
    table: HTMLTableElement
    class?: string
}

const MarkdownTable: Component<MarkdownTableProps> = props => {
    let frame!: HTMLDivElement
    onMount(() => {
        const typed = typeTable(props.table)
        onCleanup(() => typed.dispose())
        onCleanup(watchScrollFade(frame))
        onCleanup(
            watchFitTable(frame, props.table, frame.parentElement ?? frame),
        )
    })
    return (
        <div
            ref={frame}
            class={`${styles['frame']} ${props.class ?? ''}`}
            data-markdown-table
        >
            {props.table}
        </div>
    )
}

export default MarkdownTable
