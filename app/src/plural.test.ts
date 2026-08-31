import { test, expect } from 'bun:test'
import { plural, pluralWord } from './plural'

test('plural: 1 takes the singular, everything else the plural', () => {
    expect(plural(1, 'node')).toBe('1 node')
    expect(plural(2, 'node')).toBe('2 nodes')
    // The defect this module was written for: the graph footer read "1 nodes".
    expect(plural(1, 'node')).not.toBe('1 nodes')
})

test('plural: zero is plural, not singular', () => {
    expect(plural(0, 'edge')).toBe('0 edges')
})

test('plural: an explicit second form wins over the -s default', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry')
    expect(plural(3, 'entry', 'entries')).toBe('3 entries')
})

test('plural: negatives and non-integers are plural (never accidentally singular)', () => {
    expect(plural(-1, 'node')).toBe('-1 nodes')
    expect(plural(1.5, 'node')).toBe('1.5 nodes')
})

test('pluralWord: the noun alone, for call sites that render the count separately', () => {
    expect(pluralWord(1, 'turn')).toBe('turn')
    expect(pluralWord(2, 'turn')).toBe('turns')
    expect(pluralWord(0, 'match', 'matches')).toBe('matches')
})
