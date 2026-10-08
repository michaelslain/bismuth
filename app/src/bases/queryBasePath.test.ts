import { test, expect } from 'bun:test'
import { resolveQueryBasePath } from './queryBasePath'

test('a basename ref finds the nested base', () => {
    expect(
        resolveQueryBasePath('[[List]]', ['a.md', 'reading/List.md']),
    ).toBe('reading/List.md')
})

test('an exact path wins over a shallower basename match', () => {
    expect(
        resolveQueryBasePath('[[reading/List]]', [
            'List.md',
            'reading/List.md',
            'other/reading/List.md',
        ]),
    ).toBe('reading/List.md')
})

test('fewest segments wins among basename matches', () => {
    expect(
        resolveQueryBasePath('[[List]]', ['x/y/List.md', 'z/List.md']),
    ).toBe('z/List.md')
})

test('no match falls back to the root path', () => {
    expect(resolveQueryBasePath('[[Nope]]', ['a.md'])).toBe('Nope.md')
    expect(resolveQueryBasePath(undefined, ['a.md'])).toBe('')
})

test('non-markdown files are not candidates', () => {
    expect(resolveQueryBasePath('[[List]]', ['img/List.png'])).toBe('List.md')
})

test('a bare ref finds a jsonl base, root or nested', () => {
    expect(resolveQueryBasePath('[[Cal]]', ['Cal.base.jsonl'])).toBe('Cal.base.jsonl')
    expect(resolveQueryBasePath('[[Cal]]', ['sub/Cal.base.jsonl'])).toBe(
        'sub/Cal.base.jsonl',
    )
})
