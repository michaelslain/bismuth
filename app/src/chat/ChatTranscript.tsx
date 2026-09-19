// app/src/chat/ChatTranscript.tsx — ChatTranscript.module.css is the ONLY importer of its module.
// The scrollable message list: owns its own scroll container, follow-bottom tracking + the
// "Latest" jump pill, wikilink click → the global `bismuth-open` navigation event, the floating
// selection "Reply" button, and the bubble right-click menu (Reply/Copy). Renders each TurnItem via
// ChatUserTurn/ChatAssistantTurn/ChatSystemNote, plus the transient "awaiting reply" and per-turn
// error rows. Extracted from ChatView.tsx's transcript list render (~2345-2590) and its
// selection/context-menu wiring (~1951-2059); T5/T6 render this in the chat tab and the daemon page
// respectively, driven by a `ChatSession` (subscribeAppend = session.onAppend).
import {
    children,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
    type JSX,
} from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { openContextMenu } from '../nativeMenu'
import { copyChatText } from './copyChatText'
import ChatTurnColumn from './ChatTurnColumn'
import ChatTurnLabel from './ChatTurnLabel'
import ChatUserTurn from './ChatUserTurn'
import ChatAssistantTurn from './ChatAssistantTurn'
import ChatSystemNote from './ChatSystemNote'
import type { AssistantItem, TurnItem, UserItem } from '../chatTranscript'
import styles from './ChatTranscript.module.css'

