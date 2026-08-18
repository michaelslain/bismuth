// app/src/shell/PaneOverlay.tsx
// The always-mounted terminal/chat overlay shell — positioned over a pane's `data-terminal-host` /
// `data-chat-host` placeholder so a PTY or a chat WS survives tab/pane switches without a remount.
// Lifted out of App.tsx's two nearly-identical `<For>` bodies (terminal, chat) verbatim; the only
// real difference between them was the class name and that only the terminal overlay re-triggers
// the pane's context menu on right-click, both expressed here as props.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE). The two kinds branch on `props.kind` INSIDE a `<Show>` (rather
// than one dynamic `class={…}` expression) specifically so each branch keeps a static
// `class="terminal-overlay"` / `class="chat-overlay"` literal — a dynamic class here would leave
// the extraction half nothing to prove byte-for-byte, since Solid drops a dynamic `class` from the
// static template entirely. `.terminal-overlay` and `.chat-overlay` have NO other rules — all
// geometry is the inline `style` below, computed from `rect` — so once the CSS half lands each
// still resolves to a single module-local class, no co-riding state. The `style` object is INLINED
// per branch (not hoisted to a shared helper) so Solid can still bake the static `position:
// absolute` half into the template exactly as it did before the extraction — a hoisted accessor
// would make the whole style prop opaque to the compiler and lose that.
//
// The `rect` prop is the resolved host rectangle (or absent, meaning "no host in the active tab" —
// hidden but still mounted, per the keep-alive comment this component's markup carries over from
// App.tsx). App.tsx keeps owning `terminalHostRects()`/`chatHostRects()` and the `<For>` loops;
// this component only draws one overlay for one already-resolved id.
import { Show, type JSX } from 'solid-js'
import type { Rect } from '../panes'

export function PaneOverlay(props: {
    kind: 'terminal' | 'chat'
    rect?: Rect
    onContextMenu?: (e: MouseEvent) => void
    children: JSX.Element
}) {
    return (
        <Show
            when={props.kind === 'terminal'}
            fallback={
                <div
                    class="chat-overlay"
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
            }
        >
            <div
                class="terminal-overlay"
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
        </Show>
    )
}
