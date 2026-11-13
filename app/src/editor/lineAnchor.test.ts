import { describe, expect, test } from 'bun:test'
import { clampLineAnchor, lineAnchorLabel, parseLineAnchor } from './lineAnchor'

describe('parseLineAnchor', () => {
    test('one line', () => {
        expect(parseLineAnchor('L12')).toEqual({ from: 12, to: 12 })
    })
    test('a range, with or without the second L', () => {
        expect(parseLineAnchor('L12-L18')).toEqual({ from: 12, to: 18 })
        expect(parseLineAnchor('L12-18')).toEqual({ from: 12, to: 18 })
    })
    test('a reversed range is put in order', () => {
        expect(parseLineAnchor('L18-L12')).toEqual({ from: 12, to: 18 })
    })
    test('heading anchors and line 0 are not line anchors', () => {
        expect(parseLineAnchor('Goals')).toBeNull()
        expect(parseLineAnchor('L12 notes')).toBeNull()
        expect(parseLineAnchor('L0')).toBeNull()
        expect(parseLineAnchor(undefined)).toBeNull()
    })
})

test('lineAnchorLabel', () => {
    expect(lineAnchorLabel({ from: 12, to: 12 })).toBe(':12')
    expect(lineAnchorLabel({ from: 12, to: 18 })).toBe(':12–18')
})

test('clampLineAnchor', () => {
    expect(clampLineAnchor({ from: 3, to: 40 }, 10)).toEqual({ from: 3, to: 10 })
    expect(clampLineAnchor({ from: 11, to: 12 }, 10)).toBeNull()
})
