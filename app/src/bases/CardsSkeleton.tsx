import { For } from 'solid-js'
import { SkeletonBar } from './SkeletonBar'
import CardFrame from './CardFrame'
import styles from './CardsSkeleton.module.css'

/**
 * A grid of card outlines (cover block + a couple of text lines) in the SAME grid and the SAME card
 * frame as CardsView's loaded cards, so the pane does not reflow when the rows arrive: the column
 * template is CardsView's `.cardGrid` (as many columns as fit at `--card-grid-min`) and the cover
 * is the real cover's height. The story pins the match by measuring both.
 */
export function CardsSkeleton() {
    return (
        <div class={styles.cards} data-skeleton-cards>
            <div class={styles.grid} data-skeleton-grid>
                <For each={Array.from({ length: 10 })}>
                    {() => (
                        <CardFrame>
                            <div class={styles.cover} />
                            <div class={styles.body}>
                                <SkeletonBar class={styles.lineWide} />
                                <SkeletonBar class={styles.line} />
                            </div>
                        </CardFrame>
                    )}
                </For>
            </div>
        </div>
    )
}
