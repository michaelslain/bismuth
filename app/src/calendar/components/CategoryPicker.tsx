// The event form's category chips: `none` plus one toggle per calendar category, tinted with the
// category's own colour when picked. An event can hold several; the parent owns the list.
import { For, type Component } from 'solid-js'
import { categories } from '../state'
import { resolveCategoryColor } from '../categoryColor'
import ChipToggle from '../../ui/ChipToggle'
import StatusDot from '../../ui/StatusDot'
import styles from './CategoryPicker.module.css'

export type CategoryPickerProps = {
    /** Picked category names. Empty = none. */
    selected: string[]
    onChange: (names: string[]) => void
    class?: string
}

const CategoryPicker: Component<CategoryPickerProps> = props => {
    const toggle = (name: string) =>
        props.onChange(
            props.selected.includes(name)
                ? props.selected.filter(n => n !== name)
                : [...props.selected, name],
        )
    return (
        <div class={[styles.cats, props.class ?? ''].filter(Boolean).join(' ')}>
            <ChipToggle
                selected={props.selected.length === 0}
                onToggle={() => props.onChange([])}
            >
                <StatusDot color="var(--faint)" /> none
            </ChipToggle>
            <For each={categories.value}>
                {c => {
                    const color = () => resolveCategoryColor(c.color)
                    return (
                        <ChipToggle
                            selected={props.selected.includes(c.name)}
                            color={color()}
                            onToggle={() => toggle(c.name)}
                        >
                            <StatusDot color={color()} /> {c.name}
                        </ChipToggle>
                    )
                }}
            </For>
        </div>
    )
}

export default CategoryPicker
export { CategoryPicker }
