// app/src/ChatView.tsx
// The chat TAB (`::chat:<id>`) — a VISUAL Claude Code. A thin composition over the session registry:
// the `/chat` WebSocket, transcript, draft, queue and every picker's state live in
// `chat/chatSession.ts` (one session per retained chat id, kept alive by App's
// `retainChatSessions` effect — see chat/chatSessions.ts), so this view is disposable. It renders
// INLINE in PaneContent; a tab or pane switch unmounts it while the session, its streaming turn and
// its draft carry on in the registry. Nothing here opens a socket or holds conversation state.
//
// Composition, top to bottom: the tinted drop-target host → `ChatHeader` (title crumb + the shared
// controls) → a setup/refusal dead end via `ChatSetup` when the chat cannot run → otherwise
// `ChatTranscript` (the greeting centred when empty) and the shared `ChatComposerBar`.
//
// The one frame before App's effect has retained this chat's session renders the header-less shell:
// an empty body and the composer bar in its `session={undefined}` mode, which hands anything typed
// to the session the moment it arrives.
//
// FOCUS IS THE VIEW'S JOB, not the session's (chat/chatSession.ts never touches the DOM): the
// session announces `onFocusRequest` after a new chat, a provider switch, a history resume, a stop
// that restores queued text, a quote-reply or a drop/mention insertion, and the view answers by
// focusing its composer — whichever control (header, transcript, setup screen) made the call.
import {
    createEffect,
    createSignal,
    Match,
    onCleanup,
    Show,
    Switch,
    type JSX,
} from 'solid-js'
import styles from './ChatView.module.css'
import ChatSetup from './ChatSetup'
import EmptyState from './ui/EmptyState'
import Text from './ui/Text'
import ChatHeader from './chat/ChatHeader'
import ChatTranscript from './chat/ChatTranscript'
import ChatComposerBar from './chat/ChatComposerBar'
import { createChatDropTarget } from './chat/createChatDropTarget'
import { chatSession } from './chat/chatSessions'
import type { ComposerHandle } from './ChatComposer'
import { chatColor } from './chatColors'
import { chatTitle, resolveChatHeaderTitle } from './chatTitles'
import { chatPersonaName } from './daemonIdentity'
import { chatOrigin, chatOriginIcon } from './chatOrigin'
import { providerLabel, sanitizeChatProvider } from './chatProvider'
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
    // A dead end replaces transcript + composer: the chosen backend refuses this vault's hidden
    // notes, or its CLI is missing.
    const blocked = () => {
        const s = session()
        return !!s && (!!s.gateRefusal() || !!s.setupError())
    }
    // Subscribe once both the session and the composer handle exist; re-subscribes if either changes.
    createEffect(() => {
        const s = session()
        const handle = composer()
        if (!s || !handle) return
        onCleanup(s.onFocusRequest(() => handle.focus()))
    })
    const switchProvider = (provider: string) =>
        session()?.switchProvider(provider)
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
                when={!blocked()}
                fallback={
                    <Switch>
                        <Match when={session()?.gateRefusal()}>
                            {refusal => (
                                <ChatSetup
                                    icon="Lock"
                                    iconLabel="Visibility"
                                    heading={
                                        <>
                                            {providerLabel(
                                                sanitizeChatProvider(
                                                    refusal().binary,
                                                ),
                                            )}{' '}
                                            can't honour this vault's hidden
                                            notes
                                        </>
                                    }
                                    body={<Text>{refusal().message}</Text>}
                                    actionLabel="USE CLAUDE CODE INSTEAD"
                                    onAction={() => switchProvider('claude')}
                                />
                            )}
                        </Match>
                        <Match when={session()?.setupError() === 'opencode'}>
                            <ChatSetup
                                icon="MessageSquare"
                                iconLabel="Chat"
                                heading="opencode isn't available"
                                body={
                                    <Text>
                                        This chat is set to the opencode
                                        provider, but the <code>opencode</code>{' '}
                                        CLI wasn't found on your machine.
                                        Install it from opencode.ai (e.g.{' '}
                                        <code>brew install sst/tap/opencode</code>
                                        ), then reopen this tab.
                                    </Text>
                                }
                                actionLabel="USE CLAUDE CODE INSTEAD"
                                onAction={() => switchProvider('claude')}
                            />
                        </Match>
                        <Match when={session()?.setupError()}>
                            <ChatSetup
                                icon="MessageSquare"
                                iconLabel="Chat"
                                heading="Claude Code isn't available"
                                body={
                                    <Text>
                                        This chat runs the <code>claude</code>{' '}
                                        CLI on your machine — it isn't
                                        installed or signed in. Install Claude
                                        Code and sign in, then reopen this tab.
                                    </Text>
                                }
                                actionLabel="USE OPENCODE INSTEAD"
                                onAction={() => switchProvider('opencode')}
                            />
                        </Match>
                    </Switch>
                }
            >
                <Show
                    when={session()}
                    fallback={<div class={styles.pending} />}
                >
                    {s => (
                        <ChatTranscript
                            items={s().transcript}
                            persona={s().persona()}
                            awaitingReply={s().awaitingReply()}
                            turnError={s().turnError()}
                            empty={
                                <EmptyState>
                                    Ask {persona()} anything about your vault.
                                    Run any <code>/command</code>, watch tool
                                    calls and thinking, and approve tool use
                                    inline.
                                </EmptyState>
                            }
                            onAnswerPermission={s().answerPermission}
                            onAnswerQuestion={s().answerQuestion}
                            onCancelQueued={s().cancelQueued}
                            onReply={reply}
                            subscribeAppend={s().onAppend}
                        />
                    )}
                </Show>
                <div class={styles.composer}>
                    <ChatComposerBar
                        session={session()}
                        placeholder={`Message ${persona()}`}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                        onReady={setComposer}
                    />
                </div>
            </Show>
        </div>
    )
}

export default ChatView
