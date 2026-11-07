import { test, expect } from 'bun:test'
import { EventStore, MemoryBackend } from './EventStore'

async function freshStore() {
    const s = new EventStore(new MemoryBackend())
    await s.load()
    return s
}

test('non-recurring event appears only in its range', async () => {
    const s = await freshStore()
    await s.addEvent({ title: 'A', date: '2026-05-10' })
    expect(s.getEventsForRange('2026-05-01', '2026-05-31').length).toBe(1)
    expect(s.getEventsForRange('2026-06-01', '2026-06-30').length).toBe(0)
})

test('daily recurrence expands across the range', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'Daily',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' },
    })
    expect(s.getEventsForRange('2026-05-01', '2026-05-05').length).toBe(5)
})

test('deleteOccurrence removes exactly one day and keeps the rest', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'D',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' },
    })
    await s.deleteOccurrence((s as any).data.events[0].id, '2026-05-03')
    const days = s
        .getEventsForRange('2026-05-01', '2026-05-05')
        .map(e => e.date)
        .sort()
    expect(days).toEqual([
        '2026-05-01',
        '2026-05-02',
        '2026-05-04',
        '2026-05-05',
    ])
})

test('editSeries updates every master in the series', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'Old',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'sid' },
    })
    await s.editSeries('sid', { title: 'New' })
    expect(
        s
            .getEventsForRange('2026-05-01', '2026-05-02')
            .every(e => e.title === 'New'),
    ).toBe(true)
})

test('editFollowing preserves recurrence-rule edits (type/daysOfWeek) on the new segment', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'D',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'sid' },
    })
    const masterId = (s as any).data.events[0].id
    // From 2026-05-04 onward, switch the rule from daily to weekly-on-Mondays.
    await s.editFollowing(masterId, '2026-05-04', {
        title: 'D',
        recurrence: {
            type: 'weekly',
            daysOfWeek: [1],
            startDate: '2026-05-04',
            seriesId: 'ignored',
        },
    })
    // Before the split: still daily (5/01–5/03 inclusive = 3 days).
    expect(s.getEventsForRange('2026-05-01', '2026-05-03').length).toBe(3)
    // After the split: only Mondays (5/04, 5/11, 5/18, 5/25), not every day.
    expect(
        s
            .getEventsForRange('2026-05-04', '2026-05-31')
            .map(e => e.date)
            .sort(),
    ).toEqual(['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'])
})

test('category delete with no reassignTo clears the category (events become uncategorized)', async () => {
    const s = await freshStore()
    await s.addCategory({ name: 'work', color: '#fff' })
    await s.addEvent({ title: 'A', date: '2026-05-10', category: 'work' })
    await s.deleteCategory('work')
    expect(
        s.getEventsForRange('2026-05-01', '2026-05-31')[0].category,
    ).toBeUndefined()
})

test('category delete reassigns events to an explicit stable default target', async () => {
    const s = await freshStore()
    await s.addCategory({ name: 'Uncategorized', color: '#ccc' })
    await s.addCategory({ name: 'work', color: '#fff' })
    await s.addEvent({ title: 'A', date: '2026-05-10', category: 'work' })
    // Deleting 'work' moves its events to the stable default, not an arbitrary neighbor.
    await s.deleteCategory('work', 'Uncategorized')
    expect(s.getEventsForRange('2026-05-01', '2026-05-31')[0].category).toBe(
        'Uncategorized',
    )
})

test('category rename rewrites both the legacy single field and the categories array', async () => {
    const s = await freshStore()
    await s.addCategory({ name: 'work', color: '#fff' })
    await s.addCategory({ name: 'home', color: '#000' })
    await s.addEvent({ title: 'single', date: '2026-05-10', category: 'work' })
    await s.addEvent({
        title: 'multi',
        date: '2026-05-11',
        category: 'work',
        categories: ['work', 'home'],
    })
    await s.updateCategory('work', { name: 'office' })
    const evs = s.getEventsForRange('2026-05-01', '2026-05-31')
    expect(evs.find(e => e.title === 'single')!.category).toBe('office')
    expect(evs.find(e => e.title === 'multi')!.categories).toEqual([
        'office',
        'home',
    ])
})

test('category delete drops the name from a multi-category event and dedupes', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'multi',
        date: '2026-05-10',
        category: 'work',
        categories: ['work', 'home'],
    })
    await s.deleteCategory('work')
    const ev = s.getEventsForRange('2026-05-01', '2026-05-31')[0]
    expect(ev.categories).toEqual(['home'])
})

test('category delete reassigns a multi-category member without duplicating an existing one', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'multi',
        date: '2026-05-10',
        categories: ['work', 'home'],
    })
    // Reassign 'work' → 'home', which the event already has: expect a single 'home'.
    await s.deleteCategory('work', 'home')
    const ev = s.getEventsForRange('2026-05-01', '2026-05-31')[0]
    expect(ev.categories).toEqual(['home'])
})

