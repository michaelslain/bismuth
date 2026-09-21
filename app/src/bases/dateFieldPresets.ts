// app/src/bases/dateFieldPresets.ts
// The relative-date rows DateFieldEditor hands DatePicker (Today / Tomorrow / Next week), as
// ISO `YYYY-MM-DD` strings in LOCAL time. Pure — no framework imports — so it is unit-testable.
import type { DateOption } from '../editor/DatePicker'

function iso(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
}

export function dateFieldPresets(now: Date = new Date()): DateOption[] {
    const at = (days: number) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
        return iso(d)
    }
    return [
        { label: 'Today', date: at(0) },
        { label: 'Tomorrow', date: at(1) },
        { label: 'Next week', date: at(7) },
    ]
}
