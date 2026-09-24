// app/src/chat/ChatComposerBar.tsx
// The ONE composer box shared by the chat tab and the daemon page (Acceptance: "The same
// ChatComposerBar renders in the chat tab and on the daemon page"). Owns everything about
// COMPOSING a turn: the outlined box (1px --border-soft, --accent on focus-within, no fill, no
// hairline above — daemon-chat plan Acceptance), attachment chips, the slash-command popover,
// prompt-history recall (ArrowUp/ArrowDown at the composer's boundary), paste → image/file intake,
// and the send/stop button, inside a max-width 680px centred column.
//
// `session` may be undefined — the daemon page renders this BEFORE a session exists (its composer
// IS the trusted-gesture arming surface: "the composer is pixel-identical before and after it is
// clicked… clicking only focuses it"). Typing while session is undefined goes to a local draft,
// which is handed to `session.setDraft` the moment a session arrives; send stays disabled.
import {
    children,
    createEffect,
    createMemo,
    createSignal,
    For,
    Show,
    type JSX,
} from 'solid-js'
import styles from './ChatComposerBar.module.css'
import type { ChatSession } from './chatSession'
import { ChatComposer, type ComposerHandle } from '../ChatComposer'
import { IconButton } from '../ui/IconButton'
import PopoverList, { type PopoverRow } from '../ui/popover/PopoverList'
import { createMenuNav } from '../ui/popover/createMenuNav'
import { classifyComposerKey } from '../chatComposerKeys'
import { settings } from '../settings'
import {
    HISTORY_BOTTOM,
    historyUp,
    historyDown,
    type HistoryCursor,
} from '../chatHistory'
import { filePathsFromTransfer } from '../fileIntake'
import { addChatReference } from '../chatContext'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'

export type ChatComposerBarProps = {
    /** undefined = no session yet (daemon, pre-arm): identical render; typing goes to a local
     *  draft that is handed to session.setDraft the moment a session arrives; send is disabled. */
    session: ChatSession | undefined
    placeholder: string
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    onReady?: (handle: ComposerHandle) => void
    /** Trusted-gesture hook for the daemon's arming: fired with the raw pointerdown/focusin event. */
    onGesture?: (e: PointerEvent | FocusEvent) => void
    /** Rendered directly under the composer box (the daemon page puts ChatControls here). */
    below?: JSX.Element
    class?: string
}

