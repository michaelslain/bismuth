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
  await s.addEvent({ title: 'Daily', date: '2026-05-01', recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' } })
  expect(s.getEventsForRange('2026-05-01', '2026-05-05').length).toBe(5)
})

test('deleteOccurrence removes exactly one day and keeps the rest', async () => {
  const s = await freshStore()
  await s.addEvent({ title: 'D', date: '2026-05-01', recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'x' } })
  await s.deleteOccurrence((s as any).data.events[0].id, '2026-05-03')
  const days = s.getEventsForRange('2026-05-01', '2026-05-05').map(e => e.date).sort()
  expect(days).toEqual(['2026-05-01', '2026-05-02', '2026-05-04', '2026-05-05'])
})

test('editSeries updates every master in the series', async () => {
  const s = await freshStore()
  await s.addEvent({ title: 'Old', date: '2026-05-01', recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'sid' } })
  await s.editSeries('sid', { title: 'New' })
  expect(s.getEventsForRange('2026-05-01', '2026-05-02').every(e => e.title === 'New')).toBe(true)
})

test('editFollowing preserves recurrence-rule edits (type/daysOfWeek) on the new segment', async () => {
  const s = await freshStore()
  await s.addEvent({ title: 'D', date: '2026-05-01', recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'sid' } })
  const masterId = (s as any).data.events[0].id
  // From 2026-05-04 onward, switch the rule from daily to weekly-on-Mondays.
  await s.editFollowing(masterId, '2026-05-04', { title: 'D', recurrence: { type: 'weekly', daysOfWeek: [1], startDate: '2026-05-04', seriesId: 'ignored' } })
  // Before the split: still daily (5/01–5/03 inclusive = 3 days).
  expect(s.getEventsForRange('2026-05-01', '2026-05-03').length).toBe(3)
  // After the split: only Mondays (5/04, 5/11, 5/18, 5/25), not every day.
  expect(s.getEventsForRange('2026-05-04', '2026-05-31').map(e => e.date).sort())
    .toEqual(['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'])
})

test('category delete with no reassignTo clears the category (events become uncategorized)', async () => {
  const s = await freshStore()
  await s.addCategory({ name: 'work', color: '#fff' })
  await s.addEvent({ title: 'A', date: '2026-05-10', category: 'work' })
  await s.deleteCategory('work')
  expect(s.getEventsForRange('2026-05-01', '2026-05-31')[0].category).toBeUndefined()
})

test('category delete reassigns events to an explicit stable default target', async () => {
  const s = await freshStore()
  await s.addCategory({ name: 'Uncategorized', color: '#ccc' })
  await s.addCategory({ name: 'work', color: '#fff' })
  await s.addEvent({ title: 'A', date: '2026-05-10', category: 'work' })
  // Deleting 'work' moves its events to the stable default, not an arbitrary neighbor.
  await s.deleteCategory('work', 'Uncategorized')
  expect(s.getEventsForRange('2026-05-01', '2026-05-31')[0].category).toBe('Uncategorized')
})
