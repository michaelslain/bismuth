import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../src/registry'
import { encodeProjectDir } from '../../memory/src'
import { commandTier } from '../../core/src/visibilityCliGate'

// `history` runs IN-PROCESS against a temp CLAUDE_CONFIG_DIR holding hand-written session logs.

let root: string
let vault: string
let sessions: string
const saved: Record<string, string | undefined> = {}
const ENV = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SESSION_ID', 'BISMUTH_VAULT']

const entry = (role: 'user' | 'assistant', text: string, timestamp: string) =>
    JSON.stringify({
        type: role,
        timestamp,
        message: { role, content: role === 'user' ? text : [{ type: 'text', text }] },
    })

function writeSession(id: string, lines: string[], mtime: Date) {
    const file = join(sessions, `${id}.jsonl`)
    writeFileSync(file, lines.join('\n') + '\n')
    utimesSync(file, mtime, mtime)
}

beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'history-')))
    vault = join(root, 'my vault')
    mkdirSync(vault)
    sessions = join(root, 'config', 'projects', encodeProjectDir(vault))
    mkdirSync(sessions, { recursive: true })
    for (const k of ENV) {
        saved[k] = process.env[k]
        delete process.env[k]
    }
    process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
    writeSession(
        'party',
        [
            entry('user', 'should i go to the bside event tonight', '2026-10-09T18:00:00'),
            entry('assistant', 'Go for an hour.', '2026-10-09T18:00:05'),
            entry('user', 'ok', '2026-10-09T18:10:00'),
            entry('assistant', 'Good.', '2026-10-09T18:10:02'),
        ],
        new Date('2026-10-09T18:10:02'),
    )
    writeSession(
        'homework',
        [
            entry('user', 'help with data science homework', '2026-10-08T10:00:00'),
            entry('assistant', 'Sure.', '2026-10-08T10:00:03'),
        ],
        new Date('2026-10-08T10:00:03'),
    )
})

afterEach(() => {
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
    rmSync(root, { recursive: true, force: true })
})

async function run(phrase: string, args: string[]) {
    const lines: string[] = []
    const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    const err = spyOn(console, 'error').mockImplementation(() => {})
    const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`)
    }) as never)
    try {
        await registry[phrase].run(args)
    } finally {
        log.mockRestore()
        err.mockRestore()
        exit.mockRestore()
    }
    return JSON.parse(lines.join('\n'))
}

test('history --on returns that day’s sessions with their turns', async () => {
    const r = await run('history', ['--on', '2026-10-09', '--vault', vault])
    expect(r.count).toBe(1)
    expect(r.sessions[0].id).toBe('party')
    expect(r.sessions[0].turnCount).toBe(2)
    expect(r.sessions[0].turns[0].you).toBe('should i go to the bside event tonight')
})

test('history with words returns only the matching turns, across the --all range', async () => {
    const r = await run('history', ['bside', '--all', '--vault', vault])
    expect(r.count).toBe(1)
    expect(r.sessions[0].turns.map((t: { claude: string }) => t.claude)).toEqual(['Go for an hour.'])
    const none = await run('history', ['essay', '--all', '--vault', vault])
    expect(none.count).toBe(0)
})

test('history skips the session that is asking', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'party'
    const r = await run('history', ['--all', '--vault', vault])
    expect(r.sessions.map((s: { id: string }) => s.id)).toEqual(['homework'])
})

test('history show prints one session', async () => {
    const r = await run('history show', ['homework', '--vault', vault])
    expect(r.id).toBe('homework')
    expect(r.turns[0].claude).toBe('Sure.')
})

test('a vault with no session logs returns an empty list', async () => {
    rmSync(sessions, { recursive: true })
    const r = await run('history', ['--all', '--vault', vault])
    expect(r.count).toBe(0)
})

test('history is refused for an agent in a restricted vault, like chat', () => {
    expect(commandTier(['history', 'bside'])).toBe('refuse-when-restricted')
    expect(commandTier(['history', 'show', 'x'])).toBe('refuse-when-restricted')
})
