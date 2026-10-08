// app/src/quickAsk/QuickAsk.tsx — the only importer of QuickAsk.module.css; QuickAskHost.tsx is the only importer of this component.
// The Cmd+K popover: the chat itself, floating beside the caret. A header row (the daemon face + its
// name, then `[ apply ]` once a reply exists in a note, `[ open in chat ] [ esc ]`) over the shared
// chat/ChatSessionBody in its `column` layout — the same transcript (tool rows, thinking, permission and question cards), the
// same composer (attachments, mentions, slash commands, paste) and the same ChatControls row
// (model // mode // history // new chat) as the chat tab. It owns only presentation, placement and
// dismissal: the session, the apply flow and the hand-off are the host's (props).
//
// The panel is NOT modal. It has no backdrop, so a drag can start anywhere in the app (a sidebar
// row, a tab, a file from the OS) and land on it: HTML5 and native drops through
// createChatDropTarget (capture phase, so the note editor underneath never claims a drop on the
// popover), in-app pointer drags through the `data-chat-drop` hook dnd/viewDrag.ts resolves. A CLICK
// in the app outside it dismisses (a press that moves past `CLICK_SLOP` is a drag, not a click); a
// press inside another floating layer (the model menu, the history dialog) is that layer's own.
// Escape dismisses unless something already consumed it (the composer's stop, an open menu) or focus
// sits in another floating layer.
// Placement is `popoverPlacement` (pure).
import {
    createMemo,
    createSignal,
    onCleanup,
    Show,
    type Component,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ChatSession } from '../chat/chatSession'
import ChatSessionBody from '../chat/ChatSessionBody'
import { createChatDropTarget } from '../chat/createChatDropTarget'
import DaemonFace from '../daemon/DaemonFace'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import DropCue from '../ui/DropCue'
import Popover from '../ui/Popover'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { isDismissKey } from '../ui/widgetKeys'
import type { QuickAskAnchor } from './quickAskState'
import {
    faceMood,
    isClick,
    popoverPlacement,
    popoverWidth,
} from './quickAskLogic'
import styles from './QuickAsk.module.css'

export type QuickAskProps = {
    anchor: QuickAskAnchor
    /** The chat this popover shows (drops are delivered to it). */
    chatId: string
    /** undefined until the registry creates it */
    session: ChatSession | undefined
    daemonEnabled: boolean
    /** The header name: the daemon's name when it is enabled, else `chat`. */
    name: string
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    /** An in-app drag (sidebar row, tab, pane) is over the popover — shows the drop cue. */
    dragOver?: boolean
    /** Not offered at all without a note to edit (`anchor.kind === 'pane'`, or no note path). The
     *  event is handed over so the host can require a trusted click. */
    onApply?: (e: MouseEvent) => void
    onOpenInChat: () => void
    onClose: () => void
    class?: string
}

type Rect = { left: number; top: number; width: number; height: number }

/** Viewport geometry for the anchor: the caret line (note editors), the pane it lives in, and the
 *  element whose top-level subtree is "the app" for outside-click purposes. */
function anchorGeometry(anchor: QuickAskAnchor): {
    caret: { left: number; top: number; bottom: number } | null
    /** The rect the popover is clamped inside: the pane, narrowed to the editor's content column
     *  for a caret anchor (so it never hangs into the empty gutter). */
    pane: Rect
    /** The whole pane's width, which sizes the popover. */
    paneWidth: number
    host: Element | null
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
        const leaf =
            anchor.view.dom.closest('[data-pane-leaf]') ?? anchor.view.dom
        const pane = rectOf(leaf)
        const col = anchor.view.contentDOM.getBoundingClientRect()
        return {
            caret: c ? { left: c.left, top: c.top, bottom: c.bottom } : null,
            pane:
                col.width > 0
                    ? { ...pane, left: col.left, width: col.width }
                    : pane,
            paneWidth: pane.width,
            host: leaf,
        }
    }
    const leaf = anchor.leafId
        ? document.querySelector(
              `[data-pane-leaf="${CSS.escape(anchor.leafId)}"]`,
          )
        : null
    const pane = rectOf(leaf)
    return { caret: null, pane, paneWidth: pane.width, host: leaf }
}

/** The direct child of <body> holding `el` — the app's mount, or a portaled floating layer. */
function layerOf(el: Node | null): Node | null {
    let n = el
    while (n && n.parentNode && n.parentNode !== document.body) n = n.parentNode
    return n && n.parentNode === document.body ? n : null
}

