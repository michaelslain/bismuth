// opencode 1's `session.prompt` body (v1TurnBody): the agent rides it only when one was picked.
import { describe, expect, test } from 'bun:test'
import { v1TurnBody } from '../../src/chatProviders/opencode/opencode'

const parts = [{ type: 'text', text: 'hi' }]

describe('v1TurnBody', () => {
    test('a picked agent rides the body', () => {
        expect(v1TurnBody({ agent: 'plan' }, 'anthropic/claude-x', 'sys', parts)).toEqual({
            model: { providerID: 'anthropic', modelID: 'claude-x' },
            agent: 'plan',
            system: 'sys',
            parts,
        })
    })

    test('no agent key when none was picked', () => {
        const body = v1TurnBody({}, 'anthropic/claude-x', 'sys', parts)
        expect('agent' in body).toBe(false)
        expect(body.model).toEqual({ providerID: 'anthropic', modelID: 'claude-x' })
    })

    test('an empty agent and no model leave both keys out', () => {
        const body = v1TurnBody({ agent: '' }, null, 'sys', parts)
        expect(body).toEqual({ system: 'sys', parts })
    })
})
