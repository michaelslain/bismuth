// Pure ASCII line-plot layout behind LineView.tsx — ported in spirit from
// bismuth-design/ascii/design-system/guidelines/bases-line.card.html: a value over time,
// plotted on the character grid (no SVG). Kept as plain functions (no DOM/Solid) so
// it's unit-testable headlessly, matching the AsciiMeter/asciiMeterMath split.

import { formatValue } from '../../../core/src/bases/chartText'

export interface LinePoint {
    label: string
    value: number
}

/** One drawn cell: a run of same-kind characters within a plot row. */
export type SegmentKind = 'blank' | 'line' | 'point' | 'trend'

export interface LineSegment {
    text: string
    kind: SegmentKind
}

export interface LineRow {
    /** Left y-axis gutter: the row's value tick, or blank, padded to `gutter` width. */
    tick: string
    segments: LineSegment[]
}

export interface LinePlot {
    rows: LineRow[]
    /** The baseline `+---…` axis rule, sized to the plot width. */
    axisRule: string
    /** x-axis tick labels, on their OWN line under the rule, each centred under its point's
     *  column (blank-padded between). Labels that would collide are thinned to every k-th. */
    axisLabels: string
}

const MIN_SLOT = 2

/** Row index (0 = top) a value plots at, within `height` rows spanning [scaleMin, scaleMax]. */
function rowFor(
    value: number,
    scaleMin: number,
    scaleMax: number,
    height: number,
): number {
    const span = scaleMax - scaleMin
    if (span <= 0) return height - 1
    const frac = (value - scaleMin) / span
    const r = height - 1 - Math.round(frac * (height - 1))
    return Math.max(0, Math.min(height - 1, r))
}

/**
 * Lay `points` onto a character grid, `height` rows tall (default 12), spanning the full
 * measured `columns` width. Points are spaced evenly by INDEX (not by actual date distance) —
 * a categorical axis, one column-slot per point, the point centred in its slot. When the slots
 * would be narrower than `MIN_SLOT` (2 chars) for the full point count, only the last K points
 * that fit are kept (`firstIndex` says how many were dropped from the front).
 *
 * `opts.trend`, when given, is called with a (possibly fractional) index into the ORIGINAL
 * `points` array — the caller owns converting that index to its own t/value — and its result is
 * drawn as a faint `.` in every otherwise-blank cell (never overwriting the data line/points).
 */
