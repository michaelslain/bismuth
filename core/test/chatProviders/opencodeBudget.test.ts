import { describe, expect, test } from 'bun:test'
import {
    CHAT_GROWTH_TOKENS,
    estimateTokens,
    leanerTier,
    observedBase,
    opencodeUsable,
    OPENCODE_BASE_TOKENS,
    pickTier,
    tierHasBrain,
    tierOpening,
    tierProfile,
    type TurnBudget,
} from '../../src/chatProviders/opencode/opencodeBudget'
import {
    newOpencodeV2TurnState,
    stepInputTokens,
    translateOpencodeV2Event,
} from '../../src/chatProviders/opencode/opencodeV2Translate'

// A real vault's turn: Bismuth's chat note (197 tokens), its brain block (2,693) and a short message.
const budget = (window: number | null): TurnBudget => ({
    window,
    base: OPENCODE_BASE_TOKENS,
    always: 197,
    brain: 2_693,
    message: 5,
})

describe('pickTier', () => {
    test('an unknown window injects everything', () => {
        expect(pickTier(budget(null))).toBe('full')
    })

    test('a large window keeps the full prompt', () => {
        expect(pickTier(budget(64_000))).toBe('full')
        expect(pickTier(budget(262_144))).toBe('full')
    })

    test('a mid window drops to the compact profile and keeps the brain block', () => {
        expect(pickTier(budget(16_384))).toBe('brain')
        // opencode compacts a 32k window at 16k, so the full prompt leaves too little room
        expect(pickTier(budget(32_000))).toBe('brain')
    })

    test('8k and 10k windows run lean: compact profile, recall only', () => {
        expect(pickTier(budget(8_192))).toBe('lean')
        expect(pickTier(budget(10_000))).toBe('lean')
    })

    test('a window too small for any tier still picks the leanest', () => {
        expect(pickTier(budget(2_048))).toBe('lean')
    })

    test('each picked tier leaves the measured growth inside the window', () => {
        for (const w of [12_000, 16_384, 20_000, 32_000, 64_000]) {
            const b = budget(w)
            const tier = pickTier(b)
            if (tier !== 'lean')
                expect(tierOpening(tier, b) + CHAT_GROWTH_TOKENS).toBeLessThanOrEqual(
                    opencodeUsable(w),
                )
        }
    })

    test('a larger brain block pushes a window down a tier', () => {
        expect(pickTier({ ...budget(16_384), brain: 8_000 })).toBe('lean')
    })
})

describe('opencodeUsable', () => {
    test('the window less 15%, and at least 16,000 from 32k up', () => {
        expect(opencodeUsable(10_000)).toBe(8_500)
        expect(opencodeUsable(8_192)).toBe(6_964)
        expect(opencodeUsable(32_000)).toBe(16_000)
        expect(opencodeUsable(262_144)).toBe(222_823)
    })
})

describe('tiers', () => {
    test('profile and brain per tier', () => {
        expect(tierProfile('full')).toBe('default')
        expect(tierProfile('brain')).toBe('compact')
        expect(tierProfile('lean')).toBe('compact')
        expect(tierHasBrain('full')).toBe(true)
        expect(tierHasBrain('brain')).toBe(true)
        expect(tierHasBrain('lean')).toBe(false)
    })

    test('leanerTier never steps back up', () => {
        expect(leanerTier('full', 'lean')).toBe('lean')
        expect(leanerTier('lean', 'full')).toBe('lean')
        expect(leanerTier('brain', 'full')).toBe('brain')
    })
})

describe('token estimates', () => {
    test('estimateTokens uses the measured characters per token', () => {
        // The measured brain block: 9,457 characters, 2,693 tokens.
        expect(estimateTokens('x'.repeat(9_457))).toBe(2_702)
        expect(estimateTokens('')).toBe(0)
    })

    test('observedBase subtracts what Bismuth injected and the message', () => {
        expect(observedBase(9_916, 197, 19)).toBe(9_700)
        expect(observedBase(100, 197, 19)).toBeNull()
    })
})

describe('stepInputTokens', () => {
    test('input plus cache reads', () => {
        expect(stepInputTokens({ input: 1_000, cache: { read: 400 } })).toBe(1_400)
        expect(stepInputTokens({ input: 2_402, output: 11 })).toBe(2_402)
    })

    test('null without an input count', () => {
        expect(stepInputTokens(undefined)).toBeNull()
        expect(stepInputTokens({ output: 3 })).toBeNull()
        expect(stepInputTokens({ input: 0 })).toBeNull()
    })

    test('a turn keeps its first step', () => {
        const state = newOpencodeV2TurnState()
        const step = (input: number) =>
            translateOpencodeV2Event(
                { type: 'session.step.ended', data: { cost: 0, tokens: { input } } },
                state,
            )
        step(2_402)
        step(2_900)
        expect(state.firstInputTokens).toBe(2_402)
    })
})
