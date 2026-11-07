// app/src/chat/ChatTranscript.tsx — ChatTranscript.module.css is the ONLY importer of its module.
// The scrollable message list: owns its own scroll container, follow-bottom tracking + the
// "Latest" jump pill, the vault names a message's links resolve against, the floating
// selection "Reply" button, and the bubble right-click menu (Reply/Copy). Renders each TurnItem via
// ChatUserTurn/ChatAssistantTurn/ChatSystemNote, plus the transient "awaiting reply" and per-turn
// error rows. Rendered in the chat tab and the daemon page, driven by a `ChatSession`
// (subscribeAppend = session.onAppend).
import {
    children,
    createEffect,
    createMemo,
    createSignal,
    For,
    onCleanup,
    on,
    onMount,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import Caret from '../ui/Caret'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import { ChatVaultNamesContext } from './chatVaultNames'
import { IconTextButton } from '../ui/IconTextButton'
import { TextButton } from '../ui/TextButton'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import Popover from '../ui/Popover'
import { copyText } from '../ui/copyText'
import ChatTurnColumn from './ChatTurnColumn'
import ChatTurnLabel from './ChatTurnLabel'
import ChatUserTurn from './ChatUserTurn'
import ChatAssistantTurn from './ChatAssistantTurn'
import ChatSystemNote from './ChatSystemNote'
import ChatNote from './ChatNote'
import DaemonFace from '../daemon/DaemonFace'
import type { DaemonMood } from '../daemon/daemonFaceModel'
import { avatarIndex } from './chatAvatar'
import type { AssistantItem, TurnItem, UserItem } from './chatTranscriptLogic'
import {
    BOTTOM_SLACK,
    loadChatScroll,
    saveChatScroll,
    spotAt,
    topFor,
    type ChatScrollSpot,
} from './chatScrollMemory'
import styles from './ChatTranscript.module.css'

/** Input that means the person is scrolling the transcript themselves. */
const INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

export type ChatTranscriptProps = {
    items: readonly TurnItem[]
    /** Label for assistant turns (the persona name). */
    persona: string
    /** The bot's face (the daemon's `.:[00]:.`) — the avatar on the LOWEST assistant row only
     *  (chatAvatar.ts's `avatarIndex`): earlier turns show just the name. Its mood; default
     *  `thinking` while a reply is awaited, else `idle`. */
    avatarMood?: DaemonMood
    awaitingReply: boolean
    turnError: string | null
    /** Shown when items is empty; omit for nothing. */
    empty?: JSX.Element
    onAnswerPermission: (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => void
    onAnswerQuestion: (
        id: string,
        answers: Record<string, string> | null,
    ) => void
    onCancelQueued: (queueId: string) => void
    /** The conversation this transcript shows, and where a button's `send` goes (the session's
     *  sendText). Together they make an assistant message's ```button fences live. */
    chatId?: string
    onSend?: (text: string) => void
    /** Selection-reply button + bubble context menu "Reply". */
    onReply: (text: string) => void
    /** Subscribe to appends (pass session.onAppend). Follow-bottom + "Latest" pill live here. */
    subscribeAppend?: (listener: (force: boolean) => void) => () => void
    /** 'pane' (default): the list's own inline padding. 'flush': none, so the turn column's left
     *  edge is the host's — the daemon page aligns transcript, composer and controls on one edge. */
    inset?: 'pane' | 'flush'
    /** Vault notes and memory notes that links inside messages resolve against, as in a note. */
    noteNames?: () => NoteCandidate[]
    memoryNames?: () => MemoryCandidate[]
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

const ChatTranscript: Component<ChatTranscriptProps> = props => {
    let list!: HTMLDivElement

    // `children()` resolves the `empty` JSX prop ONCE and memoizes it — reading `props.empty`
    // directly in both the Show `when` and its body would run the getter twice, instantiating the
    // caller's EmptyState tree a second time on every read (and rebuilding it on every
    // empty↔non-empty flip).
    const empty = children(() => props.empty)

    // Which item carries the face — -1 while the awaiting row below the list holds it instead.
    const faceAt = createMemo(() =>
        avatarIndex(props.items, props.awaitingReply),
    )
    const face = () => (
        <DaemonFace
            mood={
                props.avatarMood ?? (props.awaitingReply ? 'thinking' : 'idle')
            }
            size="avatar"
            label={props.persona.toLowerCase()}
        />
    )

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
        // A forced jump (the pill, a sent message) wins over a restore still holding its spot.
        if (force) {
            endRestore()
            setFollowing(true)
        }
        if (!following()) return
        queueMicrotask(() => {
            if (list) list.scrollTop = list.scrollHeight
        })
    }

    // Each message's top in the list's content. Rows are the list's first `items.length` children
    // (the empty slot renders only with no items). offsetTop ignores the list's own scroll.
    const rowTops = () => {
        const rows = Array.from(list.children).slice(0, props.items.length)
        return rows.map(r => (r as HTMLElement).offsetTop - list.offsetTop)
    }

    // Restoring: true from mount until the rows stop changing height or the person scrolls. While
    // it runs, the saved spot is re-applied every frame and scroll events do not overwrite it.
    let restoring = false
    let endRestore = () => {}

    /** Hold `spot` while the transcript settles: a remount shows every message as plain text and
     *  swaps in its note view as it nears the viewport (NoteProse `lazy`), and CodeMirror measures
     *  after that, so the rows keep changing height for a while after the first frame. Ends once
     *  the content height has been still for SETTLE_MS, after MAX_MS, or at the first wheel, touch,
     *  pointer or key in the list. */
    const SETTLE_MS = 600
    const MAX_MS = 5000
    const holdSpot = (spot: ChatScrollSpot) => {
        restoring = true
        const start = performance.now()
        let stillSince = start
        let lastHeight = -1
        let frame = 0
        const stop = () => {
            if (!restoring) return
            restoring = false
            cancelAnimationFrame(frame)
            for (const ev of INPUT_EVENTS) list.removeEventListener(ev, stop)
            onListScroll()
        }
        for (const ev of INPUT_EVENTS)
            list.addEventListener(ev, stop, { passive: true })
        endRestore = stop
        onCleanup(stop)
        const tick = (now: number) => {
            if (!restoring) return
            if (list.clientHeight > 0) {
                const top = topFor(spot, rowTops(), list)
                if (Math.abs(list.scrollTop - top) > 1) list.scrollTop = top
                if (list.scrollHeight !== lastHeight) {
                    lastHeight = list.scrollHeight
                    stillSince = now
                }
            } else stillSince = now
            if (now - stillSince >= SETTLE_MS || now - start >= MAX_MS)
                return stop()
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
    }

    onMount(() => {
        const saved = props.chatId ? loadChatScroll(props.chatId) : undefined
        const spot = saved ?? { bottom: true as const }
        setFollowing(spot.bottom || spot.row >= props.items.length)
        holdSpot(spot)
        const unsub = props.subscribeAppend?.(force => scrollToBottom(force))
        if (unsub) onCleanup(unsub)
    })

    // A new notice (a refused send or attach, a lost connection) is brought into view: it answers
    // what the person just did, so it must not sit below the fold where they scrolled away from it.
    createEffect(
        on(
            () => props.turnError,
            msg => {
                if (msg) scrollToBottom(true)
            },
            { defer: true },
        ),
    )

    const turnNotice = () => (
        <Show when={props.turnError}>
            {msg => (
                <ChatTurnColumn>
                    <ChatNote icon="TriangleAlert" tone="danger">
                        {msg()}
                    </ChatNote>
                </ChatTurnColumn>
            )}
        </Show>
    )

    const onListScroll = () => {
        if (!list || restoring || list.clientHeight === 0) return
        setFollowing(
            list.scrollHeight - list.scrollTop - list.clientHeight <
                BOTTOM_SLACK,
        )
        if (props.chatId)
            saveChatScroll(props.chatId, spotAt(rowTops(), list))
        // The floating selection-reply button is anchored to a viewport position that scrolling
        // invalidates — drop it (a fresh selection re-shows it).
        if (selReply()) setSelReply(null)
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
                onSelect: () => copyText(selected || text),
            },
        ]
        setMenu({ x: e.clientX, y: e.clientY, items })
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
        <ChatVaultNamesContext.Provider
            value={{
                noteNames: () => props.noteNames?.() ?? [],
                memoryNames: () => props.memoryNames?.() ?? [],
            }}
        >
            <div class={`${styles['chat-list-wrap']} ${props.class ?? ''}`}>
                <div
                    class={styles['chat-list']}
                    classList={{
                        [styles['chat-list--flush']]: props.inset === 'flush',
                    }}
                    ref={list!}
                    data-chat-list
                    onScroll={onListScroll}
                    onMouseUp={onListMouseUp}
                >
                    <Show when={props.items.length === 0 && empty()}>
                        <div class={styles['chat-empty']}>
                            {/* The notice shares the greeting's full-height slot, or it lands below
                                the fold. */}
                            <div class={styles['chat-empty-stack']}>
                                {empty()}
                                {turnNotice()}
                            </div>
                        </div>
                    </Show>
                    <For each={props.items}>
                        {(item, i) => {
                            if (item.role === 'system')
                                return <ChatSystemNote text={item.text} />
                            if (item.role === 'assistant')
                                return (
                                    <ChatAssistantTurn
                                        item={item as AssistantItem}
                                        persona={props.persona}
                                        avatar={
                                            i() === faceAt()
                                                ? face()
                                                : undefined
                                        }
                                        onAnswerPermission={
                                            props.onAnswerPermission
                                        }
                                        onAnswerQuestion={
                                            props.onAnswerQuestion
                                        }
                                        onBubbleContextMenu={
                                            onBubbleContextMenu
                                        }
                                        chatId={props.chatId}
                                        onSend={props.onSend}
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
                            <ChatTurnLabel
                                label={props.persona}
                                avatar={face()}
                            />
                            <ChatNote>
                                working
                                <Caret />
                            </ChatNote>
                        </ChatTurnColumn>
                    </Show>
                    <Show when={!(props.items.length === 0 && empty())}>
                        {turnNotice()}
                    </Show>
                </div>
                {/* Floating jump-back pill while the user has scrolled up off the live tail. */}
                <Show when={!following() && props.items.length > 0}>
                    <IconTextButton
                        icon="ArrowDown"
                        class={styles['chat-jump-bottom']}
                        onClick={() => scrollToBottom(true)}
                    >
                        latest
                    </IconTextButton>
                </Show>
                {/* Floating "Reply" on an active text selection inside a bubble. onMouseDown +
                    preventDefault keeps the selection alive so onReply quotes it before it collapses.
                    The Popover is its surface: the bracket register paints no fill, and this floats
                    over the prose above the selection. It is portalled to <body>: every pane is
                    `contain: strict` (PaneLeaf.module.css), which makes the pane the containing block
                    of a `position: fixed` descendant, so viewport coordinates placed inside the pane
                    would land offset by the pane's own position. */}
                <Show when={selReply()}>
                    {s => (
                        <Portal>
                            <Popover
                                class={styles['chat-sel-reply']}
                                style={{ left: `${s().x}px`, top: `${s().y}px` }}
                            >
                                <TextButton
                                    onMouseDown={e => {
                                        e.preventDefault()
                                        props.onReply(s().text)
                                        window.getSelection()?.removeAllRanges()
                                        setSelReply(null)
                                    }}
                                >
                                    reply
                                </TextButton>
                            </Popover>
                        </Portal>
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
        </ChatVaultNamesContext.Provider>
    )
}

export default ChatTranscript
