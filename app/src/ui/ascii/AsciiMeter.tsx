// [########..] — the system's only progress indicator, and its only bar chart.
// Solid port of bismuth-design/ascii/design-system/components/ascii/AsciiMeter.jsx — the
// pure fill math lives in ./asciiMeterMath.ts so it's unit-testable without a DOM.
// The bar chart is its own component: ./AsciiChart.tsx.
import type { Component } from 'solid-js'
import { meterFill } from './asciiMeterMath'
import styles from './AsciiMeter.module.css'

export type AsciiMeterProps = {
    /** 0–1. Not clamped before scaling — the rendered fill count clamps instead,
     *  so 1.4 still draws a full bar and -0.4 an empty one. Any value above 0 draws
     *  at least one `#`: a bar that rounds down to nothing would read as zero. */
    value: number
    width?: number
    label?: string
    /** Pad the label to this many characters so a stack of meters lines its `[` up in one
     *  column. Omitted: the label is not padded. */
    labelWidth?: number
    suffix?: string
    color?: string
    class?: string
}

const AsciiMeter: Component<AsciiMeterProps> = props => {
    const width = () => props.width ?? 10
    const filled = () => meterFill(props.value, width())
    const label = () =>
        props.label ? props.label.padEnd(props.labelWidth ?? 0) + '  ' : ''
    // Width is a fixed cell count and cannot reflow, so callers in a resizable pane pick
    // it with fitMeterWidth() against their measured slot. The whole bar stays one inline
    // glyph run: `[`, the cells and `]` never break onto separate lines.
    return (
        <span
            class={`${styles.meter} ${props.class ?? ''}`}
            style={props.color ? { '--meter-color': props.color } : undefined}
        >
            {label()}[<span class={styles.fill}>{'#'.repeat(filled())}</span>
            <span class={styles.empty}>{'.'.repeat(width() - filled())}</span>]
            {props.suffix ? ' ' + props.suffix : ''}
        </span>
    )
}

export default AsciiMeter
