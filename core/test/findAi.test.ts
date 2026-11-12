import { describe, expect, test } from 'bun:test'
import {
    buildAskPrompt,
    buildFindPrompt,
    findAi,
    findAiNoun,
    locatePassages,
    MAX_FIND_TEXT,
    parseAskReply,
    parseFindReply,
} from '../src/findAi'
import { AppError } from '../src/error'
import type { HeadlessTurn } from '../src/chatProviders/headlessTurn'

const NOTE = 'Groceries\n\nBuy oat milk and\nbananas on Friday.\nCall the dentist about the crown.\n'

describe('parseFindReply', () => {
    test('one passage per line, markers and quotes stripped, NONE and fences dropped', () => {
        expect(parseFindReply('NONE')).toEqual([])
        expect(parseFindReply('1. "Call the dentist"\n- `bananas`\n```\n\n• oat milk')).toEqual([
            'Call the dentist',
            'bananas',
            'oat milk',
        ])
    })
})

describe('locatePassages', () => {
    test('ranges into the real text; invented passages and overlaps dropped', () => {
        const m = locatePassages(NOTE, ['call THE dentist', 'a passage that is not there', 'the dentist', 'oat milk and bananas'])
        expect(m.map(x => x.text)).toEqual(['Call the dentist', 'oat milk and\nbananas'])
        for (const x of m) expect(NOTE.slice(x.from, x.to)).toBe(x.text)
    })
})

describe('findAi', () => {
    test('one turn on the chat provider backend, prompt carries query and text', async () => {
        const turns: HeadlessTurn[] = []
        const r = await findAi(
            { query: 'tooth appointment', text: NOTE, chatProvider: 'opencode' },
            {
                installed: () => ['opencode'],
                runTurn: async t => {
                    turns.push(t)
                    return 'Call the dentist about the crown.'
                },
            },
        )
        expect(r.backend).toBe('opencode')
        expect(r.matches).toEqual([
            { from: NOTE.indexOf('Call'), to: NOTE.indexOf('crown.') + 6, text: 'Call the dentist about the crown.' },
        ])
        expect(turns).toHaveLength(1)
        expect(turns[0].text).toBe(buildFindPrompt('tooth appointment', NOTE))
        expect(turns[0].text).toContain(NOTE)
    })

    test('NONE answers no matches', async () => {
        const r = await findAi(
            { query: 'zebra', text: NOTE, chatProvider: 'opencode' },
            { installed: () => ['opencode'], runTurn: async () => 'NONE' },
        )
        expect(r.matches).toEqual([])
    })

    test('a backend that is not installed is a 503 naming it, and no turn runs', async () => {
        let ran = false
        const err = await findAi(
            { query: 'x', text: NOTE, chatProvider: 'opencode' },
            { installed: () => [], runTurn: async () => ((ran = true), '') },
        ).catch(e => e)
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).statusCode).toBe(503)
        expect(ran).toBe(false)
    })

    test('an empty query is a 400', async () => {
        const err = await findAi({ query: '  ', text: NOTE }, { installed: () => ['opencode'] }).catch(e => e)
        expect((err as AppError).statusCode).toBe(400)
    })

    test('refusals and the empty answer name a note a note and a code or text file a file', async () => {
        expect(findAiNoun('a/Week.md')).toBe('note')
        expect(findAiNoun('src/main.ts')).toBe('file')
        expect(findAiNoun('notes.txt')).toBe('file')
        const long = 'x'.repeat(MAX_FIND_TEXT + 1)
        const tooLong = async (noun?: 'note' | 'file') =>
            ((await findAi({ query: 'q', text: long, noun }, { installed: () => ['opencode'] }).catch(e => e)) as AppError)
                .message
        expect(await tooLong()).toBe('this note is too long to ask ai about')
        expect(await tooLong('file')).toBe('this file is too long to ask ai about')
        const empty = await findAi(
            { query: 'q', text: '  ', ask: true, chatProvider: 'opencode', noun: 'file' },
            { installed: () => ['opencode'] },
        )
        expect(empty.answer).toBe('This file is empty.')
    })
})

describe('ask', () => {
    test('parseAskReply reads the JSON, even wrapped in prose or a fence', () => {
        expect(parseAskReply('```json\n{"answer": "Friday.", "passages": ["bananas on Friday.", 3, " "]}\n```')).toEqual({
            answer: 'Friday.',
            passages: ['bananas on Friday.'],
        })
        expect(parseAskReply('It does not say.')).toEqual({ answer: 'It does not say.', passages: [] })
    })

    test('one turn answers and locates the passages the answer rests on', async () => {
        const turns: HeadlessTurn[] = []
        const r = await findAi(
            { query: 'when do i buy bananas?', text: NOTE, ask: true, chatProvider: 'opencode' },
            {
                installed: () => ['opencode'],
                runTurn: async t => {
                    turns.push(t)
                    return '{"answer": "On Friday.", "passages": ["bananas on Friday.", "not in the note"]}'
                },
            },
        )
        expect(turns).toHaveLength(1)
        expect(turns[0].text).toBe(buildAskPrompt('when do i buy bananas?', NOTE))
        expect(r.answer).toBe('On Friday.')
        expect(r.matches.map(m => m.text)).toEqual(['bananas on Friday.'])
    })

    test('a search carries no answer', async () => {
        const r = await findAi(
            { query: 'zebra', text: NOTE, chatProvider: 'opencode' },
            { installed: () => ['opencode'], runTurn: async () => 'NONE' },
        )
        expect(r.answer).toBeUndefined()
    })
})
