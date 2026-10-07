// app/src/chat/ChatColorDot.tsx
// The colour swatch in a chat tab's Color submenu rows (App.tsx's openTabContextMenu): one filled
// dot per swatch, plus a hollow ring for the Reset row. It is nothing but `ui/StatusDot` at its
// picker size — it used to carry its own stylesheet, which set a width and height on an inline span
// with no `display`, so the dot rendered nothing at all. No stylesheet, no size, no ring of its own.
import type { Component } from 'solid-js'
import StatusDot from '../ui/StatusDot'

export type ChatColorDotProps = {
    /** The swatch colour (any valid CSS colour). Ignored when `none` is set. */
    color?: string
    /** Renders the "no colour" ring (Reset row) instead of a filled swatch. */
    none?: boolean
}

/* NOT destructured, and typed `Component` not `FC` — Solid reads destructured props once. */
const ChatColorDot: Component<ChatColorDotProps> = props => (
    <StatusDot
        size="lg"
        ring
        color={props.none ? 'transparent' : (props.color ?? 'currentColor')}
    />
)

export default ChatColorDot
