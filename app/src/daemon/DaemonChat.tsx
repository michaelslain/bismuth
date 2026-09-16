// app/src/daemon/DaemonChat.tsx — DaemonChat.tsx is the ONLY importer of DaemonChat.module.css.
// The daemon page's centre-column chat: ChatTranscript (only once the conversation has items — no
// empty greeting, the face above is the greeting), `inset="flush"` so its turn column shares the
// composer's and controls row's left edge (Acceptance, design #4), stacked over the shared
// ChatComposerBar with ChatControls rendered via the bar's `below` slot as one quiet row.
// `props.session` is undefined before a trusted gesture arms the daemon chat (daemonChatArming.ts)
// — the composer renders IDENTICALLY either way (Acceptance: "pixel-identical before and after
// it is clicked… clicking only focuses it"); `onGesture` is wired straight through to the composer
// box's own pointerdown/focusin, the one thing DaemonPageHost needs from this component.
//
// A gate refusal / missing-CLI dead end (chat/ChatSetupGate.tsx, shared with ChatView.tsx) replaces
// the transcript when a session can't run; the composer stays visible below it either way, as it
// always has here.
//
// Fills whatever height DaemonPage.module.css's `.chatRegion`/`.chatFill` gives it: content-height
// while resting (composer + controls, nothing above), full column height while conversing (the
// transcript scrolls, the composer stays pinned to the bottom).
import { createSignal, Show, type JSX } from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import ChatTranscript from '../chat/ChatTranscript'
import ChatComposerBar from '../chat/ChatComposerBar'
import ChatControls from '../chat/ChatControls'
import ChatHistoryPanel from '../chat/ChatHistoryPanel'
import ChatSetupGate from '../chat/ChatSetupGate'
import { createComposerFocus } from '../chat/createComposerFocus'
import type { ComposerHandle } from '../ChatComposer'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import { DAEMON_CHAT_ID } from '../tabIds'
import styles from './DaemonChat.module.css'

export type DaemonChatProps = {
    /** undefined until a trusted gesture arms the chat (daemonChatArming.ts). */
    session: ChatSession | undefined
    /** The daemon's display name — composer placeholder `Message <name>` and assistant turn label. */
    name: string
    /** Trusted-gesture hook for arming: forwarded to ChatComposerBar's own pointerdown/focusin. */
    onGesture: (e: PointerEvent | FocusEvent) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    class?: string
}

export default function DaemonChat(props: DaemonChatProps): JSX.Element {
    const items = () => props.session?.transcript ?? []

    // Once both a session and a ready composer exist, refocus the composer whenever the session
    // asks for it (ChatSession.onFocusRequest — fired after startNewChat, switchProvider,
    // history.resume, stop, quoteReply, a drop/mention insertion). Shared with ChatView.tsx.
    const [composer, setComposer] = createSignal<ComposerHandle | undefined>(
        undefined,
    )
    createComposerFocus(() => props.session, composer)

    return (
        <div class={`${styles.chat} ${props.class ?? ''}`}>
            <Show
                when={!props.session?.history.open()}
                fallback={
                    <ChatHistoryPanel
                        history={props.session!.history}
                        onNewChat={props.session!.startNewChat}
                    />
                }
            >
                <Show when={props.session}>
                    {s => (
                        <ChatSetupGate session={s()} compact>
                            <Show when={items().length > 0}>
                                <ChatTranscript
                                    class={styles.transcript}
                                    inset="flush"
                                    items={items()}
                                    persona={props.name}
                                    awaitingReply={s().awaitingReply()}
                                    turnError={s().turnError()}
                                    onAnswerPermission={(id, behavior, always) =>
                                        s().answerPermission(id, behavior, always)
                                    }
                                    onAnswerQuestion={(id, answers) =>
                                        s().answerQuestion(id, answers)
                                    }
                                    onCancelQueued={id => s().cancelQueued(id)}
                                    onReply={text => s().quoteReply(text)}
                                    subscribeAppend={s().onAppend}
                                />
                            </Show>
                        </ChatSetupGate>
                    )}
                </Show>
                {/* data-testid ONLY: a stable, test-only hook so a story can assert the composer's
                    box rect + placeholder are pixel-identical before and after the arming gesture,
                    without reaching into ChatComposerBar's own (foreign) module for a class name. */}
                <div
                    class={styles.composerWrap}
                    data-testid="daemon-chat-composer"
                >
                    <ChatComposerBar
                        session={props.session}
                        placeholder={`Message ${props.name}`}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                        onGesture={props.onGesture}
                        onReady={setComposer}
                        below={
                            <ChatControls
                                session={props.session}
                                chatId={DAEMON_CHAT_ID}
                            />
                        }
                    />
                </div>
            </Show>
        </div>
    )
}
