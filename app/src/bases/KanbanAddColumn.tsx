// The trailing "+ column" ghost column at the end of a kanban board's column row. Click swaps
// the ghost header for a text input; Enter adds (refusing a duplicate name inline, matching
// `appendColumnKey`'s own refusal so the two never disagree), Escape or a blur while empty
// cancels back to the ghost. Presentational only — KanbanView owns persisting the new column
// (optimistic `columns` order + the `properties.options` append) via `onAdd`.
import { createSignal, Show } from 'solid-js'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import TextInput from '../ui/TextInput'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import styles from './KanbanAddColumn.module.css'

export type KanbanAddColumnProps = {
    /** Existing column keys — a name matching one of these (after trim) is refused. */
    existing: string[]
    onAdd: (name: string) => void
    className?: string
}

function KanbanAddColumn(props: KanbanAddColumnProps) {
    const [editing, setEditing] = createSignal(false)
    const [value, setValue] = createSignal('')
    const [error, setError] = createSignal<string | null>(null)

    function reset(): void {
        setEditing(false)
        setValue('')
        setError(null)
    }

    function submit(): void {
        const trimmed = value().trim()
        if (trimmed === '') return
        if (props.existing.includes(trimmed)) {
            setError('already a column')
            return
        }
        props.onAdd(trimmed)
        reset()
    }

    return (
        <div
            class={[styles.ghost, props.className].filter(Boolean).join(' ')}
        >
            <Show
                when={editing()}
                fallback={
                    <PlainButton
                        class={styles.trigger}
                        onClick={() => {
                            setValue('')
                            setError(null)
                            setEditing(true)
                        }}
                    >
                        <Text
                            as="span"
                            size="inherit"
                            tone="muted"
                            weight="inherit"
                        >
                            + column
                        </Text>
                    </PlainButton>
                }
            >
                <div class={styles.editing}>
                    <TextInput
                        plain
                        class={styles.input}
                        value={value()}
                        placeholder="column name"
                        ref={el => queueMicrotask(() => el.focus())}
                        onInput={v => {
                            setValue(v)
                            setError(null)
                        }}
                        onKeyDown={e => {
                            if (isConfirmKey(e)) {
                                e.preventDefault()
                                submit()
                            } else if (isDismissKey(e)) {
                                reset()
                            }
                        }}
                        onBlur={() => {
                            if (value().trim() === '') reset()
                        }}
                    />
                    <Show when={error()}>
                        <Text
                            as="span"
                            size="micro"
                            class={styles.error}
                        >
                            {error()}
                        </Text>
                    </Show>
                </div>
            </Show>
        </div>
    )
}

export default KanbanAddColumn
export { KanbanAddColumn }
