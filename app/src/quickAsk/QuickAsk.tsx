// app/src/quickAsk/QuickAsk.tsx — the only importer of QuickAsk.module.css; QuickAskHost.tsx is the only importer of this component.
// The Cmd+K popover, a conversation: a header of the daemon face + its name + (until the first send)
// the input; after that the thread (each user turn a muted `> ` line, each reply as markdown through
// the chat's own renderer), a reply input under it, and a right-aligned `[ apply ] [ open in chat ]
// [ esc ]` footer. It owns only presentation + placement: the session, the apply flow and the
// hand-off are the host's (props). A permission or question from the agent renders inline with the
// chat's own cards, so a turn can never hang invisibly. Placement is `popoverPlacement` (pure),
// painted by <AnchoredPopover> through a virtual anchor — AnchoredPopover supplies the portal,
// outside-click and Esc dismissal.
import {
    createEffect,
    createMemo,
    createSignal,
    For,
    onCleanup,
    Show,
    type Component,
} from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import type { AssistantItem } from '../chat/chatTranscriptLogic'
import DaemonFace from '../daemon/DaemonFace'
import Caret from '../ui/Caret'
import ChatNote from '../chat/ChatNote'
import ChatPermissionCard from '../chat/ChatPermissionCard'
import ChatQuestionCard from '../chat/ChatQuestionCard'
import ChatTextBubble from '../chat/ChatTextBubble'
import AnchoredPopover from '../ui/AnchoredPopover'
import Popover from '../ui/Popover'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import TextInput from '../ui/TextInput'
import { isConfirmKey } from '../ui/widgetKeys'
import type { QuickAskAnchor } from './quickAskState'
import { faceMood, popoverPlacement, popoverWidth, quickAskTurns } from './quickAskLogic'
import styles from './QuickAsk.module.css'

export type QuickAskProps = {
    anchor: QuickAskAnchor
    /** undefined until the registry creates it */
    session: ChatSession | undefined
    daemonEnabled: boolean
    /** The header name: the daemon's name when it is enabled, else `chat`. */
    name: string
    /** The first question (the host mints the chat id from a trusted Enter). */
    onSubmit: (question: string, e: KeyboardEvent) => void
    /** A follow-up in the same conversation. */
    onReply: (text: string, e: KeyboardEvent) => void
    /** Not offered at all without a note to edit (`anchor.kind === 'pane'`, or no note path). The
     *  event is handed over so the host can require a trusted click. */
    onApply?: (e: MouseEvent) => void
    onOpenInChat: () => void
    onClose: () => void
    class?: string
}

type Rect = { left: number; top: number; width: number; height: number }

