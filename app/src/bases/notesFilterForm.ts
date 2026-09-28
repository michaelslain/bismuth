// Pure bridge between the query builder's notes filter (`BuilderState['notes']`, rows of
// `NotesRow`) and the shared filter editor's `FilterForm` (rows of `CondRow | RawRow`), so the
// builder composes FiltersEditor instead of carrying its own row layout.
//
// The two row shapes carry the same four fields; the only difference is the escape hatch: a
// `NotesRow` with `op: 'raw'` holds its expression in `val`, a `RawRow` in `text`. Nothing here
// touches how a row compiles — that stays queryGen's `compileNotesRow`, byte for byte.
import type { BuilderState, NotesRow } from './queryGen'
import type { FilterForm, FilterRow } from './filterForm'

export type NotesFilter = BuilderState['notes']

const rowToForm = (r: NotesRow): FilterRow =>
    r.op === 'raw'
        ? { kind: 'raw', text: r.val }
        : { kind: 'cond', prop: r.prop, op: r.op, val: r.val, type: r.type }

const formToRow = (r: FilterRow): NotesRow =>
    r.kind === 'raw'
        ? { prop: '', op: 'raw', val: r.text, type: 'string' }
        : { prop: r.prop, op: r.op, val: r.val, type: r.type }

/** The builder's rows + connective as an editor form (always `touched`: the builder writes
 *  rows out through `compileNotesRow`, never a stored original). */
export function notesToForm(notes: NotesFilter): FilterForm {
    return { conj: notes.connective, rows: notes.rows.map(rowToForm), touched: true }
}

/** An edited form back as the two fields the builder owns. `rawWhere` is not the form's. */
export function formToNotes(form: FilterForm): Pick<NotesFilter, 'connective' | 'rows'> {
    return { connective: form.conj, rows: form.rows.map(formToRow) }
}
