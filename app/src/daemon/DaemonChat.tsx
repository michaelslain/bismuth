// app/src/daemon/DaemonChat.tsx — DaemonChat.tsx is the ONLY importer of DaemonChat.module.css.
// The daemon page's centre-column chat: the shared chat/ChatSessionBody (variant "column": the
// transcript only once the conversation has items — no empty greeting, the face above is the
// greeting — `flush` so its turn column shares the composer's and controls row's left edge
// (Acceptance, design #4), over the composer bar with ChatControls as one quiet row).
// `props.session` is undefined before a trusted gesture arms the daemon chat (daemonChatArming.ts)
// — the composer renders IDENTICALLY either way (Acceptance: "pixel-identical before and after
// it is clicked… clicking only focuses it"); `onGesture` is wired straight through to the composer
// box's own pointerdown/focusin, the one thing DaemonPageHost needs from this component.
//
// A gate refusal / missing-CLI dead end replaces the transcript when a session can't run; the
// composer stays visible below it either way.
//
// Fills whatever height DaemonHub.module.css's `.chatRegion`/`.chatFill` gives it: content-height
// while resting (composer + controls, nothing above), full column height while conversing (the
// transcript scrolls, the composer stays pinned to the bottom).
import type { JSX } from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import ChatSessionBody from '../chat/ChatSessionBody'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import { DAEMON_CHAT_ID } from '../tabIds'
import type { DaemonMood } from './daemonFaceModel'
import styles from './DaemonChat.module.css'

export type DaemonChatProps = {
    /** undefined until a trusted gesture arms the chat (daemonChatArming.ts). */
    session: ChatSession | undefined
    /** The daemon's display name — composer placeholder `Message <name>` and assistant turn label. */
    name: string
    /** The daemon's full mood (DaemonPageHost's), shown by its face on the transcript's lowest
     *  assistant row — so hurt / alert / asleep reach the conversation, not just thinking/talking. */
    mood?: DaemonMood
    /** Trusted-gesture hook for arming: forwarded to ChatComposerBar's own pointerdown/focusin. */
    onGesture: (e: PointerEvent | FocusEvent) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    class?: string
}

export default function DaemonChat(props: DaemonChatProps): JSX.Element {
    return (
        <div
            class={`${styles.chat} ${props.class ?? ''}`}
            data-chat-surface
        >
            {/* data-testid ONLY: a stable, test-only hook so a story can assert the composer's box
                rect + placeholder are pixel-identical before and after the arming gesture, without
                reaching into ChatComposerBar's own (foreign) module for a class name. */}
            <ChatSessionBody
                variant="column"
                session={props.session}
                placeholder={`Message ${props.name}`}
                persona={props.name}
                avatarMood={props.mood}
                noteNames={props.noteNames}
                memoryNames={props.memoryNames}
                tagNames={props.tagNames}
                onGesture={props.onGesture}
                chatId={DAEMON_CHAT_ID}
                composerTestId="daemon-chat-composer"
            />
        </div>
    )
}
