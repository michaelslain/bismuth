// A column-name text field shared by KanbanAddColumn (adding a column) and KanbanColumnMenu
// (renaming one) — Enter confirms, Escape (or an empty/unchanged value) cancels, and a name
// matching an existing column is refused inline with an `already a column` error. Extracted so
// the two callers cannot drift on chrome the way they had: KanbanAddColumn inherited its
// header's 500 font-weight and had no resting field chrome, KanbanColumnMenu's error sat a few
// px off the input's own text x.
import { createSignal, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import { isColumnNameTaken } from './kanbanColumnOrder'
import styles from './KanbanColumnNameInput.module.css'

export type KanbanColumnNameInputProps = {
    /** Prefilled value — a rename field's current name. Omit for a fresh "add column" field. */
    initial?: string
    placeholder?: string
    /** Every OTHER column's key — a submitted name matching one of these (after trim) is
     *  refused inline with `already a column`. */
    existing: string[]
    /** Select the prefilled text on mount, so typing replaces it outright (rename). */
    selectOnMount?: boolean
    /** Fires with the trimmed name — only for a non-empty name that isn't in `existing` and
     *  differs (after trim) from `initial`. */
    onSubmit: (name: string) => void
    /** Fires on Escape, a blur while empty, or a submit that is empty or unchanged from
     *  `initial` (the rename no-op). */
    onCancel: () => void
    className?: string
}

const KanbanColumnNameInput: Component<KanbanColumnNameInputProps> = props => {
    const [value, setValue] = createSignal(props.initial ?? '')
    const [error, setError] = createSignal<string | null>(null)

    function submit(): void {
        const trimmed = value().trim()
        if (trimmed === '' || trimmed === (props.initial ?? '').trim()) {
            props.onCancel()
            return
        }
        if (isColumnNameTaken(props.existing, trimmed)) {
            setError('already a column')
            return
        }
        props.onSubmit(trimmed)
    }

    return (
        <div
            class={[styles.field, props.className].filter(Boolean).join(' ')}
        >
            <TextInput
                plain
                class={styles.input}
                value={value()}
                placeholder={props.placeholder}
                ref={el =>
                    queueMicrotask(() => {
                        el.focus()
                        if (props.selectOnMount) el.select()
                    })
                }
                onInput={v => {
                    setValue(v)
                    setError(null)
                }}
                onKeyDown={e => {
                    if (isConfirmKey(e)) {
                        e.preventDefault()
                        submit()
                    } else if (isDismissKey(e)) {
                        props.onCancel()
                    }
                }}
                onBlur={() => {
                    if (value().trim() === '') props.onCancel()
                }}
            />
            <Show when={error()}>
                <Text as="span" size="micro" class={styles.error}>
                    {error()}
                </Text>
            </Show>
        </div>
    )
}

export default KanbanColumnNameInput