export default function ChatComposerBar(
    props: ChatComposerBarProps,
): JSX.Element {
    // `children()` resolves the getter ONCE into a memo — a bare `<Show when={props.below}>
    // {props.below}</Show>` re-reads the `below` prop getter on every render (Show evaluates
    // `when` in its own memo), which instantiates whatever JSX it holds a SECOND time. T6 passes
    // <ChatControls/> here, so the bare form would mount two control trees: two authOpen signals,
    // two history panels each with their own document pointerdown/keydown listener.
    const below = children(() => props.below)
    const [localDraft, setLocalDraft] = createSignal('')
    let composerHandle: ComposerHandle | undefined
    let historyCursor: HistoryCursor = HISTORY_BOTTOM
    // Set just before a history recall writes the draft, so the very next onInput (the feedback
    // from that write reflecting back through ChatComposer's doc→signal listener) doesn't reset the
    // cursor it was just given — mirrors ChatView's pendingHistoryText guard.
    let skipHistoryReset = false

    const draftValue = () =>
        props.session ? props.session.draft() : localDraft()
    const setDraft = (value: string) => {
        if (props.session) props.session.setDraft(value)
        else setLocalDraft(value)
    }
    // Hand the local draft over the instant a session arrives (the daemon's arming gesture).
    createEffect(() => {
        const session = props.session
        const pending = localDraft()
        if (session && pending) {
            session.setDraft(pending)
            setLocalDraft('')
        }
    })

    const streaming = () => props.session?.streaming() ?? false
    const attachments = () => props.session?.attachments() ?? []

    const onComposerInput = (value: string) => {
        if (!skipHistoryReset) historyCursor = HISTORY_BOTTOM
        skipHistoryReset = false
        setDraft(value)
    }

    // ── Slash-command popover ──────────────────────────────────────────────────────────────
    const [slashOpen, setSlashOpen] = createSignal(false)
    const slashQuery = createMemo(() => {
        const d = draftValue()
        if (!d.startsWith('/')) return null
        // Single-token only: once a space is typed it's an argument, not a command pick.
        if (/\s/.test(d)) return null
        return d.slice(1).toLowerCase()
    })
    const slashMatches = createMemo<string[]>(() => {
        const q = slashQuery()
        const session = props.session
        if (q === null || !session) return []
        return session
            .slashCommands()
            .filter(c => c.toLowerCase().startsWith(q))
            .slice(0, 50)
    })
    const slashRows = createMemo<PopoverRow[]>(() =>
        slashMatches().map(c => ({
            label: `/${c}`,
            icon: 'ChevronRight',
            detail: props.session?.slashCommandDetail(c),
        })),
    )
    const closeSlash = () => setSlashOpen(false)
    const chooseSlash = (i: number) => {
        const cmd = slashMatches()[i]
        if (!cmd) return
        setDraft(`/${cmd} `)
        closeSlash()
        composerHandle?.focus()
    }
    const slashNav = createMenuNav({
        count: () => slashMatches().length,
        onSelect: i => chooseSlash(i),
        onEscape: () => closeSlash(),
    })
    createEffect(() => {
        const open = slashQuery() !== null && slashMatches().length > 0
        setSlashOpen(open)
        if (open) slashNav.setActive(0)
    })

    // ── Prompt-history recall ──────────────────────────────────────────────────────────────
    const applyHistoryMove = (move: { cursor: HistoryCursor; text: string }) => {
        historyCursor = move.cursor
        skipHistoryReset = true
        setDraft(move.text)
    }

    const doSend = () => props.session?.send()

    const onComposerKey = (
        e: KeyboardEvent,
        boundary: { atTop: boolean; atBottom: boolean },
    ): boolean => {
        switch (
            classifyComposerKey(
                e,
                {
                    slashOpen: slashOpen(),
                    streaming: streaming(),
                    ...boundary,
                },
                {
                    'chat-send': settings.keybindings['chat-send'],
                    'chat-stop': settings.keybindings['chat-stop'],
                    'chat-history-prev':
                        settings.keybindings['chat-history-prev'],
                    'chat-history-next':
                        settings.keybindings['chat-history-next'],
                },
            )
        ) {
            case 'slash-nav':
                slashNav.onKeyDown(e)
                return true
            case 'slash-select':
                e.preventDefault()
                chooseSlash(slashNav.active())
                return true
            case 'stop':
                e.preventDefault()
                props.session?.stop()
                return true
            case 'send':
                e.preventDefault()
                doSend()
                return true
            case 'history-up': {
                const move = historyUp(
                    historyCursor,
                    props.session?.historyEntries() ?? [],
                    draftValue(),
                )
                if (!move) return false
                e.preventDefault()
                applyHistoryMove(move)
                return true
            }
            case 'history-down': {
                const move = historyDown(
                    historyCursor,
                    props.session?.historyEntries() ?? [],
                )
                if (!move) return false
                e.preventDefault()
                applyHistoryMove(move)
                return true
            }
            case 'pass':
                return false
        }
    }

    // ── Paste → image/file intake, delegated to the session ───────────────────────────────
    const onPaste = (e: ClipboardEvent) => {
        const session = props.session
        if (!session) return
        const paths = filePathsFromTransfer(e.clipboardData)
        if (paths.length) {
            e.preventDefault()
            void session.addDroppedPaths(paths)
            return
        }
        const items = e.clipboardData?.items
        if (!items) return
        const files: File[] = []
        for (const it of items) {
            if (it.kind === 'file') {
                const f = it.getAsFile()
                if (f) files.push(f)
            }
        }
        if (!files.length) return
        e.preventDefault()
        void session.addDroppedFiles(files)
    }

    const onGesture = (e: PointerEvent | FocusEvent) => props.onGesture?.(e)

    // A pointerdown on `.box`'s own padding, or on the send button while it's disabled (no draft
    // yet), still reaches this handler — but neither lands inside the CodeMirror content, so
    // neither would otherwise focus the editor (final-findings Group 2 #8: "arms without focusing
    // the editor"). `.cm-content` is CodeMirror's own generated class (never hashed — a plain-DOM
    // library, not a project component; see CLAUDE.md's `closest()` exception for exactly this
    // case), so `closest` here is reaching OUT of this component's tree into a third-party editor's
    // markup, not reading a sibling project component's class name.
    //
    // TRUSTED PRESSES ONLY. `focus()` dispatches a TRUSTED `focusin` even when the call was
    // provoked by a synthetic event, and that focusin bubbles to `.box`'s `onFocusIn={onGesture}`
    // — so focusing on an untrusted pointerdown would let a `dispatchEvent` arm the daemon chat
    // (daemon/daemonChatArming.ts forbids exactly that). This is the ONE programmatic composer
    // focus reachable while `session` is undefined; keep it gated on `e.isTrusted`.
    const onBoxPointerDown = (e: PointerEvent) => {
        onGesture(e)
        if (e.isTrusted && !(e.target as HTMLElement).closest('.cm-content')) {
            composerHandle?.focus()
        }
    }

    return (
        <div class={`${styles.bar} ${props.class ?? ''}`}>
            <div class={styles.box} onPointerDown={onBoxPointerDown} onFocusIn={onGesture}>
                <Show when={slashOpen()}>
                    <div
                        class={styles['slash-popover']}
                        onMouseDown={e => e.preventDefault() /* keep composer focus */}
                    >
                        <PopoverList
                            items={slashRows()}
                            active={slashNav.active()}
                            onActivate={i => chooseSlash(i)}
                            onHover={i => slashNav.setActive(i)}
                        />
                    </div>
                </Show>
                <div class={styles.main}>
                    <Show when={attachments().length > 0}>
                        <div class={styles.attachments}>
                            <For each={attachments()}>
                                {(att, i) => (
                                    <div class={styles.attachment}>
                                        <img
                                            class={styles['attachment-img']}
                                            src={`data:${att.mediaType};base64,${att.data}`}
                                            alt={att.name}
                                            title={att.name}
                                        />
                                        <IconButton
                                            icon="X"
                                            label="Remove attachment"
                                            size="sm"
                                            class={styles['attachment-remove']}
                                            onClick={() =>
                                                props.session?.removeAttachment(
                                                    i(),
                                                )
                                            }
                                        />
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>
                    <div class={styles.input}>
                        <ChatComposer
                            value={draftValue}
                            onInput={onComposerInput}
                            onKeyDown={onComposerKey}
                            onPaste={onPaste}
                            onReady={h => {
                                composerHandle = h
                                props.onReady?.(h)
                            }}
                            getNotes={props.noteNames}
                            getMemories={props.memoryNames}
                            getTags={props.tagNames}
                            getFiles={() => props.session?.fileCandidates() ?? []}
                            onFileMention={p => {
                                const session = props.session
                                if (session) addChatReference(session.chatId, p)
                            }}
                            placeholder={() => props.placeholder}
                        />
                    </div>
                </div>
                <Show
                    when={streaming()}
                    fallback={
                        <IconButton
                            icon="Send"
                            label="Send message"
                            variant="selected"
                            class={styles.send}
                            onClick={doSend}
                            disabled={
                                !props.session ||
                                (!draftValue().trim() &&
                                    attachments().length === 0)
                            }
                        />
                    }
                >
                    <IconButton
                        icon="Square"
                        label="Stop generating"
                        danger
                        class={styles.send}
                        onClick={() => props.session?.stop()}
                    />
                </Show>
            </div>
            <Show when={below()}>
                <div class={styles.below}>{below()}</div>
            </Show>
        </div>
    )
}
