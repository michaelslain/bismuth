import { describe, expect, test } from 'bun:test'
import { editorKind } from './filterOps'
import type { NotesOp } from './queryGen'

const KINDS: Record<NotesOp, string> = {
    equals: 'text',
    not_equals: 'text',
    gt: 'text',
    gte: 'text',
    lt: 'text',
    lte: 'text',
    contains: 'text',
    starts_with: 'text',
    ends_with: 'text',
    matches: 'text',
    has_tag: 'tag',
    not_tag: 'tag',
    in_folder: 'folder',
    folder_is: 'folder',
    date_before: 'date',
    date_after: 'date',
    date_within: 'text',
    checked: 'none',
    unchecked: 'none',
    is_set: 'none',
    is_empty: 'none',
    raw: 'text',
}

describe('editorKind', () => {
    for (const [op, kind] of Object.entries(KINDS))
        test(`${op} -> ${kind}`, () => {
            expect(editorKind(op as NotesOp, 'string')).toBe(kind as never)
        })
})
