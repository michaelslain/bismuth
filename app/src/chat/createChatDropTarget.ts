// app/src/chat/createChatDropTarget.ts
// Drag-and-drop staging for a chat surface — moved out of ChatView.tsx (~1117-1306, ~2080-2104:
// the host-level HTML5 handlers + the Tauri native-drop window listener) so the chat tab AND the
// daemon page share ONE drop target instead of two hand-rolled copies.
//
// Two transports, both covered:
//  • Browser / dev build: HTML5 drag events fire — return the three handlers to spread onto the
//    host element (`onDragOver`/`onDragLeave`/`onDrop`).
//  • Packaged Tauri app: the native drag-drop handler suppresses the webview's HTML5 `drop` for
//    external OS files, so those arrive ONLY as a `bismuth-native-drag` window event
//    (nativeDrop.ts). This installs that listener itself and hit-tests the cursor against
//    `host()`'s rect (pointInDropRect) so only the pane under the cursor stages the drop.
//
// `session` may report undefined (no session yet, e.g. the daemon pre-arm) — a drop or paste with
// no session to hand files to is simply ignored; the affordance still shows, since something IS
// being dragged over the pane, but nothing is staged until a session exists.
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js'
import type { ChatSession } from './chatSession'
import { pointInDropRect, type NativeDragDetail } from '../nativeDrop'
import { filePathsFromTransfer } from '../fileIntake'

export function createChatDropTarget(
    session: Accessor<ChatSession | undefined>,
    host: Accessor<HTMLElement | undefined>,
): {
    dragActive: Accessor<boolean>
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
} {
    const [dragActive, setDragActive] = createSignal(false)

    const onDragOver = (e: DragEvent) => {
        const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
        if (!types.includes('Files') && !types.includes('text/uri-list'))
            return
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
        const paths = filePathsFromTransfer(e.dataTransfer)
        const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
        if (!paths.length && !files.length) return
        e.preventDefault()
        const s = session()
        if (!s) return
        if (paths.length) void s.addDroppedPaths(paths)
        else void s.addDroppedFiles(files)
    }

    onMount(() => {
        const onNativeDrag = (e: Event) => {
            const d = (e as CustomEvent<NativeDragDetail>).detail
            const el = host()
            if (!d || !el) return
            const inside = pointInDropRect(el.getBoundingClientRect(), d.x, d.y)
            if (d.type === 'drop') {
                setDragActive(false)
                if (!inside || d.paths.length === 0) return
                const s = session()
                if (s) void s.addDroppedPaths(d.paths)
            } else if (d.type === 'leave') {
                setDragActive(false)
            } else {
                setDragActive(inside)
            }
        }
        window.addEventListener('bismuth-native-drag', onNativeDrag)
        onCleanup(() =>
            window.removeEventListener('bismuth-native-drag', onNativeDrag),
        )
    })

    return { dragActive, onDragOver, onDragLeave, onDrop }
}
