import { describe, expect, test } from 'bun:test'
import { parseExportPrefs, parseExportTabState } from './exportPrefs'

describe('parseExportPrefs', () => {
    test('missing storage reads as the defaults', () => {
        expect(parseExportPrefs(undefined)).toEqual({
            format: undefined,
            theme: 'dark',
            pdfFontSize: 12,
            includeFrontmatter: true,
            showMarkdownSyntax: false,
        })
    })
    test('valid values round-trip', () => {
        const p = {
            format: 'pdf',
            theme: 'light',
            pdfFontSize: 16,
            includeFrontmatter: false,
            showMarkdownSyntax: true,
        }
        expect(parseExportPrefs(JSON.parse(JSON.stringify(p)))).toEqual(
            p as never,
        )
    })
    test('invalid fields fall back one by one', () => {
        const p = parseExportPrefs({
            format: 'docx',
            pdfFontSize: 13,
            theme: 1,
        })
        expect(p.format).toBeUndefined()
        expect(p.pdfFontSize).toBe(12)
        expect(p.theme).toBe('dark')
    })
})

describe('parseExportTabState', () => {
    test('keeps a source, a mode and a date', () => {
        expect(
            parseExportTabState({
                src: 'a/b.md',
                mode: 'visual',
                calStart: '2026-10-10',
            }),
        ).toEqual({ src: 'a/b.md', mode: 'visual', calStart: '2026-10-10' })
    })
    test('drops junk', () => {
        expect(
            parseExportTabState({ src: '', mode: 'x', calStart: 'soon' }),
        ).toEqual({ src: undefined, mode: undefined, calStart: '' })
    })
})
