import { describe, expect, test } from 'bun:test'
import { formToNotes, notesToForm } from './notesFilterForm'
import { compileNotesWhere, type NotesRow } from './queryGen'

const rows: NotesRow[] = [
    { prop: 'status', op: 'equals', val: 'Doing', type: 'string' },
    { prop: 'due', op: 'date_within', val: '7', type: 'date' },
    { prop: '', op: 'raw', val: 'rating * 2 > 8', type: 'string' },
]

describe('notesFilterForm', () => {
    test('notes -> form maps cond rows and the raw escape hatch', () => {
        const f = notesToForm({ connective: 'or', rows })
        expect(f.conj).toBe('or')
        expect(f.touched).toBe(true)
        expect(f.rows[0]).toEqual({ kind: 'cond', prop: 'status', op: 'equals', val: 'Doing', type: 'string' })
        expect(f.rows[2]).toEqual({ kind: 'raw', text: 'rating * 2 > 8' })
    })
    test('round trip is the identity on rows + connective', () => {
        const n = { connective: 'and' as const, rows }
        expect(formToNotes(notesToForm(n))).toEqual(n)
    })
    test('the compiled where is unchanged by the round trip', () => {
        const n = { connective: 'or' as const, rows }
        expect(compileNotesWhere({ ...n, ...formToNotes(notesToForm(n)) })).toBe(compileNotesWhere(n))
    })
})
