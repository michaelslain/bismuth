import { onCleanup, onMount, type Component } from 'solid-js'
import { syncToDocumentClock } from './caretClock'

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
    let el!: HTMLSpanElement
    // Every caret blinks on ONE clock (ui/caretClock.ts): pinned on mount, and again whenever its
    // blink restarts — a class that turns the animation off and back on (the intro copy's typing
    // state) starts a fresh, unsynced one.
    onMount(() => {
        const sync = () => syncToDocumentClock(el)
        sync()
        el.addEventListener('animationstart', sync)
        onCleanup(() => el.removeEventListener('animationstart', sync))
    })
    return (
        <span
            ref={el}
            class={`asc-caret${props.class ? ` ${props.class}` : ''}`}
        >
            _
        </span>
    )
}

export default Caret
export { Caret }
