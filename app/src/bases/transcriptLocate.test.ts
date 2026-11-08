import { describe, expect, test } from 'bun:test'
import type { TextLine } from '../../../core/src/visionOcr'
import { boxesForQuote, lineAtPoint } from './transcriptLocate'

const L = (text: string, y: number): TextLine => ({ text, x: 0.1, y, w: 0.8, h: 0.03 })
const lines = [L('The mitochondria is the powerhouse', 0.1), L('of the cell and more.', 0.15), L('Energy is made here.', 0.2), L('The cell again', 0.3)]
const box = (y: number) => ({ x: 0.1, y, w: 0.8, h: 0.03 })

describe('boxesForQuote', () => {
    test('exact line', () => expect(boxesForQuote(lines, 'Energy is made here.')).toEqual([box(0.2)]))
    test('part of a line gives that whole line', () => expect(boxesForQuote(lines, 'is made')).toEqual([box(0.2)]))
    test('a quote spanning two lines', () =>
        expect(boxesForQuote(lines, 'powerhouse\nof the cell')).toEqual([box(0.1), box(0.15)]))
    test('markdown, math and == marks in the quote are ignored', () =>
        expect(boxesForQuote(lines, '==**Energy** is $made$ here==')).toEqual([box(0.2)]))
    test('whitespace and case differences', () =>
        expect(boxesForQuote(lines, '  ENERGY   is\n made  here. ')).toEqual([box(0.2)]))
    test('a quote not on the page is empty', () => expect(boxesForQuote(lines, 'nothing like this')).toEqual([]))
    test('an empty quote is empty', () => expect(boxesForQuote(lines, ' == ')).toEqual([]))
    test('a repeated phrase matches its first occurrence', () => expect(boxesForQuote(lines, 'the cell')).toEqual([box(0.15)]))
    test('lines out of order are read top to bottom', () =>
        expect(boxesForQuote([...lines].reverse(), 'powerhouse of the cell')).toEqual([box(0.1), box(0.15)]))
})

describe('lineAtPoint', () => {
    test('finds the line under a point', () => expect(lineAtPoint(lines, 0.5, 0.21)?.text).toBe('Energy is made here.'))
    test('undefined between lines and outside', () => {
        expect(lineAtPoint(lines, 0.5, 0.25)).toBeUndefined()
        expect(lineAtPoint(lines, 0.05, 0.1)).toBeUndefined()
    })
})
