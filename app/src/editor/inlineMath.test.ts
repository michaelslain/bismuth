import { describe, expect, test } from 'bun:test'
import { findInlineMath, findSymbolEscapes } from './inlineMath'

const inners = (line: string) => findInlineMath(line).map(s => s.inner)

describe('findInlineMath', () => {
    test('math still renders', () => {
        expect(inners('area $x^2$ here')).toEqual(['x^2'])
        expect(inners('$a$ and $b$')).toEqual(['a', 'b'])
        expect(inners('$\\frac{1}{2}$')).toEqual(['\\frac{1}{2}'])
    })

    test('dollar amounts stay text', () => {
        expect(inners('costs $5 and $10 total')).toEqual([])
        expect(inners('between $5-$10')).toEqual([])
        expect(inners('a $5 coffee')).toEqual([])
        expect(inners('$ 5 $')).toEqual([])
    })

    test('an escaped dollar never opens or closes math', () => {
        expect(inners('literal \\$x\\$ here')).toEqual([])
        expect(inners('price \\$5 and $y$')).toEqual(['y'])
        expect(inners('$a \\$ b$')).toEqual(['a \\$ b'])
        // `\\` is an escaped backslash, so the `$` after it is a real delimiter
        expect(inners('\\\\$z$')).toEqual(['z'])
    })

    test('display delimiters never open inline math', () => {
        expect(inners('$$x$$')).toEqual([])
    })

    test('spans carry their offsets', () => {
        expect(findInlineMath('ab $c$')).toEqual([{ from: 3, to: 6, inner: 'c' }])
    })
})

describe('findSymbolEscapes', () => {
    test('finds the backslash of each \\$ and \\#', () => {
        expect(findSymbolEscapes('a \\$5 and \\#tag')).toEqual([2, 10])
    })

    test('an escaped backslash pairs off first', () => {
        expect(findSymbolEscapes('\\\\$x')).toEqual([])
        expect(findSymbolEscapes('\\\\\\$')).toEqual([2])
    })

    test('other escapes are left alone', () => {
        expect(findSymbolEscapes('\\* \\[')).toEqual([])
    })
})
