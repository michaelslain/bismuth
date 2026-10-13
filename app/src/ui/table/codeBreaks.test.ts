import { describe, expect, test } from 'bun:test'
import { codeBreaks } from './codeBreaks'

describe('codeBreaks', () => {
    test('a path breaks after each slash and before each dot', () => {
        expect(codeBreaks('app/src/chat/ChatTextBubble.module.css')).toEqual([
            'app/',
            'src/',
            'chat/',
            'ChatTextBubble',
            '.module',
            '.css',
        ])
    })
    test('a flag, a scheme and a dotfile stay whole', () => {
        expect(codeBreaks('--since')).toEqual(['--since'])
        expect(codeBreaks('http://localhost:6201')).toEqual([
            'http://localhost:6201',
        ])
        expect(codeBreaks('.env')).toEqual(['.env'])
    })
    test('snake and kebab words break after the joint', () => {
        expect(codeBreaks('max_tokens')).toEqual(['max_', 'tokens'])
        expect(codeBreaks('table-layout')).toEqual(['table-', 'layout'])
    })
    test('the pieces always rejoin to the input', () => {
        for (const s of ['', 'a', 'a/b/c.d', 'x=1&y=2', '  a  b ', 'é/ü.ß'])
            expect(codeBreaks(s).join('')).toBe(s)
    })
})
