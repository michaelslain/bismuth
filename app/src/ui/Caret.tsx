import type { Component } from 'solid-js'
import './Caret.module.css'
import './ui.css'

export type CaretProps = {
    class?: string
}

/**
 * The one blinking cursor glyph, reused in terminal/chat/status/tree contexts. Owns
 * `.asc-caret` and its `@keyframes asc-blink` — moved OUT of ui/ui.css (one-global-stylesheet
 * Task 7) as the primitive that file's own header comment named as missing: five components
 * (ChatView, TermPanel, TopStrip, StatusBar, SwitcherBar) write `.asc-caret` bare, with no
 * owning component. Those call sites composing this instead is a later wave's job.
 * `asc-caret` is written as a bare string literal, not `styles[...]`, because the class is
 * still a `:global()` bridge in Caret.module.css — see that file's header.
 */
const Caret: Component<CaretProps> = props => {
    return (
        <span class={'asc-caret' + (props.class ? ` ${props.class}` : '')} />
    )
}

export default Caret
export { Caret }
