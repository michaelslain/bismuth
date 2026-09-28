import { test, expect } from 'bun:test'
import { initialEventForm, buildEventData, formDirty } from './eventForm'

const TODAY = '2026-08-20'

test('a blank new event opens all-day on the seeded date', () => {
    const f = initialEventForm(undefined, { date: '2026-08-22' }, TODAY)
    expect(f.allDay).toBe(true)
    expect(f.date).toBe('2026-08-22')
    expect(f.recDays).toEqual([6])
})

test('a timed seed opens with the time fields on', () => {
    const f = initialEventForm(undefined, { startTime: '09:00' }, TODAY)
    expect(f.allDay).toBe(false)
    expect(f.date).toBe(TODAY)
})

test('build keeps end only when it is after start, and clears categories explicitly', () => {
    const f = initialEventForm(undefined, { startTime: '10:00', endTime: '09:00' }, TODAY)
    const data = buildEventData({ ...f, title: 't' }, 's')
    expect(data.startTime).toBe('10:00')
    expect('endTime' in data).toBe(false)
    expect('category' in data).toBe(true)
    expect(data.category).toBeUndefined()
})

test('several categories mirror the first into category', () => {
    const f = { ...initialEventForm(undefined, {}, TODAY), cats: ['A', 'B'] }
    const data = buildEventData(f, 's')
    expect(data.category).toBe('A')
    expect(data.categories).toEqual(['A', 'B'])
})

test('weekly carries days + series id; monthly carries no days', () => {
    const base = { ...initialEventForm(undefined, {}, TODAY), recEnd: '2026-09-30' }
    const weekly = buildEventData({ ...base, recType: 'weekly', recDays: [1, 3] }, 'sid')
    expect(weekly.recurrence).toMatchObject({
        type: 'weekly',
        daysOfWeek: [1, 3],
        endDate: '2026-09-30',
        seriesId: 'sid',
    })
    const monthly = buildEventData({ ...base, recType: 'monthly' }, 'sid')
    expect(monthly.recurrence && 'daysOfWeek' in monthly.recurrence).toBe(false)
})

test('formDirty sees a typed change', () => {
    const a = initialEventForm(undefined, {}, TODAY)
    expect(formDirty(a, a)).toBe(false)
    expect(formDirty({ ...a, title: 'x' }, a)).toBe(true)
})