/** Viewport geometry for the anchor: the caret line (note editors) and the pane it lives in. */
function anchorGeometry(anchor: QuickAskAnchor): {
    caret: { left: number; top: number; bottom: number } | null
    /** The rect the popover is clamped inside: the pane, narrowed to the editor's content column
     *  for a caret anchor (so it never hangs into the empty gutter). */
    pane: Rect
    /** The whole pane's width, which sizes the popover. */
    paneWidth: number
} {
    const fallback: Rect = {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
    }
    const rectOf = (el: Element | null | undefined): Rect => {
        if (!el) return fallback
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    if (anchor.kind === 'caret') {
        const c = anchor.view.coordsAtPos(anchor.pos)
        const pane = rectOf(anchor.view.dom.closest('[data-pane-leaf]') ?? anchor.view.dom)
        const col = anchor.view.contentDOM.getBoundingClientRect()
        return {
            caret: c ? { left: c.left, top: c.top, bottom: c.bottom } : null,
            pane: col.width > 0 ? { ...pane, left: col.left, width: col.width } : pane,
            paneWidth: pane.width,
        }
    }
    const leaf = anchor.leafId
        ? document.querySelector(`[data-pane-leaf="${CSS.escape(anchor.leafId)}"]`)
        : null
    const pane = rectOf(leaf)
    return { caret: null, pane, paneWidth: pane.width }
}

/** The assistant turn being streamed: the transcript's last item when it is an assistant turn. */
function lastAssistant(session: ChatSession | undefined): AssistantItem | undefined {
    const t = session?.transcript
    const last = t?.[t.length - 1]
    return last?.role === 'assistant' ? last : undefined
}

const QuickAsk: Component<QuickAskProps> = props => {
    const [value, setValue] = createSignal('')
    // Set locally on a TRUSTED Enter; otherwise the question is whatever the session's first user
    // turn says (a restored / story-fed session), so the popover never claims a send that did not
    // happen.
    const [sent, setSent] = createSignal<string | null>(null)
    const question = (): string | null => {
        const local = sent()
        if (local !== null) return local
        const first = props.session?.transcript.find(i => i.role === 'user')
        return first && first.role === 'user' ? first.text : null
    }
    const [reply, setReply] = createSignal('')
    const [size, setSize] = createSignal({ width: 0, height: 0 })
    const [viewport, setViewport] = createSignal(0)
    const onResize = () => setViewport(v => v + 1)
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))

    const geometry = createMemo(() => {
        viewport()
        return anchorGeometry(props.anchor)
    })
    const width = () => popoverWidth(geometry().paneWidth)
    // The side picked at open, latched once the popover has a measured height, so streaming
    // growth never flips it.
    const [latched, setLatched] = createSignal<'above' | 'below' | null>(null)
    const place = createMemo(() =>
        popoverPlacement({
            caret: geometry().caret,
            pane: geometry().pane,
            size: { width: width(), height: size().height },
            latched: latched(),
        }),
    )
    createEffect(() => {
        const p = place()
        if (latched() === null && size().height > 0 && p.side !== 'pane-top') setLatched(p.side)
    })
    // AnchoredPopover places a panel `below` an element with a 4px gap; a virtual anchor whose
    // bottom edge sits 4px above the wanted top puts the panel exactly where popoverPlacement says.
    const virtualAnchor = {
        getBoundingClientRect: () => {
            const p = place()
            return { top: p.top - 4, bottom: p.top - 4, left: p.left, width: 0 }
        },
    } as unknown as HTMLElement

    let observer: ResizeObserver | undefined
    function onRoot(el: HTMLDivElement): void {
        const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight })
        // Before first paint, so the first frame is already beside the caret.
        queueMicrotask(measure)
        observer = new ResizeObserver(measure)
        observer.observe(el)
    }
    onCleanup(() => observer?.disconnect())

    const turn = () => lastAssistant(props.session)
    const streaming = () => props.session?.streaming() ?? false
    const hasPrompt = () =>
        !!turn()?.parts.some(
            p => (p.kind === 'permission' || p.kind === 'question') && !p.answered && !p.cancelled,
        )
    const hasText = () => !!turn()?.parts.some(p => p.kind === 'text' && p.text.trim())
    // The question is still queued for send while the session's draft holds it.
    const queued = () => (props.session?.draft().trim() ?? '') !== ''
    const waiting = () =>
        !props.session?.setupError() &&
        !props.session?.gateRefusal() &&
        !!question() &&
        !hasPrompt() &&
        !hasText() &&
        (props.session === undefined || queued() || props.session.awaitingReply() || streaming())
    const busy = () => streaming() || waiting()
    const started = () => question() !== null
    // The thread, with the typed-but-not-yet-echoed first question standing in until the session
    // reports its own user turn.
    const turns = createMemo(() => quickAskTurns(props.session?.transcript ?? []))
    const finishedReply = () => {
        const last = turns()[turns().length - 1]
        return last?.role === 'assistant' && last.text.trim() !== '' && !busy()
    }
    const canApply = () => props.anchor.kind === 'caret' && props.anchor.notePath !== null
    const mood = () =>
        faceMood({
            daemonEnabled: props.daemonEnabled,
            streaming: busy(),
            hasReplyText: hasText(),
            typing: (started() ? reply() : value()).trim() !== '',
        })

    let thread: HTMLDivElement | undefined
    let replyInput: HTMLInputElement | undefined
    // Pinned to the bottom while the reply streams in.
    createEffect(() => {
        turns()
        for (const t of props.session?.transcript ?? [])
            if (t.role === 'assistant') for (const p of t.parts) if (p.kind === 'text') void p.text
        waiting()
        queueMicrotask(() => {
            if (thread) thread.scrollTop = thread.scrollHeight
        })
    })
    // The reply input takes focus each time a reply finishes.
    createEffect(prev => {
        const done = started() && !busy()
        if (done && !prev) queueMicrotask(() => replyInput?.focus({ preventScroll: true }))
        return done
    }, false)

    function onKeyDown(e: KeyboardEvent): void {
        if (!isConfirmKey(e)) return
        const q = value().trim()
        if (!q) return
        e.preventDefault()
        props.onSubmit(q, e)
        // A synthetic Enter is dropped by the host (no session is minted), so it must not look sent.
        if (e.isTrusted) setSent(q)
    }

    function onReplyKeyDown(e: KeyboardEvent): void {
        if (!isConfirmKey(e)) return
        e.preventDefault()
        const q = reply().trim()
        // Typeable while a reply streams, but Enter does nothing until it finishes.
        if (!q || busy()) return
        props.onReply(q, e)
        if (e.isTrusted) setReply('')
    }

    const body = (
        <Popover
            tone="panel"
            ref={onRoot}
            class={`${styles['quick-ask']} ${props.class ?? ''}`}
            style={{ width: `${width()}px` }}
        >
            <div class={styles.row}>
                <div class={styles.who}>
                    <DaemonFace mood={mood()} size="avatar" label={props.name} />
                    <Text as="span" class={styles.name}>
                        {props.name}
                    </Text>
                </div>
                <Show when={!started()}>
                    <TextInput
                        plain
                        class={styles.input}
                        value={value()}
                        onInput={setValue}
                        onKeyDown={onKeyDown}
                        placeholder="ask…"
                        aria-label="ask"
                        ref={(el: HTMLInputElement) =>
                            queueMicrotask(() => el.focus({ preventScroll: true }))
                        }
                    />
                </Show>
            </div>
            <Show when={started()}>
                <div class={styles.body} ref={thread}>
                    <Show when={turns().length === 0 && question()}>
                        <Text as="div" tone="muted" class={styles.user}>
                            {`> ${question()}`}
                        </Text>
                    </Show>
                    <For each={props.session?.transcript ?? []}>
                        {item => {
                            const s = props.session
                            if (item.role === 'user')
                                return (
                                    <Text as="div" tone="muted" class={styles.user}>
                                        {`> ${quickAskTurns([item])[0].text}`}
                                    </Text>
                                )
                            if (item.role !== 'assistant') return null
                            return (
                                <div class={styles.turn}>
                                    <For each={item.parts}>
                                        {part => {
                                            if (part.kind === 'text')
                                                return (
                                                    <ChatTextBubble
                                                        text={part.text}
                                                        role="assistant"
                                                    />
                                                )
                                            if (part.kind === 'permission' && s)
                                                return (
                                                    <ChatPermissionCard
                                                        part={part}
                                                        onAnswer={(behavior, always) =>
                                                            s.answerPermission(
                                                                part.id,
                                                                behavior,
                                                                always,
                                                            )
                                                        }
                                                    />
                                                )
                                            if (part.kind === 'question' && s)
                                                return (
                                                    <ChatQuestionCard
                                                        part={part}
                                                        onAnswer={answers =>
                                                            s.answerQuestion(part.id, answers)
                                                        }
                                                    />
                                                )
                                            return null
                                        }}
                                    </For>
                                </div>
                            )
                        }}
                    </For>
                    <Show when={waiting()}>
                        <ChatNote>
                            working
                            <Caret />
                        </ChatNote>
                    </Show>
                    <Show when={props.session?.gateRefusal()}>
                        {r => (
                            <ChatNote icon="TriangleAlert" tone="danger">
                                {r().message}
                            </ChatNote>
                        )}
                    </Show>
                    <Show when={props.session?.setupError()}>
                        <ChatNote icon="TriangleAlert" tone="danger">
                            no agent set up — open in chat to set one up
                        </ChatNote>
                    </Show>
                    <Show when={!queued() && props.session?.turnError()}>
                        {msg => (
                            <ChatNote icon="TriangleAlert" tone="danger">
                                {msg()}
                            </ChatNote>
                        )}
                    </Show>
                </div>
                <div class={styles.reply}>
                    <Text as="span" tone="faint" class={styles.prompt} aria-hidden="true">
                        {'>'}
                    </Text>
                    <TextInput
                        plain
                        class={styles.input}
                        value={reply()}
                        onInput={setReply}
                        onKeyDown={onReplyKeyDown}
                        placeholder="reply…"
                        aria-label="reply"
                        ref={(el: HTMLInputElement) => (replyInput = el)}
                    />
                </div>
                <div class={styles.footer}>
                    <Show when={canApply() && props.onApply}>
                        {apply => (
                            <TextButton
                                primary
                                disabled={busy() || !finishedReply()}
                                onClick={e => apply()(e)}
                            >
                                apply
                            </TextButton>
                        )}
                    </Show>
                    <TextButton onClick={() => props.onOpenInChat()}>open in chat</TextButton>
                    <TextButton onClick={() => props.onClose()}>esc</TextButton>
                </div>
            </Show>
        </Popover>
    )

    return (
        <AnchoredPopover
            open
            anchor={() => virtualAnchor}
            placement="below"
            onDismiss={() => props.onClose()}
            panelAttrs={{
                'data-chat-surface': '',
                'data-quick-ask': '',
                role: 'dialog',
                'aria-label': 'ask the daemon',
            }}
        >
            {/* Reading place()/size() here re-runs AnchoredPopover's measure effect when the popover
                grows, so the box stays glued to its anchor edge while the answer streams. */}
            {(place(), body)}
        </AnchoredPopover>
    )
}

export default QuickAsk
