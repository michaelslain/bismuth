// app/src/ui/Disclosure.tsx
// A summary line that opens and closes a body: a button, a chevron, `aria-expanded`, and the
// height-animating Collapsible. Was built five different ways — chat/ChatToolRow and
// chat/ChatThinkingBlock swapped a Down/Right icon pair and set no `aria-expanded`;
// bases/PropertyRowEditor rotated a `chevron-right`; preview/CompanionFrontmatter and
// preview/OutlineTree each did their own — with the chevron on the OPPOSITE side in two of them and
// the body indented by a hardcoded 20px or 22px.
//
// THE CHEVRON LEADS (the majority spelling), is ONE glyph that rotates a quarter turn when open, and
// the body is indented by `--disclosure-indent` (chevron width + gap) so it hangs under the summary
// text. Controlled: the caller owns `open`, so a disclosure can be driven by a tree or a store.
import { children, Show, type Component, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import Collapsible from './Collapsible'
import ListRow from './ListRow'
import PlainButton from './PlainButton'
import styles from './Disclosure.module.css'

export type DisclosureProps = {
    open: boolean
    onToggle: () => void
    /** What the button shows after the chevron — a label, or a row of parts. */
    summary: JSX.Element
    /** A control that sits at the END of the head line, OUTSIDE the toggle button — an eye, a
     *  remove `[x]`. Beside the button, never inside it, so it is not part of the disclosure's
     *  accessible name and a click on it never toggles. */
    trailing?: JSX.Element
    /** The body; mounted while open and for the length of the collapse. */
    children: JSX.Element
    /** Merged onto the root, so a caller can adjust one instance without forking the component. */
    class?: string
}

const Disclosure: Component<DisclosureProps> = props => {
    // Resolved ONCE: a JSX prop is a getter that builds a fresh instance per read (see ListRow).
    const trailing = children(() => props.trailing)
    const head = (
        <PlainButton
            class={styles.head}
            aria-expanded={props.open}
            onClick={() => props.onToggle()}
        >
            <Icon
                value="ChevronRight"
                class={`${styles.chevron} ${props.open ? styles.open : ''}`}
            />
            <span class={styles.summary}>{props.summary}</span>
        </PlainButton>
    )
    return (
        <div
            class={`${styles.disclosure} ${props.class ?? ''}`}
            data-testid="disclosure"
        >
            <Show when={trailing()} fallback={head}>
                <ListRow trailing={trailing()}>{head}</ListRow>
            </Show>
            <Collapsible open={props.open}>
                <div class={styles.body}>{props.children}</div>
            </Collapsible>
        </div>
    )
}

export default Disclosure
export { Disclosure }
