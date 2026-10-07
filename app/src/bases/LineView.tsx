import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { buildChartData } from '../../../core/src/bases/chart'
import { fitTrend, trendAt, type TrendFit } from '../../../core/src/bases/trend'
import { chartDefinitionLatex, trendLatex } from '../../../core/src/bases/chartLatex'
import { chartCaption, bucketReadout, formatValue } from '../../../core/src/bases/chartText'
import {
    arrowDirection,
    buildLinePlot,
    columnAt,
    nearestIndex,
    stepIndex,
    timeOffsets,
} from './asciiLine'
import CodeBlock from '../ui/CodeBlock'
import Text from '../ui/Text'
import Tex from '../ui/Tex'
import { isActivateKey } from '../ui/widgetKeys'
import ChartFrame from './ChartFrame'
import Readout from '../ui/Readout'
import ChartDrill from './ChartDrill'
import type { ChartGrid } from './chartColumns'
import type { ChartViewProps } from './chartViewProps'
import styles from './LineView.module.css'

type DisplaySegment = { text: string; cls: string }
type DisplayRow = { tick: string; segments: DisplaySegment[] }

/** A value over time, plotted on the character grid — no SVG (bases-line.card.html). */
export function LineView(props: ChartViewProps) {
    const rows = createMemo<Row[]>(() => props.result.groups.flatMap(g => g.rows))
    const data = createMemo(() => buildChartData(rows(), props.result.view))
    const [grid, setGrid] = createSignal<ChartGrid>(
        { columns: 20, cellWidth: 0 },
        { equals: (a, b) => a.columns === b.columns && a.cellWidth === b.cellWidth },
    )
    const [hoverIdx, setHoverIdx] = createSignal<number | null>(null)
    const [drillKey, setDrillKey] = createSignal<string | null>(null)

    const fit = createMemo<TrendFit | null>(() =>
        fitTrend(data().points, { isDate: data().isDate, bin: data().bin }),
    )

    // With `xs` supplied below, buildLinePlot already hands back a `t` in the trend fit's own
    // units (day/week/month diff from the first point) — no index-to-t interpolation needed here.
    const trendValueAt = (t: number): number => {
        const f = fit()
        if (!f) return 0
        return trendAt(f, t)
    }

    const xs = createMemo<number[] | undefined>(() =>
        data().isDate ? timeOffsets(data().points.map(p => p.key), data().bin) : undefined,
    )

    const plot = createMemo(() =>
        buildLinePlot(data().points, {
            columns: grid().columns,
            xs: xs(),
            trend: fit() ? trendValueAt : undefined,
        }),
    )

    const visiblePoints = createMemo(() => data().points.slice(plot().firstIndex))

    const caption = createMemo(() => chartCaption(data()))
    const peakPart = createMemo(() => {
        const pts = data().points
        if (pts.length === 0) return null
        const top = pts.reduce((a, b) => (b.value > a.value ? b : a))
        return `peak ${formatValue(top.value)} (${top.label})`
    })

    const readoutParts = createMemo(() => {
        const idx = hoverIdx()
        if (idx !== null) {
            const p = visiblePoints()[idx]
            if (p) return bucketReadout(p.label, p.value, p.rows.length, data().aggregate)
        }
        const parts = [caption()]
        const peak = peakPart()
        if (peak) parts.push(peak)
        const fi = plot().firstIndex
        if (fi > 0) parts.push(`last ${data().points.length - fi} of ${data().points.length}`)
        return parts
    })

    createEffect(() => {
        const k = drillKey()
        if (k !== null && !data().points.some(p => p.key === k)) setDrillKey(null)
    })

    const drillPoint = createMemo(() => {
        const key = drillKey()
        if (key === null) return null
        return data().points.find(p => p.key === key) ?? null
    })

    let preRef: HTMLPreElement | undefined

    const indexAtX = (clientX: number): number | null => {
        if (!preRef) return null
        const col = columnAt(clientX, preRef.getBoundingClientRect().left, grid().cellWidth)
        if (col === null) return null
        return nearestIndex(plot().colOf, visiblePoints().length, col)
    }

    const toggleDrillAt = (idx: number | null) => {
        if (idx === null) return
        const p = visiblePoints()[idx]
        if (!p) return
        setDrillKey(k => (k === p.key ? null : p.key))
    }

    const onMove = (e: PointerEvent) => setHoverIdx(indexAtX(e.clientX))
    const onLeave = () => setHoverIdx(null)
    const onClickPlot = (e: MouseEvent) => toggleDrillAt(indexAtX(e.clientX))

    // Keyboard path: the arrows / Home / End move the hover column, Enter or Space drills into it.
    const onKeyDown = (e: KeyboardEvent) => {
        if (isActivateKey(e)) {
            // No hover column: swallow the key so Space does not scroll the page.
            e.preventDefault()
            if (hoverIdx() === null) return
            toggleDrillAt(hoverIdx())
            return
        }
        const dir = arrowDirection(e)
        if (!dir) return
        e.preventDefault()
        setHoverIdx(stepIndex(hoverIdx(), dir, visiblePoints().length))
    }

    const displayRows = createMemo<DisplayRow[]>(() => {
        const p = plot()
        const idx = hoverIdx()
        const hoverCol = idx !== null ? p.colOf(idx) - p.gutter : null
        return p.rows.map(row => {
            let col = 0
            const segments: DisplaySegment[] = []
            for (const seg of row.segments) {
                const isHoverPoint = seg.kind === 'point' && col === hoverCol
                segments.push({
                    text: isHoverPoint ? '@' : seg.text,
                    cls:
                        isHoverPoint
                            ? styles.hover
                            : seg.kind === 'point' || seg.kind === 'line'
                              ? styles.accent
                              : seg.kind === 'trend'
                                ? styles.trend
                                : '',
                })
                col += seg.text.length
            }
            return { tick: row.tick, segments }
        })
    })

    return (
        <ChartFrame
            empty={data().points.length === 0}
            onGrid={setGrid}
            readout={
                <Readout parts={readoutParts()} tone={hoverIdx() !== null ? 'default' : 'muted'} />
            }
            footer={
                <div class={styles.footer}>
                    <Tex
                        class={styles.muted}
                        tex={'\\displaystyle ' + chartDefinitionLatex(data(), props.config.formulas)}
                    />
                    <Show when={fit()}>
                        {f => (
                            <Tex
                                class={styles.muted}
                                tex={'\\displaystyle ' + trendLatex(f())}
                            />
                        )}
                    </Show>
                </div>
            }
            drill={
                <Show when={drillPoint()}>
                    {p => (
                        <ChartDrill
                            title={p().label}
                            rows={p().rows.map(i => rows()[i])}
                            onOpen={props.onOpen}
                            onClear={() => setDrillKey(null)}
                        />
                    )}
                </Show>
            }
        >
            <CodeBlock
                bare
                class={styles.linePlot}
                ref={preRef}
                tabIndex={0}
                role="group"
                aria-label="line chart: arrow keys move between points, Enter opens the notes behind one"
                onPointerMove={onMove}
                onPointerLeave={onLeave}
                onBlur={onLeave}
                onClick={onClickPlot}
                onKeyDown={onKeyDown}
            >
                <For each={displayRows()}>
                    {row => (
                        <div>
                            {row.tick}
                            <For each={row.segments}>
                                {seg => (
                                    <Text as="span" inherit class={seg.cls}>
                                        {seg.text}
                                    </Text>
                                )}
                            </For>
                        </div>
                    )}
                </For>
                <div class={styles.axisRule}>{plot().axisRule}</div>
                <div>{plot().axisLabels}</div>
            </CodeBlock>
        </ChartFrame>
    )
}
