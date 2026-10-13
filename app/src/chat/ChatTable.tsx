// app/src/chat/ChatTable.tsx — ChatTable.module.css is the ONLY importer of its module.
// One markdown table inside a chat message. The bubble's body is an HTML string, so the `<table>`
// already exists when this mounts: it is handed in and adopted, not rebuilt. It is the same table a
// note renders — ui/table/typeTable.ts types its grid, breaks its code paths and gives it the shared
// cell rules (global.css's "Markdown tables" section) for the note editor and chat alike. What is
// chat's own is the frame: a table whose narrowest layout is still wider than the transcript scrolls
// sideways inside it, never widening the transcript.
import { onCleanup, onMount, type Component } from 'solid-js'
import { watchScrollFade } from '../ui/table/scrollFade'
import { typeTable } from '../ui/table/typeTable'
import styles from './ChatTable.module.css'

export type ChatTableProps = {
    /** The rendered markdown `<table>`, adopted into the frame as-is. */
    table: HTMLTableElement
    class?: string
}

const ChatTable: Component<ChatTableProps> = props => {
    let frame!: HTMLDivElement
    onMount(() => {
        const typed = typeTable(props.table)
        onCleanup(() => typed.dispose())
        onCleanup(watchScrollFade(frame))
    })
    return (
        <div
            ref={frame}
            class={`${styles['frame']} ${props.class ?? ''}`}
            data-chat-table
        >
            {props.table}
        </div>
    )
}

export default ChatTable
