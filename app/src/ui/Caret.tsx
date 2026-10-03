import type { Component } from 'solid-js'

export type CaretProps = {
    class?: string
}

/**
 * The brand's blinking cursor mark — a decorative `_`, deliberately NOT the text-entry cursor's
 * shape: every editor and the terminal draw a --cursor-width accent bar (editor/cursorTheme.ts,
 * .xterm-custom-cursor), while this mark stays an underscore. It shares their colour (--accent) and
 * their blink (--cursor-blink, appearance.cursorBlinkSeconds). `.asc-caret` (+ its
 * `@keyframes asc-blink`) lives in app/src/global.css as a bare global, written only by this
 * component. Caret supplies the "_" content: an EMPTY element has no intrinsic size and renders as a
 * 0x0 box, invisible regardless of color/animation.
 */
const Caret: Component<CaretProps> = props => {
    return <span class={`asc-caret${props.class ? ` ${props.class}` : ''}`}>_</span>
}

export default Caret
export { Caret }
