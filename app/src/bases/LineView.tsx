import { For, Show, createMemo, createSignal } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import type { Bin } from '../../../core/src/dates'
import { buildChartData } from '../../../core/src/bases/chart'
import { fitTrend, trendAt, type TrendFit } from '../../../core/src/bases/trend'
import { chartDefinitionLatex, trendLatex } from '../../../core/src/bases/chartLatex'
import { chartCaption, bucketReadout, formatValue } from '../../../core/src/bases/chartText'
import { buildLinePlot } from './asciiLine'
import Text from '../ui/Text'
import Tex from '../ui/Tex'
import ChartFrame from './ChartFrame'
import ChartReadout from './ChartReadout'
import ChartDrill from './ChartDrill'
import type { ChartGrid } from './chartColumns'
import type { ChartViewProps } from './chartViewProps'
import styles from './LineView.module.css'

// Duplicated from core/src/bases/trend.ts's private tFor/dayDiff/monthDiff (not exported —
// trend.ts is Task 2's file, out of scope here) so the trend LINE can be evaluated at any
// fractional point index, not just the whole-index `t`s `fitTrend` itself computed.
function dayDiff(a: string, b: string): number {
    const da = new Date(a.slice(0, 10) + 'T00:00:00')
    const db = new Date(b.slice(0, 10) + 'T00:00:00')
    return Math.round((db.getTime() - da.getTime()) / 86400000)
}
function monthDiff(a: string, b: string): number {
    const da = new Date(a.slice(0, 10) + 'T00:00:00')
    const db = new Date(b.slice(0, 10) + 'T00:00:00')
    return (
        (db.getFullYear() - da.getFullYear()) * 12 +
        (db.getMonth() - da.getMonth())
    )
}
function tFor(origin: string, key: string, bin: Bin): number {
    if (bin === 'month') return monthDiff(origin, key)
    if (bin === 'week') return dayDiff(origin, key) / 7
    return dayDiff(origin, key)
}

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

    const trendValueAt = (i: number): number => {
        const f = fit()
        const pts = data().points
        if (!f || pts.length === 0) return 0
        const lo = Math.max(0, Math.min(pts.length - 1, Math.floor(i)))
        const hi = Math.max(0, Math.min(pts.length - 1, Math.ceil(i)))
        const origin = pts[0].key
        const tLo = tFor(origin, pts[lo].key, data().bin)
        if (hi === lo) return trendAt(f, tLo)
        const tHi = tFor(origin, pts[hi].key, data().bin)
        const frac = i - lo
        return trendAt(f, tLo + (tHi - tLo) * frac)
    }

    const plot = createMemo(() =>
        buildLinePlot(data().points, {
            columns: grid().columns,
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
            if (p) return bucketReadout(p.label, p.value, p.rows.length)
        }
        const parts = [caption()]
        const peak = peakPart()
        if (peak) parts.push(peak)
        const fi = plot().firstIndex
        if (fi > 0) parts.push(`last ${data().points.length - fi} of ${data().points.length}`)
        return parts
    })

    const drillPoint = createMemo(() => {
        const key = drillKey()
        if (key === null) return null
        return data().points.find(p => p.key === key) ?? null
    })

    let preRef: HTMLPreElement | undefined

    const localColAt = (clientX: number): number | null => {
        if (!preRef) return null
        const cellW = grid().cellWidth
        if (!cellW) return null
        const rect = preRef.getBoundingClientRect()
        return Math.round((clientX - rect.left) / cellW)
    }

    const nearestVisibleIndex = (col: number): number | null => {
        const p = plot()
        const n = visiblePoints().length
        if (n === 0) return null
        let best = 0
        let bestDist = Infinity
        for (let i = 0; i < n; i++) {
            const d = Math.abs(p.colOf(i) - col)
            if (d < bestDist) {
                bestDist = d
                best = i
            }
        }
        return best
    }

    const onMove = (e: PointerEvent) => {
        const col = localColAt(e.clientX)
        setHoverIdx(col === null ? null : nearestVisibleIndex(col))
    }
    const onLeave = () => setHoverIdx(null)
    const onClickPlot = (e: MouseEvent) => {
        const col = localColAt(e.clientX)
        if (col === null) return
        const idx = nearestVisibleIndex(col)
        if (idx === null) return
        const p = visiblePoints()[idx]
        if (!p) return
        setDrillKey(k => (k === p.key ? null : p.key))
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
            emptyMessage="No data to chart."
            onGrid={setGrid}
            readout={
                <ChartReadout parts={readoutParts()} active={hoverIdx() !== null} />
            }
            footer={
                <div class={styles.footer}>
                    <Tex
                        display
                        class={styles.muted}
                        tex={chartDefinitionLatex(data(), props.config.formulas)}
                    />
                    <Show when={fit()}>
                        {f => <Tex display class={styles.muted} tex={trendLatex(f())} />}
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
            <pre
                class={styles.linePlot}
                ref={preRef}
                onPointerMove={onMove}
                onPointerLeave={onLeave}
                onClick={onClickPlot}
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
                <div>{plot().axisRule}</div>
                <div>{plot().axisLabels}</div>
            </pre>
        </ChartFrame>
    )
}
