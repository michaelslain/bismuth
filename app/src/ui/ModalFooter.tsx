// app/src/ui/ModalFooter.tsx
// The action strip every modal repeats: an optional `esc` hint, optional leading (left-aligned)
// actions, a spacer, and the trailing (right-aligned) actions. Extracted alongside ModalHeader —
// see its header comment for why.
//
// The slot split matters: EventModal's DELETE/DUPLICATE and the settings modals' RESET are
// LEADING actions, while CANCEL/SAVE are trailing. Call sites used to express that with a bare
// `<div class="sp">` spacer element hand-placed between them, plus a one-off `margin-left: 14px`
// inline style in QueryBuilder and a `.set-reset-btn` class in CalendarSettings doing the same
// thing two different ways. Both are now the leading slot's own gap.
import { Show, type Component, type JSX } from 'solid-js'
import styles from './ModalFooter.module.css'

export type ModalFooterProps = {
    /** Words after the `esc` key cap, e.g. "to close" / "to cancel". Omit for no hint. */
    hint?: string
    /** Left-aligned actions, before the spacer (DELETE, RESET). */
    leading?: JSX.Element
    /** Right-aligned actions, after the spacer (CANCEL, SAVE). */
    children?: JSX.Element
    class?: string
}

const ModalFooter: Component<ModalFooterProps> = props => (
    <div
        class={styles['modal-foot']}
        classList={{ [props.class ?? '']: !!props.class }}
    >
        <Show when={props.hint}>
            {h => (
                <span class={styles['modal-hint']}>
                    <b>esc</b> {h()}
                </span>
            )}
        </Show>
        <Show when={props.leading}>
            <span class={styles['modal-foot-leading']}>{props.leading}</span>
        </Show>
        <span class={styles['modal-foot-sp']} />
        {props.children}
    </div>
)

export default ModalFooter
export { ModalFooter }
