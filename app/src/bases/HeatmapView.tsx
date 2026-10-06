import { For, Index, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import {
    buildChartData,
    buildHeatmapWeeks,
    type Aggregate,
    type ChartData,
    type HeatCell as HeatCellData,
} from '../../../core/src/bases/chart'
import { bucketReadout, formatValue, propName } from '../../../core/src/bases/chartText'
import { binLabel, todayISO } from '../../../core/src/dates'
import Text from '../ui/Text'
import ChartFrame from './ChartFrame'
import ChartReadout from './ChartReadout'
import ChartDrill from './ChartDrill'
import HeatCell from './HeatCell'
import HeatmapDayEditor from './HeatmapDayEditor'
import {
    dayLabel,
    glyphOf,
    heatmapRange,
    legendRanges,
    levelOf,
    monthLabels,
    streaks,
} from './heatmapLayout'
import { dayAction, type HeatmapWriteSeam } from './heatmapWrites'
import type { ChartViewProps } from './chartViewProps'
import styles from './HeatmapView.module.css'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const AGG_WORD: Record<Aggregate, string> = {
    sum: 'sum of',
    avg: 'average',
    min: 'min',
    max: 'max',
    count: '',
}

/** The resting caption — always "per day" rather than chartText.ts's `chartCaption` "by day of
 *  <x>", since a heatmap's x is always the calendar day; naming it again would be noise. */
function heatmapCaption(data: ChartData): string {
    if (data.aggregate === 'count' || !data.y) return 'notes per day'
    return `${AGG_WORD[data.aggregate]} ${propName(data.y)} per day`
}

/** How to interact, spelled out for someone who has never seen this view before — the other half
 *  of "isn't meaningful": a glyph with no legend and a square that does nothing on click. */
function interactionHint(writes: HeatmapWriteSeam | undefined): string {
    if (!writes) return 'right-click a day to see its notes'
    if (writes.origin === 'base')
        return writes.isCount ? 'click a day to toggle it' : 'click a day to log a value'
    return 'right-click a day to see its notes'
}

export type HeatmapViewProps = ChartViewProps & {
    /** The write seam BaseView builds from the resolved x/y/aggregate and the rows behind this
     *  view — undefined when there is no write target (an inline ```query block with no base
     *  file), in which case every square is read-only and a click only opens the drill list. */
    writes?: HeatmapWriteSeam
}

export function HeatmapView(props: HeatmapViewProps) {
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
        return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null
    })

    const [columns, setColumns] = createSignal(20)
    const range = createMemo(() =>
        heatmapRange(columns(), latestData(), today()),
    )
    const grid = createMemo(() => buildHeatmapWeeks(data().points, range()))

    // Transpose the column-major week grid (buildHeatmapWeeks: weeks[week][Mon..Sun])
    // into 7 weekday ROWS spanning every week — the card reads Mon..Sun top-to-bottom.
    const dowRows = createMemo<HeatCellData[][]>(() => {
        const weeks = grid().weeks
        return DOW.map((_, dow) => weeks.map(week => week[dow]))
    })

    // Bucket by date, so hover/click can look a cell's row-count/rows up in O(1).
    const byDate = createMemo(() => {
        const m = new Map<string, { value: number; rows: number[] }>()
        for (const p of data().points)
            if (p.date) m.set(p.date, { value: p.value, rows: p.rows })
        return m
    })

    // Optimistic square fill/clear between a write and the refetch it triggers — cleared the
    // moment fresh rows arrive, whether that confirms the write or (on failure) reverts it.
    const [overrides, setOverrides] = createSignal<Map<string, number>>(new Map())
    createEffect(on(rows, () => setOverrides(new Map())))
    const effectiveValue = (dateISO: string): number | null => {
        const o = overrides()
        if (o.has(dateISO)) return o.get(dateISO)!
        return byDate().get(dateISO)?.value ?? null
    }

    const level = (cell: HeatCellData): number => {
        const { min, max } = data()
        return levelOf(effectiveValue(cell.date) ?? cell.value, min, max)
    }

    // The grid wrapper the day editor is anchored inside — a ref, not a class-name `closest`.
    let wrapRef: HTMLDivElement | undefined

    const [hovered, setHovered] = createSignal<string | null>(null)
    const [selected, setSelected] = createSignal<string | null>(null)
    const [drillNote, setDrillNote] = createSignal<string | null>(null)
    const [editing, setEditing] = createSignal<{ date: string; top: number; left: number } | null>(null)

    // NOTE: there used to be an effect here closing the drill whenever the selected date had no
    // bucket in `byDate` — meant for "the data changed under us and the row disappeared". That
    // is no longer a safe signal: a write-seam 'drill' action (heatmapWrites.ts's `dayAction`)
    // deliberately opens the drill for a day with ZERO rows too (an empty day in a query-sourced
    // chart, so the reader sees WHY there's nothing to edit), and that day never had a `byDate`
    // bucket in the first place — the effect would close it the instant it opened.

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
            return bucketReadout(dayLabel(h), effectiveValue(h) ?? bucket?.value ?? 0, bucket?.rows.length ?? 0)
        }
        const p = peak()
        const caption = heatmapCaption(data())
        const hint = interactionHint(props.writes)
        if (!p || !p.date) return [caption, hint]
        return [caption, `peak ${formatValue(p.value)} (${binLabel(p.date, 'day')})`, hint]
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

    /** Right-click always opens (or closes) the drill list of the day's rows — independent of
     *  what a left-click does, and available even with no write seam. */
    const onCellContextMenu = (cell: HeatCellData, e: MouseEvent) => {
        e.preventDefault()
        setEditing(null)
        setDrillNote(null)
        setSelected(prev => (prev === cell.date ? null : cell.date))
    }

    const closeEditor = () => setEditing(null)

    const saveDay = (dateISO: string, value: number | undefined) => {
        const w = props.writes
        setEditing(null)
        if (!w) return
        setOverrides(prev => {
            const next = new Map(prev)
            next.set(dateISO, value ?? 0)
            return next
        })
        void w.onSetDay(dateISO, value)
    }

    const onCellClick = (cell: HeatCellData, e: MouseEvent) => {
        const w = props.writes
        const bucket = byDate().get(cell.date)
        const rowCount = bucket?.rows.length ?? 0
        if (!w) {
            // Read-only (no write target): the old behaviour — click opens/closes the drill.
            if (rowCount === 0) return
            setSelected(prev => (prev === cell.date ? null : cell.date))
            return
        }
        const action = dayAction({
            origin: w.origin,
            isCount: w.isCount,
            dateLabel: dayLabel(cell.date),
            rowCount,
            current: bucket?.value,
        })
        if (action.kind === 'toggle') {
            setEditing(null)
            setSelected(null)
            const willFill = rowCount === 0
            setOverrides(prev => {
                const next = new Map(prev)
                next.set(cell.date, willFill ? 1 : 0)
                return next
            })
            void w.onToggleDay(cell.date)
            return
        }
        if (action.kind === 'edit') {
            setSelected(null)
            const target = e.currentTarget as HTMLElement
            const wrap = wrapRef
            if (wrap) {
                const wrapRect = wrap.getBoundingClientRect()
                const cellRect = target.getBoundingClientRect()
                setEditing({
                    date: cell.date,
                    top: cellRect.bottom - wrapRect.top + 4,
                    left: cellRect.left - wrapRect.left,
                })
            }
            return
        }
        // drill, with a message explaining why (several entries, no note, several notes, …)
        setEditing(null)
        setDrillNote(action.message)
        setSelected(cell.date)
    }

    return (
        <ChartFrame
            empty={!data().isDate || data().points.length === 0}
            emptyHint="set an x date column in view settings"
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
                    <div class={styles.drillWrap}>
                        {drillNote() ? (
                            <Text as="div" inherit size="ui" tone="muted" class={styles.drillNote}>
                                {drillNote()}
                            </Text>
                        ) : undefined}
                        <ChartDrill
                            title={dayLabel(selected()!)}
                            rows={drillRows()}
                            onOpen={props.onOpen}
                            onClear={() => {
                                setSelected(null)
                                setDrillNote(null)
                            }}
                        />
                    </div>
                ) : undefined
            }
        >
            <div class={styles.heatmap} ref={wrapRef}>
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
                    <Index each={dowRows()}>
                        {(weekRow, i) => (
                            <div class={styles.heatRow}>
                                <Text
                                    as="span"
                                    inherit
                                    class={styles.heatDow}
                                >
                                    {DOW[i]}
                                </Text>
                                <Index each={weekRow()}>
                                    {cell => (
                                        <HeatCell
                                            date={cell().date}
                                            level={level(cell())}
                                            glyph={glyphOf(level(cell()))}
                                            selected={selected() === cell().date}
                                            label={`${dayLabel(cell().date)}: ${formatValue(effectiveValue(cell().date) ?? 0)}`}
                                            onHover={entered =>
                                                setHovered(prev =>
                                                    entered ? cell().date : prev === cell().date ? null : prev,
                                                )
                                            }
                                            onClick={e => onCellClick(cell(), e)}
                                            onContextMenu={e => onCellContextMenu(cell(), e)}
                                        />
                                    )}
                                </Index>
                            </div>
                        )}
                    </Index>
                </div>
                {editing() ? (
                    <HeatmapDayEditor
                        dateLabel={dayLabel(editing()!.date)}
                        value={effectiveValue(editing()!.date) ?? undefined}
                        style={{ top: `${editing()!.top}px`, left: `${editing()!.left}px` }}
                        onSave={value => saveDay(editing()!.date, value)}
                        onCancel={closeEditor}
                    />
                ) : undefined}
                <div class={styles.legend}>
                    <For each={legendRanges(data().min, data().max)}>
                        {entry => (
                            <Text as="span" inherit class={styles.legendEntry}>
                                <HeatCell
                                    static
                                    level={entry.level}
                                    glyph={entry.glyph}
                                    class={styles.legendGlyph}
                                />
                                <Text as="span" inherit class={styles.legendRange}>
                                    {entry.range}
                                </Text>
                            </Text>
                        )}
                    </For>
                    <Text as="span" inherit class={styles.legendRange}>
                        {`// ${data().valueLabel} per day`}
                    </Text>
                </div>
            </div>
        </ChartFrame>
    )
}
