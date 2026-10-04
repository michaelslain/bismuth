import { describe, expect, test } from 'bun:test'
import { LanguageDescription } from '@codemirror/language'
import { codeLanguages, EXTRA_ALIASES } from './codeLanguages'

const match = (info: string) => LanguageDescription.matchLanguageName(codeLanguages, info, true)?.name

describe('codeLanguages', () => {
    test('```matlab resolves to the Octave mode', () => {
        expect(match('matlab')).toBe('Octave')
        expect(match('MATLAB')).toBe('Octave')
    })

    test('the other extra aliases resolve', () => {
        expect(match('py')).toBe('Python')
        expect(match('jl')).toBe('Julia')
        expect(match('hs')).toBe('Haskell')
    })

    test('stock names still resolve', () => {
        expect(match('octave')).toBe('Octave')
        expect(match('python')).toBe('Python')
        expect(match('bash')).toBe('Shell')
    })

    test('every aliased name exists in the stock list', () => {
        const names = new Set(codeLanguages.map(d => d.name))
        for (const name of Object.keys(EXTRA_ALIASES)) expect(names.has(name)).toBe(true)
    })

    test('the matlab entry actually loads a parser', async () => {
        const support = await LanguageDescription.matchLanguageName(codeLanguages, 'matlab')!.load()
        expect(support.language.name).toBe('octave')
    })

    test('`function` is a keyword, `sum` stays a builtin', async () => {
        const { octave } = await import('@codemirror/legacy-modes/mode/octave')
        const support = await LanguageDescription.matchLanguageName(codeLanguages, 'matlab')!.load()
        const { StringStream } = await import('@codemirror/language')
        const parser = (support.language as unknown as { streamParser: typeof octave }).streamParser
        const tokens = (line: string) => {
            const stream = new StringStream(line, 4, 4)
            const state = parser.startState!(4)
            const out: [string, string | null][] = []
            while (!stream.eol()) {
                const style = parser.token(stream, state)
                if (stream.current().trim()) out.push([stream.current(), style])
                stream.start = stream.pos
            }
            return out
        }
        expect(tokens('function y = f(x)')[0]).toEqual(['function', 'keyword'])
        expect(tokens('y = sum(x)')).toContainEqual(['sum', 'builtin'])
    })
})
