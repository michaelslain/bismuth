// app/src/ChatColorDot.tsx
// The small color swatch shown in a chat tab's Color submenu rows (App.tsx's openTabContextMenu) —
// one filled dot per swatch, plus a "none" ring for the Reset row. Extracted per the visual-
// unification audit §9.8/§6: ChatColorDot.module.css already existed as its own file (moved out of
// the global ChatView.css during CSS modularization) with nobody's markup ever following it — the
// dot itself was still inlined as a bare <span> at the menu-item call site. A stylesheet with no
// component is a missing component.
import type { Component } from 'solid-js'
import styles from './ChatColorDot.module.css'

export type ChatColorDotProps = {
    /** The swatch color (any valid CSS color). Ignored when `none` is set. */
    color?: string
    /** Renders the "no color" ring (Reset row) instead of a filled swatch. */
    none?: boolean
}

/** A circular color swatch — genuinely round (a shape, not a softened corner), so it keeps its
 *  50% radius under the visual-unification audit's "square corners" rule (§9.2). */
/* NOT destructured, and typed `Component` not `FC`. Solid has no `FC`, and destructuring props
 * reads every field ONCE at setup and permanently unsubscribes the component from later changes —
 * the dot would keep its first colour forever. This is the Solid trap that the React-shaped house
 * rule ("props destructured in the signature", "type components as FC") walks straight into; that
 * rule is written for React and does not apply in this repo. Match Text.tsx / Heading.tsx /
 * Badge.tsx, which all take `props` whole. */
const ChatColorDot: Component<ChatColorDotProps> = props => (
    <span
        class={`${styles['chat-color-dot']} ${props.none ? styles['chat-color-dot--none'] : ''}`}
        style={
            !props.none && props.color ? { background: props.color } : undefined
        }
    />
)

export default ChatColorDot
export { ChatColorDot }
