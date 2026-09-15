// app/src/shell/PaneOverlay.tsx
// The always-mounted terminal overlay shell — positioned over a pane's `data-terminal-host`
// placeholder so a PTY survives tab/pane switches without a remount. Lifted out of App.tsx's `<For>`
// body verbatim; the overlay re-triggers the pane's context menu on right-click via `onContextMenu`.
//
// There used to be a second `kind`, `'chat'`: chats rode the same keep-alive overlay until their
// session moved into a registry that outlives any view (chat/chatSessions.ts), after which the chat
// tab renders inline in PaneContent. `kind` stays as a one-member union so a call site still names
// what it overlays.
//
// The `rect` prop is the resolved host rectangle (or absent, meaning "no host in the active tab" —
// hidden but still mounted, per the keep-alive comment this component's markup carries over from
// App.tsx). App.tsx keeps owning `terminalHostRects()` and the `<For>` loop; this component only
// draws one overlay for one already-resolved id.
import type { JSX } from 'solid-js'
import type { Rect } from '../panes'
import styles from './PaneOverlay.module.css'

export function PaneOverlay(props: {
    kind: 'terminal'
    rect?: Rect
    onContextMenu?: (e: MouseEvent) => void
    children: JSX.Element
}) {
    return (
        <div
            class={styles['terminal-overlay']}
            onContextMenu={props.onContextMenu}
            style={{
                position: 'absolute',
                left: props.rect ? `${props.rect.x}px` : '0',
                top: props.rect ? `${props.rect.y}px` : '0',
                width: props.rect ? `${props.rect.w}px` : '100%',
                height: props.rect ? `${props.rect.h}px` : '100%',
                display: props.rect ? 'block' : 'none',
            }}
        >
            {props.children}
        </div>
    )
}
