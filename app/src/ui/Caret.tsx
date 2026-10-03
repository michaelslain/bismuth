import type { Component } from 'solid-js'

export type CaretProps = {
    class?: string
}

/**
 * The one blinking cursor glyph. `.asc-caret` (+ its `@keyframes asc-blink`) lives in
 * app/src/global.css as a bare global, written only by this component. `Terminal.tsx`'s xterm
 * cursor and `ChatComposer`'s CodeMirror cursor imitate its look (accent underline) but do not
 * reference the class. Caret supplies the "_" content: an EMPTY element has no intrinsic size and
 * renders as a 0x0 box, invisible regardless of color/animation.
 */
const Caret: Component<CaretProps> = props => {
    return <span class={`asc-caret${props.class ? ` ${props.class}` : ''}`}>_</span>
}

export default Caret
export { Caret }
