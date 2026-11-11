import { test, expect } from 'bun:test'
import { upsertRow, upsertRows, deleteRow, reorderRow, patchRowWhere } from '../../src/bases/rowOps'
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

test('upsertRows applies every update in ONE rewrite', () => {
    const text = [
        '---',
        'type: base',
        'views:',
        '  - type: table',
        '    order: [description, status]',
        '---',
        '',
        '- description: a',
        '  status: todo',
        '- description: b',
        '  status: todo',
        '',
    ].join('\n')
    const meta = { name: 'Board', path: 'Board.md' }
    const next = upsertRows(text, meta, [
        { index: 0, note: { description: 'a', status: 'done' } },
        { index: 1, note: { description: 'b', status: 'doing' } },
    ])
    const { rows } = parseBaseFile(next, meta)
    expect(rows.map(r => r.note.status)).toEqual(['done', 'doing'])
})

test('upsertRows appends every null-index update after the replacements', () => {
    const text = '---\ntype: base\n---\n\n- description: a\n'
    const meta = { name: 'Board', path: 'Board.md' }
    const next = upsertRows(text, meta, [
        { index: 0, note: { description: 'a2' } },
        { index: null, note: { description: 'b' } },
        { index: null, note: { description: 'c' } },
    ])
    const { rows } = parseBaseFile(next, meta)
    expect(rows.map(r => r.note.description)).toEqual(['a2', 'b', 'c'])
})

test('upsertRows rejects the WHOLE batch when any index is out of range', () => {
    const text = '---\ntype: base\n---\n\n- description: a\n'
    const meta = { name: 'Board', path: 'Board.md' }
    // `text` is a JS string the function only READS — it can never reflect anything
    // `upsertRows` does internally, so re-parsing it afterward would prove nothing about
    // whether the batch was actually applied atomically. Capturing the RETURN VALUE instead
    // is what makes this test able to fail: if validation ran AFTER the apply loop instead of
    // before, `rows[7] = row` on this 1-row array grows it to length 8 via JS's sparse-array
    // assignment, so a range check performed afterward sees the already-widened length and
    // never throws — the function would return a corrupted string (a hole-filled row list
    // with row 0 already overwritten to 'ok') instead of rejecting the batch.
    let result: string | undefined
    try {
        result = upsertRows(text, meta, [
            { index: 0, note: { description: 'ok' } },
            { index: 7, note: { description: 'nope' } },
        ])
    } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).code).toBe('EINVAL')
        expect((err as Error).message).toMatch(/out of range/)
    }
    // Nothing escapes when the batch rejects — a defined `result` here means the function
    // returned a (partially-applied) string instead of throwing before mutating anything.
    expect(result).toBeUndefined()
})

test('upsertRows rejects a non-integer index the same way upsertRow does', () => {
    const text = '---\ntype: base\n---\n\n- description: a\n'
    const meta = { name: 'Board', path: 'Board.md' }
    expect(() =>
        upsertRows(text, meta, [{ index: 2.5, note: {} }]),
    ).toThrow(/out of range/)
    expect(() =>
        upsertRows(text, meta, [{ index: NaN, note: {} }]),
    ).toThrow(/out of range/)
})

test('upsertRows addressing the same row twice keeps the LAST write', () => {
    const text = '---\ntype: base\n---\n\n- description: a\n'
    const meta = { name: 'Board', path: 'Board.md' }
    const next = upsertRows(text, meta, [
        { index: 0, note: { description: 'first' } },
        { index: 0, note: { description: 'second' } },
    ])
    expect(parseBaseFile(next, meta).rows[0].note.description).toBe('second')
})

test('reassemble writes back in the format of the input text', () => {
    const jsonl = '{"type":"base","view":"table"}\n{"id":1,"title":"A"}\n'
    const out = upsertRow(jsonl, META, null, { id: 2, title: 'B' })
    expect(out).toBe(
        '{"type":"base","view":"table"}\n{"id":1,"title":"A"}\n{"id":2,"title":"B"}\n',
    )
    expect(rows(out).map(r => r.note.title)).toEqual(['A', 'B'])
})

