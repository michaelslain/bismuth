// Each private-chat eraser removes exactly the chat's own records from a fake store laid out the way
// that CLI writes it, and leaves every other conversation alone.
import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tempDir } from '../helpers'
import { join } from 'node:path'
import {
    eraseClaudeSession,
    eraseClineSession,
    eraseCodexThread,
    eraseGeminiSession,
    eraseGooseLogs,
    eraseHermesSession,
    eraseOpenclawSession,
    type EraseContext,
} from '../../src/chatProviders/privateErase'

const ID = '01a0e1c5-c04a-7b80-a630-8649fe561bf2'
const OTHER = '99999999-0000-7000-8000-000000000000'
const dirs: string[] = []
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function home(): string {
    const d = tempDir('bismuth-erase-')
    dirs.push(d)
    return d
}
function put(path: string, text = 'secret'): string {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    return path
}
function ctx(h: string, extra: Partial<EraseContext> = {}): EraseContext {
    return { sessionId: ID, chatId: 'private-c1', cwd: h, startedAt: 0, env: { HOME: h }, ...extra }
}

describe('eraseCodexThread', () => {
    test('removes the rollout, snapshot, index line and sqlite rows of one thread only', async () => {
        const h = home()
        const root = join(h, '.codex')
        const mine = put(join(root, 'sessions/2026/10/17', `rollout-2026-10-17T10-00-00-${ID}.jsonl`))
        const theirs = put(join(root, 'sessions/2026/10/17', `rollout-2026-10-17T10-00-00-${OTHER}.jsonl`))
        const archived = put(join(root, 'archived_sessions', `rollout-x-${ID}.jsonl`))
        const snap = put(join(root, 'shell_snapshots', `${ID}.sh`))
        put(
            join(root, 'session_index.jsonl'),
            `{"id":"${ID}","thread_name":"a"}\n{"id":"${OTHER}","thread_name":"b"}\n`,
        )
        const state = new Database(join(root, 'state_5.sqlite'))
        state.exec('CREATE TABLE threads (id TEXT, title TEXT); CREATE TABLE thread_attachments (thread_id TEXT)')
        state.query('INSERT INTO threads VALUES (?, ?), (?, ?)').run(ID, 'mine', OTHER, 'theirs')
        state.query('INSERT INTO thread_attachments VALUES (?)').run(ID)
        state.close()
        const hist = new Database(join(root, 'thread_history_1.sqlite'))
        hist.exec('CREATE TABLE thread_items (thread_id TEXT, item_json TEXT)')
        hist.query('INSERT INTO thread_items VALUES (?, ?), (?, ?)').run(ID, 'secret', OTHER, 'kept')
        hist.close()

        await eraseCodexThread(ctx(h))

        expect([mine, archived, snap].map(existsSync)).toEqual([false, false, false])
        expect(existsSync(theirs)).toBe(true)
        expect(readFileSync(join(root, 'session_index.jsonl'), 'utf8')).not.toContain(ID)
        expect(readFileSync(join(root, 'session_index.jsonl'), 'utf8')).toContain(OTHER)
        const s2 = new Database(join(root, 'state_5.sqlite'))
        expect(s2.query('SELECT id FROM threads').all()).toEqual([{ id: OTHER }])
        expect(s2.query('SELECT * FROM thread_attachments').all()).toEqual([])
        s2.close()
        const h2 = new Database(join(root, 'thread_history_1.sqlite'))
        expect(h2.query('SELECT thread_id FROM thread_items').all()).toEqual([{ thread_id: OTHER }])
        h2.close()
    })

    test('honours CODEX_HOME and does nothing without a thread id', async () => {
        const h = home()
        const f = put(join(h, 'alt', 'sessions', `rollout-x-${ID}.jsonl`))
        await eraseCodexThread(ctx(h, { sessionId: '', env: { HOME: h, CODEX_HOME: join(h, 'alt') } }))
        expect(existsSync(f)).toBe(true)
        await eraseCodexThread(ctx(h, { env: { HOME: h, CODEX_HOME: join(h, 'alt') } }))
        expect(existsSync(f)).toBe(false)
    })
})

test('eraseClaudeSession removes the transcript and subagent dir from any project', async () => {
    const h = home()
    const t = put(join(h, '.claude/projects/-some-vault', `${ID}.jsonl`))
    const sub = put(join(h, '.claude/projects/-some-vault', ID, 'subagents/a.jsonl'))
    const other = put(join(h, '.claude/projects/-some-vault', `${OTHER}.jsonl`))
    await eraseClaudeSession(ctx(h))
    expect([existsSync(t), existsSync(sub), existsSync(other)]).toEqual([false, false, true])
})

test('eraseGeminiSession removes the chat, log, tool outputs and session dir', async () => {
    const h = home()
    const p = join(h, '.gemini/tmp/proj')
    const files = [
        put(join(p, 'chats', `session-2026-10-17T10-00-${ID.slice(0, 8)}.jsonl`)),
        put(join(p, 'logs', `session-${ID}.jsonl`)),
        put(join(p, 'tool-outputs', `session-${ID}`, 'out.txt')),
        put(join(p, ID, 'x')),
    ]
    const other = put(join(p, 'chats', `session-2026-10-17T10-00-${OTHER.slice(0, 8)}.jsonl`))
    await eraseGeminiSession(ctx(h))
    expect(files.map(existsSync)).toEqual([false, false, false, false])
    expect(existsSync(other)).toBe(true)
})

test('eraseGooseLogs removes only request logs written since the chat started', async () => {
    const h = home()
    const logs = join(h, '.local/state/goose/logs')
    const old = put(join(logs, 'llm_request.a.jsonl'))
    utimesSync(old, new Date(1000), new Date(1000))
    const fresh = put(join(logs, 'llm_request.b.jsonl'))
    const unrelated = put(join(logs, 'cli.log'))
    await eraseGooseLogs(ctx(h, { startedAt: Date.now() - 60_000 }))
    expect([existsSync(old), existsSync(fresh), existsSync(unrelated)]).toEqual([true, false, true])
})

test('eraseClineSession runs history delete and removes the session dir', async () => {
    const h = home()
    const dir = put(join(h, '.cline/data/sessions', ID, `${ID}.messages.json`))
    const runs: string[][] = []
    await eraseClineSession(ctx(h, { bin: '/bin/cline', run: async argv => void runs.push(argv) }))
    expect(runs).toEqual([['/bin/cline', 'history', 'delete', '--session-id', ID]])
    expect(existsSync(dir)).toBe(false)
})

test('eraseOpenclawSession deletes the key and the archive the delete leaves', async () => {
    const h = home()
    const sessions = join(h, '.openclaw/agents/main/sessions')
    const before = put(join(sessions, 'old.jsonl.deleted.1'))
    utimesSync(before, new Date(1000), new Date(1000))
    const runs: string[][] = []
    let archive = ''
    await eraseOpenclawSession(
        ctx(h, {
            bin: 'openclaw',
            run: async argv => {
                runs.push(argv)
                archive = put(join(sessions, 'abc.jsonl.deleted.2'))
            },
        }),
    )
    expect(runs).toEqual([['openclaw', 'sessions', 'delete', 'agent:main:bismuth-private-c1', '--yes']])
    expect(existsSync(archive)).toBe(false)
    expect(existsSync(before)).toBe(true)
})

test('eraseHermesSession runs sessions delete', async () => {
    const runs: string[][] = []
    await eraseHermesSession(ctx(home(), { bin: 'hermes', run: async argv => void runs.push(argv) }))
    expect(runs).toEqual([['hermes', 'sessions', 'delete', ID, '--yes']])
})
