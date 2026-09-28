import type { ChartSpec } from './chartLatex'

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

export function bucketReadout(
    label: string,
    value: number,
    rowCount: number,
): string[] {
    const noun = rowCount === 1 ? 'note' : 'notes'
    return [label, formatValue(value), `${rowCount} ${noun}`]
}
