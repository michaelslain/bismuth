import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { aiTranscribe, resolveAiBackend } from '../src/aiTranscribe'
import { AppError } from '../src/error'
import type { HeadlessTurn } from '../src/chatProviders/headlessTurn'
import { tempDir } from './helpers'

describe('resolveAiBackend', () => {
    test('auto follows chatProvider, itself auto -> first installed', () => {
        expect(resolveAiBackend({ provider: 'auto' }, 'opencode', () => [])).toBe('opencode')
        expect(resolveAiBackend({ provider: 'auto' }, 'auto', () => ['opencode'])).toBe('opencode')
    })
    test('explicit id wins, unknown falls through', () => {
        expect(resolveAiBackend({ provider: 'opencode' }, 'claude', () => [])).toBe('opencode')
        expect(resolveAiBackend({ provider: 'nope' }, 'opencode', () => [])).toBe('opencode')
    })
})

describe('aiTranscribe', () => {
    test('one turn per page in order, image attached, temp cwd removed', async () => {
        const d = tempDir('ai-tr')
        writeFileSync(join(d, 'a.png'), 'AAA')
        writeFileSync(join(d, 'b.jpg'), 'BBB')
        const turns: HeadlessTurn[] = []
        const out = await aiTranscribe(
            [
                { page: 2, path: join(d, 'a.png') },
                { page: 1, path: join(d, 'b.jpg') },
            ],
            { provider: 'opencode', model: 'm' },
            {
                installed: () => ['opencode'],
                runTurn: async t => {
                    turns.push(t)
                    return ` text${turns.length} `
                },
            },
        )
        expect(out).toEqual([
            { page: 2, text: 'text1' },
            { page: 1, text: 'text2' },
        ])
        expect(turns[0].images).toEqual([{ media_type: 'image/png', data: Buffer.from('AAA').toString('base64') }])
        expect(turns[1].images?.[0].media_type).toBe('image/jpeg')
        expect(turns[0].model).toBe('m')
        expect(turns[0].text).toContain('$')
        expect(turns[0].text).toContain('no commentary')
        expect(existsSync(turns[0].cwd)).toBe(false)
    })
    test('not installed throws AI_UNAVAILABLE naming the backend, no claude', async () => {
        const err = await aiTranscribe([], { provider: 'opencode' }, { installed: () => [] }).catch(e => e)
        expect(err).toBeInstanceOf(AppError)
        expect(err.code).toBe('AI_UNAVAILABLE')
        expect(err.statusCode).toBe(503)
        expect(err.message).toContain('opencode')
        expect(err.message.toLowerCase()).not.toContain('claude')
    })
})
