import { test, expect } from 'bun:test'
import { encodeTaskDrag, decodeTaskDrag } from './taskDrag'

test('round-trips a payload through encode/decode', () => {
    const p = { path: 'todo.md', line: 3, field: 'scheduled' }
    expect(decodeTaskDrag(encodeTaskDrag(p))).toEqual(p)
})

test('decode rejects empty, malformed and foreign strings', () => {
    expect(decodeTaskDrag('')).toBeNull()
    expect(decodeTaskDrag('not json')).toBeNull()
    expect(decodeTaskDrag('"just a string"')).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md' }))).toBeNull()
    expect(decodeTaskDrag(JSON.stringify({ path: 'a.md', line: '3', field: 'due' }))).toBeNull()
})
