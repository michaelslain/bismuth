import { test, expect } from 'bun:test'
import { attentionFirst, processNeedsAttention } from './daemonAttention'

test('attentionFirst moves flagged items up and keeps both groups in order', () => {
    expect(attentionFirst([1, 2, 3, 4, 5, 6], n => n % 3 === 0)).toEqual([
        3, 6, 1, 2, 4, 5,
    ])
})

test('attentionFirst with nothing flagged is the identity', () => {
    expect(attentionFirst(['a', 'b'], () => false)).toEqual(['a', 'b'])
})

test('a service needs attention only while enabled and the daemon is down', () => {
    const p = (enabled: boolean) =>
        ({ name: 'x', file: 'x', enabled }) as Parameters<typeof processNeedsAttention>[0]
    expect(processNeedsAttention(p(true), false)).toBe(true)
    expect(processNeedsAttention(p(true), true)).toBe(false)
    expect(processNeedsAttention(p(false), false)).toBe(false)
})
