import type { ChartSpec } from './chartLatex'
import type { Aggregate } from './chart'
import type { Bin } from '../dates'

export function propName(id: string): string {
    const m = id.match(/^(?:note|formula|file)\.(.+)$/)
    return m ? m[1] : id
}

const AGGREGATE_WORD: Record<string, string> = {
    sum: 'sum of',
    avg: 'average',
    min: 'min',
    max: 'max',
}

export function chartCaption(spec: ChartSpec): string {
    let head: string
    if (spec.aggregate === 'count') {
        head = 'count of notes'
    } else {
        const word = AGGREGATE_WORD[spec.aggregate]
        head = `${word} ${propName(spec.y ?? '')}`
    }

    if (!spec.x) return head

    const xName = propName(spec.x)
    if (spec.isDate) return `${head} by ${spec.bin} of ${xName}`
    return `${head} by ${xName}`
}

export function formatValue(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** The bar/line/heatmap header's x-axis name, e.g. `status` or `due (week)` for a binned date
 *  axis — `chartCaption`'s per-axis half, without the surrounding sentence. */
export function axisName(x: string | undefined, isDate: boolean, bin: Bin): string {
    if (!x) return ''
    const name = propName(x)
    return isDate ? `${name} (${bin})` : name
}

/** The header's value-column name: `notes` for a count chart, else `<aggregate> <y>` (e.g.
 *  `sum priority`) — matches the short aggregate word `bucketReadout` uses in its hover line. */
export function valueAxisName(aggregate: Aggregate, y: string | undefined): string {
    if (aggregate === 'count') return 'notes'
    return `${aggregate} ${propName(y ?? '')}`.trim()
}

/**
 * The chart hover line, joined with ` // ` by the caller. A count chart's value IS its note
 * count, so showing both is redundant (`Doing // 2 // 2 notes`) — pass `aggregate: 'count'` to
 * collapse it to `Doing // 2 notes`. Any other aggregate labels its value (`Jul 20 // sum 5 //
 * 2 notes`). `aggregate` is optional so existing 3-arg call sites keep compiling unchanged.
 */
export function bucketReadout(
    label: string,
    value: number,
    rowCount: number,
    aggregate?: Aggregate,
): string[] {
    const noun = rowCount === 1 ? 'note' : 'notes'
    if (aggregate === 'count') return [label, `${rowCount} ${noun}`]
    const valueStr = aggregate ? `${aggregate} ${formatValue(value)}` : formatValue(value)
    return [label, valueStr, `${rowCount} ${noun}`]
}
