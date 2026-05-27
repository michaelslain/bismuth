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

test('category delete reassigns events', async () => {
  const s = await freshStore()
  await s.addCategory({ name: 'work', color: '#fff' })
  await s.addEvent({ title: 'A', date: '2026-05-10', category: 'work' })
  await s.deleteCategory('work')
  expect(s.getEventsForRange('2026-05-01', '2026-05-31')[0].category).toBeUndefined()
})
