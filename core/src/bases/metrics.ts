import type { Expr } from './ast'
import type { Row, ViewConfig, StatMetric } from './types'
import { parseExpr } from './parser'
import { evaluate } from './evaluate'
import { toContext } from './query'
import { toNumber, truthy } from './values'
import { buildChartData, type ChartData, type Aggregate } from './chart'
import { binKey, binLabel, addDaysISO, type Bin } from '../dates'

export type MetricResult = {
    label: string
    source: string // the metric expression text
    value: number | null // over ALL rows
    current: number | null // over rows in the bin containing `today`
    previous: number | null // over rows in the bin before that
    series: (number | null)[] // the last 12 bins ending at today's bin, oldest first
    seriesKeys: string[] // ISO bin keys, same length/order as `series`
    seriesLabels: string[] // binLabel(key, bin) per entry, same length/order as `series`
    bin: Bin // view.bin ?? 'week'
    hasTime: boolean // false when x is not a date axis: current/previous null, series []
    error?: string
}

const AGGREGATE_FNS = new Set(['sum', 'avg', 'min', 'max', 'count'])

// Human-readable name of an expression node, for the "X must be inside ..." error —
// a bare ident is just its name, a member chain reads as its dotted path.
function exprName(node: Expr): string {
    if (node.type === 'ident') return node.name
    if (node.type === 'member') return `${exprName(node.object)}.${node.name}`
    return 'expression'
}

