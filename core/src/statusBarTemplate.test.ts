import { describe, expect, test } from 'bun:test'
import { renderStatusTemplate, templateTokens } from './statusBarTemplate'

describe('statusBarTemplate', () => {
    test('substitutes tokens', () => {
        expect(renderStatusTemplate('files: {files}', { files: 412 })).toBe('files: 412')
    })
    test('unknown or undefined token renders empty', () => {
        expect(renderStatusTemplate('{nope}', {})).toBe('')
        expect(renderStatusTemplate('a {x} b', { x: undefined })).toBe('a  b')
    })
    test('double braces are literal', () => {
        expect(renderStatusTemplate('{{x}}', { x: 1 })).toBe('{x}')
    })
    test('result is trimmed', () => {
        expect(renderStatusTemplate('  {a}  ', { a: 'z' })).toBe('z')
    })
    test('templateTokens lists referenced names', () => {
        expect(templateTokens('{a} {tasks.due} {{b}}')).toEqual(new Set(['a', 'tasks.due']))
    })
})
