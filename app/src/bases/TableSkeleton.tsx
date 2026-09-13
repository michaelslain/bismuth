import { For } from 'solid-js'
import styles from './BaseSkeleton.module.css'

/** A header row over evenly-spaced body rows — the generic "table loading" shape. */
export function TableSkeleton() {
    return (
        <div class={styles.table}>
            <div class={styles.head}>
                <For each={[0, 1, 2, 3]}>
                    {() => <div class={styles.headCell} />}
                </For>
            </div>
            <For each={Array.from({ length: 8 })}>
                {() => (
                    <div class={styles.row}>
                        <For each={[0, 1, 2, 3]}>
                            {() => <div class={styles.cell} />}
                        </For>
                    </div>
                )}
            </For>
        </div>
    )
}
