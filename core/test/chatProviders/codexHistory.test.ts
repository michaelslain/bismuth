// Codex chats in history: rollout files under a fake CODEX_HOME, in the shapes codex 0.158 writes
// (session_meta first, then event_msg item_completed UserMessage / AgentMessage) and the older
// user_message / agent_message shape.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    codexHistoryFrames,
    isCodexThreadId,
    listCodexChats,
    parseCodexRollout,
    restoreCodexChats,
    searchCodexChats,
    trashCodexChats,
} from '../../src/chatProviders/codex/codexHistory'

const home = mkdtempSync(join(tmpdir(), 'codex-history-'))
const env = { CODEX_HOME: home }
const vault = mkdtempSync(join(tmpdir(), 'codex-vault-'))
afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
})

const A = '01a1dc64-89e7-7f30-b617-6462d33e0464'
const B = '01a1dc65-0000-7000-8000-000000000001'
const SUB = '01a1dc66-0000-7000-8000-000000000002'
const ELSEWHERE = '01a1dc67-0000-7000-8000-000000000003'

const meta = (id: string, cwd: string, threadSource = 'user') =>
    JSON.stringify({
        type: 'session_meta',
        payload: { id, cwd, thread_source: threadSource, base_instructions: { text: 'x' } },
    })
const item = (type: string, text: string) =>
    JSON.stringify({
        type: 'event_msg',
        payload: {
            type: 'item_completed',
            item: { type, id: 'i', content: [{ type: type === 'UserMessage' ? 'text' : 'Text', text }] },
        },
    })
const injected = JSON.stringify({
    type: 'response_item',
    payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions for /vault' }],
    },
})

function rollout(id: string, lines: string[], day: string, mtime: number) {
    const dir = join(home, 'sessions', '2026', '11', day)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `rollout-2026-11-${day}T10-00-00-${id}.jsonl`)
    writeFileSync(path, lines.join('\n') + '\n')
    utimesSync(path, mtime, mtime)
}

rollout(
    A,
    [
        meta(A, vault),
        injected,
        item('UserMessage', '<editor-context>\nopen: a.md\n</editor-context>\n\nsummarize my tasks'),
        item('Reasoning', 'thinking'),
        item('AgentMessage', 'You have three tasks due.'),
    ],
    '13',
    1_800_000_000,
)
rollout(
    B,
    [
        meta(B, vault),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'older shape' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'still read' } }),
    ],
    '14',
    1_800_000_100,
)
rollout(SUB, [meta(SUB, vault, 'subagent'), item('UserMessage', 'spawned')], '14', 1_800_000_200)
rollout(ELSEWHERE, [meta(ELSEWHERE, '/somewhere/else'), item('UserMessage', 'x')], '14', 1_800_000_300)
writeFileSync(
    join(home, 'session_index.jsonl'),
    JSON.stringify({ id: B, thread_name: 'Old shape chat', updated_at: '' }) + '\n',
)

describe('codex history', () => {
    test('a Codex thread id is a version 7 UUID, never a Claude session id', () => {
        expect(isCodexThreadId(A)).toBe(true)
        expect(isCodexThreadId('0ef199f6-7c8e-4f77-821d-76e79968c2ff')).toBe(false)
        expect(isCodexThreadId('ses_e242d2f54ffeUXaxS7QRJDzuUF')).toBe(false)
    })

    test('a rollout reads as the typed messages, not the context codex injects', () => {
        const r = parseCodexRollout(
            [meta(A, vault), injected, item('UserMessage', 'hi'), item('AgentMessage', 'hello')].join('\n'),
        )
        expect(r?.frames).toEqual([
            { type: 'user-message', text: 'hi' },
            { type: 'assistant-text', text: 'hello' },
        ])
        expect(parseCodexRollout('{"type":"turn_context"}')).toBeNull()
    })

    test("lists the vault's own threads newest first, titled, without subagents or other folders", async () => {
        const rows = await listCodexChats(vault, 50, env)
        expect(rows.map(r => r.sessionId)).toEqual([B, A])
        expect(rows[0]).toMatchObject({ summary: 'Old shape chat', origin: 'user', provider: 'codex' })
        expect(rows[1]!.summary).toBe('summarize my tasks')
        expect(rows[1]!.lastModified).toBe(1_800_000_000_000)
    })

    test('replays a thread with the editor context stripped', async () => {
        expect(await codexHistoryFrames(A, env)).toEqual([
            { type: 'user-message', text: 'summarize my tasks' },
            { type: 'assistant-text', text: 'You have three tasks due.' },
        ])
        expect(await codexHistoryFrames('0ef199f6-7c8e-4f77-821d-76e79968c2ff', env)).toEqual([])
    })

    test('search matches title and message text', async () => {
        const hits = await searchCodexChats(vault, 'three tasks', env)
        expect(hits.map(h => h.sessionId)).toEqual([A])
        expect(hits[0]!.provider).toBe('codex')
        expect((await searchCodexChats(vault, 'old shape', env)).map(h => h.sessionId)).toEqual([B])
    })

    test('a deleted chat hides until restored', async () => {
        expect(trashCodexChats([A, 'ses_x'], vault)).toEqual([A])
        expect((await listCodexChats(vault, 50, env)).map(r => r.sessionId)).toEqual([B])
        expect(restoreCodexChats([A])).toEqual([A])
        expect((await listCodexChats(vault, 50, env)).map(r => r.sessionId)).toEqual([B, A])
    })
})