function evalAggregate(name: string, args: Expr[], rows: Row[]): number | null {
    if (name === 'count') {
        if (args.length === 0) return rows.length
        const expr = args[0]
        let n = 0
        for (const r of rows) if (truthy(evaluate(expr, toContext(r)))) n++
        return n
    }
    const expr = args[0]
    if (!expr) throw new Error(`${name}() requires an argument`)
    const nums: number[] = []
    for (const r of rows) {
        const v = toNumber(evaluate(expr, toContext(r)))
        if (!Number.isNaN(v)) nums.push(v)
    }
    if (name === 'sum') return nums.reduce((a, b) => a + b, 0)
    if (nums.length === 0) return null
    if (name === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
    if (name === 'min') return Math.min(...nums)
    return Math.max(...nums) // 'max'
}

// Walk the AST in "metric space": only aggregate calls (sum/avg/min/max/count), num
// literals, unary '-', binary + - * / % and parentheses (already flattened by the
// parser) are legal outside an aggregate's own argument — a bare ident/member there
// throws, since it has no row to read from.
function evalMetricExpr(node: Expr, rows: Row[]): number | null {
    switch (node.type) {
        case 'num':
            return node.value
        case 'unary': {
            if (node.op !== '-')
                throw new Error(`unsupported operator ${node.op}`)
            const v = evalMetricExpr(node.operand, rows)
            return v === null ? null : -v
        }
        case 'binary': {
            const l = evalMetricExpr(node.left, rows)
            const r = evalMetricExpr(node.right, rows)
            if (l === null || r === null) return null
            switch (node.op) {
                case '+':
                    return l + r
                case '-':
                    return l - r
                case '*':
                    return l * r
                case '/':
                    return r === 0 ? null : l / r
                case '%':
                    return r === 0 ? null : l % r
                default:
                    throw new Error(`unsupported operator ${node.op}`)
            }
        }
        case 'call': {
            if (node.callee.type !== 'ident' || !AGGREGATE_FNS.has(node.callee.name))
                throw new Error(
                    `${exprName(node.callee)} must be inside sum, avg, min, max or count`,
                )
            return evalAggregate(node.callee.name, node.args, rows)
        }
        case 'ident':
        case 'member':
            throw new Error(
                `${exprName(node)} must be inside sum, avg, min, max or count`,
            )
        default:
            throw new Error(`unsupported expression`)
    }
}

/** The metric a stat view falls back to when it declares no `stats:` — mirrors the
 *  view's own x/y/aggregate. `count()` when aggregate is count or no y resolved;
 *  otherwise `<agg>(<y>)` (y with any "note." prefix stripped), labelled
 *  "<agg> of <name>" ("average" for avg). */
export function defaultMetric(data: ChartData): StatMetric {
    const agg: Aggregate = data.aggregate
    if (agg === 'count' || !data.y) return { label: 'notes', value: 'count()' }
    const name = data.y.replace(/^note\./, '')
    const aggLabel = agg === 'avg' ? 'average' : agg
    return { label: `${aggLabel} of ${name}`, value: `${agg}(${name})` }
}

// Step a bin key back (or forward, with a positive n) by n bins. Day/week bins are a
// fixed number of days; month bins need real month arithmetic since a month's length
// varies (keys are always the 1st of the month, from dates.ts's binKey).
function stepBin(key: string, bin: Bin, n: number): string {
    if (bin === 'month') {
        const y = Number(key.slice(0, 4))
        const m = Number(key.slice(5, 7))
        const total = y * 12 + (m - 1) + n
        const ny = Math.floor(total / 12)
        const nm = ((total % 12) + 12) % 12
        return `${ny}-${String(nm + 1).padStart(2, '0')}-01`
    }
    const days = bin === 'week' ? 7 : 1
    return addDaysISO(key, days * n)
}

/** Resolve the view's stat metrics against `rows`: `view.stats` when declared,
 *  otherwise one synthesized metric from the view's own x/y/aggregate. Each metric is
 *  evaluated over all rows (`value`), and — when the view's x axis resolves to a date —
 *  additionally over the bin containing `today` (`current`), the bin before that
 *  (`previous`), and the last 12 bins ending at today's bin (`series`, oldest first). A
 *  parse/evaluation error is captured on `error` rather than thrown, with every number
 *  nulled. */
export function metricResults(
    rows: Row[],
    view: ViewConfig,
    today: string,
): MetricResult[] {
    const bin: Bin = view.bin ?? 'week'
    const metrics: StatMetric[] =
        view.stats && view.stats.length > 0
            ? view.stats
            : [defaultMetric(buildChartData(rows, view))]

    // Bucket the rows by bin (count aggregate is irrelevant — only the buckets' `rows`
    // index lists are used) so current/previous/series can re-evaluate each metric over
    // exactly the rows in that bin.
    const binData = buildChartData(rows, { ...view, aggregate: 'count', bin })
    const hasTime = binData.isDate
    const pointsByKey = new Map(binData.points.map(p => [p.key, p]))
    const currentKey = binKey(today, bin)

    return metrics.map(m => {
        let value: number | null = null
        let current: number | null = null
        let previous: number | null = null
        let series: (number | null)[] = []
        let seriesKeys: string[] = []
        let seriesLabels: string[] = []
        let error: string | undefined

        const rowsForBin = (key: string): Row[] => {
            const p = pointsByKey.get(key)
            return p ? p.rows.map(i => rows[i]) : []
        }

        try {
            const ast = parseExpr(m.value)
            value = evalMetricExpr(ast, rows)
            if (hasTime) {
                current = evalMetricExpr(ast, rowsForBin(currentKey))
                previous = evalMetricExpr(
                    ast,
                    rowsForBin(stepBin(currentKey, bin, -1)),
                )
                const keys: string[] = []
                let k = currentKey
                for (let i = 0; i < 12; i++) {
                    keys.unshift(k)
                    k = stepBin(k, bin, -1)
                }
                series = keys.map(key => evalMetricExpr(ast, rowsForBin(key)))
                seriesKeys = keys
                seriesLabels = keys.map(key => binLabel(key, bin))
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e)
            value = null
            current = null
            previous = null
            series = []
            seriesKeys = []
            seriesLabels = []
        }

        return {
            label: m.label,
            source: m.value,
            value,
            current: hasTime ? current : null,
            previous: hasTime ? previous : null,
            series: hasTime ? series : [],
            seriesKeys: hasTime ? seriesKeys : [],
            seriesLabels: hasTime ? seriesLabels : [],
            bin,
            hasTime,
            error,
        }
    })
}
