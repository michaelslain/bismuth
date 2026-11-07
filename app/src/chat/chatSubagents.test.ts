import { describe, expect, test } from 'bun:test'
import type { ChatSubagent } from '../../../core/src/chatSubagentTypes'
import { settleSubagents, upsertSubagent } from './chatSubagents'

const a = (id: string, status: ChatSubagent['status']): ChatSubagent => ({
    id,
    agentType: 'Explore',
    description: `job ${id}`,
    status,
})

describe('upsertSubagent', () => {
    test('appends a new id in dispatch order', () => {
        const list = upsertSubagent([a('1', 'running')], a('2', 'running'))
        expect(list.map(x => x.id)).toEqual(['1', '2'])
    })
    test('replaces an existing id in place', () => {
        const list = upsertSubagent(
            [a('1', 'running'), a('2', 'running')],
            a('1', 'done'),
        )
        expect(list.map(x => `${x.id}:${x.status}`)).toEqual([
            '1:done',
            '2:running',
        ])
    })
    test('does not mutate its input', () => {
        const before = [a('1', 'running')]
        upsertSubagent(before, a('1', 'done'))
        expect(before[0].status).toBe('running')
    })
})

describe('settleSubagents', () => {
    test('keeps the list while any row runs', () => {
        const list = [a('1', 'done'), a('2', 'running')]
        expect(settleSubagents(list)).toBe(list)
    })
    test('clears once every row is done or failed', () => {
        expect(settleSubagents([a('1', 'done'), a('2', 'failed')])).toEqual([])
    })
    test('a late done frame for a cleared row does not bring the strip back', () => {
        expect(settleSubagents(upsertSubagent([], a('1', 'done')))).toEqual([])
    })
})
