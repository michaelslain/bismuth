import { test, expect } from 'bun:test'
import { EventStore, MemoryBackend } from './EventStore'
import {
    addCategory,
    renameCategory,
    deleteCategoryWithUndo,
} from './categoryActions'
import { toasts, dismissToast } from './../toastStore'

async function freshStore() {
    const s = new EventStore(new MemoryBackend())
    await s.load()
    return s
}
const names = (s: EventStore) => s.getCategories().map(c => c.name)
const cleanup = () => toasts().forEach(t => dismissToast(t.id))

test('two concurrent adds of the same name add one', async () => {
    const s = await freshStore()
    const [a, b] = await Promise.all([
        addCategory(s, { name: 'Read', color: 'blue' }),
        addCategory(s, { name: 'Read', color: 'blue' }),
    ])
    expect(names(s).filter(n => n === 'Read')).toHaveLength(1)
    expect([a, b].filter(Boolean)).toHaveLength(1)
})

test('empty and existing names are refused', async () => {
    const s = await freshStore()
    await addCategory(s, { name: 'Read', color: 'blue' })
    expect(await addCategory(s, { name: '  ', color: 'blue' })).toBe(false)
    expect(await addCategory(s, { name: 'Read', color: 'rose' })).toBe(false)
})

test('rename refuses a taken name and retargets events', async () => {
    const s = await freshStore()
    await addCategory(s, { name: 'A', color: 'blue' })
    await addCategory(s, { name: 'B', color: 'rose' })
    await s.addEvent({ title: 'x', date: '2026-05-10', category: 'A' })
    expect(await renameCategory(s, 'A', 'B')).toBe(false)
    expect(await renameCategory(s, 'A', 'C')).toBe(true)
    expect((s as any).data.events[0].category).toBe('C')
})

test('delete then undo restores the category and every event category', async () => {
    const s = await freshStore()
    await addCategory(s, { name: 'A', color: 'blue' })
    const ev = await s.addEvent({
        title: 'x',
        date: '2026-05-10',
        category: 'A',
        categories: ['A', 'Z'],
    })
    await deleteCategoryWithUndo(s, 'A')
    expect(names(s)).not.toContain('A')
    expect((s as any).data.events[0].category).toBeUndefined()
    toasts().find(t => t.action?.label === 'undo')!.action!.onClick()
    await new Promise(r => setTimeout(r, 20))
    expect(names(s)).toContain('A')
    const back = (s as any).data.events.find((e: any) => e.id === ev.id)
    expect(back.category).toBe('A')
    expect(back.categories).toEqual(['A', 'Z'])
    cleanup()
})

test('undoing a category delete restores its original position', async () => {
    const s = await freshStore()
    for (const n of ['Work', 'Home', 'Gym'])
        await addCategory(s, { name: n, color: 'blue' })
    await deleteCategoryWithUndo(s, 'Work')
    expect(names(s)).toEqual(['Home', 'Gym'])
    toasts().find(t => t.action?.label === 'undo')!.action!.onClick()
    await new Promise(r => setTimeout(r, 20))
    expect(names(s)).toEqual(['Work', 'Home', 'Gym'])
    cleanup()
})

test('a taken name toasts on add and on rename, empty and unchanged stay silent', async () => {
    const s = await freshStore()
    cleanup()
    await addCategory(s, { name: 'A', color: 'blue' })
    await addCategory(s, { name: 'B', color: 'rose' })
    expect(toasts()).toHaveLength(0)
    await addCategory(s, { name: 'A', color: 'rose' })
    expect(toasts().map(t => t.message)).toEqual([
        'a category named A already exists',
    ])
    cleanup()
    await renameCategory(s, 'A', 'B')
    expect(toasts().map(t => t.message)).toEqual([
        'a category named B already exists',
    ])
    cleanup()
    await addCategory(s, { name: '  ', color: 'blue' })
    await renameCategory(s, 'A', 'A')
    await renameCategory(s, 'A', '')
    expect(toasts()).toHaveLength(0)
})
