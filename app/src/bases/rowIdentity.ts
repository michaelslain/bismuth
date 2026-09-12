// A key that tells two rows apart inside ONE view result.
//
// `row.file.path` is not that key. Rows STORED in a base's own body all share one synthetic
// file path (`syntheticBaseFile`) — the base's own — because the path is a write-back handle
// there, not an identity. Any map keyed by it collapses every stored row onto one entry, and
// the last row wins: KanbanView rendered N cards all showing the last row's text.
//
// `Row.index` is the identity that already exists for those rows. It is the same handle
// `canWriteStoredRow`/`rowUpdate` address a row by, so a key built from it points at exactly
// the row a write would hit — which is what makes drag, reorder, rename and delete land on
// the card the user touched.
//
// `Number.isInteger`, not `typeof === 'number'`, matching `canWriteStoredRow`: `typeof NaN`
// is 'number' and so is 2.5, and a key minted from either would look stable while addressing
// nothing.
//
// NOT the same function as `rowKey` in reconcileRows.ts, and the two must not be merged.
// That one answers "is this the same row as last resolve, for <For> reuse" and deliberately
// keys tasks by DESCRIPTION so that completing one does not remount its renumbered siblings.
// This one answers "which row is this, right now, within one result" and must never collide.
import type { Row } from '../../../core/src/bases/types'

export function rowId(row: Row): string {
    return Number.isInteger(row.index)
        ? `${row.file.path}#${row.index}`
        : row.file.path
}
