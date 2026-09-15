// app/src/daemon/DaemonChat.tsx — DaemonChat.module.css is the ONLY importer of its module.
// The daemon page's centre-column chat: ChatTranscript (only once the conversation has items — no
// empty greeting, the face above is the greeting) stacked over the shared ChatComposerBar, with
// ChatControls rendered via the bar's `below` slot as one quiet row. `props.session` is undefined
// before a trusted gesture arms the daemon chat (daemonChatArming.ts) — the composer renders
// IDENTICALLY either way (Acceptance: "pixel-identical before and after it is clicked… clicking
// only focuses it"); `onGesture` is wired straight through to the composer box's own
// pointerdown/focusin, the one thing DaemonPageHost needs from this component.
//
// Fills whatever height DaemonPage.module.css's `.chatRegion`/`.chatFill` gives it: content-height
// while resting (composer + controls, nothing above), full column height while conversing (the
// transcript scrolls, the composer stays pinned to the bottom).
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import ChatTranscript from '../chat/ChatTranscript'
import ChatComposerBar from '../chat/ChatComposerBar'
import ChatControls from '../chat/ChatControls'
import ChatSetup from '../ChatSetup'
import type { ComposerHandle } from '../ChatComposer'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import { providerLabel, sanitizeChatProvider } from '../chatProvider'
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
    const gateRefusal = () => props.session?.gateRefusal() ?? null
    const setupError = () => props.session?.setupError() ?? null

    // Once both a session and a ready composer exist, refocus the composer whenever the session
    // asks for it (ChatSession.onFocusRequest — fired after startNewChat, switchProvider,
    // history.resume, stop, quoteReply, a drop/mention insertion). Re-subscribes if either changes;
    // unsubscribes on cleanup or before the next subscription.
    const [composer, setComposer] = createSignal<ComposerHandle | undefined>(
        undefined,
    )
    createEffect(() => {
        const session = props.session
        const handle = composer()
        if (!session || !handle) return
        const unsub = session.onFocusRequest?.(() => handle.focus())
        if (unsub) onCleanup(unsub)
    })

    return (
        <div class={`${styles.chat} ${props.class ?? ''}`}>
            <Show when={items().length > 0}>
                <ChatTranscript
                    class={styles.transcript}
                    items={items()}
                    persona={props.name}
                    awaitingReply={props.session?.awaitingReply() ?? false}
                    turnError={props.session?.turnError() ?? null}
                    onAnswerPermission={(id, behavior, always) =>
                        props.session?.answerPermission(id, behavior, always)
                    }
                    onAnswerQuestion={(id, answers) =>
                        props.session?.answerQuestion(id, answers)
                    }
                    onCancelQueued={id => props.session?.cancelQueued(id)}
                    onReply={text => props.session?.quoteReply(text)}
                    subscribeAppend={props.session?.onAppend}
                />
            </Show>
            {/* A visibility refusal (the backend is installed, it just can't be trusted with this
                vault's hidden notes) is a distinct dead end from setupError below — kept as its own
                Show, same as ChatView.tsx's non-dock chat. Compact here: wrapped in a non-flex
                container so ChatSetup's own `flex: 1 1 auto` (which fills a flex parent) has no
                effect and it renders at its natural content height above the composer instead of
                filling the column. */}
            <Show when={gateRefusal()}>
                {refusal => (
                    <div class={styles.setup}>
                        <ChatSetup
                            icon="Lock"
                            iconLabel="Visibility"
                            heading={
                                <>
                                    {providerLabel(
                                        sanitizeChatProvider(refusal().binary),
                                    )}{' '}
                                    can't honour this vault's hidden notes
                                </>
                            }
                            body={<p>{refusal().message}</p>}
                            actionLabel="USE CLAUDE CODE INSTEAD"
                            onAction={() =>
                                props.session?.switchProvider('claude')
                            }
                        />
                    </div>
                )}
            </Show>
            <Show when={!gateRefusal() && setupError()}>
                {error => (
                    <div class={styles.setup}>
                        <Show
                            when={error() === 'opencode'}
                            fallback={
                                <ChatSetup
                                    icon="MessageSquare"
                                    iconLabel="Chat"
                                    heading="Claude Code isn't available"
                                    body={
                                        <p>
                                            This chat runs the{' '}
                                            <code>claude</code> CLI on your
                                            machine — it isn't installed or
                                            signed in.
                                        </p>
                                    }
                                    actionLabel="USE OPENCODE INSTEAD"
                                    onAction={() =>
                                        props.session?.switchProvider(
                                            'opencode',
                                        )
                                    }
                                />
                            }
                        >
                            <ChatSetup
                                icon="MessageSquare"
                                iconLabel="Chat"
                                heading="opencode isn't available"
                                body={
                                    <p>
                                        This chat is set to the{' '}
                                        <code>opencode</code> provider, but
                                        the CLI wasn't found on your machine.
                                    </p>
                                }
                                actionLabel="USE CLAUDE CODE INSTEAD"
                                onAction={() =>
                                    props.session?.switchProvider('claude')
                                }
                            />
                        </Show>
                    </div>
                )}
            </Show>
            {/* data-testid ONLY: a stable, test-only hook so a story can assert the composer's box
                rect + placeholder are pixel-identical before and after the arming gesture, without
                reaching into ChatComposerBar's own (foreign) module for a class name. */}
            <div class={styles.composerWrap} data-testid="daemon-chat-composer">
                <ChatComposerBar
                    session={props.session}
                    placeholder={`Message ${props.name}`}
                    noteNames={props.noteNames}
                    memoryNames={props.memoryNames}
                    tagNames={props.tagNames}
                    onGesture={props.onGesture}
                    onReady={setComposer}
                    below={<ChatControls session={props.session} />}
                />
            </div>
        </div>
    )
}
