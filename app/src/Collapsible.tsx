// A height-animating disclosure wrapper. Extracted from FileTree.tsx (visual-unification audit
// §6/§9.8) — it was one of five components sharing that file, which meant it had no story and could
// not be looked at in isolation.
//
// TWO PIECES OF STATE, NOT ONE, and they are not redundant. `mounted` controls whether the children
// exist in the DOM at all; `expanded` drives the CSS transition. Opening sets `mounted` first and
// flips `expanded` on the NEXT frame, because a transition cannot run from a value the element has
// never rendered at — set both in the same tick and it snaps open with no animation. Closing runs
// the other way: `expanded` goes false immediately, and `mounted` only drops once the transition
// actually reports finishing, so the children stay alive for the duration of the collapse.
import {
    createSignal,
    createEffect,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import styles from './Collapsible.module.css'

export type CollapsibleProps = {
    open: boolean
    children: JSX.Element
    /** Merged onto the root, so a caller can adjust one instance without forking the component. */
    class?: string
}

const Collapsible: Component<CollapsibleProps> = props => {
    const [mounted, setMounted] = createSignal(props.open)
    const [expanded, setExpanded] = createSignal(props.open)
    createEffect(() => {
        if (props.open) {
            setMounted(true)
            requestAnimationFrame(() => setExpanded(true))
        } else {
            setExpanded(false)
        }
    })
    return (
        <div
            class={`${styles['ft-collapse']} ${props.class ?? ''}`}
            classList={{ [styles['open']]: expanded() }}
            onTransitionEnd={e => {
                // Guarded on the property name: this element also inherits unrelated transitions,
                // and unmounting the children on any of them would empty the panel mid-animation.
                if (e.propertyName === 'grid-template-rows' && !props.open)
                    setMounted(false)
            }}
        >
            <div class={styles['ft-collapse-inner']}>
                <Show when={mounted()}>{props.children}</Show>
            </div>
        </div>
    )
}

export default Collapsible
export { Collapsible }
