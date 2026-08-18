// app/src/shell/PaneOverlay.tsx
// The always-mounted terminal/chat overlay shell — positioned over a pane's `data-terminal-host` /
// `data-chat-host` placeholder so a PTY or a chat WS survives tab/pane switches without a remount.
// Lifted out of App.tsx's two nearly-identical `<For>` bodies (terminal, chat) verbatim; the only
// real difference between them was the class name and that only the terminal overlay re-triggers
// the pane's context menu on right-click, both expressed here as props.
//
// The two kinds branch on `props.kind` INSIDE a `<Show>` (rather than one dynamic `class={…}`
// expression) so each branch keeps its own `class={styles['terminal-overlay']}` /
// `class={styles['chat-overlay']}` lookup. `.terminal-overlay` and `.chat-overlay` have NO other
// rules — all geometry is the inline `style` below, computed from `rect` — so each resolves to a
// single module-local class, no co-riding state; see PaneOverlay.module.css's header for the
// `:global(html.view-dragging)` rule split off into this module. The `style` object is INLINED per
// branch (not hoisted to a shared helper) so Solid can still bake the static `position: absolute`
// half into the template.
//
// `bench/templateDiff.ts --modulo-class` reports ONE emitted template here where the pre-CSS-half
// source had two (`<div class=terminal-overlay …>` / `<div class=chat-overlay …>`). That is
// EXPECTED, not a regression: with `class` excluded, both branches' static shape is now the
// byte-identical `<div style=position:absolute>`, and babel-preset-solid caches identical static
// templates — so Solid shares one template string between the two `<Show>` branches and clones it
// twice at runtime, one instance per branch, each still getting its own dynamic `class`/`style`/
// `onContextMenu` at render time. This is the SAME "a class that becomes a dynamic expression
// legitimately leaves the static template" allowance the CSS half always relies on, just visible as
// a template-count change instead of an attribute-count change because these two branches' only
// static differentiator WAS the class. `bench/probeStory.ts` (keyed by structural path, not by
// template identity) is what actually proves the two branches still render distinctly — see the
// `Terminal` and `Chat` stories.
//
// The `rect` prop is the resolved host rectangle (or absent, meaning "no host in the active tab" —
// hidden but still mounted, per the keep-alive comment this component's markup carries over from
// App.tsx). App.tsx keeps owning `terminalHostRects()`/`chatHostRects()` and the `<For>` loops;
// this component only draws one overlay for one already-resolved id.
import { Show, type JSX } from 'solid-js'
import type { Rect } from '../panes'
import styles from './PaneOverlay.module.css'

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
                    class={styles['chat-overlay']}
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
        </Show>
    )
}
