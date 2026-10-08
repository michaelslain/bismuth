import { expect, test } from 'bun:test'
import { basePickerOptions } from './basePickerOptions'

test('unique names are plain wikilinks, sorted, notes and bases alike', () => {
    const out = basePickerOptions([
        { path: 'z/Zed.md' },
        { path: 'boards/Alpha.base.jsonl' },
        { path: 'img/pic.png' },
    ])
    expect(out).toEqual([
        { value: '[[Alpha]]', label: 'Alpha' },
        { value: '[[Zed]]', label: 'Zed' },
    ])
})

test('Foo.md and Foo.base.jsonl in different folders are two distinct values', () => {
    const out = basePickerOptions([
        { path: 'notes/Foo.md' },
        { path: 'boards/Foo.base.jsonl' },
    ])
    expect(out.map(o => o.value)).toEqual([
        '[[boards/Foo.base.jsonl]]',
        '[[notes/Foo]]',
    ])
    expect(new Set(out.map(o => o.value)).size).toBe(2)
    expect(out.some(o => o.value === '[[Foo]]')).toBe(false)
})

test('a root note and a base of the same name stay distinct', () => {
    const out = basePickerOptions([
        { path: 'Foo.md' },
        { path: 'Foo.base.jsonl' },
    ])
    expect(new Set(out.map(o => o.value)).size).toBe(2)
})

test('the base being edited is excluded', () => {
    const out = basePickerOptions(
        [{ path: 'a/Mine.base.jsonl' }, { path: 'b/Other.base.jsonl' }],
        'a/Mine.base.jsonl',
    )
    expect(out.map(o => o.value)).toEqual(['[[Other]]'])
})

test('a note sharing the edited base name gets a path-qualified value', () => {
    const out = basePickerOptions(
        [{ path: 'Foo.base.jsonl' }, { path: 'deep/Foo.md' }],
        'Foo.base.jsonl',
    )
    expect(out.map(o => o.value)).toEqual(['[[deep/Foo]]'])
})
