// app/src/chat/ChatHeader.tsx — the chat view's toolbar, as a component.
//
// SESSION-DRIVEN (daemon-chat plan, Task 3): ONE `session: ChatSession` — the registry-backed
// controller (chat/chatSession.ts) that outlives this component's own mount/unmount. The actual
// control markup (readouts/config/actions) lives in `chatControlSlots()` (ChatControls.tsx), shared
// with the daemon page's quiet inline row — this file's only job is the identity crumb + wiring
// those three regions into ViewBar, plus the bar-scoped register in `../ChatHeader.module.css`
// (crumb width cap, readout gap, the transparent picker triggers).
//
// THE TWO POPOVERS (history/auth) are owned by ChatControls.tsx + ChatHistoryPanel.tsx/
// ChatAuthPanel.tsx — this component doesn't render or know about them at all.
import type { JSX } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import type { ChatSession } from './chatSession'
import { chatControlSlots } from './ChatControls'
import styles from '../ChatHeader.module.css'

export type ChatHeaderProps = {
    /** The pane title — the tab's custom name, else the session title, else the persona. */
    title: string
    /** Daemon-vs-user glyph, mirroring the tab strip's icon. */
    originIcon: string
    session: ChatSession
    /** Merged onto the bar, so one caller can adjust one instance without forking this. */
    class?: string
}

export default function ChatHeader(props: ChatHeaderProps): JSX.Element {
    return (
        <ViewBar
            class={`${styles['chat-header']} ${props.class ?? ''}`}
            identity={<Crumb icon={props.originIcon}>{props.title}</Crumb>}
            {...chatControlSlots(props.session)}
        />
    )
}
