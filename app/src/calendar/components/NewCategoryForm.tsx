// The "new category" card: a colour chip, a name field and an add button. Enter in the field adds —
// that key is the field's alone (no window listener), and the add itself is deduped by
// categoryActions, so a double Enter still adds one.
import { createSignal, type Component } from 'solid-js'
import type { Category } from '../types'
import { settings } from '../../settings'
import { Icon } from '../../icons/Icon'
import Text from '../../ui/Text'
import ColorChip from '../../ui/ColorChip'
import { TextInput } from '../../ui/TextInput'
import { IconTextButton } from '../../ui/IconTextButton'
import { isConfirmKey } from '../../ui/widgetKeys'
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
        <div
            class={[styles.form, props.class ?? ''].filter(Boolean).join(' ')}
            data-testid="new-category-form"
        >
            <Text as="div" inherit class={styles.head}>
                <Icon value="plus" strokeWidth={2.2} />
                new category
            </Text>
            <div class={styles.row}>
                <ColorChip
                    color={color()}
                    open={pickerOpen()}
                    onToggle={() => setPickerOpen(o => !o)}
                    onPick={c => {
                        setColor(c)
                        setPickerOpen(false)
                    }}
                />
                <TextInput
                    class={styles.input}
                    placeholder="category name"
                    value={name()}
                    onInput={setName}
                    onKeyDown={e => {
                        if (!isConfirmKey(e)) return
                        e.preventDefault()
                        void submit()
                    }}
                />
                <IconTextButton icon="plus" variant="selected" onClick={submit}>
                    add
                </IconTextButton>
            </div>
        </div>
    )
}

export default NewCategoryForm
export { NewCategoryForm }
