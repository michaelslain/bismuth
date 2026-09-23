import { describe, it, expect } from 'bun:test'
import { buttonClass } from './buttonClass'

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
                kind: 'segment',
                state: 'selected',
                size: 'lg',
                danger: true,
                primary: true,
                class: 'x',
            }),
        ).toBe(
            'btn btn--segment btn--selected btn--lg btn--danger btn--primary x',
        )
    })
    it('ignores size for kind text — every text button is one size', () => {
        expect(buttonClass({ kind: 'text', size: 'sm' })).not.toContain(
            'btn--sm',
        )
        expect(buttonClass({ kind: 'text', size: 'sm' })).toBe(
            'btn btn--text btn--normal',
        )
    })
    it('applies size for kind segment — the old text look, verbatim', () => {
        expect(buttonClass({ kind: 'segment', size: 'sm' })).toBe(
            'btn btn--segment btn--normal btn--sm',
        )
    })
    it('still applies size for kind icon', () => {
        expect(buttonClass({ kind: 'icon', size: 'sm' })).toContain('btn--sm')
    })
})
