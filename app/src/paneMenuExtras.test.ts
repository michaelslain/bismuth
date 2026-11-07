import { expect, test } from 'bun:test'
import { addPaneMenuItems, paneMenuItemsOf, withPaneItems } from './paneMenuExtras'

test('rows added to an event are read back in order', () => {
    const e = new Event('contextmenu')
    expect(paneMenuItemsOf(e)).toEqual([])
    addPaneMenuItems(e, [{ label: 'a' }])
    addPaneMenuItems(e, [{ label: 'b' }])
    expect(paneMenuItemsOf(e).map(i => i.label)).toEqual(['a', 'b'])
})

test('content rows come first, the pane rows after a separator', () => {
    const merged = withPaneItems([{ label: 'transcribe again with ai' }], [{ label: 'Split right' }, { label: 'Close pane' }])
    expect(merged.map(i => i.label)).toEqual(['transcribe again with ai', 'Split right', 'Close pane'])
    expect(merged[1].separatorBefore).toBe(true)
    expect(withPaneItems([], [{ label: 'Split right' }])).toEqual([{ label: 'Split right' }])
})
