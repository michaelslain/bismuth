import { describe, expect, test } from 'bun:test'
import {
    newSubagentRoster,
    observeSubagentFrame,
} from '../src/chatSubagentRoster'

const use = (id: string, name: string, input: unknown) =>
    ({ type: 'tool-use', id, name, input }) as const
const result = (id: string, content = 'ok', isError = false) =>
    ({ type: 'tool-result', id, content, isError }) as const

describe('subagent roster', () => {
    test('a foreground Agent call runs then finishes done', () => {
        const r = newSubagentRoster()
        expect(
            observeSubagentFrame(
                r,
                use('t1', 'Agent', {
                    subagent_type: 'Explore',
                    description: 'find x',
                }),
            ),
        ).toEqual([
            {
                type: 'subagent',
                id: 't1',
                agentType: 'Explore',
                description: 'find x',
                status: 'running',
            },
        ])
        expect(observeSubagentFrame(r, result('t1'))).toEqual([
            {
                type: 'subagent',
                id: 't1',
                agentType: 'Explore',
                description: 'find x',
                status: 'done',
            },
        ])
    })

    test('the older Task tool name works and defaults fill in', () => {
        const r = newSubagentRoster()
        expect(observeSubagentFrame(r, use('t1', 'Task', {}))).toEqual([
            {
                type: 'subagent',
                id: 't1',
                agentType: 'agent',
                description: '',
                status: 'running',
            },
        ])
    })

    test('an error result is failed', () => {
        const r = newSubagentRoster()
        observeSubagentFrame(r, use('t1', 'Agent', {}))
        const out = observeSubagentFrame(r, result('t1', 'boom', true))
        expect(out.map(f => f.status)).toEqual(['failed'])
    })

    test('a backgrounded call stays running until its notification', () => {
        const r = newSubagentRoster()
        observeSubagentFrame(r, use('t1', 'Agent', { description: 'bg' }))
        expect(r.taskStarted({ tool_use_id: 't1' })).toEqual([])
        expect(
            observeSubagentFrame(
                r,
                result('t1', 'Agent is running in the background'),
            ),
        ).toEqual([])
        expect(
            r.taskNotification({ tool_use_id: 't1', status: 'completed' }),
        ).toMatchObject([{ id: 't1', status: 'done' }])
    })

    test('run_in_background input keeps it running', () => {
        const r = newSubagentRoster()
        observeSubagentFrame(r, use('t1', 'Agent', { run_in_background: true }))
        expect(observeSubagentFrame(r, result('t1'))).toEqual([])
    })

    test('stopped and failed notifications are failed', () => {
        const r = newSubagentRoster()
        observeSubagentFrame(r, use('a', 'Agent', { run_in_background: true }))
        observeSubagentFrame(r, use('b', 'Agent', { run_in_background: true }))
        expect(
            r.taskNotification({ tool_use_id: 'a', status: 'stopped' }),
        ).toMatchObject([{ id: 'a', status: 'failed' }])
        expect(
            r.taskNotification({ tool_use_id: 'b', status: 'failed' }),
        ).toMatchObject([{ id: 'b', status: 'failed' }])
    })

    test('task_started for an unseen id adds a running row; skipped ones are ignored', () => {
        const r = newSubagentRoster()
        expect(
            r.taskStarted({
                tool_use_id: 'x',
                subagent_type: 'Plan',
                description: 'plan it',
            }),
        ).toEqual([
            {
                type: 'subagent',
                id: 'x',
                agentType: 'Plan',
                description: 'plan it',
                status: 'running',
            },
        ])
        expect(
            r.taskStarted({ tool_use_id: 'y', skip_transcript: true }),
        ).toEqual([])
        expect(r.taskStarted({ description: 'no id' })).toEqual([])
        expect(
            r.taskStarted({ tool_use_id: 'z', task_type: 'local_bash' }),
        ).toEqual([])
    })

    test('opencode task tool', () => {
        const r = newSubagentRoster()
        expect(
            observeSubagentFrame(
                r,
                use('c1', 'task', {
                    subagent_type: 'general',
                    description: 'd',
                }),
            ),
        ).toMatchObject([{ agentType: 'general', status: 'running' }])
        expect(observeSubagentFrame(r, result('c1'))).toMatchObject([
            { status: 'done' },
        ])
    })

    test('unrelated tools emit nothing', () => {
        const r = newSubagentRoster()
        expect(observeSubagentFrame(r, use('b1', 'Bash', {}))).toEqual([])
        expect(observeSubagentFrame(r, result('b1'))).toEqual([])
        expect(observeSubagentFrame(r, { type: 'assistant-text' })).toEqual([])
    })

    test('the same status twice emits nothing', () => {
        const r = newSubagentRoster()
        observeSubagentFrame(r, use('t1', 'Agent', {}))
        expect(observeSubagentFrame(r, use('t1', 'Agent', {}))).toEqual([])
        observeSubagentFrame(r, result('t1'))
        expect(observeSubagentFrame(r, result('t1'))).toEqual([])
        expect(
            r.taskNotification({ tool_use_id: 't1', status: 'completed' }),
        ).toEqual([])
    })
})

