import { Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { buildChartData, type ChartPoint } from '../../../core/src/bases/chart'
import {
    chartCaption,
    bucketReadout,
    formatValue,
    axisName,
    valueAxisName,
} from '../../../core/src/bases/chartText'
import { barHeader, layoutBars } from './barRows'
import type { ChartGrid } from './chartColumns'
import ChartFrame from './ChartFrame'
import Readout from '../ui/Readout'
import ChartDrill from './ChartDrill'
import type { ChartViewProps } from './chartViewProps'
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import styles from './BarView.module.css'

/** A row of typed `#` per bucket, sized to fill the pane — no SVG (bases-bar.card.html). */
export function BarView(props: ChartViewProps) {
    // ChartFrame reports a fresh object on every resize callback; an identical measure must not
    // re-run layoutBars, or `<For>` (keyed by reference) rebuilds every row under the pointer.
    const [grid, setGrid] = createSignal<ChartGrid>(
        { columns: 20, cellWidth: 0 },
        { equals: (a, b) => a.columns === b.columns && a.cellWidth === b.cellWidth },
    )
    const [hoverKey, setHoverKey] = createSignal<string | undefined>(undefined)
    const [selectedKey, setSelectedKey] = createSignal<string | undefined>(undefined)

    const rows = createMemo<Row[]>(() => props.result.groups.flatMap(g => g.rows))
    const data = createMemo(() => buildChartData(rows(), props.result.view))
    const headerNames = createMemo(() => ({
        label: axisName(data().x, data().isDate, data().bin),
        value: valueAxisName(data().aggregate, data().y),
    }))
    const bars = createMemo(() => layoutBars(data().points, grid().columns, headerNames()))

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

    // How many rows the pane shows at once, when there are more than that. The body scrolls, so a
    // long list otherwise reads as the whole list — `showing 22 of 60` says it is not. `null` when
    // everything fits. Measured off the scrolling parent (a tag-free `parentElement`, not a class).
    let chartRef: HTMLDivElement | undefined
    const [shown, setShown] = createSignal<number | null>(null)
    const measureShown = () => {
        const body = chartRef?.parentElement
        const first = chartRef?.querySelector<HTMLElement>('[data-bucket]')
        if (!body || !first || first.offsetHeight === 0) return setShown(null)
        const header = chartRef!.firstElementChild === first ? 0 : (chartRef!.firstElementChild as HTMLElement).offsetHeight
        const fit = Math.floor((body.clientHeight - header) / first.offsetHeight)
        setShown(body.scrollHeight > body.clientHeight + 1 && fit < bars().length ? Math.max(1, fit) : null)
    }
    onMount(() => {
        measureShown()
        if (typeof ResizeObserver === 'undefined' || !chartRef?.parentElement) return
        const observer = new ResizeObserver(() => measureShown())
        observer.observe(chartRef.parentElement)
        onCleanup(() => observer.disconnect())
    })
    createEffect(() => {
        bars()
        grid()
        queueMicrotask(measureShown)
    })

    const readoutParts = createMemo(() => {
        const point = activePoint()
        if (point)
            return bucketReadout(point.label, point.value, point.rows.length, data().aggregate)
        const best = maxPoint()
        const caption = chartCaption(data())
        if (!best) return [caption]
        const parts = [caption, `peak ${formatValue(best.value)} (${best.label})`]
        const n = shown()
        if (n !== null) parts.push(`showing ${n} of ${bars().length}`)
        return parts
    })

    // One header row above the bars: the x property's name over the label column, the value's
    // name (aggregate + y, or `notes` for a count chart) over the value column — same total
    // width as a body row so it can never overflow on its own (Review Focus #1/#2).
    const header = createMemo(() => {
        const rowsData = bars()
        if (rowsData.length === 0) return undefined
        const names = headerNames()
        const barWidth = rowsData[0].fill + rowsData[0].track
        return barHeader(names.label, names.value, rowsData[0].label.length, rowsData[0].value.length, barWidth)
    })

    // The selected row's label, with a `>` marker swapped into its leading characters — kept to
    // the SAME total width as `bar.label` (no reserved column, no overflow risk) by trimming the
    // real text just enough to fit the marker, ellipsis-truncating if that text was already
    // filling the column.
    const markedLabel = (label: string) => {
        const marker = '> '
        const text = label.trimEnd()
        const maxText = label.length - marker.length
        if (maxText <= 0) return marker.slice(0, label.length)
        const shown =
            text.length > maxText
                ? maxText <= 1
                    ? text.slice(0, maxText)
                    : text.slice(0, maxText - 1) + '…'
                : text
        return (marker + shown).padEnd(label.length)
    }

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
            onGrid={setGrid}
            readout={<Readout parts={readoutParts()} tone={activePoint() !== undefined ? 'default' : 'muted'} />}
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
            <div class={styles.barChart} ref={chartRef}>
                <Show when={header()}>
                    <Text as="div" inherit tone="muted" class={styles.header}>
                        {header()}
                    </Text>
                </Show>
                {/* Index, not For: a relayout (a scrollbar appearing when the drill opens) hands back fresh
                    row objects, and a keyed For would rebuild every row — dropping the focused one. */}
                <Index each={bars()}>
                    {bar => (
                        <PlainButton
                            class={styles.row}
                            data-bucket={bar().key}
                            aria-pressed={selectedKey() === bar().key}
                            onPointerEnter={() => setHoverKey(bar().key)}
                            onPointerLeave={() => setHoverKey(undefined)}
                            onFocus={() => setHoverKey(bar().key)}
                            onBlur={() => setHoverKey(k => (k === bar().key ? undefined : k))}
                            onClick={() => toggle(bar().key)}
                        >
                            <Text
                                as="span"
                                inherit
                                tone={selectedKey() === bar().key ? 'default' : 'muted'}
                                class={styles.label}
                            >
                                {/* layoutBars budgets two 2-space gutters; they are typed here. */}
                                {(selectedKey() === bar().key ? markedLabel(bar().label) : bar().label) +
                                    '  '}
                            </Text>
                            <Text
                                as="span"
                                inherit
                                class={styles.fill}
                                classList={{
                                    [styles.negative]: bar().negative,
                                    [styles.dim]:
                                        selectedKey() !== undefined && selectedKey() !== bar().key,
                                    [styles.active]: activeKey() === bar().key,
                                }}
                            >
                                {'#'.repeat(bar().fill)}
                            </Text>
                            <Text as="span" inherit tone="faint" class={styles.track}>
                                {'.'.repeat(bar().track)}
                            </Text>
                            <Text as="span" inherit class={styles.value}>
                                {'  ' + bar().value}
                            </Text>
                        </PlainButton>
                    )}
                </Index>
            </div>
        </ChartFrame>
    )
}
