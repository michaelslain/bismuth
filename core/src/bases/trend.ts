import type { Bin } from '../dates'

export type TrendFit = {
    slope: number
    intercept: number
    r2: number
    unit: Bin
    origin: string
}

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

export function fitTrend(
    points: { key: string; label: string; value: number }[],
    spec: { isDate: boolean; bin: Bin },
): TrendFit | null {
    if (!spec.isDate) return null
    if (points.length < 3) return null

    const origin = points[0].label
    const originKey = points[0].key
    const t = points.map(p => tFor(originKey, p.key, spec.bin))
    const y = points.map(p => p.value)
    const n = t.length

    const tMean = t.reduce((a, b) => a + b, 0) / n
    const yMean = y.reduce((a, b) => a + b, 0) / n

    let sTT = 0
    let sTY = 0
    for (let i = 0; i < n; i++) {
        sTT += (t[i] - tMean) * (t[i] - tMean)
        sTY += (t[i] - tMean) * (y[i] - yMean)
    }
    if (sTT === 0) return null

    const slope = sTY / sTT
    const intercept = yMean - slope * tMean

    let ssRes = 0
    let ssTot = 0
    for (let i = 0; i < n; i++) {
        const pred = slope * t[i] + intercept
        ssRes += (y[i] - pred) * (y[i] - pred)
        ssTot += (y[i] - yMean) * (y[i] - yMean)
    }
    const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

    return { slope, intercept, r2, unit: spec.bin, origin }
}

export function trendAt(fit: TrendFit, t: number): number {
    return fit.slope * t + fit.intercept
}
