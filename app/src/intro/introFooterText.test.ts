import { describe, expect, test } from 'bun:test'
import { footerReadout, nextLabel } from './introFooterText'

describe('footerReadout', () => {
    test('1-based index, count, // separator, label', () => {
        expect(footerReadout(0, 7, 'welcome')).toBe('1/7 // welcome')
        expect(footerReadout(1, 7, 'palette')).toBe('2/7 // palette')
        expect(footerReadout(6, 7, 'open vault')).toBe('7/7 // open vault')
    })
})

describe('nextLabel', () => {
    test('next until the last slide', () => {
        expect(nextLabel(0, 7, false)).toBe('next')
        expect(nextLabel(5, 7, true)).toBe('next')
    })
    test('last slide enters the vault, opening… while busy', () => {
        expect(nextLabel(6, 7, false)).toBe('enter your vault')
        expect(nextLabel(6, 7, true)).toBe('opening…')
    })
})
