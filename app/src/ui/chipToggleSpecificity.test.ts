// Pins the specificity fix from 10d3966a: a selected chip's colour must out-rank
// `.chip-toggle:hover` (0,2,0), which a bare `.selected` (0,1,0) does not. Real `:hover` can't be
// driven from a story in this harness (userEvent.hover never engages CSS :hover), so this checks
// the stylesheet directly instead.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, 'ChipToggle.module.css'), 'utf8')

const stripComments = (input: string): string =>
    input.replace(/\/\*[\s\S]*?\*\//g, '')

const selectedSelectors = stripComments(css)
    .split('{')
    .slice(0, -1)
    .map(chunk => chunk.trim().split('\n').pop() ?? '')
    .flatMap(prelude => prelude.split(','))
    .map(selector => selector.trim())
    .filter(selector => selector.includes('.selected'))

describe('ChipToggle.module.css selected-state specificity', () => {
    it('finds selected-state selectors to check', () => {
        expect(selectedSelectors.length).toBeGreaterThan(0)
    })

    it('every selected selector starts with .chip-toggle.', () => {
        // a bare `.selected` (0,1,0) loses to `.chip-toggle:hover` (0,2,0), so a selected chip's
        // colour must come from `.chip-toggle.selected` (0,2,0) or higher to out-rank hover
        for (const selector of selectedSelectors) {
            expect(selector.startsWith('.chip-toggle.')).toBe(true)
        }
    })
})