describe('opencode translators emit subagent frames', () => {
    test('v2: tool.input.started + tool.called + tool.success for task', async () => {
        const { newOpencodeV2TurnState, translateOpencodeV2Event } =
            await import('../src/chatProviders/opencode/opencodeV2Translate')
        const state = newOpencodeV2TurnState()
        const ev = (type: string, data: Record<string, unknown>) =>
            translateOpencodeV2Event({ type, data }, state)
        ev('session.tool.input.started', { id: 'c1', name: 'task' })
        const called = ev('session.tool.called', {
            id: 'c1',
            input: { subagent_type: 'general', description: 'look' },
        })
        expect(called.map(f => f.type)).toEqual(['tool-use', 'subagent'])
        const ok = ev('session.tool.success', {
            id: 'c1',
            content: [{ type: 'text', text: 'done' }],
        })
        expect(ok.map(f => f.type)).toEqual(['tool-result', 'subagent'])
        expect(ok[1]).toMatchObject({ id: 'c1', status: 'done' })
    })

    test('server and run mode: a task part runs then completes; replay emits none', async () => {
        const t =
            await import('../src/chatProviders/opencode/opencodeTranslate')
        const part = (status: string) => ({
            type: 'tool',
            tool: 'task',
            callID: 'c1',
            state: {
                status,
                input: { subagent_type: 'general', description: 'look' },
                output: 'ok',
            },
        })
        const server = t.newOpencodeServerTurnState()
        const run = (status: string) =>
            t.translateOpencodeServerEvent(
                {
                    type: 'message.part.updated',
                    properties: { part: part(status) },
                },
                server,
            )
        const pending = t.translateOpencodeServerEvent(
            {
                type: 'message.part.updated',
                properties: {
                    part: {
                        type: 'tool',
                        tool: 'task',
                        callID: 'c1',
                        state: { status: 'pending', input: {} },
                    },
                },
            },
            server,
        )
        expect(pending.map(f => f.type)).toEqual(['tool-use'])
        const running = run('running')
        expect(running.map(f => f.type)).toEqual(['subagent'])
        expect(running[0]).toMatchObject({
            agentType: 'general',
            description: 'look',
        })
        expect(run('completed').map(f => f.type)).toEqual([
            'tool-result',
            'subagent',
        ])
        const cli = t.newOpencodeTurnState()
        const out = t.translateOpencodeEvent(
            { type: 'tool_use', part: part('error') },
            cli,
        )
        expect(out.filter(f => f.type === 'subagent')).toMatchObject([
            { status: 'running' },
            { status: 'failed' },
        ])
    })
})
