// app/src/chat/createChatDropTarget.ts
// Drag-and-drop intake for a chat surface — the chat tab (ChatView.tsx) and the daemon page's
// inline chat (DaemonPageHost.tsx). Every draggable from OUTSIDE the app lands here; in-app
// draggables (sidebar rows, tabs, panes) are pointer drags resolved by App's viewDrag handler, which
// hands the same chat a `mention` through `deliverChatDrop`. Full matrix: docs/overview/draggables.md.
//
// Two transports, both covered:
//  • Browser / dev build: HTML5 drag events fire — return the three handlers to spread onto the
//    host element. Files and `file:` URIs stage as files; anything else (a browser image, a link,
//    dragged text) goes through the same pasteboard planner a note uses (dropIntake.planDrop).
//  • Packaged Tauri app: the native drag-drop handler suppresses the webview's HTML5 `drop`, so
//    drags arrive ONLY as a `bismuth-native-drag` window event (nativeDrop.ts), hit-tested against
//    `host()`'s rect so only the pane under the cursor takes it. A drop with no OS paths (browser
//    image, link, text, a Photos file promise) reads the drag pasteboard via `read_drag_pasteboard`,
//    exactly as the note editor does.
//
// `beforeDrop` runs once a drop is accepted, before it is delivered — the daemon page arms its chat
// there, and the drop waits in `deliverChatDrop`'s queue until the session exists. `capture` hears the
// native event before every bubble-phase listener, so a surface floating OVER another drop target
// (the Cmd+K popover over a note editor) claims a drop on itself first.
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js'
import { pointInDropRect, type NativeDragDetail } from '../nativeDrop'
import { claimNativeDrop } from '../nativeDropRouting'
import { filePathsFromTransfer } from '../fileIntake'
import {
    pasteboardFromTransfer,
    planDrop,
    type DragPasteboard,
} from '../dropIntake'
import { pushToast } from '../ui/toastStore'
import { deliverChatDrop } from './chatSessions'
import { chatActionsFromPlan, type ChatDropAction } from './chatDrop'

const ACCEPTED_TYPES = ['Files', 'text/uri-list', 'text/plain', 'text/html']

export function createChatDropTarget(
    chatId: Accessor<string>,
    host: Accessor<HTMLElement | undefined>,
    opts: { beforeDrop?: () => void; capture?: boolean } = {},
): {
    dragActive: Accessor<boolean>
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
} {
    const [dragActive, setDragActive] = createSignal(false)

    const deliver = (actions: ChatDropAction[]) => {
        if (!actions.length) {
            pushToast("Couldn't read that drop")
            return
        }
        opts.beforeDrop?.()
        for (const a of actions) deliverChatDrop(chatId(), a)
    }

    const onDragOver = (e: DragEvent) => {
        const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
        if (!types.some(t => ACCEPTED_TYPES.includes(t))) return
        e.preventDefault()
        setDragActive(true)
    }
    const onDragLeave = (e: DragEvent) => {
        const el = host()
        if (e.relatedTarget && el?.contains(e.relatedTarget as Node)) return
        setDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
        setDragActive(false)
        // The composer's CodeMirror already took a text drop onto itself — don't insert it twice.
        if (e.defaultPrevented || !e.isTrusted) return
        const dt = e.dataTransfer
        const paths = filePathsFromTransfer(dt)
        const files = dt ? Array.from(dt.files) : []
        e.preventDefault()
        if (paths.length) deliver([{ kind: 'paths', paths }])
        else if (files.length) deliver([{ kind: 'files', files }])
        else deliver(chatActionsFromPlan(planDrop(pasteboardFromTransfer(dt))))
    }

    onMount(() => {
        const onNativeDrag = async (e: Event) => {
            const d = (e as CustomEvent<NativeDragDetail>).detail
            const el = host()
            if (!d || !el) return
            const inside = pointInDropRect(el.getBoundingClientRect(), d.x, d.y)
            if (d.type === 'leave') setDragActive(false)
            else if (d.type !== 'drop') setDragActive(inside)
            if (d.type !== 'drop') return
            setDragActive(false)
            if (!inside || !claimNativeDrop(d)) return
            if (d.paths.length) {
                deliver([{ kind: 'paths', paths: d.paths }])
                return
            }
            let pb: DragPasteboard
            try {
                const { invoke } = await import('@tauri-apps/api/core')
                pb = await invoke<DragPasteboard>('read_drag_pasteboard')
            } catch (err) {
                pushToast("Couldn't read that drop")
                console.error('read_drag_pasteboard failed', err)
                return
            }
            deliver(chatActionsFromPlan(planDrop(pb)))
        }
        const capture = opts.capture === true
        window.addEventListener('bismuth-native-drag', onNativeDrag, capture)
        onCleanup(() =>
            window.removeEventListener(
                'bismuth-native-drag',
                onNativeDrag,
                capture,
            ),
        )
    })

    return { dragActive, onDragOver, onDragLeave, onDrop }
}
