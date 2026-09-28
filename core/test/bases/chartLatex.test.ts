import { describe, expect, test } from 'bun:test'
import { parseExpr } from '../../src/bases/parser'
import {
    chartDefinitionLatex,
    exprToLatex,
    texText,
    trendLatex,
    type ChartSpec,
} from '../../src/bases/chartLatex'

describe('texText', () => {
    test('escapes tex-special characters', () => {
        expect(texText('a_b {x} 50%')).toBe('\\text{a\\_b \\{x\\} 50\\%}')
    })
})

describe('exprToLatex', () => {
    test('numeric literal', () => {
        expect(exprToLatex(parseExpr('42'))).toBe('42')
    })

    test('string literal', () => {
        expect(exprToLatex(parseExpr('"hi"'))).toBe('\\text{"hi"}')
    })

    test('bool and null literals', () => {
        expect(exprToLatex(parseExpr('true'))).toBe('\\text{true}')
        expect(exprToLatex(parseExpr('false'))).toBe('\\text{false}')
        expect(exprToLatex(parseExpr('null'))).toBe('\\text{null}')
    })

    test('note member', () => {
        expect(exprToLatex(parseExpr('note.price'))).toBe('\\text{price}')
    })

    test('other member', () => {
        expect(exprToLatex(parseExpr('foo.bar'))).toBe('\\text{foo}.\\text{bar}')
    })

    test('division as frac', () => {
        expect(exprToLatex(parseExpr('note.a / note.b'))).toBe(
            '\\frac{\\text{a}}{\\text{b}}',
        )
    })

    test('multiplication as cdot', () => {
        expect(exprToLatex(parseExpr('note.a * note.b'))).toBe(
            '\\text{a} \\cdot \\text{b}',
        )
    })

    test('modulo as bmod', () => {
        expect(exprToLatex(parseExpr('note.a % note.b'))).toBe(
            '\\text{a} \\bmod \\text{b}',
        )
    })

    test('comparison operators', () => {
        expect(exprToLatex(parseExpr('note.a == note.b'))).toBe(
            '\\text{a} = \\text{b}',
        )
        expect(exprToLatex(parseExpr('note.a != note.b'))).toBe(
            '\\text{a} \\ne \\text{b}',
        )
        expect(exprToLatex(parseExpr('note.a <= note.b'))).toBe(
            '\\text{a} \\le \\text{b}',
        )
        expect(exprToLatex(parseExpr('note.a >= note.b'))).toBe(
            '\\text{a} \\ge \\text{b}',
        )
    })

    test('boolean operators', () => {
        expect(exprToLatex(parseExpr('note.a && note.b'))).toBe(
            '\\text{a} \\land \\text{b}',
        )
        expect(exprToLatex(parseExpr('note.a || note.b'))).toBe(
            '\\text{a} \\lor \\text{b}',
        )
    })

    test('unary minus and not', () => {
        expect(exprToLatex(parseExpr('-note.a'))).toBe('-\\text{a}')
        expect(exprToLatex(parseExpr('!note.a'))).toBe('\\lnot \\text{a}')
    })

    test('parenthesizes lower-precedence binary child', () => {
        expect(exprToLatex(parseExpr('(note.a + note.b) * note.c'))).toBe(
            '\\left( \\text{a} + \\text{b} \\right) \\cdot \\text{c}',
        )
    })

    test('does not parenthesize a frac child', () => {
        expect(exprToLatex(parseExpr('note.a / note.b + note.c'))).toBe(
            '\\frac{\\text{a}}{\\text{b}} + \\text{c}',
        )
    })

    test('calls: abs sqrt min max and other', () => {
        expect(exprToLatex(parseExpr('abs(note.a)'))).toBe(
            '\\left|\\text{a}\\right|',
        )
        expect(exprToLatex(parseExpr('sqrt(note.a)'))).toBe('\\sqrt{\\text{a}}')
        expect(exprToLatex(parseExpr('min(note.a, note.b)'))).toBe(
            '\\min(\\text{a}, \\text{b})',
        )
        expect(exprToLatex(parseExpr('max(note.a, note.b)'))).toBe(
            '\\max(\\text{a}, \\text{b})',
        )
        expect(exprToLatex(parseExpr('round(note.a)'))).toBe(
            '\\operatorname{round}(\\text{a})',
        )
    })

    test('method call', () => {
        expect(exprToLatex(parseExpr('note.a.toUpperCase()'))).toBe(
            '\\operatorname{toUpperCase}(\\text{a})',
        )
    })

    test('lambda', () => {
        expect(exprToLatex(parseExpr('p => p.x'))).toBe(
            '(p) \\mapsto \\text{p}.\\text{x}',
        )
    })

    test('regex', () => {
        expect(exprToLatex(parseExpr('/abc/gi'))).toBe('\\texttt{/abc/gi}')
    })

    test('index', () => {
        expect(exprToLatex(parseExpr('note.a[0]'))).toBe('\\text{a}[0]')
    })
})