const QuickAsk: Component<QuickAskProps> = props => {
    const [size, setSize] = createSignal({ width: 0, height: 0 })
    const [viewport, setViewport] = createSignal(0)
    const bump = () => setViewport(v => v + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    onCleanup(() => {
        window.removeEventListener('resize', bump)
        window.removeEventListener('scroll', bump, true)
    })

    const geometry = createMemo(() => {
        viewport()
        return anchorGeometry(props.anchor)
    })
    const width = () => popoverWidth(geometry().paneWidth)
    const place = createMemo(() =>
        popoverPlacement({
            caret: geometry().caret,
            pane: geometry().pane,
            size: { width: width(), height: size().height },
        }),
    )

    let panel: HTMLDivElement | undefined
    let observer: ResizeObserver | undefined
    function onRoot(el: HTMLDivElement): void {
        panel = el
        const measure = () =>
            setSize({ width: el.offsetWidth, height: el.offsetHeight })
        // Before first paint, so the first frame is already beside the caret.
        queueMicrotask(measure)
        observer = new ResizeObserver(measure)
        observer.observe(el)
        // The composer takes focus on open (the Cmd+K press was the person's own gesture).
        // `.cm-content` is CodeMirror's own class (a third-party editor, never hashed).
        requestAnimationFrame(() =>
            el
                .querySelector<HTMLElement>('.cm-content')
                ?.focus({ preventScroll: true }),
        )
    }
    onCleanup(() => observer?.disconnect())

    // ── dismissal: a click (not a drag) in the app outside the panel, or an unconsumed Escape ──
    let press: { x: number; y: number } | null = null
    const onPointerDown = (e: PointerEvent) => {
        press = null
        const target = e.target as Node | null
        if (!target || panel?.contains(target)) return
        const appLayer = layerOf(geometry().host)
        if (appLayer && layerOf(target) !== appLayer) return
        press = { x: e.clientX, y: e.clientY }
    }
    const onPointerUp = (e: PointerEvent) => {
        const p = press
        press = null
        if (p && isClick(p, { x: e.clientX, y: e.clientY })) props.onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.defaultPrevented || !isDismissKey(e)) return
        const active = document.activeElement
        // Escape in another floating layer (the history dialog, a menu) is that layer's; anywhere in
        // the panel or the app itself (the note's editor included) it closes the popover.
        if (
            active &&
            active !== document.body &&
            !panel?.contains(active) &&
            layerOf(active) !== layerOf(geometry().host)
        )
            return
        e.preventDefault()
        props.onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('pointerup', onPointerUp, true)
        window.removeEventListener('keydown', onKeyDown)
    })

    const drop = createChatDropTarget(
        () => props.chatId,
        () => panel,
        { capture: true },
    )

    const streaming = () => props.session?.streaming() ?? false
    const busy = () => streaming() || (props.session?.awaitingReply() ?? false)
    const lastReplyText = () => {
        const t = props.session?.transcript
        const last = t?.[t.length - 1]
        if (last?.role !== 'assistant') return ''
        return last.parts.map(p => (p.kind === 'text' ? p.text : '')).join('')
    }
    // Offered only in a note, and only once there is a reply to apply.
    const canApply = () =>
        props.anchor.kind === 'caret' &&
        props.anchor.notePath !== null &&
        !!props.session?.transcript.some(i => i.role === 'assistant')
    const mood = () =>
        faceMood({
            daemonEnabled: props.daemonEnabled,
            streaming: busy(),
            hasReplyText: lastReplyText().trim() !== '',
            typing: (props.session?.draft() ?? '').trim() !== '',
        })

    return (
        <Portal>
            <div
                ref={onRoot}
                class={`${styles.layer} ${props.class ?? ''}`}
                style={{
                    left: `${place().left}px`,
                    top: `${place().top}px`,
                    width: `${width()}px`,
                    'max-height': `${place().maxHeight}px`,
                }}
                data-chat-surface=""
                data-quick-ask=""
                data-chat-drop={props.chatId}
                role="dialog"
                aria-label="ask the daemon"
                onDragOver={drop.onDragOver}
                onDragLeave={drop.onDragLeave}
                onDrop={drop.onDrop}
            >
                <Popover tone="panel" class={styles['quick-ask']}>
                    <DropCue active={drop.dragActive() || !!props.dragOver} />
                    <div class={styles.row}>
                        <div class={styles.who}>
                            <DaemonFace
                                mood={mood()}
                                size="avatar"
                                label={props.name}
                            />
                            <Text as="span" class={styles.name}>
                                {props.name}
                            </Text>
                        </div>
                        <div class={styles.actions}>
                            <Show when={canApply() && props.onApply}>
                                {apply => (
                                    <TextButton
                                        primary
                                        disabled={
                                            busy() ||
                                            lastReplyText().trim() === ''
                                        }
                                        onClick={e => apply()(e)}
                                    >
                                        apply
                                    </TextButton>
                                )}
                            </Show>
                            <TextButton onClick={() => props.onOpenInChat()}>
                                open in chat
                            </TextButton>
                            <TextButton onClick={() => props.onClose()}>
                                esc
                            </TextButton>
                        </div>
                    </div>
                    <div class={styles.chat}>
                        <ChatSessionBody
                            variant="column"
                            session={props.session}
                            placeholder={`Message ${props.name}`}
                            persona={props.name}
                            avatarMood={mood()}
                            noteNames={props.noteNames}
                            memoryNames={props.memoryNames}
                            tagNames={props.tagNames}
                            chatId={props.chatId}
                        />
                    </div>
                </Popover>
            </div>
        </Portal>
    )
}

export default QuickAsk
