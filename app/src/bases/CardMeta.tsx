import { For, Show } from 'solid-js'
import type { Component } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import Label from '../ui/Label'
import Text from '../ui/Text'
import { renderCell } from './renderValue'
import styles from './CardMeta.module.css'

export type CardMetaProps = {
    /** The view's ordered meta columns — already stripped of the title, author, status, rating
     *  and pages columns, which CardBody renders in their own places. */
    cols: string[]
    row: Row
    /** Declared property types, so a declared number / multiselect / boolean / markdown reads
     *  here exactly as it does in Table, List and Kanban. */
    config: BaseConfig
    class?: string
}

/** `note.author` / `file.mtime` -> `author` / `mtime`, the label a card shows for a column. */
function labelOf(id: string): string {
    const dot = id.indexOf('.')
    return dot >= 0 ? id.slice(dot + 1) : id
}

function hasValue(id: string, row: Row): boolean {
    const v = resolveProperty(id, row)
    if (v == null || v === '') return false
    return !(Array.isArray(v) && v.length === 0)
}

/**
 * The extra property rows on a card: one `label  value` line per ordered meta column that has a
 * value, each value drawn by `renderCell` with the base config so a declared type looks the same
 * here as in every other view. Empty values are skipped rather than shown as a dash — a card is
 * a summary, not a form.
 */
const CardMeta: Component<CardMetaProps> = props => {
    const shown = () => props.cols.filter(c => hasValue(c, props.row))
    return (
        <Show when={shown().length > 0}>
            <div class={`${styles.cardMetaList} ${props.class ?? ''}`}>
                <For each={shown()}>
                    {id => (
                        <div class={styles.item}>
                            <Label tone="muted" class={styles.key}>
                                {labelOf(id)}
                            </Label>
                            <Text as="span" inherit class={styles.value}>
                                {renderCell(id, props.row, true, props.config)}
                            </Text>
                        </div>
                    )}
                </For>
            </div>
        </Show>
    )
}

export default CardMeta
export { CardMeta }
