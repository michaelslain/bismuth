import type { Component, JSX } from 'solid-js'
import type { TaskRowRef } from '../../taskDrag'
import { readTaskDrop } from '../../taskDrag'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import type { AsciiEdge } from '../../../ui/ascii/AsciiCellEdges'
import DayNumber from '../DayNumber'
import styles from './MonthCell.module.css'

export type MonthCellProps = {
    /** `YYYY-MM-DD` */
    date: string
    day: number
    /** False for the leading/trailing days that spill in from a neighbouring month (dimmed). */
    inMonth: boolean
    today: boolean
    /** A click on the cell itself (chips claim their own): create-event modal, or the composer. */
    onOpen: () => void
    /** Present in the tasks register only: makes the cell a drop target for a dragged task chip. */
    onDropTask?: (ref: TaskRowRef, date: string) => void
    /** Position in the grid, which decides which edges this cell types (each boundary is typed by
     *  exactly one cell): every cell types its top + left; the first row omits top (the weekday
     *  header types its heavy bottom there), the last column adds right, the last row adds bottom. */
    isFirstRow?: boolean
    isLastCol?: boolean
    isLastRow?: boolean
    class?: string
    /** The day's chips. */
    children?: JSX.Element
}

/** One cell of the month grid: the day number, and whatever the register puts in it. */
const MonthCell: Component<MonthCellProps> = props => {
    const edges = (): AsciiEdge[] => [
        'left',
        ...(props.isFirstRow ? [] : (['top'] as const)),
        ...(props.isLastCol ? (['right'] as const) : []),
        ...(props.isLastRow ? (['bottom'] as const) : []),
    ]
    return (
        <div
            class={`${styles.cell} ${props.class ?? ''}`.trim()}
            data-testid="month-cell"
            onClick={() => props.onOpen()}
            onDragOver={e => {
                // Only a tasks-register cell accepts a drop — and must preventDefault or the browser
                // never fires `drop` at all.
                if (!props.onDropTask) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={e => {
                if (!props.onDropTask) return
                const ref = readTaskDrop(e)
                if (ref) props.onDropTask(ref, props.date)
            }}
        >
            <DayNumber
                day={props.day}
                today={props.today}
                class={`${styles.number}${props.inMonth ? '' : ` ${styles.dim}`}`}
            />
            <div class={styles.items} data-testid="month-cell-events">
                {props.children}
            </div>
            {/* last child: the day number stays the cell's firstElementChild */}
            <AsciiCellEdges edges={edges()} />
        </div>
    )
}

export default MonthCell
