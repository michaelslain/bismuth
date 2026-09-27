import { describe, expect, test } from 'bun:test'
import {
    updateTaskLineFields,
    taskItemRange,
    removeTaskItem,
} from '../src/taskEdit'

describe('updateTaskLineFields', () => {
    test('replaces the description, keeps checkbox + indent + fields', () => {
        const line =
            '  - [ ] pay rent [due 2026-06-01] [scheduled 2026-05-28] [high] [every month]'
        const out = updateTaskLineFields(line, { description: 'pay bills' })
        expect(out).toBe(
            '  - [ ] pay bills [due 2026-06-01] [scheduled 2026-05-28] [high] [every month]',
        )
    })

    test('sets a date field that was not present', () => {
        const line = '- [ ] buy milk'
        const out = updateTaskLineFields(line, { due: '2026-09-14' })
        expect(out).toBe('- [ ] buy milk [due 2026-09-14]')
    })

    test('changes an existing date field', () => {
        const line = '- [ ] buy milk [due 2026-09-14]'
        const out = updateTaskLineFields(line, { due: '2026-10-01' })
        expect(out).toBe('- [ ] buy milk [due 2026-10-01]')
    })

    test('clears a date field with null', () => {
        const line = '- [ ] buy milk [due 2026-09-14] [high]'
        const out = updateTaskLineFields(line, { due: null })
        expect(out).toBe('- [ ] buy milk [high]')
    })

    test('sets priority', () => {
        const line = '- [ ] buy milk'
        const out = updateTaskLineFields(line, { priority: 'high' })
        expect(out).toBe('- [ ] buy milk [high]')
    })

    test('clears priority with null', () => {
        const line = '- [ ] buy milk [high]'
        const out = updateTaskLineFields(line, { priority: null })
        expect(out).toBe('- [ ] buy milk')
    })

    test('changes priority from one level to another', () => {
        const line = '- [ ] buy milk [low]'
        const out = updateTaskLineFields(line, { priority: 'highest' })
        expect(out).toBe('- [ ] buy milk [highest]')
    })

    test('preserves done/created/cancelled/recurrence untouched, tags kept', () => {
        const line =
            '- [x] ship it #work [done 2026-01-01] [every week] [due 2026-01-08]'
        const out = updateTaskLineFields(line, { due: '2026-01-09' })
        expect(out).toBe(
            '- [x] ship it #work [due 2026-01-09] [done 2026-01-01] [every week]',
        )
    })

    test('preserves CRLF', () => {
        const line = '- [ ] buy milk\r'
        const out = updateTaskLineFields(line, { due: '2026-09-14' })
        expect(out).toBe('- [ ] buy milk [due 2026-09-14]\r')
    })

    test('throws on a non-task line', () => {
        expect(() =>
            updateTaskLineFields('just text', { description: 'x' }),
        ).toThrow('not a task line')
    })

    test('leaving a key absent keeps the field as-is', () => {
        const line = '- [ ] buy milk [due 2026-09-14] [high]'
        const out = updateTaskLineFields(line, { description: 'buy oat milk' })
        expect(out).toBe('- [ ] buy oat milk [due 2026-09-14] [high]')
    })
})

describe('taskItemRange', () => {
    test('a task with no children is just itself', () => {
        const lines = ['- [ ] a', '- [ ] b']
        expect(taskItemRange(lines, 0)).toEqual({ start: 0, end: 1 })
    })

    test('sweeps up deeper-indented continuation lines', () => {
        const lines = [
            '- [ ] parent',
            '  - [ ] child',
            '  more detail',
            '- [ ] sibling',
        ]
        expect(taskItemRange(lines, 0)).toEqual({ start: 0, end: 3 })
    })

    test('stops at a blank line', () => {
        const lines = ['- [ ] parent', '  - [ ] child', '', '- [ ] sibling']
        expect(taskItemRange(lines, 0)).toEqual({ start: 0, end: 2 })
    })

    test('stops at a line at or above the head indent', () => {
        const lines = ['  - [ ] parent', '  - [ ] sibling-same-indent']
        expect(taskItemRange(lines, 0)).toEqual({ start: 0, end: 1 })
    })
})

describe('removeTaskItem', () => {
    test('removes a leaf task', () => {
        const content = '- [ ] a\n- [ ] b\n- [ ] c\n'
        const { content: out, removed } = removeTaskItem(content, 1)
        expect(out).toBe('- [ ] a\n- [ ] c\n')
        expect(removed).toEqual(['- [ ] b'])
    })

    test('removes a task and its children together', () => {
        const content = '- [ ] keep\n- [ ] parent\n  - [ ] child\n- [ ] after\n'
        const { content: out, removed } = removeTaskItem(content, 1)
        expect(out).toBe('- [ ] keep\n- [ ] after\n')
        expect(removed).toEqual(['- [ ] parent', '  - [ ] child'])
    })

    test('throws on an out-of-range line', () => {
        expect(() => removeTaskItem('- [ ] a\n', 5)).toThrow(
            'line out of range',
        )
    })
})
