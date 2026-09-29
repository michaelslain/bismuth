import { test, expect } from 'bun:test'
import { EventStore, MemoryBackend } from './EventStore'
import { deleteEventWithUndo, duplicateEvent } from './eventActions'
import { toasts, dismissToast } from '../toastStore'

async function freshStore() {
    const s = new EventStore(new MemoryBackend())
    await s.load()
    return s
}

const masters = (s: EventStore) => structuredClone((s as any).data.events)

function clickUndo(): void {
    const t = toasts().find(x => x.action?.label === 'undo')!
    t.action!.onClick()
}

const cleanup = () => toasts().forEach(t => dismissToast(t.id))

test('delete then undo restores a plain event identically', async () => {
    const s = await freshStore()
    const ev = await s.addEvent({
        title: 'Lunch',
        date: '2026-05-10',
        startTime: '12:00',
        categories: ['a', 'b'],
        category: 'a',
    })
    const before = masters(s)
    await deleteEventWithUndo(s, ev)
    expect(masters(s)).toEqual([])
    expect(toasts().some(t => t.message === 'deleted Lunch')).toBe(true)
    clickUndo()
    await new Promise(r => setTimeout(r, 0))
    expect(masters(s)).toEqual(before)
    cleanup()
})

for (const scope of ['one', 'following', 'all'] as const) {
    test(`recurring delete scope ${scope} then undo restores every recurrence field`, async () => {
        const s = await freshStore()
        await s.addEvent({
            title: 'D',
            date: '2026-05-01',
            recurrence: {
                type: 'weekly',
                daysOfWeek: [1, 3],
                startDate: '2026-05-01',
                endDate: '2026-06-30',
                seriesId: 'sid',
            },
        })
        const before = masters(s)
        const occ = s
            .getEventsForRange('2026-05-01', '2026-05-31')
            .find(e => e.date === '2026-05-13')!
        await deleteEventWithUndo(s, occ, scope)
        const days = s
            .getEventsForRange('2026-05-01', '2026-05-31')
            .map(e => e.date)
        if (scope === 'all') expect(days).toEqual([])
        else expect(days).not.toContain('2026-05-13')
        if (scope === 'following') expect(days).not.toContain('2026-05-18')
        clickUndo()
        await new Promise(r => setTimeout(r, 0))
        expect(masters(s)).toEqual(before)
        cleanup()
    })
}

test('duplicateEvent makes an independent copy with a fresh id and series', async () => {
    const s = await freshStore()
    const ev = await s.addEvent({
        title: 'R',
        date: '2026-05-01',
        recurrence: { type: 'daily', startDate: '2026-05-01', seriesId: 'sid' },
    })
    const copy = await duplicateEvent(s, ev)
    expect(copy.id).not.toBe(ev.id)
    expect(copy.title).toBe('R')
    expect(copy.recurrence!.seriesId).not.toBe('sid')
    expect((s as any).data.events.length).toBe(2)
})
