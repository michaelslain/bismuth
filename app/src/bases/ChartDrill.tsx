import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { rowLabel } from './chartColumns'
import { treePrefix } from '../ui/ascii/treePrefix'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import NoteLink from '../ui/NoteLink'
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
 * `<title> // N notes` plus `[ clear ]`, then one row per note in a faint ASCII tree (`treePrefix`
 * — the same connector the app's other trees use). A row is a `NoteLink` — the app's one way to
 * render "open this note" (see NoteLink.tsx) — when a write target exists, otherwise plain `Text`:
 * a bucket's notes are still readable with no write target (Review Focus #5). Scrolls past 12
 * rows.
 */
const ChartDrill: Component<ChartDrillProps> = props => {
    return (
        <div class={`${styles.drill} ${props.class ?? ''}`}>
            <div class={styles.head}>
                <Text as="span" inherit size="ui" tone="muted">
                    {props.title} // {props.rows.length} {props.rows.length === 1 ? 'note' : 'notes'}
                </Text>
                <TextButton onClick={() => props.onClear()}>clear</TextButton>
            </div>
            <div class={styles.rows}>
                <For each={props.rows}>
                    {(row, i) => (
                        <div class={styles.row}>
                            <Text as="span" inherit size="ui" tone="faint" class={styles.prefix}>
                                {treePrefix(0, i() === props.rows.length - 1)}
                            </Text>
                            <Show
                                when={props.onOpen}
                                fallback={
                                    <Text as="span" inherit size="ui">
                                        {rowLabel(row)}
                                    </Text>
                                }
                            >
                                <NoteLink path={row.file.path}>{rowLabel(row)}</NoteLink>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </div>
    )
}

export default ChartDrill
