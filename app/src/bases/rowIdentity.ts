// A key that tells two rows apart inside ONE view result.
//
// `row.file.path` is not that key. Rows STORED in a base's own body all share one synthetic
// file path (`syntheticBaseFile`) — the base's own — because the path is a write-back handle
// there, not an identity. Any map keyed by it collapses every stored row onto one entry, and
// the last row wins: KanbanView rendered N cards all showing the last row's text. The same
// collapse hits query-origin task rows (`taskToRow`, no `index`): every task scanned out of
// ONE note shares that note's path, so a note with two open tasks rendered one of them twice
// and dropped the other.
//
// Three cases, in order:
//   1. `Row.index` — the identity that already exists for rows STORED in a base's own body.
//      It is the same handle `canWriteStoredRow`/`rowUpdate` address a row by, so a key built
//      from it points at exactly the row a write would hit — which is what makes drag,
//      reorder, rename and delete land on the card the user touched.
//   2. `note.line` — the identity a query-origin task row carries instead (`taskToRow` sets
//      it from the checkbox line's position; a stored row never has it, which is deliberately
//      the field the write seam keys off — see `normalizeStoredTaskRow`). Two tasks scanned
//      out of one note differ only by line, so the key must too.
//   3. Neither — a plain note row, keyed by its path alone, unchanged.
//
// The two key shapes (`#<index>` and `:L<line>`) use different separators ON PURPOSE so
// neither can ever collide with the other, even if a path or number happened to line up.
//
// `Number.isInteger`, not `typeof === 'number'`, matching `canWriteStoredRow`: `typeof NaN`
// is 'number' and so is 2.5, and a key minted from either would look stable while addressing
// nothing. Same guard applies to `note.line`.
//
// NOT the same function as `rowKey` in reconcileRows.ts, and the two must not be merged.
// That one answers "is this the same row as last resolve, for <For> reuse" and deliberately
// keys tasks by DESCRIPTION so that completing one does not remount its renumbered siblings.
// This one answers "which row is this, right now, within one result" and must never collide.
import type { Row } from '../../../core/src/bases/types'

export function rowId(row: Row): string {
    if (Number.isInteger(row.index)) return `${row.file.path}#${row.index}`
    const line = row.note?.line
    if (Number.isInteger(line)) return `${row.file.path}:L${line}`
    return row.file.path
}
