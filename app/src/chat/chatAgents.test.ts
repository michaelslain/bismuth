import { describe, expect, test } from 'bun:test'
import { nextAgent, rememberedAgentToPush } from './chatAgents'

const two = [{ value: 'build' }, { value: 'plan' }]

describe('nextAgent', () => {
    test('moves to the next agent and wraps', () => {
        expect(nextAgent(two, 'build')).toBe('plan')
        expect(nextAgent(two, 'plan')).toBe('build')
        expect(nextAgent([...two, { value: 'mine' }], 'plan')).toBe('mine')
    })
    test('a current missing from the list goes to the first', () => {
        expect(nextAgent(two, 'gone')).toBe('build')
        expect(nextAgent(two, '')).toBe('build')
    })
    test('under two entries there is nothing to cycle to', () => {
        expect(nextAgent([], 'build')).toBeNull()
        expect(nextAgent([{ value: 'build' }], 'build')).toBeNull()
    })
})

describe('rememberedAgentToPush', () => {
    const base = { resumed: false, can: true, list: two, want: 'plan', current: 'build' }
    test('a fresh session gets the remembered agent', () => {
        expect(rememberedAgentToPush(base)).toBe('plan')
    })
    test('a resumed session keeps its own agent', () => {
        expect(rememberedAgentToPush({ ...base, resumed: true })).toBeNull()
    })
    test('a backend without agents pushes nothing', () => {
        expect(rememberedAgentToPush({ ...base, can: false })).toBeNull()
    })
    test('nothing to push when unset, already current, or not in the list', () => {
        expect(rememberedAgentToPush({ ...base, want: null })).toBeNull()
        expect(rememberedAgentToPush({ ...base, want: '' })).toBeNull()
        expect(rememberedAgentToPush({ ...base, want: 'build' })).toBeNull()
        expect(rememberedAgentToPush({ ...base, want: 'gone' })).toBeNull()
    })
})
