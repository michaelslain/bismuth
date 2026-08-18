import { For, Show, createMemo } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import {
    buildChartData,
    buildHeatmapWeeks,
    type HeatCell,
} from '../../../core/src/bases/chart'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import styles from './Charts.module.css'

const MONTH_NAMES = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
]
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

export function HeatmapView(props: { result: ViewResult; config: BaseConfig }) {
    const rows = createMemo<Row[]>(() =>
        props.result.groups.flatMap(g => g.rows),
    )
    // The heatmap is always day-binned (a calendar grid), regardless of the view's bin setting.
    const data = createMemo(() =>
        buildChartData(rows(), { ...props.result.view, bin: 'day' }),
    )
    const grid = createMemo(() => buildHeatmapWeeks(data().points))

    // Transpose the column-major week grid (buildHeatmapWeeks: weeks[week][Mon..Sun])
    // into 7 weekday ROWS spanning every week — the card reads Mon..Sun top-to-bottom.
    const dowRows = createMemo<(HeatCell | null)[][]>(() => {
        const weeks = grid().weeks
        return DOW.map((_, dow) => weeks.map(week => week[dow] ?? null))
    })

    const level = (cell: HeatCell | null): number => {
        if (!cell) return 0
        const { min, max } = data()
        return levelOf(cell.value, min, max)
    }

    // One label per week column: the month name when this column is the first to
    // fall in a new month, blank otherwise (GitHub-style sparse month row).
    const monthLabels = createMemo<string[]>(() => {
        let prev = -1
        const raw = grid().weeks.map(week => {
            const iso = week[0]?.date
            if (!iso) return ''
            const m = Number(iso.slice(5, 7)) - 1
            if (m === prev) return ''
            prev = m
            return MONTH_NAMES[m] ?? ''
        })
        // Each label sits in a 14px column (one week-cell wide) with overflow visible, so a
        // 3-letter abbreviation spills into the next column. That's invisible for a normal
        // month (several blank columns follow before the next label), but the grid's FIRST
        // column is labeled unconditionally regardless of how many of its 7 days actually
        // fall in that month — when the data starts a day or two into a month, that column's
        // Monday is still the prior month, so its label lands immediately beside the very
        // next column's label and the two glyphs merge. Drop a label that doesn't have at
        // least one blank column of clearance before the next one, favoring the later
        // (fuller) month over the earlier sliver.
        let lastKept = -Infinity
        for (let i = 0; i < raw.length; i++) {
            if (!raw[i]) continue
            if (i - lastKept < 2) raw[lastKept] = ''
            lastKept = i
        }
        return raw
    })

    // Streak stat cards (entries / current streak / longest streak) over the
    // day-binned points. A day "counts" when it has a value > 0.
    const streaks = createMemo(() => {
        const days = data().points.filter(p => p.date && p.value > 0)
        const entries = days.length
        const dates = days.map(p => p.date as string).sort()
        let longest = 0
        let current = 0
        let prev: string | null = null
        const nextDay = (iso: string) => {
            const d = new Date(iso + 'T00:00:00')
            d.setDate(d.getDate() + 1)
            return d.toISOString().slice(0, 10)
        }
        for (const d of dates) {
            current = prev !== null && nextDay(prev) === d ? current + 1 : 1
            if (current > longest) longest = current
            prev = d
        }
        // `current` is the run ending at the most recent entry — that's only a live
        // streak if the last entry is today (or yesterday, with today still open). If
        // the chain already lapsed, the current streak is 0.
        const today = todayISO()
        if (prev !== null && prev !== today && prev !== addDaysISO(today, -1))
            current = 0
        return { entries, current, longest }
    })

    const streakCards = createMemo(() => {
        const s = streaks()
        return [
            { label: 'entries', value: String(s.entries) },
            {
                label: 'current streak',
                value: `${s.current} ${s.current === 1 ? 'day' : 'days'}`,
            },
            {
                label: 'longest streak',
                value: `${s.longest} ${s.longest === 1 ? 'day' : 'days'}`,
            },
        ]
    })

    return (
        <div class={styles.chart}>
            <Show
                when={grid().weeks.length > 0}
                fallback={
                    <div class={styles.empty}>
                        No dated rows to chart. Set an x date column in view
                        settings.
                    </div>
                }
            >
                <div class={styles.heatmap}>
                    <div class={styles.heatMonths}>
                        <span style={{ width: '14px', flex: 'none' }} />
                        <For each={monthLabels()}>
                            {label => (
                                <span class={styles.heatMonthCol}>{label}</span>
                            )}
                        </For>
                    </div>
                    <div class={styles.heatGrid}>
                        <For each={dowRows()}>
                            {(weekRow, i) => (
                                <div class={styles.heatRow}>
                                    <span class={styles.heatDow}>
                                        {DOW[i()]}
                                    </span>
                                    <For each={weekRow}>
                                        {cell => {
                                            const lv = level(cell)
                                            return (
                                                <span
                                                    class={`${styles.heatCol} ${styles[LEVEL_CLASS[lv]]}`}
                                                    title={
                                                        cell
                                                            ? `${cell.date}: ${cell.value ?? 0}`
                                                            : ''
                                                    }
                                                >
                                                    {glyphOf(lv)}
                                                </span>
                                            )
                                        }}
                                    </For>
                                </div>
                            )}
                        </For>
                    </div>
                    <div class={styles.legend}>
                        <span>less</span>
                        <span class={`${styles.legendGlyph} ${styles.lv0}`}>
                            .
                        </span>
                        <span class={`${styles.legendGlyph} ${styles.lv1}`}>
                            -
                        </span>
                        <span class={`${styles.legendGlyph} ${styles.lv2}`}>
                            +
                        </span>
                        <span class={`${styles.legendGlyph} ${styles.lv3}`}>
                            #
                        </span>
                        <span>more</span>
                        <div class={styles.legendSpacer} />
                        <span>intensity is the glyph, never the cell size</span>
                    </div>
                    <div class={`${styles.statgrid} ${styles.streakStats}`}>
                        <For each={streakCards()}>
                            {card => (
                                <div class={styles.statTile}>
                                    <div
                                        class={styles.statValue}
                                        style={{ 'font-size': '22px' }}
                                    >
                                        {card.value}
                                    </div>
                                    <div class={styles.statLabel}>
                                        {card.label}
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
            </Show>
        </div>
    )
}
