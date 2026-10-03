import { test, expect } from 'bun:test'
import { createKeyedSignal } from './createKeyedSignal'

test('get is undefined until set; set then clear round-trips', () => {
    const k = createKeyedSignal<number>()
    expect(k.get('a')).toBeUndefined()
    k.set('a', 1)
    expect(k.get('a')).toBe(1)
    expect(k.get('b')).toBeUndefined()
    k.clear('a')
    expect(k.get('a')).toBeUndefined()
})

test('set of an equal value and clear of an absent id keep the same Map', () => {
    const k = createKeyedSignal<string>()
    k.set('a', 'x')
    const before = k.map()
    k.set('a', 'x')
    k.clear('nope')
    expect(k.map()).toBe(before)
    k.set('a', 'y')
    expect(k.map()).not.toBe(before)
    expect(before.get('a')).toBe('x') // the old Map is never mutated
})
