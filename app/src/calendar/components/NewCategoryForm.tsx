// The "new category" row: a colour chip, a name field and an add button, as a ListRow — the panel
// renders it as the LAST row of the category list, so its chip, field and button sit on the same
// columns as the rows above it. Enter in the field adds —
// that key is the field's alone (no window listener), and the add itself is deduped by
// categoryActions, so a double Enter still adds one.
import { createSignal, type Component } from 'solid-js'
import type { Category } from '../types'
import { settings } from '../../settings'
import ColorChip from '../../ui/ColorChip'
import StatusDot from '../../ui/StatusDot'
import { resolvePaletteColor } from '../../ui/palette'
import { TextInput } from '../../ui/TextInput'
import { IconTextButton } from '../../ui/IconTextButton'
import { isConfirmKey } from '../../ui/widgetKeys'
import ListRow from '../../ui/ListRow'
import styles from './NewCategoryForm.module.css'

export type NewCategoryFormProps = {
    /** Resolves true when the category was added (the form then resets), false when refused. */
    onAdd: (category: Category) => Promise<boolean>
    class?: string
}

const NewCategoryForm: Component<NewCategoryFormProps> = props => {
    const [name, setName] = createSignal('')
    const [color, setColor] = createSignal(settings.calendar.defaultCategoryColor)
    const [pickerOpen, setPickerOpen] = createSignal(false)

    async function submit(): Promise<void> {
        const trimmed = name().trim()
        if (!trimmed) return
        if (await props.onAdd({ name: trimmed, color: color() })) {
            setName('')
            setColor(settings.calendar.defaultCategoryColor)
        }
    }

    return (
        <ListRow
            class={props.class}
            leading={
                <ColorChip
                    color={color()}
                    trigger={
                        <StatusDot
                            size="md"
                            color={resolvePaletteColor(color()) || 'var(--accent)'}
                        />
                    }
                    open={pickerOpen()}
                    onToggle={() => setPickerOpen(o => !o)}
                    onPick={c => {
                        setColor(c)
                        setPickerOpen(false)
                    }}
                />
            }
            trailing={
                <IconTextButton icon="plus" variant="selected" onClick={submit}>
                    add
                </IconTextButton>
            }
        >
            <TextInput
                class={styles.input}
                placeholder="new category"
                aria-label="new category"
                value={name()}
                onInput={setName}
                onKeyDown={e => {
                    if (!isConfirmKey(e)) return
                    e.preventDefault()
                    void submit()
                }}
            />
        </ListRow>
    )
}

export default NewCategoryForm
export { NewCategoryForm }
