import { describe, expect, test } from 'bun:test'
import {
    addMonthsISO,
    calendarCells,
    monthLabel,
    monthOf,
    moveFocus,
    shiftMonth,
    weekdayHeads,
} from './monthCalendarModel'
import { formatTimeText, parseTimeText, timeSlots } from './timeFieldText'

describe('monthCalendarModel', () => {
    test('monthOf reads the value, else the fallback', () => {
        expect(monthOf('2026-08-20', '2020-01-01')).toEqual({ year: 2026, month: 7 })
        expect(monthOf('', '2026-02-03')).toEqual({ year: 2026, month: 1 })
        expect(monthOf('2026-08-20T14:30', '')).toEqual({ year: 2026, month: 7 })
    })

    test('shiftMonth carries across years both ways', () => {
        expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
        expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    })

    test('calendarCells is whole weeks starting on the configured day', () => {
        // August 2026 starts on a Saturday.
        const sun = calendarCells({ year: 2026, month: 7 }, false)
        expect(sun.length % 7).toBe(0)
        expect(sun[0]).toEqual({ iso: '2026-07-26', day: 26, inMonth: false })
        expect(sun[6]).toEqual({ iso: '2026-08-01', day: 1, inMonth: true })
        const mon = calendarCells({ year: 2026, month: 7 }, true)
        expect(mon[0].iso).toBe('2026-07-27')
        expect(mon.filter(c => c.inMonth).length).toBe(31)
    })

    test('labels are lowercase', () => {
        expect(monthLabel({ year: 2026, month: 7 }, 'en-US')).toBe('august 2026')
        expect(weekdayHeads(false, 'en-US')).toEqual(['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'])
        expect(weekdayHeads(true, 'en-US')[0]).toBe('mo')
    })

    test('addMonthsISO clamps to the shorter month', () => {
        expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28')
        expect(addMonthsISO('2026-03-15', -3)).toBe('2025-12-15')
    })

    test('moveFocus steps days, weeks and months; other keys are not moves', () => {
        expect(moveFocus('2026-08-31', 'ArrowRight')).toBe('2026-09-01')
        expect(moveFocus('2026-08-03', 'ArrowUp')).toBe('2026-07-27')
        expect(moveFocus('2026-08-20', 'PageDown')).toBe('2026-09-20')
        expect(moveFocus('2026-08-20', 'a')).toBeNull()
    })
})

describe('timeFieldText', () => {
    test('parseTimeText reads the shapes people type', () => {
        expect(parseTimeText('14:30')).toBe('14:30')
        expect(parseTimeText('1430')).toBe('14:30')
        expect(parseTimeText('2:30pm')).toBe('14:30')
        expect(parseTimeText('2:30 PM')).toBe('14:30')
        expect(parseTimeText('2 p')).toBe('14:00')
        expect(parseTimeText('12am')).toBe('00:00')
        expect(parseTimeText('12pm')).toBe('12:00')
        expect(parseTimeText('9')).toBe('09:00')
    })

    test('parseTimeText rejects what is not a whole time', () => {
        expect(parseTimeText('')).toBeNull()
        expect(parseTimeText('2:')).toBeNull()
        expect(parseTimeText('24:00')).toBeNull()
        expect(parseTimeText('13pm')).toBeNull()
        expect(parseTimeText('9:75')).toBeNull()
    })

    test('formatTimeText follows the 24-hour setting', () => {
        expect(formatTimeText('14:30', false)).toBe('2:30 pm')
        expect(formatTimeText('00:05', false)).toBe('12:05 am')
        expect(formatTimeText('14:30', true)).toBe('14:30')
    })

    test('timeSlots opens on the set time and wraps', () => {
        const s = timeSlots('14:10')
        expect(s.length).toBe(48)
        expect(s[0]).toBe('14:30')
        expect(s[47]).toBe('14:00')
        expect(timeSlots('')[0]).toBe('00:00')
    })
})
