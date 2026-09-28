import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { rowLabel } from './chartColumns'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import styles from './ChartDrill.module.css'

export type ChartDrillProps = {
    /** The bucket's own label — the readout's date/key part, e.g. `Jul 20`. */
    title: string
    rows: Row[]
    /** Opens a drill row's note. Undefined (no write target/opener) renders rows as plain text
     *  instead of buttons — see Review Focus #5. */
    onOpen?: (path: string) => void
    /** Closes the drill — clicking `[ clear ]`, or clicking the same bucket again. */
    onClear: () => void
    class?: string
}

/**
 * The list of notes behind a clicked chart bucket, opened under a chart's body: a header
 * `<title> // N notes` plus `[ clear ]`, then one row per note. A row is a `TextButton` calling
 * `onOpen(row.file.path)` when an opener exists, otherwise plain `Text` — a bucket's notes are
 * still readable with no write target. Scrolls past 12 rows.
 */
const ChartDrill: Component<ChartDrillProps> = props => {
    return (
        <div class={`${styles.drill} ${props.class ?? ''}`}>
            <div class={styles.head}>
                <Text as="span" inherit size="ui" tone="muted">
                    {props.title} // {props.rows.length} notes
                </Text>
                <TextButton onClick={() => props.onClear()}>clear</TextButton>
            </div>
            <div class={styles.rows}>
                <For each={props.rows}>
                    {row => (
                        <Show
                            when={props.onOpen}
                            fallback={
                                <Text as="div" inherit size="ui" class={styles.row}>
                                    {rowLabel(row)}
                                </Text>
                            }
                        >
                            {onOpen => (
                                <TextButton
                                    class={styles.row}
                                    onClick={() => onOpen()(row.file.path)}
                                >
                                    {rowLabel(row)}
                                </TextButton>
                            )}
                        </Show>
                    )}
                </For>
            </div>
        </div>
    )
}

export default ChartDrill
