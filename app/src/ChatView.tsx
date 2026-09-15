// app/src/ChatView.tsx
// The chat TAB (`::chat:<id>`) — a VISUAL Claude Code. A thin composition over the session registry:
// the `/chat` WebSocket, transcript, draft, queue and every picker's state live in
// `chat/chatSession.ts` (one session per retained chat id, kept alive by App's
// `retainChatSessions` effect — see chat/chatSessions.ts), so this view is disposable. It renders
// INLINE in PaneContent; a tab or pane switch unmounts it while the session, its streaming turn and
// its draft carry on in the registry. Nothing here opens a socket or holds conversation state.
//
// Composition, top to bottom: the tinted drop-target host → `ChatHeader` (title crumb + readouts
// only) → a setup/refusal dead end via `chat/ChatSetupGate` when the chat cannot run → otherwise
// `ChatTranscript` (the greeting centred and capped to the 680px reading column when empty) and the
// shared `ChatComposerBar`, with `ChatControls` as its quiet `below` row.
//
// The one frame before App's effect has retained this chat's session renders the header-less shell:
// an empty body and the composer bar in its `session={undefined}` mode, which hands anything typed
// to the session the moment it arrives.
//
// FOCUS IS THE VIEW'S JOB, not the session's (chat/chatSession.ts never touches the DOM) — answered
// by chat/createComposerFocus.ts, shared with DaemonChat.
import { createSignal, Show, type JSX } from 'solid-js'
import styles from './ChatView.module.css'
import EmptyState from './ui/EmptyState'
import ChatHeader from './chat/ChatHeader'
import ChatTranscript from './chat/ChatTranscript'
import ChatTurnColumn from './chat/ChatTurnColumn'
import ChatComposerBar from './chat/ChatComposerBar'
import ChatControls from './chat/ChatControls'
import ChatSetupGate from './chat/ChatSetupGate'
import { createComposerFocus } from './chat/createComposerFocus'
import { createChatDropTarget } from './chat/createChatDropTarget'
import { chatSession } from './chat/chatSessions'
import type { ChatSession } from './chat/chatSession'
import type { ComposerHandle } from './ChatComposer'
import { chatColor } from './chatColors'
import { chatTitle, resolveChatHeaderTitle } from './chatTitles'
import { chatPersonaName } from './daemonIdentity'
import { chatOrigin, chatOriginIcon } from './chatOrigin'
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

/** The composer bar + its quiet controls row — identical whether or not a session exists yet, so
 *  ChatView can render it both in the pre-session frame and once a session (blocked or not) is
 *  live, without two copies of the same JSX drifting apart. */
function ChatComposerSection(props: {
    session: ChatSession | undefined
    placeholder: string
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    onReady: (handle: ComposerHandle) => void
}) {
    return (
        <div class={styles.composer}>
            <ChatComposerBar
                session={props.session}
                placeholder={props.placeholder}
                noteNames={props.noteNames}
                memoryNames={props.memoryNames}
                tagNames={props.tagNames}
                onReady={props.onReady}
                below={<ChatControls session={props.session} />}
            />
        </div>
    )
}

export function ChatView(props: ChatViewProps): JSX.Element {
    let host: HTMLDivElement | undefined
    const [composer, setComposer] = createSignal<ComposerHandle>()
    const session = () => chatSession(props.chatId)
    const drop = createChatDropTarget(session, () => host)

    const persona = () =>
        session()?.persona() ?? chatPersonaName() ?? 'Claude'
    // Same precedence the TAB uses: the user-set tab name, else the session's backend title, else
    // the daemon persona / "Chat".
    const title = () =>
        resolveChatHeaderTitle(
            props.tabName?.(),
            chatTitle(props.chatId),
            chatPersonaName() ?? 'Chat',
        )

    createComposerFocus(session, composer)

    const reply = (text: string) => session()?.quoteReply(text)

    return (
        <div
            class={styles.host}
            classList={{ [styles['drop-active']]: drop.dragActive() }}
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
            <Show when={session()}>
                {s => (
                    <ChatHeader
                        title={title()}
                        originIcon={chatOriginIcon(chatOrigin(props.chatId))}
                        session={s()}
                    />
                )}
            </Show>
            <Show
                when={session()}
                fallback={
                    <>
                        <div class={styles.pending} />
                        <ChatComposerSection
                            session={undefined}
                            placeholder={`Message ${persona()}`}
                            noteNames={props.noteNames}
                            memoryNames={props.memoryNames}
                            tagNames={props.tagNames}
                            onReady={setComposer}
                        />
                    </>
                }
            >
                {s => (
                    <ChatSetupGate session={s()}>
                        <ChatTranscript
                            items={s().transcript}
                            persona={s().persona()}
                            awaitingReply={s().awaitingReply()}
                            turnError={s().turnError()}
                            empty={
                                <ChatTurnColumn>
                                    <EmptyState>
                                        Ask {persona()} anything about your
                                        vault. Run any <code>/command</code>,
                                        watch tool calls and thinking, and
                                        approve tool use inline.
                                    </EmptyState>
                                </ChatTurnColumn>
                            }
                            onAnswerPermission={s().answerPermission}
                            onAnswerQuestion={s().answerQuestion}
                            onCancelQueued={s().cancelQueued}
                            onReply={reply}
                            subscribeAppend={s().onAppend}
                        />
                        <ChatComposerSection
                            session={session()}
                            placeholder={`Message ${persona()}`}
                            noteNames={props.noteNames}
                            memoryNames={props.memoryNames}
                            tagNames={props.tagNames}
                            onReady={setComposer}
                        />
                    </ChatSetupGate>
                )}
            </Show>
        </div>
    )
}

export default ChatView
