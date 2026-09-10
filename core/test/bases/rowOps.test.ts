import { test, expect } from 'bun:test'
import { upsertRow, deleteRow, reorderRow } from '../../src/bases/rowOps'
import { parseBaseFile } from '../../src/bases/parse'
import { AppError } from '../../src/error'

const FILE = [
    '---',
    'type: base',
    'view: table',
    '---',
    '',
    '- id: 1',
    '  title: A',
].join('\n')
const META = { name: 'T', path: 'T.md' }

function rows(text: string) {
    return parseBaseFile(text, META).rows
}

test('upsertRow appends a new row preserving frontmatter', () => {
    const out = upsertRow(FILE, META, null, { id: 2, title: 'B' })
    expect(out.startsWith('---')).toBe(true)
    expect(out).toContain('type: base')
    const rs = rows(out)
    expect(rs.map(r => r.note.title)).toEqual(['A', 'B'])
})

test('upsertRow edits an existing row by index', () => {
    const out = upsertRow(FILE, META, 0, { id: 1, title: 'Z' })
    const rs = rows(out)
    expect(rs.length).toBe(1)
    expect(rs[0].note.title).toBe('Z')
})

test('deleteRow removes a row by index', () => {
    const two = upsertRow(FILE, META, null, { id: 2, title: 'B' })
    const out = deleteRow(two, META, 0)
    const rs = rows(out)
    expect(rs.map(r => r.note.title)).toEqual(['B'])
})

test('deleteRow throws on an out-of-range index', () => {
    expect(() => deleteRow(FILE, META, 5)).toThrow()
})

test('deleteRow throws a 400 EINVAL AppError on an out-of-range index (client error, not 500)', () => {
    try {
        deleteRow(FILE, META, 5)
        throw new Error('expected deleteRow to throw')
    } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).statusCode).toBe(400)
        expect((err as AppError).code).toBe('EINVAL')
    }
})

test('reorderRow moves a row forward, rewriting order', () => {
    let t = FILE
    t = upsertRow(t, META, null, { id: 2, title: 'B' })
    t = upsertRow(t, META, null, { id: 3, title: 'C' })
    const out = reorderRow(t, META, 0, 2) // A,B,C -> B,C,A
    expect(rows(out).map(r => r.note.title)).toEqual(['B', 'C', 'A'])
})

test('reorderRow moves a row backward', () => {
    let t = FILE
    t = upsertRow(t, META, null, { id: 2, title: 'B' })
    t = upsertRow(t, META, null, { id: 3, title: 'C' })
    const out = reorderRow(t, META, 2, 0) // A,B,C -> C,A,B
    expect(rows(out).map(r => r.note.title)).toEqual(['C', 'A', 'B'])
})

test('reorderRow throws on an out-of-range index', () => {
    expect(() => reorderRow(FILE, META, 0, 5)).toThrow()
})

test('reorderRow throws a 400 EINVAL AppError on an out-of-range "from" index', () => {
    try {
        reorderRow(FILE, META, 5, 0)
        throw new Error('expected reorderRow to throw')
    } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).statusCode).toBe(400)
        expect((err as AppError).code).toBe('EINVAL')
    }
})

test('reorderRow throws a 400 EINVAL AppError on an out-of-range "to" index', () => {
    try {
        reorderRow(FILE, META, 0, 5)
        throw new Error('expected reorderRow to throw')
    } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).statusCode).toBe(400)
        expect((err as AppError).code).toBe('EINVAL')
    }
})

test('upsertRow into a body-less base creates the YAML rows', () => {
    const empty = ['---', 'type: base', 'view: table', '---', ''].join('\n')
    const out = upsertRow(empty, META, null, { id: 1, title: 'A' })
    expect(rows(out)[0].note.title).toBe('A')
})

