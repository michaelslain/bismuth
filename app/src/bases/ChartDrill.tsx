import type { Component } from 'solid-js'
import { createMemo } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { rowLabel } from './chartColumns'
import AsciiTree, { type AsciiTreeRow } from '../ui/ascii/AsciiTree'
import { openNote } from '../ui/openNote'
import Readout from '../ui/Readout'
import TextButton from '../ui/TextButton'
import styles from './ChartDrill.module.css'

export type ChartDrillProps = {
    /** The bucket's own label — the readout's date/key part, e.g. `Jul 20`. */
    title: string
    rows: Row[]
    /** Whether a drill row opens its note. Undefined (no write target/opener) leaves the rows as
     *  a plain list that selects nothing — see Review Focus #5. */
    onOpen?: (path: string) => void
    /** Closes the drill — clicking `[ clear ]`, or clicking the same bucket again. */
    onClear: () => void
    class?: string
}

/**
 * The list of notes behind a clicked chart bucket, opened under a chart's body: a header
 * `<title> // N notes` plus `[ clear ]`, then the notes as an `AsciiTree` — the one tree primitive
 * the app draws connectors with, so the `|--` / `` `-- `` prefix, the row pitch and the keyboard
 * path are not rebuilt here. A row opens its note through `openNote` (the same `bismuth-open`
 * event `NoteLink` rides) when a write target exists; without one the rows are still readable.
 * Scrolls past 12 rows.
 */
const ChartDrill: Component<ChartDrillProps> = props => {
    const treeRows = createMemo<AsciiTreeRow[]>(() =>
        props.rows.map((row, i) => ({
            id: String(i),
            label: rowLabel(row),
            last: i === props.rows.length - 1,
        })),
    )
    const open = (id: string) => {
        if (!props.onOpen) return
        const row = props.rows[Number(id)]
        if (row) openNote(row.file.path)
    }
    return (
        <div class={`${styles.drill} ${props.class ?? ''}`}>
            <div class={styles.head}>
                <Readout
                    class={styles.title}
                    parts={[
                        props.title,
                        `${props.rows.length} ${props.rows.length === 1 ? 'note' : 'notes'}`,
                    ]}
                />
                <TextButton onClick={() => props.onClear()}>clear</TextButton>
            </div>
            <div class={styles.rows}>
                <AsciiTree rows={treeRows()} onSelect={open} />
            </div>
        </div>
    )
}

export default ChartDrill
