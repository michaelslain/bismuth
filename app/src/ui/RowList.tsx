// app/src/ui/RowList.tsx
// THE list container for rows inside a modal or panel: the category list, the recurrence scopes,
// a column-visibility list. Replaces three hand-matched copies of one grey inset panel
// (OptionList, CategoryList's `.group`, ToggleList's `.list`), each a `--surface-2` box drawn
// inside the modal's own frame — a box in a box, which DESIGN.md's modal rule forbids.
//
// Rows sit directly on the modal ground with no rule between them — the app's list idiom is the
// daemon's crons list: rows separated by their own height, nothing drawn. `maxHeight` turns it
// into a scrolling stack — the column-visibility list's `--list-max-h` cap.
import type { Component, JSX } from 'solid-js'
import styles from './RowList.module.css'

export type RowListProps = {
    /** The rows — ListRow, OptionRow, ToggleRow, or a composer row built on ListRow. */
    children: JSX.Element
    /** A cap past which the list scrolls instead of growing the panel, e.g. `var(--list-max-h)`. */
    maxHeight?: string
    class?: string
}

const RowList: Component<RowListProps> = props => (
    <div
        class={[styles.list, props.maxHeight ? styles.scroll : '', props.class ?? '']
            .filter(Boolean)
            .join(' ')}
        style={props.maxHeight ? { 'max-height': props.maxHeight } : undefined}
        data-testid="row-list"
    >
        {props.children}
    </div>
)

export default RowList
export { RowList }
