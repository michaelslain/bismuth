import { Recurrence } from './types'

export function formatTime(time: string, military: boolean): string {
  if (military) return time
  const [h, m] = time.split(':').map(Number)
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')}`
}

export function formatGutterHour(h: number, military: boolean): string {
  if (h === 0) return ''
  if (military) return `${h}:00`
  const h12 = h % 12 || 12
  const period = h < 12 ? 'AM' : 'PM'
  return `${h12} ${period}`
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

/** Returns the first day of the ISO week (Monday) or Sunday week containing `d`. */
export function startOfWeek(d: Date, mondayFirst: boolean): Date {
  const offset = mondayFirst ? -((d.getDay() + 6) % 7) : -d.getDay()
  return addDays(d, offset)
}

/** Returns [startDateStr, endDateStr] for the week containing `d`. */
export function weekRange(d: Date, mondayFirst: boolean): [string, string] {
  const start = startOfWeek(d, mondayFirst)
  return [toDateStr(start), toDateStr(addDays(start, 6))]
}

export function expandRecurrence(recurrence: Recurrence, rangeStart: string, rangeEnd: string): string[] {
  const dates: string[] = []
  const start = new Date(recurrence.startDate + 'T00:00:00')
  const end = recurrence.endDate ? new Date(recurrence.endDate + 'T00:00:00') : new Date('2100-01-01')
  const rStart = new Date(rangeStart + 'T00:00:00')
  const rEnd = new Date(rangeEnd + 'T00:00:00')
  let cursor = new Date(start)
  while (cursor <= end && cursor <= rEnd) {
    if (cursor >= rStart && matchesRecurrence(recurrence, toDateStr(cursor))) dates.push(toDateStr(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}

/** Number of days in the calendar month containing `d` (local). */
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

function matchesRecurrence(r: Recurrence, dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00')
  const start = new Date(r.startDate + 'T00:00:00')
  const dow = d.getDay()
  if (r.type === 'daily') return true
  if (r.type === 'weekly') return r.daysOfWeek?.includes(dow) ?? dow === start.getDay()
  if (r.type === 'biweekly') {
    const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000)
    const matchesDow = r.daysOfWeek?.includes(dow) ?? dow === start.getDay()
    return matchesDow && Math.floor(diffDays / 7) % 2 === 0
  }
  if (r.type === 'monthly') {
    // Clamp the start day-of-month to the last day of the target month, so a
    // series on the 29th/30th/31st falls back to the month's last day instead
    // of silently skipping shorter months (e.g. 31st → Feb 28/29).
    const targetDay = Math.min(start.getDate(), daysInMonth(d))
    return d.getDate() === targetDay
  }
  return false
}
