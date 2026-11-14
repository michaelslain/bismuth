import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { TASK_STATUS_OPTIONS, otherStatuses } from './taskStatusOptions'

const labels = (cur: string) => otherStatuses(cur).map(o => o.label)

describe('task status menu', () => {
    test('labels and order', () => {
        expect(TASK_STATUS_OPTIONS.map(o => o.label)).toEqual([
            'to do',
            'in progress',
            'done',
            'cancelled',
        ])
        expect(TASK_STATUS_OPTIONS.map(o => o.char)).toEqual([' ', '/', 'x', '-'])
    })
    test('the current status is left out', () => {
        expect(labels(' ')).toEqual(['in progress', 'done', 'cancelled'])
        expect(labels('/')).toEqual(['to do', 'done', 'cancelled'])
        expect(labels('x')).toEqual(['to do', 'in progress', 'cancelled'])
        expect(labels('-')).toEqual(['to do', 'in progress', 'done'])
    })
    test('x/X and / and \\ fold to one status', () => {
        expect(labels('X')).toEqual(labels('x'))
        expect(labels('\\')).toEqual(labels('/'))
    })
    test('rows carry a bracket prefix mark and no icon', () => {
        const src = readFileSync(`${import.meta.dir}/taskStatusMenu.tsx`, 'utf8')
        expect(src).toContain('prefix: <TaskMark')
        expect(src).not.toMatch(/\bicon:/)
        expect(src).not.toMatch(/Square(Check|X|Slash)?\b/)
    })
})
