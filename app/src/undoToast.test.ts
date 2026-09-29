import { test, expect } from 'bun:test'
import { pushUndoToast } from './undoToast'
import { toasts, dismissToast } from './toastStore'

const find = (id: number) => toasts().find(t => t.id === id)

test('pushUndoToast shows an undo action and runs undo exactly once', async () => {
    let calls = 0
    const id = pushUndoToast('deleted x', () => {
        calls++
    })
    const t = find(id)!
    expect(t.message).toBe('deleted x')
    expect(t.action?.label).toBe('undo')
    t.action!.onClick()
    t.action!.onClick()
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(find(id)).toBeUndefined()
})

test('a throwing undo pushes an undo failed toast', async () => {
    const id = pushUndoToast('deleted y', () => {
        throw new Error('boom')
    })
    find(id)!.action!.onClick()
    await new Promise(r => setTimeout(r, 0))
    expect(toasts().some(t => t.message === 'undo failed: boom')).toBe(true)
    toasts().forEach(t => dismissToast(t.id))
})

test('an async undo that rejects also pushes the failure toast', async () => {
    const id = pushUndoToast('deleted z', async () => {
        throw new Error('late')
    })
    find(id)!.action!.onClick()
    await new Promise(r => setTimeout(r, 0))
    expect(toasts().some(t => t.message === 'undo failed: late')).toBe(true)
    toasts().forEach(t => dismissToast(t.id))
})
