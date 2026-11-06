import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { isMathLine, looksLikeMath } from '../src/mathDetect'

// On-device recognition's text of real handwritten pages: ten pages of lecture math and ten of
// handwritten prose, as the Vision helper returned them.
const pages = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures', 'mathDetect', 'onDevicePages.json'), 'utf8'),
) as { math: string[]; prose: string[] }

describe('looksLikeMath', () => {
    test('every handwritten math page reads as math, garbled as the on-device text is', () => {
        expect(pages.math).toHaveLength(10)
        for (const text of pages.math) expect(looksLikeMath(text)).toBe(true)
    })

    test('no handwritten prose page reads as math', () => {
        expect(pages.prose).toHaveLength(10)
        for (const text of pages.prose) expect(looksLikeMath(text)).toBe(false)
    })

    test('one stray symbol in a page of prose is not math', () => {
        const text = ['Dear diary,', 'the meeting moved to 3 > 2 rooms', 'we talked for an hour', 'then lunch', 'then home', 'then bed', 'goodnight'].join('\n')
        expect(looksLikeMath(text)).toBe(false)
    })

    test('an empty page is not math', () => {
        expect(looksLikeMath('')).toBe(false)
        expect(looksLikeMath('\n \n')).toBe(false)
    })
})

describe('isMathLine', () => {
    test('a relation, two lone variables or a digit glued to a letter is a math tell', () => {
        expect(isMathLine('lim sn = s')).toBe(true)
        expect(isMathLine('let x and y be reals')).toBe(true)
        expect(isMathLine('2x plus three')).toBe(true)
    })

    test('the words a and I are not variables', () => {
        expect(isMathLine('I bought a pear')).toBe(false)
    })
})
