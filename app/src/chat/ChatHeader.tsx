// app/src/chat/ChatHeader.tsx — the chat view's toolbar, as a component.
//
// SESSION-DRIVEN (daemon-chat plan, Task 3): ONE `session: ChatSession` — the registry-backed
// controller (chat/chatSession.ts) that outlives this component's own mount/unmount.
//
// IDENTITY + READOUTS ONLY (final-findings Group 2 #5, design #5 — ruling: adopted). Config
// (provider/model/effort/permission mode) and Actions (auth/history/new chat) used to also spread
// onto this ViewBar, making the header a dense strip of 8+ controls with
// the amber `Bypass` picker the loudest thing on the surface (Acceptance: "the header is a dense
// strip of 8+ controls"). They live in exactly ONE place now: the quiet `<ChatControls session/>`
// row rendered via `ChatComposerBar`'s `below` slot, under the composer — shared verbatim by the
// chat tab and the daemon page, so both surfaces show one composer + one quiet controls row and
// never two. This component places only `ChatReadouts`.
import type { Component } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import type { ChatSession } from './chatSession'
import { ChatReadouts } from './ChatControls'
import styles from './ChatHeader.module.css'

export type ChatHeaderProps = {
    /** The pane title — the tab's custom name, else the session title, else the persona. */
    title: string
    /** Daemon-vs-user glyph, mirroring the tab strip's icon. */
    originIcon: string
    session: ChatSession
    /** Merged onto the bar, so one caller can adjust one instance without forking this. */
    class?: string
}

const ChatHeader: Component<ChatHeaderProps> = props => {
    return (
        <ViewBar
            class={props.class}
            parts={{ identity: styles.identity, readouts: styles.readouts }}
            identity={
                <Crumb icon={props.originIcon} class={styles.crumb}>
                    {props.title}
                </Crumb>
            }
            readouts={<ChatReadouts session={props.session} />}
        />
    )
}

export default ChatHeader
