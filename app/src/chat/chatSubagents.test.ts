import { describe, expect, test } from 'bun:test'
import type { ChatSubagent } from '../../../core/src/chatSubagentTypes'
import { upsertSubagent } from './chatSubagents'

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
