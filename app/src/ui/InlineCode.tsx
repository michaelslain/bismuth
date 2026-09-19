import type { Component, JSX } from 'solid-js'
import styles from './InlineCode.module.css'

export type InlineCodeProps = {
    children: JSX.Element
    class?: string
}

/**
 * A short run of inline code inside prose — a property path, a setting key, a snippet quoted in
 * a hint or error message (e.g. Kanban's "needs a groupBy" hint quoting `groupBy: note.status`).
 * Renders a real `<code>` element in the app's mono chrome font, not a `<span>` faking it.
 */
const InlineCode: Component<InlineCodeProps> = props => (
    <code class={`${styles['inline-code']} ${props.class ?? ''}`}>
        {props.children}
    </code>
)

export default InlineCode
