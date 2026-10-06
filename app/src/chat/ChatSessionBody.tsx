// app/src/chat/ChatSessionBody.tsx — ChatSessionBody.tsx is the ONLY importer of
// ChatSessionBody.module.css.
// The one session body the chat tab (ChatView) and the daemon page's chat (DaemonChat) share: the
// setup/refusal gate, the transcript, the history dialog and the composer bar with ChatControls as
// its `below` row, wired to one ChatSession, plus the composer refocus (createComposerFocus).
//
// It renders a FRAGMENT: its pieces are flex children of whatever column the host provides (ChatView's
// tinted tab host, DaemonChat's gapped column), so the host owns the root box, tint, header, drop
// target and gap. `session` is undefined before one exists (the pane's one pre-retain frame, the
// daemon before its arming gesture); the composer renders in its no-session mode either way.
//
// The two hosts differ in how the pieces nest, so `variant` picks one of two layouts:
//   pane   — a gate that fills the host; the composer sits inside the gate, inset 40px; the
//            transcript is always rendered (its `empty` greeting shows when there are no items);
//            with no session an empty `pending` filler holds the transcript's place so the
//            composer sits at the bottom edge.
//   column — a compact gate (content height); the composer sits OUTSIDE the gate so a dead end
//            never hides it; the transcript is `flush` with the composer's edge and grows to
//            fill; the composer wrapper is full width.
// In both, history is a dialog (ChatHistoryModal, portaled) OVER the body, never a swap: the
// transcript and composer stay mounted underneath, so closing it returns to the chat untouched.
// A transcript with no `empty` slot is rendered only once it has items (the daemon's face above is
// its greeting). Remaining per-host values are plain props: `persona`, `avatarMood`, `onGesture`,
// `chatId` (the controls' pre-session fallback seed) and `composerTestId` (a test-only hook).
import { createSignal, Show, type Component, type JSX } from 'solid-js'
import type { ChatSession } from './chatSession'
import ChatTranscript from './ChatTranscript'
import ChatComposerBar from './ChatComposerBar'
import ChatControls from './ChatControls'
import ChatHistoryModal from './ChatHistoryModal'
import ChatSetupGate from './ChatSetupGate'
import { createComposerFocus } from './createComposerFocus'
import type { ComposerHandle } from './ChatComposer'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import type { DaemonMood } from '../daemon/daemonFaceModel'
import styles from './ChatSessionBody.module.css'

export type ChatSessionBodyProps = {
    /** undefined until the host has one (see the header). */
    session: ChatSession | undefined
    /** The layout the host needs — see the header. */
    variant: 'pane' | 'column'
    /** Composer placeholder: `Message <name>`. */
    placeholder: string
    /** Label for assistant turns. */
    persona: string
    /** The face on the transcript's lowest assistant row. */
    avatarMood?: DaemonMood
    /** Shown in the transcript when it has no items. Omit and the transcript is not rendered until
     *  it has items. */
    empty?: JSX.Element
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    /** Trusted-gesture hook for arming: forwarded to ChatComposerBar. */
    onGesture?: (e: PointerEvent | FocusEvent) => void
    /** The chat id ChatControls seeds its disabled (no-session) row from. */
    chatId?: string
    /** Test-only hook on the composer wrapper (column variant). */
    composerTestId?: string
}

const ChatSessionBody: Component<ChatSessionBodyProps> = props => {
    const [composer, setComposer] = createSignal<ComposerHandle>()
    createComposerFocus(() => props.session, composer)

    const column = () => props.variant === 'column'

    const transcript = (s: ChatSession) => (
        <ChatTranscript
            class={column() ? styles.transcript : undefined}
            inset={column() ? 'flush' : undefined}
            items={s.transcript}
            persona={props.persona}
            avatarMood={props.avatarMood}
            awaitingReply={s.awaitingReply()}
            turnError={s.turnError()}
            empty={props.empty}
            onAnswerPermission={s.answerPermission}
            onAnswerQuestion={s.answerQuestion}
            onCancelQueued={s.cancelQueued}
            onReply={s.quoteReply}
            subscribeAppend={s.onAppend}
        />
    )

    const composerBar = () => (
        <div
            class={column() ? styles.columnComposer : styles.paneComposer}
            data-testid={props.composerTestId}
        >
            <ChatComposerBar
                session={props.session}
                placeholder={props.placeholder}
                noteNames={props.noteNames}
                memoryNames={props.memoryNames}
                tagNames={props.tagNames}
                onGesture={props.onGesture}
                onReady={setComposer}
                below={
                    <ChatControls
                        session={props.session}
                        chatId={props.chatId}
                    />
                }
            />
        </div>
    )

    // Keyed on the session itself, so the dialog never outlives the session it was opened on.
    const historyModal = () => (
        <Show when={props.session?.history.open() ? props.session : undefined}>
            {s => (
                <ChatHistoryModal
                    history={s().history}
                    onNewChat={s().startNewChat}
                />
            )}
        </Show>
    )

    const body = () => (
        <Show
            when={column()}
            fallback={
                <Show
                    when={props.session}
                    fallback={
                        <>
                            <div class={styles.pending} />
                            {composerBar()}
                        </>
                    }
                >
                    {s => (
                        <ChatSetupGate session={s()}>
                            {transcript(s())}
                            {composerBar()}
                        </ChatSetupGate>
                    )}
                </Show>
            }
        >
            <>
                <Show when={props.session}>
                    {s => (
                        <ChatSetupGate session={s()} compact>
                            <Show
                                when={
                                    props.empty !== undefined ||
                                    s().transcript.length > 0
                                }
                            >
                                {transcript(s())}
                            </Show>
                        </ChatSetupGate>
                    )}
                </Show>
                {composerBar()}
            </>
        </Show>
    )

    return (
        <>
            {body()}
            {historyModal()}
        </>
    )
}

export default ChatSessionBody
