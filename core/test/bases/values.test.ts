import { test, expect } from 'bun:test'
import { looseEquals, type Link } from '../../src/bases/values'

function link(path: string, display?: string): Link {
    return display === undefined
        ? { __link: true, path }
        : { __link: true, path, display }
}

test('looseEquals: link without display is not equal to undefined (either arg order)', () => {
    const a = link('note.md')
    expect(looseEquals(a, undefined)).toBe(false)
    expect(looseEquals(undefined, a)).toBe(false)
})

test('looseEquals: link with display equals its display text (either arg order)', () => {
    const a = link('note.md', 'My Note')
    expect(looseEquals(a, 'My Note')).toBe(true)
    expect(looseEquals('My Note', a)).toBe(true)
})

test('looseEquals: link equals its path (either arg order)', () => {
    const a = link('note.md')
    expect(looseEquals(a, 'note.md')).toBe(true)
    expect(looseEquals('note.md', a)).toBe(true)
})

test('a link equals a property written as that wikilink, as in Obsidian', () => {
    const people: Link = { __link: true, path: 'People' }
    expect(looseEquals(people, '[[People]]')).toBe(true)
    expect(looseEquals('[[People|them]]', people)).toBe(true)
    expect(looseEquals(people, '[[Categories/People]]')).toBe(true)
    expect(looseEquals(people, '[[People#Work]]')).toBe(true)
    expect(looseEquals(people, '[[Places]]')).toBe(false)
    expect(looseEquals(people, 'People and more')).toBe(false)
    expect(looseEquals({ __link: true, path: 'Categories/People' } as Link, { __link: true, path: 'People' } as Link)).toBe(true)
})

test('an embedding note`s this compares like a link to that note, as Obsidian`s this is the host file', () => {
    const kyoto = { loc: ['[[Kyoto]]'], file: { name: 'Kyoto', path: 'References/Kyoto.md', tags: [] } }
    expect(looseEquals('[[Kyoto]]', kyoto)).toBe(true)
    expect(looseEquals(kyoto, link('Kyoto'))).toBe(true)
    expect(looseEquals('[[Osaka]]', kyoto)).toBe(false)
    expect(looseEquals(kyoto.file, '[[References/Kyoto]]')).toBe(true)
    expect(looseEquals({ a: 1 }, '[[Kyoto]]')).toBe(false)
})
