// app/src/bases/valueDisplay.ts
// Pure rules for how ONE value is shown, shared by the read-only display path (PropertyDisplay,
// renderValue) and the edit path (DateFieldEditor, ReadonlyValue) so a value never changes shape on
// being clicked into. No framework imports.
import { parseDateValue } from '../editor/datePickerCore'

/** `null`, `undefined`, a blank string and an empty list are ALL "no value". They used to render
 *  three ways: a faint dash for null, nothing for `''` and `[]`, a hand-typed dash in the modal. */
export function isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    return false
}

/** A stored date or datetime as the ONE text both paths show: `2026-09-14`, or
 *  `2026-09-14 14:00` when `time` and the value carries one. The stored `T` separator never reaches
 *  the screen. Returns '' when the value holds no date. */
export function formatDateValue(value: unknown, time?: boolean): string {
    const p = parseDateValue(String(value ?? ''))
    if (!p.date) return ''
    return time && p.time ? `${p.date} ${p.time}` : p.date
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** An UNDECLARED string that is plainly a stored datetime (`2026-09-14T14:00`). */
export function looksLikeDatetime(value: unknown): value is string {
    return typeof value === 'string' && DATETIME_RE.test(value.trim())
}
