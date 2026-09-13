import { For } from 'solid-js'
import styles from './BaseSkeleton.module.css'

/** A grid of card outlines (cover bar + a couple of text lines). */
export function CardsSkeleton() {
    return (
        <div class={styles.cards}>
            <For each={Array.from({ length: 10 })}>
                {() => (
                    <div class={styles.card}>
                        <div class={styles.cardCover} />
                        <div class={styles.cardLineWide} />
                        <div class={styles.cardLine} />
                    </div>
                )}
            </For>
        </div>
    )
}
