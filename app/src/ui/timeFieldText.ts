// app/src/ui/timeFieldText.ts
// Pure text logic behind TimeField.tsx: reading what a person types as a time, writing a stored
// `HH:MM` back as the label they see, and the half-hour slots the field suggests. No framework
// imports, so it is unit-tested directly.

/** A typed time as stored `HH:MM` (24h), or null when the text is not a whole time yet.
 *  Takes "14:30", "1430", "2:30pm", "2:30 p", "2pm", "9", "09:05". */
export function parseTimeText(text: string): string | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, '')
    const m = /^(\d{1,2})(?::?(\d{2}))?([ap]m?)?$/.exec(t)
    if (!m) return null
    let h = Number(m[1])
    const min = m[2] === undefined ? 0 : Number(m[2])
    const period = m[3]?.[0]
    if (min > 59) return null
    if (period) {
        if (h < 1 || h > 12) return null
        h = (h % 12) + (period === 'p' ? 12 : 0)
    } else if (h > 23) return null
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** A stored `HH:MM` as the label a person reads: "14:30" with `military`, else "2:30 pm". */
export function formatTimeText(hhmm: string, military: boolean): string {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
    if (!m) return hhmm
    if (military) return hhmm
    const h = Number(m[1])
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`
}

/** Every half hour of the day as stored `HH:MM`, starting at the slot at or after `from` and
 *  wrapping, so the list opens on the time already set rather than on midnight. */
export function timeSlots(from: string): string[] {
    const all = Array.from({ length: 48 }, (_, i) => {
        const h = Math.floor(i / 2)
        return `${String(h).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
    })
    const start = all.findIndex(s => s >= from)
    if (!from || start <= 0) return all
    return [...all.slice(start), ...all.slice(0, start)]
}