test('grouped view with groupOrder (no order) serializes real row properties, not empty rows', () => {
    // Regression: a grouped view's `columns:` (group-key order, e.g. ["todo","done"])
    // must NOT be treated as display-column property ids. Doing so made serializeRows
    // emit empty rows (data loss). With no explicit `order:`, rows keep their own keys.
    const grouped = [
        '---',
        'type: base',
        'view: kanban',
        'groupBy: { property: status }',
        'columns: [todo, done]',
        '---',
        '',
        '- id: 1',
        '  title: A',
        '  status: todo',
    ].join('\n')
    const out = upsertRow(grouped, META, null, {
        id: 2,
        title: 'B',
        status: 'done',
    })
    const rs = rows(out)
    expect(rs.map(r => r.note.title)).toEqual(['A', 'B'])
    expect(rs.map(r => r.note.status)).toEqual(['todo', 'done'])
})

test('rowOps migrates a legacy markdown-table base to YAML on write', () => {
    const legacy = [
        '---',
        'type: base',
        '---',
        '',
        '| id | title |',
        '| --- | --- |',
        '| 1 | A |',
    ].join('\n')
    const out = upsertRow(legacy, META, null, { id: 2, title: 'B' })
    expect(out).not.toContain('| --- |') // table gone
    expect(out).toContain('- id:') // YAML rows
    expect(rows(out).map(r => r.note.title)).toEqual(['A', 'B'])
})

// upsertRow had no range check at all, and `rows[index] = row` was silently destructive in
// BOTH directions — reachable from a stale client index, not only a caller bug.
test('upsertRow throws instead of writing literal null rows past the end', () => {
    // measured before the guard: upsertRow(FILE, META, 5, …) on a 1-row base wrote
    // "- null\n- null\n- id: 9" into the user's file
    try {
        upsertRow(FILE, META, 5, { id: 9 })
        throw new Error('expected upsertRow to throw')
    } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).statusCode).toBe(400)
        expect((err as AppError).code).toBe('EINVAL')
    }
})

test('upsertRow throws instead of discarding the edit on a negative index', () => {
    // measured before the guard: rows[-1] set a non-index property, so the edit vanished
    // and the file was rewritten anyway — a write that reports success and changes nothing
    expect(() => upsertRow(FILE, META, -1, { id: 9 })).toThrow(/out of range/)
})

test('upsertRow rejects a non-integer index rather than coercing it', () => {
    expect(() => upsertRow(FILE, META, 0.5, { id: 9 })).toThrow(/out of range/)
    expect(() => upsertRow(FILE, META, NaN, { id: 9 })).toThrow(/out of range/)
})

test('upsertRow still appends on an explicit null, which is the ONE way to append', () => {
    // the out-of-range throw above must not have taken the append path with it
    const out = upsertRow(FILE, META, null, { id: 2, title: 'B' })
    expect(rows(out).map(r => r.note.title)).toEqual(['A', 'B'])
})

test('reorderRow rejects a non-integer index instead of moving row 0', () => {
    // measured before the guard: reorderRow(text, meta, undefined, 2) moved row 0 to the
    // end — `from < 0 || from >= rows.length` is false for undefined, so it fell through to
    // rows.splice(undefined, 1), which coerces to splice(0, 1)
    let t = FILE
    t = upsertRow(t, META, null, { id: 2, title: 'B' })
    t = upsertRow(t, META, null, { id: 3, title: 'C' })
    expect(() =>
        reorderRow(t, META, undefined as unknown as number, 2),
    ).toThrow(/out of range/)
    expect(() =>
        reorderRow(t, META, 0, undefined as unknown as number),
    ).toThrow(/out of range/)
    // the valid path is untouched
    expect(rows(reorderRow(t, META, 0, 2)).map(r => r.note.title)).toEqual([
        'B',
        'C',
        'A',
    ])
})

test('deleteRow rejects a non-integer index rather than coercing it', () => {
    // measured before the guard, on a 3-row base: deleteRow(t, META, 2.5) removed row 2 and
    // deleteRow(t, META, NaN) removed row 0 — every comparison with NaN is false, so the
    // range check alone waved both through to splice()
    let t = FILE
    t = upsertRow(t, META, null, { id: 2, title: 'B' })
    t = upsertRow(t, META, null, { id: 3, title: 'C' })
    expect(() => deleteRow(t, META, 2.5)).toThrow(/out of range/)
    expect(() => deleteRow(t, META, NaN)).toThrow(/out of range/)
    // the valid path is untouched
    expect(rows(deleteRow(t, META, 1)).map(r => r.note.title)).toEqual(['A', 'C'])
})
