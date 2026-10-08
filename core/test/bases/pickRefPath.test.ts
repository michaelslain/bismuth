import { test, expect } from 'bun:test'
import { pickRefPath } from '../../src/bases/sourceSpec'

test('exact root jsonl beats exact root md', () => {
    expect(pickRefPath('[[T]]', ['T.md', 'T.base.jsonl'])).toBe('T.base.jsonl')
})

test('explicit extensions stay on their kind', () => {
    expect(pickRefPath('[[T.md]]', ['T.md', 'T.base.jsonl'])).toBe('T.md')
    expect(pickRefPath('[[T.base.jsonl]]', ['a/b/T.base.jsonl', 'a/T.base.jsonl'])).toBe(
        'a/T.base.jsonl',
    )
})

test('basename tie: jsonl wins on equal depth, shallower md wins', () => {
    expect(pickRefPath('[[T]]', ['a/T.md', 'b/T.base.jsonl'])).toBe('b/T.base.jsonl')
    expect(pickRefPath('[[T]]', ['a/T.md', 'b/c/T.base.jsonl'])).toBe('a/T.md')
})

test('no match returns the root path', () => {
    expect(pickRefPath('[[Nope]]', ['a.md'])).toBe('Nope.md')
    expect(pickRefPath(undefined, [])).toBe('')
})