export type ChatTranscriptProps = {
    items: readonly TurnItem[]
    /** Label for assistant turns (the persona name). */
    persona: string
    awaitingReply: boolean
    turnError: string | null
    /** Shown when items is empty; omit for nothing. */
    empty?: JSX.Element
    onAnswerPermission: (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => void
    onAnswerQuestion: (id: string, answers: Record<string, string> | null) => void
    onCancelQueued: (queueId: string) => void
    /** Selection-reply button + bubble context menu "Reply". */
    onReply: (text: string) => void
    /** Subscribe to appends (pass session.onAppend). Follow-bottom + "Latest" pill live here. */
    subscribeAppend?: (listener: (force: boolean) => void) => () => void
    /** 'pane' (default): the list's own inline padding. 'flush': none, so the turn column's left
     *  edge is the host's — the daemon page aligns transcript, composer and controls on one edge. */
    inset?: 'pane' | 'flush'
    class?: string
}

/** The current text selection IF it lies within `container` (a message bubble), else "". */
function selectionWithin(container: HTMLElement | null): string {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return ''
    const text = sel.toString().trim()
    if (!text) return ''
    if (
        container &&
        !container.contains(sel.getRangeAt(0).commonAncestorContainer)
    )
        return ''
    return text
}

export default function ChatTranscript(props: ChatTranscriptProps) {
    let list!: HTMLDivElement

    // `children()` resolves the `empty` JSX prop ONCE and memoizes it — reading `props.empty`
    // directly in both the Show `when` and its body would run the getter twice, instantiating the
    // caller's EmptyState tree a second time on every read (and rebuilding it on every
    // empty↔non-empty flip).
    const empty = children(() => props.empty)

    const [following, setFollowing] = createSignal(true)
    const [selReply, setSelReply] = createSignal<{
        x: number
        y: number
        text: string
    } | null>(null)
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)

    const scrollToBottom = (force = false) => {
        if (force) setFollowing(true)
        if (!following()) return
        queueMicrotask(() => {
            if (list) list.scrollTop = list.scrollHeight
        })
    }

    onMount(() => {
        scrollToBottom(true)
        const unsub = props.subscribeAppend?.(force => scrollToBottom(force))
        if (unsub) onCleanup(unsub)
    })

    const onListScroll = () => {
        if (!list) return
        setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < 40)
        // The floating selection-reply button is anchored to a viewport position that scrolling
        // invalidates — drop it (a fresh selection re-shows it).
        if (selReply()) setSelReply(null)
    }

    // Wikilinks in rendered markdown (`data-href` on `a.bismuth-wikilink`) open in-app via the
    // global `bismuth-open` event, the same navigation used everywhere else a note is rendered.
    const onListClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null
        const a = target?.closest?.('a.bismuth-wikilink') as HTMLElement | null
        if (!a) return
        const href = a.getAttribute('data-href')
        if (!href) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('bismuth-open', { detail: href }))
    }

    /** Right-click a prose bubble → Reply/Copy. Reply always quotes the WHOLE message (the floating
     *  "Reply" button anchored above a selection is the sole selection-reply path); Copy prefers a
     *  live selection, else the whole message. */
    const onBubbleContextMenu = (e: MouseEvent, text: string) => {
        if (!text.trim()) return // nothing to quote/copy (e.g. an image-only bubble)
        e.preventDefault()
        const selected = selectionWithin(e.currentTarget as HTMLElement)
        const items: MenuItem[] = [
            {
                label: 'Reply',
                icon: 'Reply',
                onSelect: () => props.onReply(text),
            },
            {
                label: 'Copy',
                icon: 'Copy',
                onSelect: () => copyChatText(selected || text),
            },
        ]
        openContextMenu(e.clientX, e.clientY, items, setMenu)
    }

    /** On mouse-up, if there's a non-empty text selection inside a message bubble, float a "Reply"
     *  button just above it. Deferred a microtask so the browser has finalized the selection. */
    const onListMouseUp = () => {
        queueMicrotask(() => {
            const sel = window.getSelection()
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                setSelReply(null)
                return
            }
            const text = sel.toString().trim()
            const range = sel.getRangeAt(0)
            const node = range.commonAncestorContainer
            const el = (
                node.nodeType === 1 ? (node as Element) : node.parentElement
            )?.closest?.('[data-chat-bubble]')
            if (!text || !el) {
                setSelReply(null)
                return
            }
            const rect = range.getBoundingClientRect()
            setSelReply({ x: rect.left + rect.width / 2, y: rect.top, text })
        })
    }

    return (
        <div class={`${styles['chat-list-wrap']} ${props.class ?? ''}`}>
            <div
                class={styles['chat-list']}
                classList={{
                    [styles['chat-list--flush']]: props.inset === 'flush',
                }}
                ref={list!}
                onClick={onListClick}
                onScroll={onListScroll}
                onMouseUp={onListMouseUp}
            >
                <Show when={props.items.length === 0 && empty()}>
                    <div class={styles['chat-empty']}>{empty()}</div>
                </Show>
                <For each={props.items}>
                    {item => {
                        if (item.role === 'system')
                            return <ChatSystemNote text={item.text} />
                        if (item.role === 'assistant')
                            return (
                                <ChatAssistantTurn
                                    item={item as AssistantItem}
                                    persona={props.persona}
                                    onAnswerPermission={props.onAnswerPermission}
                                    onAnswerQuestion={props.onAnswerQuestion}
                                    onBubbleContextMenu={onBubbleContextMenu}
                                />
                            )
                        return (
                            <ChatUserTurn
                                item={item as UserItem}
                                onCancelQueued={props.onCancelQueued}
                                onBubbleContextMenu={onBubbleContextMenu}
                            />
                        )
                    }}
                </For>
                <Show when={props.awaitingReply}>
                    <ChatTurnColumn class={styles['chat-row']}>
                        <ChatTurnLabel label={props.persona} />
                        <div class={styles['chat-awaiting-dots']}>
                            working<Text as="span" size="inherit" tone="inherit" weight="inherit" class="asc-caret">_</Text>
                        </div>
                    </ChatTurnColumn>
                </Show>
                <Show when={props.turnError}>
                    {msg => (
                        <ChatTurnColumn class={styles['chat-turn-error']}>
                            <Icon
                                value="TriangleAlert"
                                size={13}
                                class={styles['chat-turn-error-icon']}
                            />
                            <Text as="span" size="inherit" tone="inherit" weight="inherit">
                                {msg()}
                            </Text>
                        </ChatTurnColumn>
                    )}
                </Show>
            </div>
            {/* Floating jump-back pill while the user has scrolled up off the live tail. */}
            <Show when={!following() && props.items.length > 0}>
                <PlainButton
                    class={styles['chat-jump-bottom']}
                    onClick={() => scrollToBottom(true)}
                >
                    <Icon value="ArrowDown" size={13} /> Latest
                </PlainButton>
            </Show>
            {/* Floating "Reply" on an active text selection inside a bubble. onMouseDown +
                preventDefault keeps the selection alive so onReply quotes it before it collapses. */}
            <Show when={selReply()}>
                {s => (
                    <PlainButton
                        class={styles['chat-sel-reply']}
                        style={{ left: `${s().x}px`, top: `${s().y}px` }}
                        onMouseDown={e => {
                            e.preventDefault()
                            props.onReply(s().text)
                            window.getSelection()?.removeAllRanges()
                            setSelReply(null)
                        }}
                    >
                        <Icon value="Reply" size={13} /> Reply
                    </PlainButton>
                )}
            </Show>
            <Show when={menu()}>
                {m => (
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        items={m().items}
                        onClose={() => setMenu(null)}
                    />
                )}
            </Show>
        </div>
    )
}
