// Pure logic behind FiltersEditor: a base's `filters:` FilterNode (or a source's `where:`
// string) ⇄ an editable list of condition rows joined by one and/or switch.
//
// The contract is NEVER LOSE DATA on save:
//   - An untouched form hands back its original value verbatim (`orig`), byte-for-byte.
//   - A row the user did not edit hands back ITS original node verbatim (`row.orig`) — so a
//     nested `{or: [...]}` / `{not: [...]}` child, or a leaf the visual builder can't model,
//     survives an edit to some OTHER row.
//   - A leaf becomes a visual condition row only when recompiling that row reproduces the
//     leaf's exact AST (queryGen's `compileNotesRow` ∘ `leafToRow` must be the identity on it).
//     `done == true`, for instance, reverses to a string-typed equals row that would recompile
//     to `done == "true"` — a different filter — so it stays a raw expression row instead.
//   - Anything the and/or list can't represent (a top-level `not:`, mixed `&&`/`||`, a
//     malformed expression) is ONE raw-expression row carrying the original node.
//
// Framework-free (no Solid, no api.ts) so it runs under `bun test`.
import type { FilterNode } from '../../../core/src/bases/types'
import type { Expr } from '../../../core/src/bases/ast'
import { parseExpr } from '../../../core/src/bases/parser'
import { lex } from '../../../core/src/bases/lexer'
import {
    compileNotesRow,
    leafToRow,
    type NotesOp,
    type PropType,
} from './queryGen'
import { VALUELESS, defaultOpFor } from './filterOps'

/** A visual condition: property / operator / value (compiled by queryGen). */
export interface CondRow {
    kind: 'cond'
    prop: string
    op: NotesOp
    val: string
    type: PropType
    /** The node this row was read from, written back verbatim until the row is edited. */
    orig?: FilterNode
}

/** A free-form Bases expression, or an opaque subtree shown as its expression text. */
export interface RawRow {
    kind: 'raw'
    text: string
    orig?: FilterNode
}

export type FilterRow = CondRow | RawRow