describe('chartDefinitionLatex', () => {
    test('sum with date x by week', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'note.priority',
            aggregate: 'sum',
            bin: 'week',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec)).toBe(
            'y(t) = \\sum_{n \\in B_t} n.\\text{priority} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\}',
        )
    })

    test('count with date x by day', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            aggregate: 'count',
            bin: 'day',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec)).toBe(
            'y(t) = \\left|B_t\\right| \\qquad B_t = \\{\\, n : n.\\text{due} = t \\,\\}',
        )
    })

    test('avg with date x by month', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'note.priority',
            aggregate: 'avg',
            bin: 'month',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec)).toBe(
            'y(t) = \\frac{1}{\\left|B_t\\right|} \\sum_{n \\in B_t} n.\\text{priority} \\qquad B_t = \\{\\, n : \\operatorname{month}(n.\\text{due}) = t \\,\\}',
        )
    })

    test('min and max with date x', () => {
        const base: ChartSpec = {
            x: 'note.due',
            y: 'note.priority',
            aggregate: 'min',
            bin: 'week',
            isDate: true,
        }
        expect(chartDefinitionLatex(base)).toBe(
            'y(t) = \\min_{n \\in B_t} n.\\text{priority} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\}',
        )
        expect(chartDefinitionLatex({ ...base, aggregate: 'max' })).toBe(
            'y(t) = \\max_{n \\in B_t} n.\\text{priority} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\}',
        )
    })

    test('category axis membership', () => {
        const spec: ChartSpec = {
            x: 'note.status',
            y: 'note.priority',
            aggregate: 'sum',
            bin: 'week',
            isDate: false,
        }
        expect(chartDefinitionLatex(spec)).toBe(
            'y(t) = \\sum_{n \\in B_t} n.\\text{priority} \\qquad B_t = \\{\\, n : n.\\text{status} = t \\,\\}',
        )
    })

    test('no x omits B_t', () => {
        const spec: ChartSpec = {
            y: 'note.priority',
            aggregate: 'sum',
            bin: 'day',
            isDate: false,
        }
        expect(chartDefinitionLatex(spec)).toBe(
            'y = \\sum_{n \\in \\text{notes}} n.\\text{priority}',
        )
    })

    test('formula y appends the formula definition', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'formula.ppu',
            aggregate: 'sum',
            bin: 'week',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec, { ppu: 'note.price / note.qty' })).toBe(
            'y(t) = \\sum_{n \\in B_t} n.\\text{ppu} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\} \\qquad \\text{ppu} = \\frac{\\text{price}}{\\text{qty}}',
        )
    })

    test('formula y also resolves the legacy formula.<name> key', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'formula.ppu',
            aggregate: 'sum',
            bin: 'week',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec, { 'formula.ppu': 'note.price / note.qty' })).toBe(
            'y(t) = \\sum_{n \\in B_t} n.\\text{ppu} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\} \\qquad \\text{ppu} = \\frac{\\text{price}}{\\text{qty}}',
        )
    })

    test('formula parse failure appends nothing', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'formula.ppu',
            aggregate: 'sum',
            bin: 'week',
            isDate: true,
        }
        expect(chartDefinitionLatex(spec, { ppu: '((' })).toBe(
            'y(t) = \\sum_{n \\in B_t} n.\\text{ppu} \\qquad B_t = \\{\\, n : \\operatorname{week}(n.\\text{due}) = t \\,\\}',
        )
    })
})

describe('trendLatex', () => {
    test('pins the exact example string', () => {
        const fit = {
            slope: -0.4,
            intercept: 3.1,
            r2: 0.82,
            unit: 'week' as const,
            origin: 'Jun 29',
        }
        expect(trendLatex(fit)).toBe(
            '\\hat{y} = -0.40\\,t + 3.10 \\qquad R^2 = 0.82 \\qquad t = \\text{weeks since Jun 29}',
        )
    })

    test('negative intercept folds the sign', () => {
        const fit = {
            slope: 0.4,
            intercept: -3.1,
            r2: 0.5,
            unit: 'day' as const,
            origin: 'Jun 1',
        }
        expect(trendLatex(fit)).toBe(
            '\\hat{y} = 0.40\\,t - 3.10 \\qquad R^2 = 0.50 \\qquad t = \\text{days since Jun 1}',
        )
    })
})
