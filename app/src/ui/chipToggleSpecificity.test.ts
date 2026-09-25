// one-button Task 8: ChipToggle now composes ui/Button instead of rendering its own <button>, so
// the specificity fix from 10d3966a (a selected chip's colour must out-rank hover) is Button's
// concern now, not ChipToggle's — `.btn--text.btn--selected` has no competing bare `:hover` rule
// to out-rank in the first place (only `.btn--text.btn--unselected:hover` exists). This test now
// pins the DELEGATION instead: that no selected/hover colour rule has crept back into
// ChipToggle's own stylesheet, and that selection is driven through Button's `state`/`accent`
// props rather than a class ChipToggle composes itself.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, 'ChipToggle.module.css'), 'utf8')
const tsx = readFileSync(join(import.meta.dir, 'ChipToggle.tsx'), 'utf8')

const stripComments = (input: string): string => input.replace(/\/\*[\s\S]*?\*\//g, '')

describe('ChipToggle delegates selection colour to Button', () => {
    it('ChipToggle.module.css defines no .selected or :hover colour rule of its own', () => {
        const body = stripComments(css)
        expect(body).not.toMatch(/\.selected/)
        expect(body).not.toMatch(/:hover/)
    })

    it('ChipToggle.tsx drives Button via state + accent, not a class it composes itself', () => {
        expect(tsx).toMatch(/state=\{local\.selected \? 'selected' : 'unselected'\}/)
        expect(tsx).toMatch(/accent=\{local\.tone/)
    })
})
