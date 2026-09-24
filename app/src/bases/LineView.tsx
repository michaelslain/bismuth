import { For, createMemo } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { buildChartData } from '../../../core/src/bases/chart'
import { buildLinePlot } from './asciiLine'
import Text from '../ui/Text'
import ChartFrame from './ChartFrame'
import styles from './LineView.module.css'

/** A value over time, plotted on the character grid — no SVG (bases-line.card.html). */
export function LineView(props: { result: ViewResult; config: BaseConfig }) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    const data = createMemo(() => buildChartData(rows(), props.result.view))
    const plot = createMemo(() => buildLinePlot(data().points))

    return (
        <ChartFrame
            empty={plot().rows.length === 0}
            emptyMessage="No data to chart."
        >
            <pre class={styles.linePlot}>
                <For each={plot().rows}>
                    {row => (
                        <>
                            {row.tick}
                            <For each={row.segments}>
                                {seg =>
                                    seg.accent ? (
                                        <Text
                                            as="span"
                                            inherit
                                            class={styles.glyph}
                                        >
                                            {seg.text}
                                        </Text>
                                    ) : (
                                        seg.text
                                    )
                                }
                            </For>
                            {'\n'}
                        </>
                    )}
                </For>
                {plot().axisRule}
                {'\n'}
                {plot().axisLabels}
            </pre>
        </ChartFrame>
    )
}
