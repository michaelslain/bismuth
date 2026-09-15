// core/test/linkTarget.test.ts
import { test, expect } from 'bun:test'
import { baseOf, dirOf, preferId, pickByBase, linkTargetFor } from '../src/linkTarget'

test('baseOf: strips the directory, leaving the basename', () => {
    expect(baseOf('a/x/Name')).toBe('Name')
})

test('baseOf: a root id is its own basename', () => {
    expect(baseOf('Name')).toBe('Name')
})

test('dirOf: returns the parent directory', () => {
    expect(dirOf('a/x/Name')).toBe('a/x')
})

test('dirOf: a root id has an empty directory', () => {
    expect(dirOf('Name')).toBe('')
})

test('preferId: fewer path segments wins', () => {
    expect(preferId('x/Name', 'a/b/Name')).toBe('x/Name')
})

test('preferId: fewer path segments wins regardless of argument order', () => {
    expect(preferId('a/b/Name', 'x/Name')).toBe('x/Name')
})

test('preferId: equal depth falls back to code-unit order', () => {
    expect(preferId('b/Name', 'a/Name')).toBe('a/Name')
    expect(preferId('a/Name', 'b/Name')).toBe('a/Name')
})

test('pickByBase: no ids match the basename', () => {
    expect(pickByBase('Name', ['a/Other', 'b/Else'])).toBeUndefined()
})

test('pickByBase: a single matching id wins uncontested', () => {
    expect(pickByBase('Name', ['a/Name', 'b/Other'])).toBe('a/Name')
})

test('pickByBase: three duplicates in shuffled order pick the same winner', () => {
    const winner = 'x/Name'
    const orderings = [
        ['x/Name', 'a/b/Name', 'c/d/e/Name'],
        ['a/b/Name', 'c/d/e/Name', 'x/Name'],
        ['c/d/e/Name', 'x/Name', 'a/b/Name'],
    ]
    for (const ids of orderings) {
        expect(pickByBase('Name', ids)).toBe(winner)
    }
})

test('linkTargetFor: a unique basename resolves to the bare base', () => {
    expect(linkTargetFor('x/Name', ['x/Name', 'a/Other'])).toBe('Name')
})

test('linkTargetFor: a duplicate basename resolves to the full id, for the tie-break winner too', () => {
    const ids = ['x/Name', 'a/b/Name']
    // The loser needs the full id to disambiguate.
    expect(linkTargetFor('a/b/Name', ids)).toBe('a/b/Name')
    // The tie-break WINNER also gets the full id — linkTargetFor doesn't special-case it,
    // because a bare `[[Name]]` written from the winner's own note would be ambiguous to
    // a reader who doesn't know the tie-break rule.
    expect(linkTargetFor('x/Name', ids)).toBe('x/Name')
})
