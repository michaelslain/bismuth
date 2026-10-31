// app/src/export/blankLines.test.ts
import { test, expect, describe } from 'bun:test'
import { keepBlankLines, BLANK_LINE_CLASS } from './blankLines'
import { renderMarkdown } from '../bases/markdown'

const SPACER = `<div class="${BLANK_LINE_CLASS}"></div>`
const spacers = (html: string) => html.split(SPACER).length - 1

describe('keepBlankLines', () => {
    test('one blank line between paragraphs is left to the paragraph margin', () => {
        expect(keepBlankLines('a\n\nb')).toBe('a\n\nb')
    })

    test('each blank line past the first becomes one spacer', () => {
        expect(spacers(keepBlankLines('a\n\n\nb'))).toBe(1)
        expect(spacers(keepBlankLines('a\n\n\n\n\nb'))).toBe(3)
    })

    test('whitespace-only lines count as blank', () => {
        expect(spacers(keepBlankLines('a\n  \n\t\nb'))).toBe(1)
    })

    test('blank lines at the start or end are left alone', () => {
        expect(keepBlankLines('\n\n\na\n\n\n')).toBe('\n\n\na\n\n\n')
    })

    test('blank lines inside a fenced code block stay code', () => {
        const md = '```\nx\n\n\n\ny\n```'
        expect(keepBlankLines(md)).toBe(md)
    })

    test('blank lines inside a $$ math block stay math', () => {
        const md = '$$\nx\n\n\ny\n$$'
        expect(keepBlankLines(md)).toBe(md)
    })

    test('a run before an indented code block is left alone', () => {
        const md = 'a\n\n\n    code'
        expect(keepBlankLines(md)).toBe(md)
    })

    test('a spacer inside a list item takes the item indent', () => {
        expect(keepBlankLines('- a\n\n\n  more')).toContain(`  ${SPACER}`)
    })
})

describe('keepBlankLines through renderMarkdown', () => {
    test('extra blank lines survive as spacer blocks between paragraphs', () => {
        const html = renderMarkdown(keepBlankLines('a\n\n\n\nb'))
        expect(html).toContain('<p>a</p>')
        expect(html).toContain('<p>b</p>')
        expect(spacers(html)).toBe(2)
    })

    test('spacers survive around headings and lists', () => {
        const html = renderMarkdown(
            keepBlankLines('a\n\n\n- x\n\n\n## h\n\n\nc'),
        )
        expect(spacers(html)).toBe(3)
        expect(html).toContain('<li>x</li>')
        expect(html).toContain('<h2')
    })
})
