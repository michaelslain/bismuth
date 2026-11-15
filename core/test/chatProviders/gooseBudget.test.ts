// Which goose profile a local-model chat runs, from the loaded window (gooseBudget.ts).
import { describe, expect, test } from 'bun:test'
import {
    GOOSE_LEAN_EXTENSIONS,
    gooseProfileEnv,
    gooseWindowMessage,
    pickGooseProfile,
} from '../../src/chatProviders/acp/gooseBudget'
import { CHAT_GROWTH_TOKENS } from '../../src/chatProviders/opencode/opencodeBudget'

// Opening sizes measured on a machine with 194 Claude agents and 49 skills (goose 1.59.1).
const opening = { full: 21_600, lean: 8_100 }

describe('pickGooseProfile', () => {
    test('a window with room for the full opening and a first exchange runs full', () => {
        const window = opening.full + 1_000 + CHAT_GROWTH_TOKENS
        expect(pickGooseProfile({ window, opening, extra: 1_000 })).toEqual({
            profile: 'full',
            fits: true,
            tokens: 22_600,
        })
    })

    test('a smaller window runs lean, which fits while its opening does', () => {
        expect(pickGooseProfile({ window: 16_384, opening, extra: 1_000 })).toMatchObject({
            profile: 'lean',
            fits: true,
        })
        expect(pickGooseProfile({ window: 9_100, opening, extra: 1_000 }).fits).toBe(true)
    })

    test('a window smaller than the lean opening does not fit', () => {
        expect(pickGooseProfile({ window: 4_096, opening, extra: 1_000 })).toEqual({
            profile: 'lean',
            fits: false,
            tokens: 9_100,
        })
    })
})

test('the lean profile keeps only the developer extension, through EXTENSIONS', () => {
    expect(gooseProfileEnv('full')).toEqual({})
    const env = gooseProfileEnv('lean')
    expect(Object.keys(JSON.parse(env.EXTENSIONS!))).toEqual(['developer'])
    expect(env.EXTENSIONS).toBe(GOOSE_LEAN_EXTENSIONS)
})

test('the too-small message names the window and the opening size', () => {
    const m = gooseWindowMessage({ model: 'qwen3.5:9b', window: 4096, tokens: 9_041 })
    expect(m).toContain('qwen3.5:9b')
    expect(m).toContain('4,096-token')
    expect(m).toContain('about 9,100 tokens')
})
