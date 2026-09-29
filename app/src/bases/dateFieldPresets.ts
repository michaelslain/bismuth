// app/src/bases/dateFieldPresets.ts
// The relative-date rows DateFieldEditor hands DatePicker (Today / Tomorrow / Next week), as
// ISO `YYYY-MM-DD` strings in LOCAL time. Pure — no framework imports — so it is unit-testable.
import type { DateOption } from '../editor/DatePicker'
import { todayISO } from '../../../core/src/dates'

export function dateFieldPresets(now: Date = new Date()): DateOption[] {
    const at = (days: number) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
        return todayISO(d)
    }
    return [
        { label: 'Today', date: at(0) },
        { label: 'Tomorrow', date: at(1) },
        { label: 'Next week', date: at(7) },
    ]
}
