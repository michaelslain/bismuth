import { describe, expect, test } from 'bun:test'
import { tooltipContent } from './tooltipContent'

const keys = { 'quick-open': 'Mod+P', unbound: '', multi: 'Mod+`, Mod+J' }

describe('tooltipContent', () => {
    test('label + bound id gives label and combo', () => {
        expect(tooltipContent('Search', 'quick-open', keys)).toEqual({ label: 'Search', combo: 'Mod+P' })
    })
    test('label + unknown id gives the label only', () => {
        expect(tooltipContent('Search', 'nope', keys)).toEqual({ label: 'Search', combo: '' })
    })
    test('label + id bound to empty gives the label only', () => {
        expect(tooltipContent('Search', 'unbound', keys)).toEqual({ label: 'Search', combo: '' })
    })
    test('no label + bound id gives the combo only', () => {
        expect(tooltipContent('', 'quick-open', keys)).toEqual({ label: '', combo: 'Mod+P' })
        expect(tooltipContent(null, 'quick-open', keys)).toEqual({ label: '', combo: 'Mod+P' })
    })
    test('neither gives null', () => {
        expect(tooltipContent('', null, keys)).toBeNull()
        expect(tooltipContent(undefined, 'unbound', keys)).toBeNull()
    })
    test('an alternatives combo passes through unchanged', () => {
        expect(tooltipContent('Terminal', 'multi', keys)).toEqual({ label: 'Terminal', combo: 'Mod+`, Mod+J' })
    })
})
