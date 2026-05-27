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
  if (r.type === 'monthly') return d.getDate() === start.getDate()
  return false
}