const BOARD = [
    '---',
    'type: base',
    'view: kanban',
    '---',
    '',
    '- ticket: T1',
    '  status: queued',
    '  order: 1',
    '  session: old',
    '- ticket: T2',
    '  status: queued',
    '  order: 2',
].join('\n')

test('patchRowWhere merges fields into the one matching row and keeps the rest', () => {
    const out = patchRowWhere(BOARD, META, 'ticket', 'T2', { status: 'in progress', branch: 'b' })
    const rs = rows(out)
    expect(rs[1].note).toEqual({ ticket: 'T2', status: 'in progress', order: 2, branch: 'b' })
    expect(rs[0].note).toEqual({ ticket: 'T1', status: 'queued', order: 1, session: 'old' })
})

test('patchRowWhere removes a field given null', () => {
    const out = patchRowWhere(BOARD, META, 'ticket', 'T1', { session: null })
    expect(rows(out)[0].note).toEqual({ ticket: 'T1', status: 'queued', order: 1 })
})

test('patchRowWhere matches a number by its string form', () => {
    const out = patchRowWhere(BOARD, META, 'order', '2', { status: 'landed' })
    expect(rows(out)[1].note.status).toBe('landed')
})

test('patchRowWhere throws ENOENT when no row matches', () => {
    try {
        patchRowWhere(BOARD, META, 'ticket', 'T9', { status: 'x' })
        throw new Error('expected a throw')
    } catch (e) {
        expect(e).toBeInstanceOf(AppError)
        expect((e as AppError).code).toBe('ENOENT')
    }
})

test('patchRowWhere throws EINVAL when several rows match', () => {
    try {
        patchRowWhere(BOARD, META, 'status', 'queued', { status: 'x' })
        throw new Error('expected a throw')
    } catch (e) {
        expect(e).toBeInstanceOf(AppError)
        expect((e as AppError).code).toBe('EINVAL')
        expect((e as AppError).message).toContain('2 rows')
    }
})

const JSONL_BOARD = [
    '{"type":"base","view":"kanban","groupBy":"status"}',
    '{"ticket":"T1","status":"queued","tags":["a","b"],"meta":{"k":1},"done":true}',
    '{"ticket":"T2","status":"queued"}',
    '',
].join('\n')
const JSONL_META = { name: 'R', path: 'R.base.jsonl' }

test('patchRowWhere on a JSONL base changes only the matched line', () => {
    const out = patchRowWhere(JSONL_BOARD, JSONL_META, 'ticket', 'T2', { status: 'landed' })
    const [cfg, r1, r2, end] = out.split('\n')
    const [cfg0, r10] = JSONL_BOARD.split('\n')
    expect(cfg).toBe(cfg0)
    expect(r1).toBe(r10)
    expect(JSON.parse(r2)).toEqual({ ticket: 'T2', status: 'landed' })
    expect(end).toBe('')
})

test('patchRowWhere matches a boolean by its string form but never an array or object', () => {
    expect(patchRowWhere(JSONL_BOARD, JSONL_META, 'done', 'true', { x: 1 })).toContain('"x":1')
    for (const [field, value] of [
        ['tags', 'a,b'],
        ['meta', '[object Object]'],
    ]) {
        expect(() => patchRowWhere(JSONL_BOARD, JSONL_META, field, value, { x: 1 })).toThrow(
            /no row has/,
        )
    }
})

test('patchRowWhere refuses a view base and a file that is not a base', () => {
    const view = '{"type":"base","view":"table","source":"notes"}\n{"ticket":"T1"}\n'
    expect(() => patchRowWhere(view, JSONL_META, 'ticket', 'T1', { x: 1 })).toThrow(/is a view/)
    const note = '---\ntitle: Plan\n---\n\n- ticket: T1\n'
    expect(() => patchRowWhere(note, META, 'ticket', 'T1', { x: 1 })).toThrow(/is not a base/)
})

test('patchRowWhere stores a __proto__ key as a field', () => {
    const out = patchRowWhere(JSONL_BOARD, JSONL_META, 'ticket', 'T2', JSON.parse('{"__proto__":{"p":1}}'))
    expect(JSON.parse(out.split('\n')[2])).toEqual(JSON.parse('{"ticket":"T2","status":"queued","__proto__":{"p":1}}'))
})
