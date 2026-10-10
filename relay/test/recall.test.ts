import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const BIN = join(import.meta.dir, '..', 'bin')

type Hit = { path: string; body: any; channel: string | null }
let hits: Hit[] = []
let mode: 'ok' | '500' | 'slow' = 'ok'

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const path = new URL(req.url).pathname
        const body = await req.json().catch(() => null)
        hits.push({ path, body, channel: req.headers.get('x-bismuth-channel') })
        if (path !== '/memory/recall') return new Response('{}')
        if (mode === '500') return new Response('boom', { status: 500 })
        if (mode === 'slow') await Bun.sleep(4000)
        return Response.json({ context: 'CTX', injected: ['a'] })
    },
})
afterAll(() => server.stop(true))
beforeEach(() => {
    hits = []
    mode = 'ok'
})

async function run(
    script: string,
    input: object,
    env: Record<string, string | undefined> = {},
) {
    const proc = Bun.spawn(['bun', 'run', join(BIN, script)], {
        stdin: new Blob([JSON.stringify(input)]),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            CLAUDE_TERMINAL_ID: 't1',
            CLAUDE_RELAY_URL: `http://localhost:${server.port}`,
            BISMUTH_MEMORY_DIR: '/tmp/mem',
            ...env,
        },
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return { out, code: proc.exitCode }
}

const recallHits = () => hits.filter(h => h.path === '/memory/recall')
const expected = (event: string) =>
    JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: 'CTX' },
    })

describe('relay hooks call /memory/recall', () => {
    test('session start posts source + registers, prints SessionStart', async () => {
        const r = await run('session-start-hook.ts', {
            session_id: 's1',
            cwd: '/x',
            source: 'resume',
            transcript_path: '/t.jsonl',
        })
        expect(r.out).toBe(expected('SessionStart'))
        expect(recallHits()[0].body).toEqual({
            mode: 'session-start',
            sessionId: 's1',
            source: 'resume',
            transcriptPath: '/t.jsonl',
        })
        expect(hits.some(h => h.path === '/relay/session')).toBe(true)
    })

    test('prompt hook posts the prompt, prints UserPromptSubmit', async () => {
        const r = await run('recall-hook.ts', {
            session_id: 's1',
            prompt: 'hello there',
            transcript_path: '/t.jsonl',
        })
        expect(r.out).toBe(expected('UserPromptSubmit'))
        expect(recallHits()[0].body).toEqual({
            mode: 'prompt',
            sessionId: 's1',
            prompt: 'hello there',
            transcriptPath: '/t.jsonl',
        })
        expect(hits.some(h => h.path === '/relay/session')).toBe(true)
    })

    test('tool batch caps tool_response at 2000 chars, passes agentId', async () => {
        const r = await run('tool-batch-hook.ts', {
            session_id: 's1',
            agent_id: 'a9',
            tool_calls: [
                {
                    tool_name: 'Read',
                    tool_input: { file_path: '/a' },
                    tool_use_id: 'u1',
                    tool_response: 'x'.repeat(5000),
                },
                { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' },
            ],
        })
        expect(r.out).toBe(expected('PostToolBatch'))
        const body = recallHits()[0].body
        expect(body.mode).toBe('tool')
        expect(body.sessionId).toBe('s1')
        expect(body.agentId).toBe('a9')
        expect(body.toolCalls).toHaveLength(2)
        expect(body.toolCalls[0].tool_response).toHaveLength(2000)
        expect(body.toolCalls[0].tool_input).toEqual({ file_path: '/a' })
        expect(body.toolCalls[1].tool_response).toBe('ok')
        expect(hits.some(h => h.path.startsWith('/relay'))).toBe(false)
    })

    test('subagent start registers + posts agentId, prints SubagentStart', async () => {
        const r = await run('subagent-start-hook.ts', {
            session_id: 's1',
            agent_id: 'a1',
            agent_type: 'Explore',
            transcript_path: '/t.jsonl',
        })
        expect(r.out).toBe(expected('SubagentStart'))
        expect(recallHits()[0].body).toEqual({
            mode: 'subagent',
            sessionId: 's1',
            agentId: 'a1',
            transcriptPath: '/t.jsonl',
        })
        expect(hits.some(h => h.path === '/relay/subagent/start')).toBe(true)
    })

    const cases: [string, object][] = [
        ['session-start-hook.ts', { session_id: 's1', source: 'startup' }],
        ['recall-hook.ts', { session_id: 's1', prompt: 'p' }],
        [
            'tool-batch-hook.ts',
            { session_id: 's1', tool_calls: [{ tool_name: 'Bash', tool_input: {} }] },
        ],
        ['subagent-start-hook.ts', { session_id: 's1', agent_id: 'a1' }],
    ]

    for (const [script, input] of cases) {
        test(`${script}: no stdout on 500`, async () => {
            mode = '500'
            const r = await run(script, input)
            expect(r.out).toBe('')
            expect(r.code).toBe(0)
        })
        test(`${script}: no stdout on timeout`, async () => {
            mode = 'slow'
            const t = Date.now()
            const r = await run(script, input)
            expect(r.out).toBe('')
            expect(r.code).toBe(0)
            expect(Date.now() - t).toBeLessThan(3500)
        }, 10000)
        test(`${script}: no stdout when core unreachable`, async () => {
            const r = await run(script, input, {
                CLAUDE_RELAY_URL: 'http://127.0.0.1:1',
            })
            expect(r.out).toBe('')
            expect(r.code).toBe(0)
        })
        test(`${script}: gated on BISMUTH_MEMORY_DIR + CLAUDE_TERMINAL_ID`, async () => {
            let r = await run(script, input, { BISMUTH_MEMORY_DIR: '' })
            expect(r.out).toBe('')
            expect(recallHits()).toHaveLength(0)
            hits = []
            r = await run(script, input, { CLAUDE_TERMINAL_ID: '' })
            expect(r.out).toBe('')
            expect(hits).toHaveLength(0)
        })
    }
})

test('recall requests carry the chat channel header', async () => {
    await run('session-start-hook.ts', { session_id: 's1', cwd: '/x', source: 'startup' })
    expect(recallHits().length).toBeGreaterThan(0)
    expect(recallHits().every(h => h.channel === 'chat')).toBe(true)
})
