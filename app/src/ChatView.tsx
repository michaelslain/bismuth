// app/src/ChatView.tsx
// The chat TAB (`::chat:<id>`) — a VISUAL Claude Code. A thin composition over the session registry:
// the `/chat` WebSocket, transcript, draft, queue and every picker's state live in
// `chat/chatSession.ts` (one session per retained chat id, kept alive by App's
// `retainChatSessions` effect — see chat/chatSessions.ts), so this view is disposable. It renders
// INLINE in PaneContent; a tab or pane switch unmounts it while the session, its streaming turn and
// its draft carry on in the registry. Nothing here opens a socket or holds conversation state.
//
// Composition, top to bottom: the tinted drop-target host → `ChatHeader` (title crumb + readouts
// only) → `chat/ChatSessionBody` (variant "pane": the setup/refusal gate, the transcript with its
// greeting centred in the 680px reading column when empty, the history panel, and the shared composer
// bar with `ChatControls` as its quiet `below` row). The one frame before App's effect has retained
// this chat's session renders the header-less shell: the body with `session={undefined}`, which
// hands anything typed to the session the moment it arrives. Composer focus is the body's job.
import { Show, type JSX } from 'solid-js'
import styles from './ChatView.module.css'
import EmptyState from './ui/EmptyState'
import DropCue from './ui/DropCue'
import InlineCode from './ui/InlineCode'
import ChatHeader from './chat/ChatHeader'
import ChatTurnColumn from './chat/ChatTurnColumn'
import ChatSessionBody from './chat/ChatSessionBody'
import { createChatDropTarget } from './chat/createChatDropTarget'
import { chatSession } from './chat/chatSessions'
import { chatColor } from './chatColors'
import { chatTitle, resolveChatHeaderTitle } from './chatTitles'
import { chatPersonaName } from './daemonIdentity'
import { chatOrigin, chatOriginIcon } from './chatOrigin'
import { chatBusy, chatComposing, chatSpeaking } from './chatActivity'
import { chatAvatarMood } from './chat/chatAvatar'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'

export type ChatViewProps = {
    /** The bare chat id (no `::chat:` prefix) — the registry key of this tab's session. */
    chatId: string
    /** The owning tab's user-set name, if any — keeps the pane header in sync with the tab chip. */
    tabName?: () => string | undefined
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
}

export function ChatView(props: ChatViewProps): JSX.Element {
    let host: HTMLDivElement | undefined
    const session = () => chatSession(props.chatId)
    // The bot's face on the transcript's lowest assistant row animates by this chat's liveness.
    const avatarMood = () =>
        chatAvatarMood({
            busy: chatBusy(props.chatId),
            speaking: chatSpeaking(props.chatId),
            composing: chatComposing(props.chatId),
        })
    const drop = createChatDropTarget(
        () => props.chatId,
        () => host,
    )

    const persona = () => session()?.persona() ?? chatPersonaName() ?? 'Claude'
    // Same precedence the TAB uses: the user-set tab name, else the session's backend title, else
    // the daemon persona / "Chat".
    const title = () =>
        resolveChatHeaderTitle(
            props.tabName?.(),
            chatTitle(props.chatId),
            chatPersonaName() ?? 'Chat',
        )

    return (
        <div
            class={styles.chatTab}
            ref={host}
            // Per-chat pane tint: wash the chosen colour into the host background so the whole
            // surface reads as that colour, and expose it as --chat-tint so the transcript's
            // surfaces blend against it (ChatView.module.css) instead of floating as opaque boxes.
            data-chat-tint={chatColor(props.chatId)}
            style={
                chatColor(props.chatId)
                    ? {
                          background: `color-mix(in srgb, ${chatColor(props.chatId)} 50%, var(--bg))`,
                          '--chat-tint': chatColor(props.chatId),
                      }
                    : undefined
            }
            onDragOver={drop.onDragOver}
            onDragLeave={drop.onDragLeave}
            onDrop={drop.onDrop}
        >
            <DropCue active={drop.dragActive()} />
            <Show when={session()}>
                {s => (
                    <ChatHeader
                        title={title()}
                        originIcon={chatOriginIcon(chatOrigin(props.chatId))}
                        session={s()}
                    />
                )}
            </Show>
            <ChatSessionBody
                variant="pane"
                session={session()}
                placeholder={`Message ${persona()}`}
                persona={persona()}
                avatarMood={avatarMood()}
                empty={
                    <ChatTurnColumn>
                        <EmptyState>
                            Ask {persona()} anything about your vault. Run any{' '}
                            <InlineCode>/command</InlineCode>, watch tool calls
                            and thinking, and approve tool use inline.
                        </EmptyState>
                    </ChatTurnColumn>
                }
                noteNames={props.noteNames}
                memoryNames={props.memoryNames}
                tagNames={props.tagNames}
            />
        </div>
    )
}

export default ChatView
