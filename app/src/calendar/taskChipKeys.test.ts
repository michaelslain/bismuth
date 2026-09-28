import { test, expect } from 'bun:test'
import { taskKey } from './taskChipKeys'
import type { Row } from '../../../core/src/bases/types'

test('a task key is its file path and line', () => {
    const row = { file: { path: 'Sprint.md' }, note: { line: 7 } } as unknown as Row
    expect(taskKey(row)).toBe('Sprint.md:7')
})
