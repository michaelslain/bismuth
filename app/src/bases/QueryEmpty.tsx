import type { Component, JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './QueryEmpty.module.css'

export type QueryEmptyProps = {
    /** Replaces the default `no matches` — for a view whose result is empty for a reason the
     *  user can act on (a chart with no x column, a map with no located rows). */
    children?: JSX.Element
    /** Drop the view gutter, for a view whose frame already pads by it (TableView). */
    flush?: boolean
    class?: string
}

/**
 * What every base view kind shows when its query returns nothing: one faint italic line where
 * the first row would start, never a centred heading. Shared by the views in their own tab and
 * in a ```query block, so an empty result reads the same everywhere.
 */
const QueryEmpty: Component<QueryEmptyProps> = props => (
    <Text
        as="p"
        size="body"
        tone="faint"
        italic
        class={[styles.queryEmpty, props.flush && styles.flush, props.class].filter(Boolean).join(' ')}
        data-testid="query-empty"
    >
        {props.children ?? 'no matches'}
    </Text>
)

export default QueryEmpty
