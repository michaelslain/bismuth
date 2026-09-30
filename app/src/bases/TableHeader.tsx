// The table's header row: one sticky <th> per column, with the reorder/resize affordances the
// pointer maths in tableColumnDrag.ts drives. It owns no gesture state — TableView hands the hover
// indexes in and takes the pointer events back out — so it renders in Storybook with stubs.
import { For, Show, type Component } from 'solid-js'
import type { BaseConfig } from '../../../core/src/bases/types'
import { columnLabel } from './columnLabel'
import Label from '../ui/Label'
import Text from '../ui/Text'
import AsciiCellEdges, { type AsciiEdge } from '../ui/ascii/AsciiCellEdges'
import styles from './TableHeader.module.css'

export type TableHeaderProps = {
    cols: string[]
    config: BaseConfig
    /** A header body drags to reorder columns. */
    reorderable?: boolean
    /** A header's right edge drags to resize its column. */
    resizable?: boolean
    /** The header the reorder drag is currently over (draws the drop cue). */
    overIdx?: number | null
    /** The header whose edge the pointer is in (shows the col-resize cursor). */
    edgeIdx?: number | null
    onPointerDown?: (idx: number, e: PointerEvent) => void
    onPointerMove?: (idx: number, e: PointerEvent) => void
    onPointerLeave?: () => void
    /** Receives the <thead>, so the owner can measure the rendered headers. */
    ref?: (el: HTMLTableSectionElement) => void
    class?: string
}

// A header cell types its top + left (the last one its right too) and its bottom as the heavy `=`;
// the first body row under it omits its own top so the two never overprint.
const headerEdges = (last: boolean): AsciiEdge[] =>
    last
        ? ['top', 'left', 'right', 'bottom']
        : ['top', 'left', 'bottom']

const TableHeader: Component<TableHeaderProps> = props => (
    <thead ref={el => props.ref?.(el)} class={props.class}>
        <tr>
            <For each={props.cols}>
                {(c, i) => (
                    <th
                        classList={{
                            [styles.th]: true,
                            [styles.thDrag]: !!props.reorderable,
                            [styles.thOver]: props.overIdx === i(),
                            [styles.thResizable]: !!props.resizable,
                            [styles.thAtEdge]: props.edgeIdx === i(),
                        }}
                        onPointerDown={e => props.onPointerDown?.(i(), e)}
                        onPointerMove={e => props.onPointerMove?.(i(), e)}
                        onPointerLeave={() => props.onPointerLeave?.()}
                    >
                        {/* First, so the resize handle below paints on top of the `|` run. */}
                        <AsciiCellEdges
                            edges={headerEdges(i() === props.cols.length - 1)}
                            edgeWeight={{ bottom: 'heavy' }}
                            backdrop
                        />
                        <Label inline class={styles.thLabel}>
                            {columnLabel(c, props.config)}
                        </Label>
                        <Show when={props.resizable}>
                            <Text as="span" inherit class={styles.thResize} />
                        </Show>
                    </th>
                )}
            </For>
        </tr>
    </thead>
)

export default TableHeader
