import { type Component, type JSX } from 'solid-js'
import Text from './Text'

export type ErrorTextProps = {
    children: JSX.Element
    /** Merged onto the root, so a caller can place one instance (margin, alignment) without
     *  forking the component. */
    class?: string
}

/**
 * Inline error text: `Text` in the danger tone with `role="alert"`. Eight surfaces hand-rolled
 * this as a bare `<div>`/`<span>` with a local red, and only two of them announced the message —
 * so a screen reader never heard the error appear. Using this primitive is what makes the
 * announcement the default rather than something each call site must remember. `role="alert"`
 * is implicitly an assertive live region: render it WHEN the error occurs (inside a `<Show>`),
 * not permanently empty.
 */
const ErrorText: Component<ErrorTextProps> = props => (
    <Text
        as="div"
        size="ui"
        tone="danger"
        role="alert"
        class={props.class}
    >
        {props.children}
    </Text>
)

export default ErrorText
