import { For, Match, Switch, type Component } from 'solid-js'
import type { ViewType } from '../../../core/src/bases/types'
import { TableSkeleton } from './TableSkeleton'
import { CardsSkeleton } from './CardsSkeleton'
import { SkeletonBar } from './SkeletonBar'
import styles from './BaseSkeleton.module.css'

export type BaseSkeletonProps = {
    type: ViewType
}

/** The silhouette a kind loads as. `table`, `cards`, `lines` (list/bullets), `columns` (kanban),
 *  `chart` (bar/line/stat/heatmap) and `block` — the neutral panel for the kinds whose shape
 *  depends on data (map, calendar, flashcards). */
export type SkeletonShape = 'table' | 'cards' | 'lines' | 'columns' | 'chart' | 'block'

export function skeletonShape(type: ViewType): SkeletonShape {
    switch (type) {
        case 'cards':
            return 'cards'
        case 'list':
        case 'bullets':
            return 'lines'
        case 'kanban':
            return 'columns'
        case 'bar':
        case 'line':
        case 'stat':
        case 'heatmap':
            return 'chart'
        case 'map':
        case 'calendar':
        case 'flashcards':
            return 'block'
        default:
            return 'table'
    }
}

const THREE = [0, 1, 2]
const BARS = [0, 1, 2, 3, 4, 5, 6]

/**
 * Shaped loading placeholder for a base view. Instead of a generic spinner it paints the
 * silhouette of the view kind — a table's header + rows, a card grid, list lines, kanban columns,
 * a chart's bars, or a neutral panel — so the pane shows structure the instant it opens while the
 * rows resolve. Used as the BaseView fallback before any cached/fetched rows arrive.
 */
export const BaseSkeleton: Component<BaseSkeletonProps> = props => {
    const shape = () => skeletonShape(props.type)
    return (
        <div class={styles.skeleton} aria-hidden="true" data-skeleton={shape()}>
            <Switch fallback={<TableSkeleton />}>
                <Match when={shape() === 'cards'}>
                    <CardsSkeleton />
                </Match>
                <Match when={shape() === 'lines'}>
                    <div class={styles.lines}>
                        <For each={Array.from({ length: 9 })}>
                            {() => (
                                <div class={styles.line}>
                                    <SkeletonBar class={styles.lineMark} />
                                    <SkeletonBar class={styles.lineText} />
                                </div>
                            )}
                        </For>
                    </div>
                </Match>
                <Match when={shape() === 'columns'}>
                    <div class={styles.columns}>
                        <For each={THREE}>
                            {() => (
                                <div class={styles.column}>
                                    <SkeletonBar class={styles.columnHead} />
                                    <For each={THREE}>{() => <SkeletonBar class={styles.columnCard} />}</For>
                                </div>
                            )}
                        </For>
                    </div>
                </Match>
                <Match when={shape() === 'chart'}>
                    <div class={styles.chart}>
                        <For each={BARS}>
                            {() => <SkeletonBar class={styles.chartBar} />}
                        </For>
                    </div>
                </Match>
                <Match when={shape() === 'block'}>
                    <SkeletonBar class={styles.blockPanel} />
                </Match>
            </Switch>
        </div>
    )
}

export default BaseSkeleton
