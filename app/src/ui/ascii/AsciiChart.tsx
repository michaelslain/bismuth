// A row of typed bars — the system's only chart: `label  ######      118`.
// Split out of AsciiMeter.tsx so it owns its stylesheet and story. The fill math is the same pure
// module the meter uses (./asciiMeterMath.ts).
import { For, type Component } from 'solid-js'
import { chartFill, chartLabelPad, chartMax, chartValueWidth } from './asciiMeterMath'
import styles from './AsciiChart.module.css'

export type AsciiChartSeries = {
    label: string
    value: number
    color?: string
}

export type AsciiChartProps = {
    series: AsciiChartSeries[]
    width?: number
    class?: string
}

/** Bars scale against the largest value; a non-zero value always draws at least one `#`. The
 *  numerals are right-aligned in their own column so magnitudes compare down the page. */
const AsciiChart: Component<AsciiChartProps> = props => {
    const width = () => props.width ?? 16
    const max = () => chartMax(props.series)
    const pad = () => chartLabelPad(props.series)
    const valueW = () => chartValueWidth(props.series)
    return (
        <div class={`${styles.chart} ${props.class ?? ''}`}>
            <For each={props.series}>
                {s => {
                    const fill = () => chartFill(s.value, max(), width())
                    return (
                        <div class={styles.row}>
                            {s.label.padEnd(pad() + 1)}
                            <span
                                class={styles.bar}
                                style={s.color ? { '--bar-color': s.color } : undefined}
                            >
                                {'#'.repeat(fill())}
                            </span>
                            {' '.repeat(Math.max(0, width() - fill() + 1))}
                            {String(s.value).padStart(valueW())}
                        </div>
                    )
                }}
            </For>
        </div>
    )
}

export default AsciiChart
