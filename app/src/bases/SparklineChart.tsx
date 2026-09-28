import type { Component } from 'solid-js'
import { For } from 'solid-js'
import type { Bin } from '../../../core/src/dates'
import { sparkline, sparklineCaption } from './sparkline'
import Text from '../ui/Text'
import styles from './SparklineChart.module.css'

export type SparklineProps = {
    /** One entry per bin, oldest first — same length/order as `keys`/`labels`. */
    values: (number | null)[]
    /** ISO bin keys, same length/order as `values` (metrics.ts's `seriesKeys`). */
    keys: string[]
    /** Human bin labels, same length/order as `values` (metrics.ts's `seriesLabels`). */
    labels: string[]
    bin: Bin
    /** Fired on hover-enter with the hovered bin's key, and on hover-leave with `null`. */
    onHover?: (bucket: string | null) => void
    class?: string
}

/**
 * A stat tile's history sparkline, made self-explaining (user report: "i dont even know what
 * the bars here mean") — the plain glyph run from sparkline.ts, plus one faint caption line
 * naming its window and its first/last bin (`last 12 weeks // Jul 6 – Sep 21`), so a reader who has never seen
 * the chart can tell what a bar spans. The current (last) bin is marked in `--accent` so
 * "this week" visibly maps to a bar; hovering any other glyph reports its bin key via
 * `onHover` so the caller can swap in that bin's own value.
 */
const SparklineChart: Component<SparklineProps> = props => {
    const glyphs = () => sparkline(props.values)
    const caption = () =>
        props.labels.length > 1
            ? `${sparklineCaption(props.bin, props.keys.length)} // ${props.labels[0]} – ${props.labels[props.labels.length - 1]}`
            : sparklineCaption(props.bin, props.keys.length)
    return (
        <Text as="div" inherit class={`${styles.sparkline} ${props.class ?? ''}`}>
            <Text as="div" inherit class={styles.glyphs}>
                <For each={props.keys}>
                    {(key, i) => (
                        <Text
                            as="span"
                            inherit
                            class={`${styles.glyph} ${i() === props.keys.length - 1 ? styles.current : ''}`}
                            data-bucket={key}
                            onMouseEnter={() => props.onHover?.(key)}
                            onMouseLeave={() => props.onHover?.(null)}
                        >
                            {glyphs()[i()]}
                        </Text>
                    )}
                </For>
            </Text>
            <Text as="div" size="micro" tone="faint" class={styles.caption}>
                {caption()}
            </Text>
        </Text>
    )
}

export default SparklineChart
