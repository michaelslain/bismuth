import { For, createEffect, createMemo, createSignal } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import {
    buildChartData,
    buildHeatmapWeeks,
    type HeatCell,
} from '../../../core/src/bases/chart'
import { chartCaption, bucketReadout, formatValue } from '../../../core/src/bases/chartText'
import { binLabel, todayISO } from '../../../core/src/dates'
import Text from '../ui/Text'
import ChartFrame from './ChartFrame'
import ChartReadout from './ChartReadout'
import ChartDrill from './ChartDrill'
import { dayLabel, heatmapRange, monthLabels, streaks } from './heatmapLayout'
import type { ChartViewProps } from './chartViewProps'
import styles from './HeatmapView.module.css'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Density glyph per intensity tier — a year of activity, one character per day
// (bases-heatmap.card.html): "intensity is the glyph, never the cell size."
const GLYPHS = ['.', '-', '+', '#'] as const
const LEVEL_CLASS = ['lv0', 'lv0', 'lv1', 'lv2', 'lv3'] // index 0 = no data

function levelOf(v: number | null, min: number, max: number): number {
    if (v === null || v <= 0) return 0
    const t = max === min ? 1 : (v - min) / (max - min)
    return 1 + Math.min(GLYPHS.length - 1, Math.floor(t * GLYPHS.length))
}
function glyphOf(level: number): string {
    return level === 0 ? '.' : GLYPHS[Math.min(GLYPHS.length - 1, level - 1)]
}

