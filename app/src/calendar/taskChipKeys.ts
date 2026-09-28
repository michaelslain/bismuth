// A task's identity across re-renders, shared by the calendar's chips.
import type { Row } from '../../../core/src/bases/types'

/** A task's identity across re-renders: the markdown line it lives on. */
export function taskKey(row: Row): string {
    return `${row.file.path}:${String(row.note.line)}`
}
