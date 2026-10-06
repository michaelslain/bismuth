// app/src/editor/callout.test.ts
import { describe, it, expect } from 'bun:test'
import {
    CALLOUT_TYPES,
    parseCalloutHeader,
    renderCalloutHtml,
    type CalloutHeader,
} from './callout'
import { tokenDef } from '../../../core/src/theme/designTokens'

const header = (type: string): CalloutHeader => ({
    type,
    title: '',
    foldable: false,
    collapsed: false,
})

describe('renderCalloutHtml colour', () => {
    it('names the per-type token for a note, not a hex', () => {
        const html = renderCalloutHtml(header('note'), '<p>x</p>')
        expect(html).toContain('style="--callout-color:var(--callout-note)"')
        expect(html).not.toContain('#448aff')
    })

    it('uses the resolved key for an alias', () => {
        const parsed = parseCalloutHeader('> [!tldr] hi')
        expect(parsed?.type).toBe('abstract')
        const html = renderCalloutHtml(parsed!, '<p>x</p>')
        expect(html).toContain('var(--callout-abstract)')
    })

    it('keeps the hex on CALLOUT_TYPES for export', () => {
        expect(CALLOUT_TYPES.note.color).toBe('#448aff')
    })

    it('pins every CALLOUT_TYPES hex to its registered token default', () => {
        for (const [k, m] of Object.entries(CALLOUT_TYPES)) {
            expect(tokenDef(`callout-${k}`)?.default).toBe(m.color)
        }
    })
})
