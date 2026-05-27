import { test, expect } from 'bun:test'
import { toDateStr, addDays, expandRecurrence, formatTime } from './dates'

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
