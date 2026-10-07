import { describe, expect, it } from 'bun:test'
import { snippetFromMatch } from './chatHistorySnippet'

const LONG =
    '…so the container is clipping the last two rows — the grid is sized from the pane height minus the bar…'

describe('snippetFromMatch', () => {
    it('moves a centered match to near the start so a one-line ellipsis cannot cut it', () => {
        const out = snippetFromMatch(LONG, 'pane height')
        expect(out.indexOf('pane height')).toBeLessThanOrEqual(13)
        expect(out.startsWith('…')).toBe(true)
        expect(out.endsWith('…')).toBe(true)
    })
    it('starts on a word boundary, not mid-word', () => {
        const out = snippetFromMatch('the chat controls should be one quiet row…', 'quiet row')
        expect(out).toBe('…be one quiet row…')
    })
    it('matches case-insensitively and keeps the original casing', () => {
        const out = snippetFromMatch(LONG, 'PANE')
        // the re-windowing is the point: the input does not start with '…pane', the output reaches
        // the match within the lead, and the original lowercase casing survives the search
        expect(out.startsWith('…')).toBe(true)
        expect(out.toLowerCase().indexOf('pane')).toBeLessThanOrEqual(13)
        expect(out).toContain('pane height')
    })
    it('falls through to the next term when the first is absent', () => {
        expect(snippetFromMatch(LONG, 'zzz pane').indexOf('pane')).toBeLessThanOrEqual(13)
    })
    it('leaves a match already near the start alone', () => {
        expect(snippetFromMatch('quiet row redesign', 'quiet')).toBe('quiet row redesign')
    })
    it('leaves the snippet alone for a blank or unmatched query', () => {
        expect(snippetFromMatch(LONG, '')).toBe(LONG)
        expect(snippetFromMatch(LONG, '   ')).toBe(LONG)
        expect(snippetFromMatch(LONG, 'nothing here')).toBe(LONG)
    })
})
