import { describe, expect, test } from 'bun:test'
import { addMenuItems, tabMenuItems, type TabMenuHandlers } from './viewTabMenu'

const calls: string[] = []
const handlers: TabMenuHandlers = {
    onRename: i => calls.push(`rename ${i}`),
    onDuplicate: i => calls.push(`duplicate ${i}`),
    onChangeType: (i, t) => calls.push(`type ${i} ${t}`),
    onToggleMode: i => calls.push(`mode ${i}`),
    onMove: (i, d) => calls.push(`move ${i} ${d}`),
    onOpenSettings: i => calls.push(`settings ${i}`),
    onDelete: i => calls.push(`delete ${i}`),
}
const VIEWS = [
    { type: 'table' as const, mode: 'normal' as const },
    { type: 'kanban' as const, mode: 'tasks' as const },
    { type: 'calendar' as const, mode: 'normal' as const },
]
const byLabel = (items: ReturnType<typeof tabMenuItems>, label: string) =>
    items.find(i => i.label === label)!

describe('tabMenuItems', () => {
    test('lists the eight actions in order', () => {
        expect(tabMenuItems(VIEWS, 1, handlers).map(i => i.label)).toEqual([
            'rename',
            'duplicate',
            'change kind',
            'turn off tasks mode',
            'move left',
            'move right',
            'view settings',
            'delete',
        ])
    })
    test('mode label follows the view mode', () => {
        expect(tabMenuItems(VIEWS, 0, handlers)[3].label).toBe('turn on tasks mode')
    })
    test('first tab cannot move left, last cannot move right', () => {
        const first = tabMenuItems(VIEWS, 0, handlers)
        expect(byLabel(first, 'move left').disabled).toBe(true)
        expect(byLabel(first, 'move right').disabled).toBe(false)
        const last = tabMenuItems(VIEWS, 2, handlers)
        expect(byLabel(last, 'move right').disabled).toBe(true)
    })
    test('change kind omits the current kind and reports the picked one', () => {
        const kinds = byLabel(tabMenuItems(VIEWS, 0, handlers), 'change kind').submenu!
        expect(kinds.some(k => k.label === 'Table')).toBe(false)
        kinds.find(k => k.label === 'Cards')!.onSelect!()
        expect(calls.at(-1)).toBe('type 0 cards')
    })
    test('delete is one flat danger row, disabled for the last view', () => {
        expect(byLabel(tabMenuItems(VIEWS, 0, handlers), 'delete').disabled).toBe(false)
        expect(byLabel(tabMenuItems([VIEWS[0]], 0, handlers), 'delete').disabled).toBe(true)
        const del = byLabel(tabMenuItems(VIEWS, 2, handlers), 'delete')
        expect(del.submenu).toBeUndefined()
        expect(del.danger).toBe(true)
        del.onSelect!()
        expect(calls.at(-1)).toBe('delete 2')
    })
    test('plain rows call their handler with the tab index', () => {
        const items = tabMenuItems(VIEWS, 1, handlers)
        byLabel(items, 'duplicate').onSelect!()
        expect(calls.at(-1)).toBe('duplicate 1')
        byLabel(items, 'move right').onSelect!()
        expect(calls.at(-1)).toBe('move 1 1')
    })
})

describe('addMenuItems', () => {
    test('one row per view kind, each adding that kind', () => {
        const added: string[] = []
        const items = addMenuItems(t => added.push(t))
        expect(items.length).toBeGreaterThanOrEqual(12)
        items.find(i => i.label === 'Map')!.onSelect!()
        expect(added).toEqual(['map'])
    })
})
