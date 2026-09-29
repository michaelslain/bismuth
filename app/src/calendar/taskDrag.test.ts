import { test, expect } from 'bun:test'
import { encodeTaskDrag, decodeTaskDrag, readTaskDrop, TASK_DRAG_MIME } from './taskDrag'

test('round-trips a line-task payload through encode/decode', () => {
    const p = { path: 'todo.md', line: 3, field: 'scheduled' }
    expect(decodeTaskDrag(encodeTaskDrag(p))).toEqual(p)
})

test('round-trips a stored-row payload through encode/decode', () => {
    const p = { path: 'base.md', index: 2, field: 'due' }
    expect(decodeTaskDrag(encodeTaskDrag(p))).toEqual(p)
})

test('decode rejects empty, malformed and foreign strings', () => {
    expect(decodeTaskDrag('')).toBeNull()
    expect(decodeTaskDrag('not json')).toBeNull()
    expect(decodeTaskDrag('"just a string"')).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md' }))).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md', line: '3', field: 'due' }))).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md', field: 'due' }))).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md', line: 3 }))).toBeNull()
})

const dropEvent = (raw: string | undefined, cancel = { called: false }) =>
    ({
        preventDefault: () => {
            cancel.called = true
        },
        dataTransfer: raw === undefined ? null : { getData: (m: string) => (m === TASK_DRAG_MIME ? raw : '') },
    }) as unknown as DragEvent

test('readTaskDrop prevents default and returns the payload', () => {
    const p = { path: 'todo.md', line: 3, field: 'due' }
    const c = { called: false }
    expect(readTaskDrop(dropEvent(encodeTaskDrag(p), c))).toEqual(p)
    expect(c.called).toBe(true)
})

test('readTaskDrop returns null for a foreign or missing payload', () => {
    expect(readTaskDrop(dropEvent('nope'))).toBeNull()
    expect(readTaskDrop(dropEvent(undefined))).toBeNull()
})
