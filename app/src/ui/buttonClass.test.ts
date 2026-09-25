import { describe, it, expect } from 'bun:test'
import { buttonClass } from './buttonClass'

// Identity map: every logical key passes through unmapped, so the string-literal expectations
// below stay exactly as they were before buttonClass() took a required cls map.
const id = new Proxy({}, { get: (_, k) => String(k) }) as Record<string, string>

describe('buttonClass', () => {
    it('defaults to a normal text button', () => {
        expect(buttonClass({}, id)).toBe('btn btn--text btn--normal')
    })
    it('composes kind, state, size, danger, and extra class in order', () => {
        expect(
            buttonClass(
                {
                    kind: 'icon',
                    state: 'selected',
                    size: 'sm',
                    danger: true,
                    class: 'x',
                },
                id,
            ),
        ).toBe('btn btn--icon btn--selected btn--sm btn--danger x')
    })
    it('omits size class for md', () => {
        expect(
            buttonClass({ kind: 'text', state: 'unselected', size: 'md' }, id),
        ).toBe('btn btn--text btn--unselected')
    })
    it("renders an icon button's normal state", () => {
        expect(buttonClass({ kind: 'icon' }, id)).toBe(
            'btn btn--icon btn--normal',
        )
    })
    it('emits btn--primary when primary is set', () => {
        expect(buttonClass({ primary: true }, id)).toBe(
            'btn btn--text btn--normal btn--primary',
        )
    })
    it('composes primary alongside kind, state, size, danger, and extra class', () => {
        expect(
            buttonClass(
                {
                    kind: 'icon',
                    state: 'selected',
                    size: 'lg',
                    danger: true,
                    primary: true,
                    class: 'x',
                },
                id,
            ),
        ).toBe(
            'btn btn--icon btn--selected btn--lg btn--danger btn--primary x',
        )
    })
    it('ignores size for kind text — every text button is one size', () => {
        expect(
            buttonClass({ kind: 'text', size: 'sm' }, id),
        ).not.toContain('btn--sm')
        expect(buttonClass({ kind: 'text', size: 'sm' }, id)).toBe(
            'btn btn--text btn--normal',
        )
    })
    it('still applies size for kind icon', () => {
        expect(buttonClass({ kind: 'icon', size: 'sm' }, id)).toContain(
            'btn--sm',
        )
    })
    it('maps each logical key through cls', () => {
        expect(
            buttonClass(
                { kind: 'text', state: 'normal' },
                { btn: 'H1', 'btn--text': 'H2', 'btn--normal': 'H3' },
            ),
        ).toBe('H1 H2 H3')
    })
    it('appends a caller class unmapped', () => {
        expect(
            buttonClass(
                { class: 'caller' },
                { btn: 'H1', 'btn--text': 'H2', 'btn--normal': 'H3' },
            ),
        ).toBe('H1 H2 H3 caller')
    })
})
