import { For, createEffect, createMemo, createSignal } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { buildChartData, type ChartPoint } from '../../../core/src/bases/chart'
import { chartCaption, bucketReadout, formatValue } from '../../../core/src/bases/chartText'
import { layoutBars } from './barRows'
import type { ChartGrid } from './chartColumns'
import ChartFrame from './ChartFrame'
import ChartReadout from './ChartReadout'
import ChartDrill from './ChartDrill'
import type { ChartViewProps } from './chartViewProps'
import Text from '../ui/Text'
import styles from './BarView.module.css'

/** A row of typed `#` per bucket, sized to fill the pane — no SVG (bases-bar.card.html). */
export function BarView(props: ChartViewProps) {
    const [grid, setGrid] = createSignal<ChartGrid>({ columns: 20, cellWidth: 0 })
    const [hoverKey, setHoverKey] = createSignal<string | undefined>(undefined)
    const [selectedKey, setSelectedKey] = createSignal<string | undefined>(undefined)

    const rows = createMemo<Row[]>(() => props.result.groups.flatMap(g => g.rows))
    const data = createMemo(() => buildChartData(rows(), props.result.view))
    const bars = createMemo(() => layoutBars(data().points, grid().columns))

    // A data change can drop the bucket a row was selected/hovered on — clear rather than
    // point at a bucket that no longer exists.
    createEffect(() => {
        const keys = new Set(data().points.map(p => p.key))
        if (selectedKey() !== undefined && !keys.has(selectedKey()!)) setSelectedKey(undefined)
        if (hoverKey() !== undefined && !keys.has(hoverKey()!)) setHoverKey(undefined)
    })

    const activeKey = createMemo(() => hoverKey() ?? selectedKey())
    const activePoint = createMemo(() =>
        data().points.find(p => p.key === activeKey()),
    )
    const maxPoint = createMemo(() =>
        data().points.reduce<ChartPoint | undefined>(
            (best, p) => (best === undefined || p.value > best.value ? p : best),
            undefined,
        ),
    )

    const readoutParts = createMemo(() => {
        const point = activePoint()
        if (point) return bucketReadout(point.label, point.value, point.rows.length)
        const best = maxPoint()
        const caption = chartCaption(data())
        if (!best) return [caption]
        return [caption, `peak ${formatValue(best.value)} (${best.label})`]
    })

    const drillPoint = createMemo(() => data().points.find(p => p.key === selectedKey()))
    const drillRows = createMemo(() => {
        const point = drillPoint()
        if (!point) return []
        const all = rows()
        return point.rows.map(i => all[i]).filter((r): r is Row => r !== undefined)
    })

    const toggle = (key: string) =>
        setSelectedKey(k => (k === key ? undefined : key))

    return (
        <ChartFrame
            empty={data().points.length === 0}
            emptyMessage="No data to chart."
            onGrid={setGrid}
            readout={<ChartReadout parts={readoutParts()} active={activePoint() !== undefined} />}
            drill={
                drillPoint() && (
                    <ChartDrill
                        title={drillPoint()!.label}
                        rows={drillRows()}
                        onOpen={props.onOpen}
                        onClear={() => setSelectedKey(undefined)}
                    />
                )
            }
        >
            <div class={styles.barChart}>
                <For each={bars()}>
                    {bar => (
                        <div
                            class={styles.row}
                            data-bucket={bar.key}
                            onPointerEnter={() => setHoverKey(bar.key)}
                            onPointerLeave={() => setHoverKey(undefined)}
                            onClick={() => toggle(bar.key)}
                        >
                            <Text as="span" inherit tone="muted" class={styles.label}>
                                {bar.label}
                            </Text>
                            <Text
                                as="span"
                                inherit
                                class={styles.fill}
                                classList={{
                                    [styles.dim]:
                                        selectedKey() !== undefined && selectedKey() !== bar.key,
                                    [styles.active]: activeKey() === bar.key,
                                }}
                            >
                                {'#'.repeat(bar.fill)}
                            </Text>
                            <Text as="span" inherit tone="faint" class={styles.track}>
                                {'.'.repeat(bar.track)}
                            </Text>
                            <Text as="span" inherit class={styles.value}>
                                {bar.value}
                            </Text>
                        </div>
                    )}
                </For>
            </div>
        </ChartFrame>
    )
}
