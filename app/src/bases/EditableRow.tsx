// app/src/bases/EditableRow.tsx
// One row of an `EditableRows` list: the editor's controls in the main slot, an optional leading
// label, optional extra actions (reorder, "edit as expression") and the remove control, with an
// optional note under the row. The remove button is built HERE so every list says the same thing —
// "Remove <noun>" — instead of "Remove condition" / "Delete formula" / "Remove sort key".
import { children, Show, type Component, type JSX } from 'solid-js'
import ListRow from '../ui/ListRow'
import RemoveRowButton from '../ui/RemoveRowButton'
import Text from '../ui/Text'
import styles from './EditableRow.module.css'

export type EditableRowProps = {
    /** What the row is, singular and lowercase — "condition", "formula", "sort key". The remove
     *  button reads "Remove <noun>". */
    noun: string
    onRemove: () => void
    /** A caption in a label-column cell before the controls ("sort by" / "then by"), laid on the
     *  same `--label-col` grid the form's labelled fields use so the controls line up with them.
     *  Decorative: the control carries its own accessible name. */
    label?: string
    /** Extra controls before remove — reorder arrows, "edit as expression". */
    actions?: JSX.Element
    /** A note under the row (a warning, an "incomplete" hint). */
    hint?: JSX.Element
    /** The row's controls. Give them `flex: 1` (or a grid) to fill the row. */
    children: JSX.Element
    class?: string
}

const EditableRow: Component<EditableRowProps> = props => {
    // Resolve the note ONCE: a JSX prop is a getter that builds a fresh element per read, and
    // `<Show when={props.hint}>{props.hint}</Show>` would build it twice.
    const hint = children(() => props.hint)
    return (
        <div class={styles.item}>
            <ListRow
                class={props.class}
                leading={
                    props.label ? (
                        <Text
                            as="span"
                            size="ui"
                            tone="muted"
                            class={styles.label}
                            aria-hidden="true"
                        >
                            {props.label}
                        </Text>
                    ) : undefined
                }
                trailing={
                    <div class={styles.actions}>
                        {props.actions}
                        <RemoveRowButton
                            label={`Remove ${props.noun}`}
                            onClick={() => props.onRemove()}
                        />
                    </div>
                }
            >
                {props.children}
            </ListRow>
            <Show when={hint()}>{hint()}</Show>
        </div>
    )
}

export default EditableRow
export { EditableRow }