export function buildLinePlot(
    points: LinePoint[],
    opts: { columns: number; height?: number; trend?: (i: number) => number },
): LinePlot & { colOf: (i: number) => number; gutter: number; firstIndex: number } {
    const height = opts.height ?? 12
    const n0 = points.length
    if (n0 === 0) {
        return {
            rows: [],
            axisRule: '',
            axisLabels: '',
            colOf: () => 0,
            gutter: 0,
            firstIndex: 0,
        }
    }

    const scaleMax = Math.max(0, ...points.map(p => p.value))
    const scaleMin = Math.min(0, ...points.map(p => p.value))
    const mid = (scaleMax + scaleMin) / 2

    const maxTick = formatValue(scaleMax)
    const midTick = formatValue(mid)
    const zeroTick = formatValue(0)
    const gutter = Math.max(maxTick.length, midTick.length, zeroTick.length) + 1

    const avail = Math.max(MIN_SLOT, opts.columns - gutter - 1)
    let n = n0
    let slotWidth = Math.floor(avail / n)
    let firstIndex = 0
    if (slotWidth < MIN_SLOT) {
        n = Math.max(1, Math.floor(avail / MIN_SLOT))
        firstIndex = n0 - n
        slotWidth = Math.floor(avail / n)
    }

    const visible = points.slice(firstIndex)
    const plotWidth = n * slotWidth
    const localColOf = (i: number) => i * slotWidth + Math.floor(slotWidth / 2)
    const colOf = (i: number) => gutter + localColOf(i)
    const rowOf = (i: number) => rowFor(visible[i].value, scaleMin, scaleMax, height)

    const chars: string[][] = Array.from({ length: height }, () =>
        Array(plotWidth).fill(' '),
    )
    const kinds: SegmentKind[][] = Array.from({ length: height }, () =>
        Array(plotWidth).fill('blank' as SegmentKind),
    )
    const setCell = (row: number, col: number, ch: string, kind: SegmentKind) => {
        if (row < 0 || row >= height || col < 0 || col >= plotWidth) return
        chars[row][col] = ch
        kinds[row][col] = kind
    }

    // Connect each pair of adjacent points. Interpolate a single row per intervening column,
    // then where two adjacent columns' rows differ by more than one, fill a vertical `|` run at
    // the later column so no two adjacent drawn columns are more than one row apart (8-connected).
    for (let i = 0; i < n - 1; i++) {
        const c0 = localColOf(i)
        const c1 = localColOf(i + 1)
        const r0 = rowOf(i)
        const r1 = rowOf(i + 1)
        const dc = c1 - c0
        const colRow: number[] = []
        for (let c = c0; c <= c1; c++) {
            const t = dc === 0 ? 0 : (c - c0) / dc
            colRow.push(Math.round(r0 + (r1 - r0) * t))
        }
        for (let k = 0; k < colRow.length; k++) {
            const c = c0 + k
            const r = colRow[k]
            if (c === c0 || c === c1) continue // points drawn separately, below
            const prev = colRow[k - 1]
            if (Math.abs(r - prev) > 1) {
                const lo = Math.min(prev, r)
                const hi = Math.max(prev, r)
                for (let rr = lo; rr <= hi; rr++) setCell(rr, c, '|', 'line')
            } else {
                const ch = r < prev ? '/' : r > prev ? '\\' : '-'
                setCell(r, c, ch, 'line')
            }
        }
    }
    // Markers drawn last so they win over any connecting glyph landing on the same cell.
    for (let i = 0; i < n; i++) setCell(rowOf(i), localColOf(i), 'o', 'point')

    // Trend: a faint `.` at every column, only where the cell is still blank.
    if (opts.trend) {
        const half = Math.floor(slotWidth / 2)
        for (let c = 0; c < plotWidth; c++) {
            const fracVisible = (c - half) / slotWidth
            const origIndex = firstIndex + fracVisible
            const value = opts.trend(origIndex)
            const r = rowFor(value, scaleMin, scaleMax, height)
            if (kinds[r][c] === 'blank') setCell(r, c, '.', 'trend')
        }
    }

    // Group each row into same-kind runs so the caller renders a handful of spans per row
    // instead of one per character.
    const rows: LineRow[] = chars.map((line, r) => {
        const segments: LineSegment[] = []
        let cur = ''
        let curKind: SegmentKind = 'blank'
        for (let c = 0; c < line.length; c++) {
            const ch = line[c]
            const kind = kinds[r][c]
            if (segments.length === 0 && cur === '') {
                cur = ch
                curKind = kind
                continue
            }
            if (kind === curKind) {
                cur += ch
                continue
            }
            segments.push({ text: cur, kind: curKind })
            cur = ch
            curKind = kind
        }
        if (cur) segments.push({ text: cur, kind: curKind })

        const maxRow = rowFor(scaleMax, scaleMin, scaleMax, height)
        const midRow = rowFor(mid, scaleMin, scaleMax, height)
        const zeroRow = rowFor(0, scaleMin, scaleMax, height)
        let tickText = ''
        if (r === maxRow) tickText = maxTick
        else if (r === zeroRow) tickText = zeroTick
        else if (r === midRow) tickText = midTick
        const tick = tickText
            ? tickText.padStart(gutter - 1) + ' '
            : ' '.repeat(gutter)
        return { tick, segments }
    })

    const axisRule = ' '.repeat(gutter) + '+' + '-'.repeat(plotWidth)

    const maxLabelLen = Math.max(...visible.map(p => p.label.length))
    const step =
        slotWidth >= maxLabelLen + 1
            ? 1
            : Math.max(1, Math.ceil((maxLabelLen + 1) / slotWidth))
    const totalLen = gutter + plotWidth
    const labelChars = Array(totalLen).fill(' ')
    for (let i = 0; i < n; i += step) {
        const label = visible[i].label
        const center = colOf(i)
        let start = center - Math.floor(label.length / 2)
        start = Math.max(0, Math.min(totalLen - label.length, start))
        for (let k = 0; k < label.length; k++) labelChars[start + k] = label[k]
    }
    const axisLabels = labelChars.join('').replace(/\s+$/, '')

    return { rows, axisRule, axisLabels, colOf, gutter, firstIndex }
}
