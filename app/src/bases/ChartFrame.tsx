import type { Component, JSX } from 'solid-js'
import { Show, onCleanup, onMount } from 'solid-js'
import type { ChartGrid } from './chartColumns'
import Text from '../ui/Text'
import styles from './ChartFrame.module.css'

export type ChartFrameProps = {
    /** True when the view has nothing to plot — renders `emptyMessage` instead of `children`. */
    empty: boolean
    /** Fallback copy shown in the empty state; each chart view supplies its own wording. */
    emptyMessage: JSX.Element
    class?: string
    /** One line above the body — see ChartReadout. */
    readout?: JSX.Element
    /** Under the body — the KaTeX math/streak line a view supplies. */
    footer?: JSX.Element
    /** Under the footer — see ChartDrill. */
    drill?: JSX.Element
    /** Called on mount and on every resize of the body with its measured character grid. */
    onGrid?: (grid: ChartGrid) => void
    children: JSX.Element
}

/**
 * The chart chrome shared by Bar/Heatmap/Line/Stat views (bases-*.card.html): fixed outer
 * padding + scroll, one consistent empty-state message, and — new here — the readout/footer/
 * drill slots plus a live character-grid measurement every chart view needs to lay out its own
 * text grid. The body wraps a hidden 10-character probe in its own font; `cellWidth` is a tenth
 * of its rendered width, and `columns` is the body's content width divided by that, floored at
 * 20 (`columnsFor` in chartColumns.ts) so a chart still renders in a narrow pane.
 */
const ChartFrame: Component<ChartFrameProps> = props => {
    let bodyRef: HTMLDivElement | undefined
    let probeRef: HTMLSpanElement | undefined

    const measure = () => {
        if (!props.onGrid || !bodyRef || !probeRef) return
        const cellWidth = probeRef.getBoundingClientRect().width / 10
        const columns = cellWidth > 0 ? Math.max(20, Math.floor(bodyRef.clientWidth / cellWidth)) : 20
        props.onGrid({ columns, cellWidth })
    }

    onMount(() => {
        measure()
        if (!bodyRef || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => measure())
        observer.observe(bodyRef)
        onCleanup(() => observer.disconnect())
    })

    return (
        <div class={`${styles.chart} ${props.class ?? ''}`}>
            <Show when={props.readout}>{props.readout}</Show>
            <div class={styles.body} ref={bodyRef}>
                <Text
                    as="span"
                    inherit
                    ref={probeRef}
                    class={styles.probe}
                    aria-hidden="true"
                >
                    0000000000
                </Text>
                <Show
                    when={!props.empty}
                    fallback={<div class={styles.empty}>{props.emptyMessage}</div>}
                >
                    {props.children}
                </Show>
            </div>
            <Show when={props.footer}>{props.footer}</Show>
            <Show when={props.drill}>{props.drill}</Show>
        </div>
    )
}

export default ChartFrame
