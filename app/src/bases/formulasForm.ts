// Pure logic behind FormulasEditor: a base's `formulas:` map (name -> expression) ⇄ an ordered
// list of editable rows. Map key order is the declaration order, so rows keep it.
//
// Save rules: an empty-name row is skipped; of two rows sharing a (trimmed) name only the first
// is kept — the editor flags that and blocks SAVE, so the second is never silently dropped.
import { parseExpr } from '../../../core/src/bases/parser'

export interface FormulaRow {
    name: string
    expr: string
}

export function seedFormulaRows(
    formulas: Record<string, string> | undefined,
): FormulaRow[] {
    return Object.entries(formulas ?? {}).map(([name, expr]) => ({
        name,
        expr: String(expr),
    }))
}

/** Rows → the `formulas:` map, or undefined when there is nothing to write. */
export function buildFormulas(
    rows: FormulaRow[],
): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    for (const r of rows) {
        const name = r.name.trim()
        if (!name || name in out) continue
        out[name] = r.expr.trim()
    }
    return Object.keys(out).length ? out : undefined
}

/** Indexes of rows whose trimmed name repeats an earlier row's. */
export function duplicateFormulaNames(rows: FormulaRow[]): Set<number> {
    const seen = new Set<string>()
    const dupes = new Set<number>()
    rows.forEach((r, i) => {
        const n = r.name.trim()
        if (!n) return
        if (seen.has(n)) dupes.add(i)
        else seen.add(n)
    })
    return dupes
}

/** A unique default name for a new row: "formula", "formula 2", … */
export function nextFormulaName(rows: FormulaRow[]): string {
    const taken = new Set(rows.map(r => r.name.trim()))
    if (!taken.has('formula')) return 'formula'
    for (let i = 2; ; i++) if (!taken.has(`formula ${i}`)) return `formula ${i}`
}

/** The parser's complaint about an expression, or null when it parses. An empty expression
 *  is not an error here — it is simply a formula that evaluates to nothing yet. */
export function formulaError(expr: string): string | null {
    if (!expr.trim()) return null
    try {
        parseExpr(expr)
        return null
    } catch (e) {
        return e instanceof Error ? e.message : String(e)
    }
}

/** The `formula.<name>` column ids a set of rows contributes to a view's columns list. */
export function formulaColumns(rows: FormulaRow[]): string[] {
    return Object.keys(buildFormulas(rows) ?? {}).map(n => `formula.${n}`)
}
