// The category rows: colour chip, name (click, or Enter/Space on it, to rename inline) and a
// delete button. Presentational — every change is handed back through props, so the panel owns the
// store and this only holds which popover / which rename is open.
import { createSignal, For, type Component } from 'solid-js'
import type { Category } from '../types'
import ColorChip from '../../ui/ColorChip'
import PlainButton from '../../ui/PlainButton'
import Text from '../../ui/Text'
import InlineTextInput from '../../ui/InlineTextInput'
import RemoveRowButton from '../../ui/RemoveRowButton'
import styles from './CategoryList.module.css'

export type CategoryListProps = {
    categories: Category[]
    onRename: (name: string, next: string) => void
    onRecolor: (name: string, color: string) => void
    onDelete: (name: string) => void
    class?: string
}

const CategoryList: Component<CategoryListProps> = props => {
    // which colour popover is open (a category name), and which name is being renamed
    const [picker, setPicker] = createSignal<string | null>(null)
    const [editing, setEditing] = createSignal<string | null>(null)

    return (
        <div
            class={[styles.group, props.class ?? ''].filter(Boolean).join(' ')}
            data-testid="category-list"
        >
            <For each={props.categories}>
                {c => (
                    <div class={styles.row}>
                        <ColorChip
                            color={c.color}
                            open={picker() === c.name}
                            onToggle={() =>
                                setPicker(p => (p === c.name ? null : c.name))
                            }
                            onPick={col => {
                                props.onRecolor(c.name, col)
                                setPicker(null)
                            }}
                        />
                        {editing() === c.name ? (
                            <InlineTextInput
                                class={styles.nameedit}
                                value={c.name}
                                label={`Rename ${c.name}`}
                                onCommit={v => {
                                    setEditing(null)
                                    props.onRename(c.name, v)
                                }}
                                onCancel={() => setEditing(null)}
                            />
                        ) : (
                            <PlainButton
                                class={styles.name}
                                title="Rename"
                                onClick={() => {
                                    setPicker(null)
                                    setEditing(c.name)
                                }}
                            >
                                <Text as="span" inherit>
                                    {c.name}
                                </Text>
                            </PlainButton>
                        )}
                        <RemoveRowButton
                            label={'Delete ' + c.name}
                            onClick={() => {
                                setPicker(null)
                                props.onDelete(c.name)
                            }}
                        />
                    </div>
                )}
            </For>
        </div>
    )
}

export default CategoryList
export { CategoryList }
