import { For } from 'solid-js'
import { SkeletonBar } from './SkeletonBar'
import styles from './CardsSkeleton.module.css'

/** A grid of card outlines (cover bar + a couple of text lines). */
export function CardsSkeleton() {
    return (
        <div class={styles.cards}>
            <For each={Array.from({ length: 10 })}>
                {() => (
                    <div class={styles.card}>
                        <div class={styles.cardCover} />
                        <SkeletonBar class={styles.cardLineWide} />
                        <SkeletonBar class={styles.cardLine} />
                    </div>
                )}
            </For>
        </div>
    )
}
