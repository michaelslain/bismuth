import type { Component } from 'solid-js'
import Text from '../ui/Text'
import styles from './ChartReadout.module.css'

export type ChartReadoutProps = {
    /** Joined with ` // ` — the caption/peak parts at rest, or date/value/count parts while
     *  hovering a bucket. */
    parts: string[]
    /** True while hovering a bucket: switches the line from `--text-muted` to `--fg`. */
    active?: boolean
    class?: string
}

/**
 * The one-line readout above a chart's body (bar/line/heatmap) — muted at rest, `--fg` while
 * hovering a bucket. Single line, ellipsis on overflow rather than wrapping.
 */
const ChartReadout: Component<ChartReadoutProps> = props => {
    return (
        <Text
            as="div"
            inherit
            size="ui"
            class={`${styles.readout} ${props.active ? styles.active : ''} ${props.class ?? ''}`}
        >
            {props.parts.join(' // ')}
        </Text>
    )
}

export default ChartReadout
