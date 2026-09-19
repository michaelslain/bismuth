import type { Component, JSX } from 'solid-js'
import { Show } from 'solid-js'
import styles from './ChartFrame.module.css'

export type ChartFrameProps = {
    /** True when the view has nothing to plot — renders `emptyMessage` instead of `children`. */
    empty: boolean
    /** Fallback copy shown in the empty state; each chart view supplies its own wording. */
    emptyMessage: JSX.Element
    class?: string
    children: JSX.Element
}

/**
 * The chart chrome shared by Bar/Heatmap/Line/Stat views (bases-*.card.html): fixed outer
 * padding + scroll, and one consistent empty-state message when a view has no data to plot.
 * Extracted from the old bases/Charts.module.css, which all four views imported directly —
 * each view now keeps only its own chart-specific classes in its own colocated module.
 */
const ChartFrame: Component<ChartFrameProps> = props => {
    return (
        <div class={`${styles.chart} ${props.class ?? ''}`}>
            <Show
                when={!props.empty}
                fallback={<div class={styles.empty}>{props.emptyMessage}</div>}
            >
                {props.children}
            </Show>
        </div>
    )
}

export default ChartFrame
