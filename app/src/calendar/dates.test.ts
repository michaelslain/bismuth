import { test, expect } from 'bun:test'
import { toDateStr, addDays, expandRecurrence, formatTime, startOfWeek, weekRange } from './dates'

test('toDateStr / addDays', () => {
  expect(toDateStr(new Date('2026-05-27T00:00:00'))).toBe('2026-05-27')
  expect(toDateStr(addDays(new Date('2026-05-27T00:00:00'), 5))).toBe('2026-06-01')
})

test('formatTime 12h', () => {
  expect(formatTime('13:05', false)).toBe('1:05')
  expect(formatTime('13:05', true)).toBe('13:05')
})

test('daily recurrence fills range', () => {
  const r = { type: 'daily' as const, startDate: '2026-05-01', seriesId: 's' }
  expect(expandRecurrence(r, '2026-05-01', '2026-05-03')).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
})

test('weekly recurrence honors daysOfWeek', () => {
  const r = { type: 'weekly' as const, startDate: '2026-05-01', daysOfWeek: [1], seriesId: 's' } // Mondays
  expect(expandRecurrence(r, '2026-05-01', '2026-05-31')).toEqual(['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'])
})

test('endDate truncates recurrence', () => {
  const r = { type: 'daily' as const, startDate: '2026-05-01', endDate: '2026-05-02', seriesId: 's' }
  expect(expandRecurrence(r, '2026-05-01', '2026-05-10')).toEqual(['2026-05-01', '2026-05-02'])
})

test('monthly on the 31st clamps to the last day of shorter months', () => {
  const r = { type: 'monthly' as const, startDate: '2026-01-31', seriesId: 's' }
  expect(expandRecurrence(r, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']) // non-leap Feb
  expect(expandRecurrence(r, '2026-04-01', '2026-04-30')).toEqual(['2026-04-30']) // 30-day month
  expect(expandRecurrence(r, '2026-03-01', '2026-03-31')).toEqual(['2026-03-31']) // exact match
})

test('startOfWeek sundayFirst — 2026-05-27 (Wed) → 2026-05-24 (Sun)', () => {
  const d = new Date('2026-05-27T00:00:00')
  expect(toDateStr(startOfWeek(d, false))).toBe('2026-05-24')
})

test('startOfWeek mondayFirst — 2026-05-27 (Wed) → 2026-05-25 (Mon)', () => {
  const d = new Date('2026-05-27T00:00:00')
  expect(toDateStr(startOfWeek(d, true))).toBe('2026-05-25')
})

test('startOfWeek mondayFirst — on Monday itself returns same day', () => {
  const d = new Date('2026-05-25T00:00:00')  // Monday
  expect(toDateStr(startOfWeek(d, true))).toBe('2026-05-25')
})

test('startOfWeek sundayFirst — on Sunday itself returns same day', () => {
  const d = new Date('2026-05-24T00:00:00')  // Sunday
  expect(toDateStr(startOfWeek(d, false))).toBe('2026-05-24')
})

test('weekRange mondayFirst — correct start+end', () => {
  const d = new Date('2026-05-27T00:00:00')  // Wednesday
  const [s, e] = weekRange(d, true)
  expect(s).toBe('2026-05-25')
  expect(e).toBe('2026-05-31')
})

test('weekRange sundayFirst — correct start+end', () => {
  const d = new Date('2026-05-27T00:00:00')  // Wednesday
  const [s, e] = weekRange(d, false)
  expect(s).toBe('2026-05-24')
  expect(e).toBe('2026-05-30')
})
