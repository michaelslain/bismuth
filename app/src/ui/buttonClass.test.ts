import { describe, it, expect } from 'bun:test'
import { buttonClass, searchBarClass } from './buttonClass'

describe('buttonClass', () => {
    it('defaults to a normal text button', () => {
        expect(buttonClass({})).toBe('btn btn--text btn--normal')
    })
    it('composes kind, state, size, danger, and extra class in order', () => {
        expect(
            buttonClass({
                kind: 'icon',
                state: 'selected',
                size: 'sm',
                danger: true,
                class: 'x',
            }),
        ).toBe('btn btn--icon btn--selected btn--sm btn--danger x')
    })
    it('omits size class for md', () => {
        expect(
            buttonClass({ kind: 'text', state: 'unselected', size: 'md' }),
        ).toBe('btn btn--text btn--unselected')
    })
    it("renders an icon button's normal state", () => {
        expect(buttonClass({ kind: 'icon' })).toBe('btn btn--icon btn--normal')
    })
    it('emits btn--primary when primary is set', () => {
        expect(buttonClass({ primary: true })).toBe(
            'btn btn--text btn--normal btn--primary',
        )
    })
    it('composes primary alongside kind, state, size, danger, and extra class', () => {
        expect(
            buttonClass({
                kind: 'text',
                state: 'selected',
                size: 'lg',
                danger: true,
                primary: true,
                class: 'x',
            }),
        ).toBe('btn btn--text btn--selected btn--lg btn--danger btn--primary x')
    })
})

describe('searchBarClass', () => {
    it('defaults to the base search-bar class', () => {
        expect(searchBarClass()).toBe('search-bar')
    })
    it('appends an extra class', () => {
        expect(searchBarClass('wide')).toBe('search-bar wide')
    })
})