// editOccurrence had no coverage at all, yet it shares its whole series-splitting body with
// deleteOccurrence (both now call the private splitSeriesAroundOccurrence). These pin the edited
// day, the untouched neighbours, and the two branches the split has: the FIRST occurrence (no head
// segment — the master is dropped rather than left with endDate < startDate) and a mid-series one.
test('editOccurrence changes exactly one day and leaves its neighbours on the series', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'D',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' },
    })
    await s.editOccurrence((s as any).data.events[0].id, '2026-05-03', {
        title: 'Special',
    })
    const range = s.getEventsForRange('2026-05-01', '2026-05-05')
    expect(range.map(e => e.date).sort()).toEqual([
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
        '2026-05-04',
        '2026-05-05',
    ])
    expect(range.find(e => e.date === '2026-05-03')!.title).toBe('Special')
    expect(range.filter(e => e.title === 'D').length).toBe(4)
})

test('editOccurrence on the FIRST occurrence keeps the day count (master dropped, not zombied)', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'D',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' },
    })
    await s.editOccurrence((s as any).data.events[0].id, '2026-05-01', {
        title: 'First',
    })
    const range = s.getEventsForRange('2026-05-01', '2026-05-04')
    expect(range.map(e => e.date).sort()).toEqual([
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
        '2026-05-04',
    ])
    expect(range.find(e => e.date === '2026-05-01')!.title).toBe('First')
})

test('deleteOccurrence on the FIRST occurrence drops just that day', async () => {
    const s = await freshStore()
    await s.addEvent({
        title: 'D',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' },
    })
    await s.deleteOccurrence((s as any).data.events[0].id, '2026-05-01')
    expect(
        s
            .getEventsForRange('2026-05-01', '2026-05-04')
            .map(e => e.date)
            .sort(),
    ).toEqual(['2026-05-02', '2026-05-03', '2026-05-04'])
})

// A weekly Wednesday series (2026-11-04, 11, 18, 25), with the 11th dragged back to Tuesday the
// 10th — the calendar's drag sends the new day as `date` beside the new times.
async function wednesdays() {
    const s = await freshStore()
    const m = await s.addEvent({
        title: 'Gym',
        date: '2026-11-04',
        startTime: '10:00',
        endTime: '11:00',
        recurrence: {
            type: 'weekly',
            daysOfWeek: [3],
            startDate: '2026-11-04',
            seriesId: 'gym',
        },
    })
    return { s, id: m.id }
}
const DRAG = { startTime: '10:00', endTime: '11:00', date: '2026-11-10' }
const novDays = (s: EventStore) =>
    s
        .getEventsForRange('2026-11-01', '2026-11-30')
        .map(e => `${e.date}${e.recurrence ? '' : ' single'}`)
        .sort()

test('moving ONE occurrence to another day lands it there and empties its old day', async () => {
    const { s, id } = await wednesdays()
    await s.editOccurrence(id, '2026-11-11', DRAG)
    expect(novDays(s)).toEqual([
        '2026-11-04',
        '2026-11-10 single',
        '2026-11-18',
        '2026-11-25',
    ])
})

test('moving an occurrence and the following ones shifts the rest of the series without a duplicate', async () => {
    const { s, id } = await wednesdays()
    await s.editFollowing(id, '2026-11-11', DRAG)
    expect(novDays(s)).toEqual([
        '2026-11-04',
        '2026-11-10',
        '2026-11-17',
        '2026-11-24',
    ])
})

test('moving a daily series earlier from one occurrence on does not double the day before', async () => {
    const s = await freshStore()
    const m = await s.addEvent({
        title: 'Night',
        date: '2026-11-01',
        recurrence: { type: 'daily', startDate: '2026-11-01', seriesId: 'n' },
    })
    await s.editFollowing(m.id, '2026-11-06', { date: '2026-11-05' })
    const days = s.getEventsForRange('2026-11-01', '2026-11-08').map(e => e.date)
    expect(days.sort()).toEqual([
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
    ])
})

test('moving every occurrence shifts the whole series and keeps it one recurring event', async () => {
    const { s } = await wednesdays()
    await s.editSeries('gym', DRAG, '2026-11-11')
    expect(novDays(s)).toEqual([
        '2026-11-03',
        '2026-11-10',
        '2026-11-17',
        '2026-11-24',
    ])
    expect((s as any).data.events.length).toBe(1)
})

test('moving the FIRST occurrence and the following ones replaces the series instead of leaving an empty one', async () => {
    const { s, id } = await wednesdays()
    await s.editFollowing(id, '2026-11-04', { date: '2026-11-03' })
    expect(novDays(s)).toEqual([
        '2026-11-03',
        '2026-11-10',
        '2026-11-17',
        '2026-11-24',
    ])
    expect((s as any).data.events.length).toBe(1)
})
