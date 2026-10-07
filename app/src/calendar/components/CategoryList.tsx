// The category rows: colour chip, name (click, or Enter/Space on it, to rename inline) and a
// delete button that shows on hover. Presentational — every change is handed back through props, so the panel owns the
// store and this only holds which popover / which rename is open.
//
// A RowList of ListRows (DESIGN.md, Overlays: lists in a modal). `composer` is rendered as the
// list's LAST row, so the new-category row continues the same columns and hairline as the rows
// above it instead of sitting in a card of its own.
import { createSignal, For, type Component, type JSX } from 'solid-js'
import type { Category } from '../types'
import CategoryColorChip from './CategoryColorChip'
import PlainButton from '../../ui/PlainButton'
import Text from '../../ui/Text'
import InlineTextInput from '../../ui/InlineTextInput'
import RemoveRowButton from '../../ui/RemoveRowButton'
import RowList from '../../ui/RowList'
import ListRow from '../../ui/ListRow'
import styles from './CategoryList.module.css'

export type CategoryListProps = {
    categories: Category[]
    onRename: (name: string, next: string) => void
    onRecolor: (name: string, color: string) => void
    onDelete: (name: string) => void
    /** A trailing row inside the same list — the panel's NewCategoryForm. */
    composer?: JSX.Element
    class?: string
}

const CategoryList: Component<CategoryListProps> = props => {
    // which colour popover is open (a category name), and which name is being renamed
    const [picker, setPicker] = createSignal<string | null>(null)
    const [editing, setEditing] = createSignal<string | null>(null)

    return (
        <RowList class={props.class}>
            <For each={props.categories}>
                {c => (
                    <ListRow
                        reveal
                        leading={
                            <CategoryColorChip
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
                        }
                        trailing={
                            <RemoveRowButton
                                label={'Delete ' + c.name}
                                onClick={() => {
                                    setPicker(null)
                                    props.onDelete(c.name)
                                }}
                            />
                        }
                    >
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
                    </ListRow>
                )}
            </For>
            {props.composer}
        </RowList>
    )
}

export default CategoryList
export { CategoryList }