export function HeatmapView(props: ChartViewProps) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    // The heatmap is always day-binned (a calendar grid), regardless of the view's bin setting.
    const data = createMemo(() =>
        buildChartData(rows(), { ...props.result.view, bin: 'day' }),
    )
    const today = createMemo(() => todayISO())
    const latestData = createMemo<string | null>(() => {
        const dates = data()
            .points.map(p => p.date)
            .filter((d): d is string => !!d)
        return dates.length ? dates.sort().at(-1)! : null
    })

    const [columns, setColumns] = createSignal(20)
    const range = createMemo(() =>
        heatmapRange(columns(), latestData(), today()),
    )
    const grid = createMemo(() => buildHeatmapWeeks(data().points, range()))

    // Transpose the column-major week grid (buildHeatmapWeeks: weeks[week][Mon..Sun])
    // into 7 weekday ROWS spanning every week — the card reads Mon..Sun top-to-bottom.
    const dowRows = createMemo<HeatCell[][]>(() => {
        const weeks = grid().weeks
        return DOW.map((_, dow) => weeks.map(week => week[dow]))
    })

    const level = (cell: HeatCell): number => {
        const { min, max } = data()
        return levelOf(cell.value, min, max)
    }

    // Bucket by date, so hover/click can look a cell's row-count/rows up in O(1).
    const byDate = createMemo(() => {
        const m = new Map<string, { value: number; rows: number[] }>()
        for (const p of data().points)
            if (p.date) m.set(p.date, { value: p.value, rows: p.rows })
        return m
    })

    const [hovered, setHovered] = createSignal<string | null>(null)
    const [selected, setSelected] = createSignal<string | null>(null)

    // A data change that removes the selected bucket closes the drill.
    createEffect(() => {
        const sel = selected()
        if (sel && !byDate().has(sel)) setSelected(null)
    })

    const peak = createMemo(() => {
        const pts = data().points
        if (pts.length === 0) return null
        return pts.reduce((a, b) => (b.value > a.value ? b : a))
    })

    const streakInfo = createMemo(() => streaks(data().points, today()))

    const readoutParts = createMemo<string[]>(() => {
        const h = hovered()
        if (h) {
            const bucket = byDate().get(h)
            return bucketReadout(dayLabel(h), bucket?.value ?? 0, bucket?.rows.length ?? 0)
        }
        const p = peak()
        const caption = chartCaption(data())
        if (!p || !p.date) return [caption]
        return [caption, `peak ${formatValue(p.value)} (${binLabel(p.date, 'day')})`]
    })

    const footerText = createMemo(() => {
        const s = streakInfo()
        const day = (n: number) => (n === 1 ? 'day' : 'days')
        return [
            `${s.entries} ${day(s.entries)} logged`,
            `current streak ${s.current} ${day(s.current)}`,
            `longest streak ${s.longest} ${day(s.longest)}`,
        ].join(' // ')
    })

    const drillRows = createMemo<Row[]>(() => {
        const sel = selected()
        if (!sel) return []
        const bucket = byDate().get(sel)
        if (!bucket) return []
        const all = rows()
        return bucket.rows.map(i => all[i])
    })

    const toggle = (date: string) => {
        const bucket = byDate().get(date)
        if (!bucket || bucket.rows.length === 0) return
        setSelected(prev => (prev === date ? null : date))
    }

    return (
        <ChartFrame
            empty={!data().isDate || data().points.length === 0}
            emptyMessage="No dated rows to chart. Set an x date column in view settings."
            onGrid={g => setColumns(g.columns)}
            readout={
                <ChartReadout parts={readoutParts()} active={hovered() !== null} />
            }
            footer={
                <Text as="div" inherit size="ui" tone="muted">
                    {footerText()}
                </Text>
            }
            drill={
                selected() ? (
                    <ChartDrill
                        title={dayLabel(selected()!)}
                        rows={drillRows()}
                        onOpen={props.onOpen}
                        onClear={() => setSelected(null)}
                    />
                ) : undefined
            }
        >
            <div class={styles.heatmap}>
                <div class={styles.heatMonths}>
                    <div class={styles.heatGutter} />
                    <For each={monthLabels(grid().weeks)}>
                        {label => (
                            <Text
                                as="span"
                                inherit
                                class={styles.heatMonthCol}
                            >
                                <Text as="span" inherit class={styles.heatMonthLabel}>
                                    {label}
                                </Text>
                            </Text>
                        )}
                    </For>
                </div>
                <div class={styles.heatGrid}>
                    <For each={dowRows()}>
                        {(weekRow, i) => (
                            <div class={styles.heatRow}>
                                <Text
                                    as="span"
                                    inherit
                                    class={styles.heatDow}
                                >
                                    {DOW[i()]}
                                </Text>
                                <For each={weekRow}>
                                    {cell => {
                                        const lv = level(cell)
                                        return (
                                            <Text
                                                as="span"
                                                inherit
                                                data-bucket={cell.date}
                                                class={`${styles.heatCol} ${styles[LEVEL_CLASS[lv]]} ${
                                                    selected() === cell.date
                                                        ? styles.selected
                                                        : ''
                                                }`}
                                                onPointerEnter={() =>
                                                    setHovered(cell.date)
                                                }
                                                onPointerLeave={() =>
                                                    setHovered(prev =>
                                                        prev === cell.date ? null : prev,
                                                    )
                                                }
                                                onClick={() => toggle(cell.date)}
                                            >
                                                {glyphOf(lv)}
                                            </Text>
                                        )
                                    }}
                                </For>
                            </div>
                        )}
                    </For>
                </div>
                <div class={styles.legend}>
                    <Text as="span" inherit>
                        less
                    </Text>
                    <Text
                        as="span"
                        inherit
                        class={`${styles.legendGlyph} ${styles.lv0}`}
                    >
                        .
                    </Text>
                    <Text
                        as="span"
                        inherit
                        class={`${styles.legendGlyph} ${styles.lv1}`}
                    >
                        -
                    </Text>
                    <Text
                        as="span"
                        inherit
                        class={`${styles.legendGlyph} ${styles.lv2}`}
                    >
                        +
                    </Text>
                    <Text
                        as="span"
                        inherit
                        class={`${styles.legendGlyph} ${styles.lv3}`}
                    >
                        #
                    </Text>
                    <Text as="span" inherit>
                        more
                    </Text>
                </div>
            </div>
        </ChartFrame>
    )
}
