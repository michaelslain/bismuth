import { For } from 'solid-js'
import { SkeletonBar } from './SkeletonBar'
import styles from './TableSkeleton.module.css'

export type TableSkeletonProps = {
    /** Body rows. Default 8. */
    rows?: number
    /** Columns per row. Default 4. */
    columns?: number
    class?: string
}

/** A header row over evenly-spaced body rows — the generic "table loading" shape. */
export function TableSkeleton(props: TableSkeletonProps) {
    const columns = () => Array.from({ length: props.columns ?? 4 })
    return (
        <div class={props.class ? `${styles.table} ${props.class}` : styles.table}>
            <div class={styles.head}>
                <For each={columns()}>
                    {() => <SkeletonBar class={styles.headCell} />}
                </For>
            </div>
            <For each={Array.from({ length: props.rows ?? 8 })}>
                {() => (
                    <div class={styles.row}>
                        <For each={columns()}>
                            {() => <SkeletonBar class={styles.cell} />}
                        </For>
                    </div>
                )}
            </For>
        </div>
    )
}

export default TableSkeleton