export interface FilterForm {
    conj: 'and' | 'or'
    rows: FilterRow[]
    /** The whole value this form was read from. */
    orig?: FilterNode
    /** False until any edit — an untouched form writes back `orig` exactly. */
    touched: boolean
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

function tryParse(src: string): Expr | null {
    try {
        return parseExpr(src)
    } catch {
        return null
    }
}

const sameAst = (a: Expr, b: Expr) => JSON.stringify(a) === JSON.stringify(b)

/** The source's token stream, positions dropped. The parser stops at the first token it can't
 *  use and ignores the rest (`not done` parses as the bare ident `not`), so an AST match alone
 *  would accept a leaf whose tail the builder silently drops — comparing tokens catches that. */
function tokenSig(src: string): string | null {
    try {
        return JSON.stringify(lex(src).map(t => [t.kind, t.value, t.flags]))
    } catch {
        return null
    }
}

/** True when `compiled` is token-for-token the same expression as `src`. */
function sameSource(compiled: string, src: string): boolean {
    const a = tokenSig(compiled)
    return a !== null && a === tokenSig(src)
}

/** A condition row for `expr` when the builder round-trips it exactly, else null. */
function toCond(expr: Expr): CondRow | null {
    const row = leafToRow(expr)
    if (!row || row.op === 'raw') return null
    const back = tryParse(compileNotesRow(row))
    if (!back || !sameAst(back, expr)) return null
    return {
        kind: 'cond',
        prop: row.prop,
        op: row.op,
        val: row.val,
        type: row.type,
    }
}

/** Flatten a chain of ONE logical operator (`a && b && c`); null when the ops are mixed. */
function flattenSameOp(expr: Expr, op: '&&' | '||'): Expr[] | null {
    if (expr.type === 'binary' && (expr.op === '&&' || expr.op === '||')) {
        if (expr.op !== op) return null
        const l = flattenSameOp(expr.left, op)
        const r = flattenSameOp(expr.right, op)
        return l && r ? [...l, ...r] : null
    }
    return [expr]
}

/** The expression text for any FilterNode — how an opaque subtree is SHOWN in a raw row. */
export function exprOf(node: FilterNode): string {
    if (typeof node === 'string') return node
    const wrap = (ns: FilterNode[]) => ns.map(n => `(${exprOf(n)})`)
    if ('and' in node && Array.isArray(node.and))
        return wrap(node.and).join(' && ')
    if ('or' in node && Array.isArray(node.or))
        return wrap(node.or).join(' || ')
    if ('not' in node && Array.isArray(node.not))
        return `!(${wrap(node.not).join(' || ')})`
    return ''
}

const raw = (text: string, orig?: FilterNode): RawRow => ({
    kind: 'raw',
    text,
    orig,
})

/** One tree child → one row. A string child is a condition when it round-trips, else raw;
 *  an object child is always a raw row that writes its subtree back verbatim. */
function childToRow(child: FilterNode): FilterRow {
    if (typeof child !== 'string') return raw(exprOf(child), child)
    const ast = tryParse(child)
    const cond = ast ? toCond(ast) : null
    return cond && sameSource(compileNotesRow(cond), child)
        ? { ...cond, orig: child }
        : raw(child, child)
}

/** A string filter: split a single-operator `&&`/`||` chain into rows when EVERY leaf
 *  round-trips; otherwise the whole string is one raw row. */
function stringToRows(src: string): Pick<FilterForm, 'conj' | 'rows'> {
    const whole = { conj: 'and' as const, rows: [raw(src, src)] }
    const ast = tryParse(src)
    if (!ast) return whole
    if (ast.type === 'binary' && (ast.op === '&&' || ast.op === '||')) {
        const leaves = flattenSameOp(ast, ast.op)
        if (!leaves) return whole
        const rows: CondRow[] = []
        for (const leaf of leaves) {
            const c = toCond(leaf)
            if (!c) return whole
            rows.push(c)
        }
        if (!sameSource(rows.map(compileNotesRow).join(` ${ast.op} `), src))
            return whole
        return { conj: ast.op === '||' ? 'or' : 'and', rows }
    }
    const c = toCond(ast)
    return c && sameSource(compileNotesRow(c), src)
        ? { conj: 'and', rows: [{ ...c, orig: src }] }
        : whole
}

/** A base/view `filters:` value → an editable form. */
export function filterToForm(node: FilterNode | undefined | null): FilterForm {
    const orig = node ?? undefined
    if (node == null || node === '')
        return { conj: 'and', rows: [], orig, touched: false }
    if (typeof node === 'string')
        return { ...stringToRows(node), orig, touched: false }
    if (typeof node === 'object') {
        if ('and' in node && Array.isArray(node.and))
            return {
                conj: 'and',
                rows: node.and.map(childToRow),
                orig,
                touched: false,
            }
        if ('or' in node && Array.isArray(node.or))
            return {
                conj: 'or',
                rows: node.or.map(childToRow),
                orig,
                touched: false,
            }
    }
    // `not:` at the top, or a shape the engine doesn't know — one opaque row.
    return {
        conj: 'and',
        rows: [raw(exprOf(node as FilterNode), node as FilterNode)],
        orig,
        touched: false,
    }
}

/** A source's `where:` string → an editable form (same rules as a string filter). */
export function whereToForm(where: string | undefined): FilterForm {
    return filterToForm(where)
}

// ---------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------

/** A condition row that still needs a value the user hasn't typed — skipped on save rather
 *  than written as `prop == ""`. */
export function isIncomplete(row: FilterRow): boolean {
    if (row.kind === 'raw') return row.text.trim() === ''
    return !VALUELESS.has(row.op) && row.val.trim() === ''
}

function rowNode(row: FilterRow): FilterNode | null {
    if (row.orig !== undefined) return row.orig
    if (isIncomplete(row)) return null
    return row.kind === 'raw' ? row.text.trim() : compileNotesRow(row)
}

function nodes(form: FilterForm): FilterNode[] {
    return form.rows.map(rowNode).filter((n): n is FilterNode => n !== null)
}

/** The form → a `filters:` value (undefined = remove the key). */
export function formToFilter(form: FilterForm): FilterNode | undefined {
    if (!form.touched) return form.orig
    const ns = nodes(form)
    if (ns.length === 0) return undefined
    if (ns.length === 1) return ns[0]
    return form.conj === 'or' ? { or: ns } : { and: ns }
}

/** The form → a source `where:` string (a source `where` can't hold a YAML tree, so an opaque
 *  subtree is folded back into its equivalent expression text). */
export function formToWhere(form: FilterForm): string | undefined {
    if (!form.touched)
        return form.orig === undefined || form.orig === ''
            ? undefined
            : exprOf(form.orig)
    const ns = nodes(form)
        .map(exprOf)
        .filter(s => s.trim() !== '')
    if (ns.length === 0) return undefined
    if (ns.length === 1) return ns[0]
    return ns.map(s => `(${s})`).join(form.conj === 'or' ? ' || ' : ' && ')
}

// ---------------------------------------------------------------------------------------
// Edits — every one marks the form touched and drops the edited row's `orig`
// ---------------------------------------------------------------------------------------

export function setConj(form: FilterForm, conj: 'and' | 'or'): FilterForm {
    return { ...form, conj, touched: true }
}

export function patchRow(
    form: FilterForm,
    i: number,
    patch: Partial<CondRow> | Partial<RawRow>,
): FilterForm {
    const rows = form.rows.map((r, idx) =>
        idx === i ? ({ ...r, ...patch, orig: undefined } as FilterRow) : r,
    )
    return { ...form, rows, touched: true }
}

export function removeRow(form: FilterForm, i: number): FilterForm {
    return {
        ...form,
        rows: form.rows.filter((_, idx) => idx !== i),
        touched: true,
    }
}

export function addRow(form: FilterForm, row: FilterRow): FilterForm {
    return { ...form, rows: [...form.rows, row], touched: true }
}

export function condRow(prop: string, type: PropType): CondRow {
    return { kind: 'cond', prop, op: defaultOpFor(type), val: '', type }
}

export function rawRow(text = ''): RawRow {
    return { kind: 'raw', text }
}

/** Turn a condition row into an editable expression carrying its compiled text. */
export function toRawRow(form: FilterForm, i: number): FilterForm {
    const r = form.rows[i]
    if (!r || r.kind === 'raw') return form
    const text = r.orig !== undefined ? exprOf(r.orig) : compileNotesRow(r)
    return patchRowReplace(form, i, { kind: 'raw', text })
}

function patchRowReplace(
    form: FilterForm,
    i: number,
    row: FilterRow,
): FilterForm {
    const rows = form.rows.map((r, idx) => (idx === i ? row : r))
    return { ...form, rows, touched: true }
}
