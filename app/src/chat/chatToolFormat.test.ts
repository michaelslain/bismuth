// app/src/chat/chatToolFormat.test.ts
// Asserts summarizeInput/prettyInput's existing outputs, unchanged by the move out of ChatView.tsx.
import { describe, expect, test } from 'bun:test'
import { prettyInput, summarizeInput } from './chatToolFormat'

describe('summarizeInput', () => {
    test('null/undefined summarize to empty', () => {
        expect(summarizeInput(null)).toBe('')
        expect(summarizeInput(undefined)).toBe('')
    })

    test('a plain string passes through unchanged', () => {
        expect(summarizeInput('hello')).toBe('hello')
    })

    test('a non-object primitive stringifies', () => {
        expect(summarizeInput(42)).toBe('42')
        expect(summarizeInput(true)).toBe('true')
    })

    test('picks the first known key in priority order', () => {
        expect(
            summarizeInput({ path: '/a/b', command: 'ls -la' }),
        ).toBe('ls -la')
        expect(summarizeInput({ file_path: '/a/b.ts' })).toBe('/a/b.ts')
        expect(summarizeInput({ pattern: 'foo*' })).toBe('foo*')
        expect(summarizeInput({ query: 'q' })).toBe('q')
        expect(summarizeInput({ url: 'https://x' })).toBe('https://x')
        expect(summarizeInput({ prompt: 'do it' })).toBe('do it')
        expect(summarizeInput({ description: 'desc' })).toBe('desc')
        expect(summarizeInput({ old_string: 'old' })).toBe('old')
        expect(summarizeInput({ content: 'body' })).toBe('body')
    })

    test('trims the matched value', () => {
        expect(summarizeInput({ command: '  ls -la  ' })).toBe('ls -la')
    })

    test('skips a blank matched value and falls through to JSON', () => {
        expect(summarizeInput({ command: '   ', other: 1 })).toBe(
            JSON.stringify({ command: '   ', other: 1 }),
        )
    })

    test('an object with none of the known keys falls back to JSON.stringify', () => {
        expect(summarizeInput({ foo: 'bar' })).toBe(
            JSON.stringify({ foo: 'bar' }),
        )
    })

    test('an unstringifiable object falls back to empty string', () => {
        const circular: Record<string, unknown> = {}
        circular.self = circular
        expect(summarizeInput(circular)).toBe('')
    })
})

describe('prettyInput', () => {
    test('a string passes through unchanged', () => {
        expect(prettyInput('raw text')).toBe('raw text')
    })

    test('pretty-prints an object with 2-space indent', () => {
        expect(prettyInput({ a: 1, b: 'x' })).toBe(
            JSON.stringify({ a: 1, b: 'x' }, null, 2),
        )
    })

    test('an unstringifiable object falls back to String()', () => {
        const circular: Record<string, unknown> = {}
        circular.self = circular
        expect(prettyInput(circular)).toBe(String(circular))
    })
})
