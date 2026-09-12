// app/src/color/parseHex.test.ts

import { test, expect, describe } from 'bun:test'
import { parseHex } from './parseHex'

describe('parseHex', () => {
    test('parses 6-digit hex', () => {
        expect(parseHex('#93BDB0')).toEqual([147, 189, 176])
        expect(parseHex('#000000')).toEqual([0, 0, 0])
        expect(parseHex('#ffffff')).toEqual([255, 255, 255])
    })

    test('parses 3-digit shorthand hex, expanded', () => {
        expect(parseHex('#fff')).toEqual([255, 255, 255])
        expect(parseHex('#0a1')).toEqual([0, 170, 17])
    })

    test('is case-insensitive and trims surrounding whitespace', () => {
        expect(parseHex('  #93bdb0  ')).toEqual([147, 189, 176])
        expect(parseHex('#ABCDEF')).toEqual(parseHex('#abcdef'))
    })

    test('rejects malformed input instead of returning a partial/NaN result', () => {
        expect(parseHex('')).toBeNull()
        expect(parseHex('93BDB0')).toBeNull() // missing '#'
        expect(parseHex('#12345')).toBeNull() // 5 digits
        expect(parseHex('#1234567')).toBeNull() // 7 digits
        expect(parseHex('#1234')).toBeNull() // 4 digits
        expect(parseHex('#zzzzzz')).toBeNull() // non-hex digits
        expect(parseHex('rgb(1, 2, 3)')).toBeNull()
        expect(parseHex('rgba(1, 2, 3, 0.5)')).toBeNull()
        expect(parseHex('teal')).toBeNull()
    })
})
