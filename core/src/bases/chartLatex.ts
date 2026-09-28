import type { Aggregate } from './chart'
import type { Bin } from '../dates'
import type { Expr } from './ast'
import { parseExpr } from './parser'
import { propName } from './chartText'
import type { TrendFit } from './trend'

export type ChartSpec = {
    x?: string
    y?: string
    aggregate: Aggregate
    bin: Bin
    isDate: boolean
}

const ESCAPES: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    $: '\\$',
    '&': '\\&',
    '#': '\\#',
    '^': '\\textasciicircum{}',
    _: '\\_',
    '%': '\\%',
    '~': '\\textasciitilde{}',
}

function escapeTex(s: string): string {
    return s.replace(/[\\{}$&#^_%~]/g, c => ESCAPES[c] ?? c)
}

export function texText(s: string): string {
    return `\\text{${escapeTex(s)}}`
}

const PRECEDENCE: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '>': 4,
    '<': 4,
    '>=': 4,
    '<=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
}

const COMPARE_OPS: Record<string, string> = {
    '==': ' = ',
    '!=': ' \\ne ',
    '<': ' < ',
    '<=': ' \\le ',
    '>': ' > ',
    '>=': ' \\ge ',
    '&&': ' \\land ',
    '||': ' \\lor ',
    '+': ' + ',
    '-': ' - ',
}

const NAMESPACE_ROOTS = new Set(['note', 'formula', 'file'])

// Renders a binary operand, wrapping it in \left( \right) only when it is
// itself a binary expression of lower precedence than the parent operator.
// A `/` child is never wrapped — \frac already groups it visually.
function renderOperand(child: Expr, parentPrec: number): string {
    const s = exprToLatex(child)
    if (child.type === 'binary' && child.op !== '/') {
        const childPrec = PRECEDENCE[child.op]
        if (childPrec !== undefined && childPrec < parentPrec)
            return `\\left( ${s} \\right)`
    }
    return s
}

export function exprToLatex(e: Expr): string {
    switch (e.type) {
        case 'num':
            return String(e.value)
        case 'str':
            return `\\text{\`\`${escapeTex(e.value)}''}`
        case 'bool':
            return `\\text{${e.value ? 'true' : 'false'}}`
        case 'null':
            return '\\text{null}'
        case 'ident':
            return texText(e.name)
        case 'member': {
            if (e.object.type === 'ident' && NAMESPACE_ROOTS.has(e.object.name))
                return texText(e.name)
            return `${exprToLatex(e.object)}.${texText(e.name)}`
        }
        case 'index':
            return `${exprToLatex(e.object)}[${exprToLatex(e.index)}]`
        case 'unary': {
            const operand =
                e.operand.type === 'binary'
                    ? `\\left( ${exprToLatex(e.operand)} \\right)`
                    : exprToLatex(e.operand)
            return e.op === '!' ? `\\lnot ${operand}` : `-${operand}`
        }
        case 'binary': {
            if (e.op === '/')
                return `\\frac{${exprToLatex(e.left)}}{${exprToLatex(e.right)}}`
            const prec = PRECEDENCE[e.op] ?? 0
            const left = renderOperand(e.left, prec)
            const right = renderOperand(e.right, prec)
            if (e.op === '*') return `${left} \\cdot ${right}`
            if (e.op === '%') return `${left} \\bmod ${right}`
            const sym = COMPARE_OPS[e.op] ?? ` ${e.op} `
            return `${left}${sym}${right}`
        }
        case 'call': {
            const args = e.args.map(a => exprToLatex(a))
            if (e.callee.type === 'ident') {
                const name = e.callee.name
                if (name === 'abs') return `\\left|${args.join(', ')}\\right|`
                if (name === 'sqrt') return `\\sqrt{${args.join(', ')}}`
                if (name === 'min') return `\\min(${args.join(', ')})`
                if (name === 'max') return `\\max(${args.join(', ')})`
                return `\\operatorname{${name}}(${args.join(', ')})`
            }
            if (e.callee.type === 'member') {
                const obj = exprToLatex(e.callee.object)
                return `\\operatorname{${e.callee.name}}(${[obj, ...args].join(', ')})`
            }
            return `\\operatorname{${exprToLatex(e.callee)}}(${args.join(', ')})`
        }
        case 'lambda':
            return `(${e.params.join(', ')}) \\mapsto ${exprToLatex(e.body)}`
        case 'regex':
            return `\\texttt{/${e.source}/${e.flags}}`
    }
}

const AGGREGATES = new Set(['sum', 'avg', 'min', 'max', 'count'])

// A stat metric's per-note term: every property reference reads `n.<name>`, the same row
// variable the line view's definition uses (`\sum_{n \in B_t} n.\text{priority}`).
function rowTerm(e: Expr): string {
    if (e.type === 'ident') return `n.${texText(e.name)}`
    if (
        e.type === 'member' &&
        e.object.type === 'ident' &&
        NAMESPACE_ROOTS.has(e.object.name)
    )
        return `n.${texText(e.name)}`
    if (e.type === 'binary') {
        if (e.op === '/') return `\\frac{${rowTerm(e.left)}}{${rowTerm(e.right)}}`
        const prec = PRECEDENCE[e.op] ?? 0
        const side = (c: Expr) =>
            c.type === 'binary' && c.op !== '/' && (PRECEDENCE[c.op] ?? 0) < prec
                ? `\\left( ${rowTerm(c)} \\right)`
                : rowTerm(c)
        if (e.op === '*') return `${side(e.left)} \\cdot ${side(e.right)}`
        if (e.op === '%') return `${side(e.left)} \\bmod ${side(e.right)}`
        return `${side(e.left)}${COMPARE_OPS[e.op] ?? ` ${e.op} `}${side(e.right)}`
    }
    if (e.type === 'unary') {
        const inner = e.operand.type === 'binary' ? `\\left( ${rowTerm(e.operand)} \\right)` : rowTerm(e.operand)
        return e.op === '!' ? `\\lnot ${inner}` : `-${inner}`
    }
    return exprToLatex(e)
}

// Wraps a summand that is itself a sum/difference so `\sum_n a + b` cannot read as `(\sum_n a) + b`.
function summand(e: Expr): string {
    const t = rowTerm(e)
    return e.type === 'binary' && (e.op === '+' || e.op === '-') ? `\\left( ${t} \\right)` : t
}

/**
 * A stat metric expression (`stats[].value`, evaluated by metrics.ts) as math notation rather than
 * function calls — the aggregates read the way the line view's definition does:
 * `sum(price)` → `\sum_{n} n.\text{price}`, `avg(priority)` → `\overline{n.\text{priority}}`,
 * `min`/`max` → `\min_{n}`/`\max_{n}`, `count()` → `\#\,\text{notes}`,
 * `count(status == "done")` → `\#\{\, n : n.\text{status} = \text{``done''} \,\}`.
 * Arithmetic between aggregates (`sum(price) / sum(units)`) keeps exprToLatex's operators.
 */
export function metricToLatex(e: Expr): string {
    if (e.type === 'call' && e.callee.type === 'ident' && AGGREGATES.has(e.callee.name)) {
        const arg = e.args[0]
        switch (e.callee.name) {
            case 'count':
                return arg
                    ? `\\#\\{\\, n : ${rowTerm(arg)} \\,\\}`
                    : `\\#\\,\\text{notes}`
            case 'sum':
                return arg ? `\\sum_{n} ${summand(arg)}` : '0'
            case 'avg':
                return arg ? `\\overline{${rowTerm(arg)}}` : `\\text{—}`
            case 'min':
                return arg ? `\\min_{n} ${summand(arg)}` : `\\text{—}`
            case 'max':
                return arg ? `\\max_{n} ${summand(arg)}` : `\\text{—}`
        }
    }
    if (e.type === 'binary') {
        if (e.op === '/') return `\\frac{${metricToLatex(e.left)}}{${metricToLatex(e.right)}}`
        const prec = PRECEDENCE[e.op] ?? 0
        const side = (c: Expr) =>
            c.type === 'binary' && c.op !== '/' && (PRECEDENCE[c.op] ?? 0) < prec
                ? `\\left( ${metricToLatex(c)} \\right)`
                : metricToLatex(c)
        if (e.op === '*') return `${side(e.left)} \\cdot ${side(e.right)}`
        if (e.op === '%') return `${side(e.left)} \\bmod ${side(e.right)}`
        return `${side(e.left)}${COMPARE_OPS[e.op] ?? ` ${e.op} `}${side(e.right)}`
    }
    if (e.type === 'unary' && e.op === '-') {
        const inner = e.operand.type === 'binary' ? `\\left( ${metricToLatex(e.operand)} \\right)` : metricToLatex(e.operand)
        return `-${inner}`
    }
    return exprToLatex(e)
}

function membership(spec: ChartSpec): string {
    const name = propName(spec.x ?? '')
    if (!spec.isDate) return `n.${texText(name)} = t`
    if (spec.bin === 'day') return `n.${texText(name)} = t`
    return `\\operatorname{${spec.bin}}(n.${texText(name)}) = t`
}

function yLine(agg: Aggregate, yProp: string, universe: string): string {
    switch (agg) {
        case 'count':
            return `y(t) = \\left|${universe}\\right|`
        case 'sum':
            return `y(t) = \\sum_{n \\in ${universe}} n.${texText(yProp)}`
        case 'avg':
            return `y(t) = \\frac{1}{\\left|${universe}\\right|} \\sum_{n \\in ${universe}} n.${texText(yProp)}`
        case 'min':
            return `y(t) = \\min_{n \\in ${universe}} n.${texText(yProp)}`
        case 'max':
            return `y(t) = \\max_{n \\in ${universe}} n.${texText(yProp)}`
    }
}

function noXLine(agg: Aggregate, yProp: string): string {
    const universe = '\\text{notes}'
    switch (agg) {
        case 'count':
            return `y = \\left|${universe}\\right|`
        case 'sum':
            return `y = \\sum_{n \\in ${universe}} n.${texText(yProp)}`
        case 'avg':
            return `y = \\frac{1}{\\left|${universe}\\right|} \\sum_{n \\in ${universe}} n.${texText(yProp)}`
        case 'min':
            return `y = \\min_{n \\in ${universe}} n.${texText(yProp)}`
        case 'max':
            return `y = \\max_{n \\in ${universe}} n.${texText(yProp)}`
    }
}

export function chartDefinitionLatex(
    spec: ChartSpec,
    formulas?: Record<string, string>,
): string {
    const yProp = propName(spec.y ?? '')
    let base: string
    if (spec.x) {
        const bt = `B_t = \\{\\, n : ${membership(spec)} \\,\\}`
        base = `${yLine(spec.aggregate, yProp, 'B_t')} \\qquad ${bt}`
    } else {
        base = noXLine(spec.aggregate, yProp)
    }

    if (spec.y?.startsWith('formula.') && formulas) {
        const src = formulas[yProp] ?? formulas[spec.y]
        if (src) {
            try {
                const parsed = exprToLatex(parseExpr(src))
                return `${base} \\qquad \\text{${escapeTex(yProp)}} = ${parsed}`
            } catch {
                return base
            }
        }
    }
    return base
}

export function trendLatex(fit: TrendFit): string {
    const slopeStr = fit.slope.toFixed(2)
    const intercept = fit.intercept
    const sign = intercept < 0 ? '-' : '+'
    const absIntercept = Math.abs(intercept).toFixed(2)
    const unitWord =
        fit.unit === 'day' ? 'days' : fit.unit === 'week' ? 'weeks' : 'months'
    return `\\hat{y} = ${slopeStr}\\,t ${sign} ${absIntercept} \\qquad R^2 = ${fit.r2.toFixed(2)} \\qquad t = \\text{${unitWord} since ${fit.origin}}`
}
