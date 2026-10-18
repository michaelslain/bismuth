import { test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CHAT_TRASH_DIR, encodeProjectDir } from '@bismuth/memory'
import { createServer } from '../src/server'
import { readRunRecords } from '../src/runRegistry'
import { buildDenyPaths, sandboxDenyRead } from '../src/visibility'
import { buildDenyPaths as daemonBuildDenyPaths } from '../../daemon/src/lib/visibility.ts'
import {
    CHAT_TRASH_TTL_MS,
    deleteChats,
    deleteChatsInScope,
    purgeChatTrash,
    restoreChats,
    setChatVisibility,
} from '../src/chatLogs'
import { makeVault, tempDir } from './helpers'

// Chat logs are the agent CLI's session files under a temp CLAUDE_CONFIG_DIR; the run registry is
// isolated so a booted server never touches ~/.bismuth/run.
process.env.BISMUTH_RUN_DIR = tempDir('bismuth-chatlogs-run-')

let vault: string
let sessions: string
let memory: string
let savedConfig: string | undefined

/** One session file the SDK can list: a user prompt and an assistant reply. */
function writeSession(id: string, prompt = 'plan the trip') {
    const at = new Date().toISOString()
    const lines = [
        { type: 'user', sessionId: id, cwd: vault, timestamp: at, uuid: randomUUID(), message: { role: 'user', content: prompt } },
        { type: 'assistant', sessionId: id, cwd: vault, timestamp: at, uuid: randomUUID(), message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ]
    writeFileSync(join(sessions, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

beforeEach(() => {
    vault = realpathSync(makeVault({ 'note.md': '# note\n' }))
    const config = tempDir('bismuth-chatlogs-config-')
    sessions = join(config, 'projects', encodeProjectDir(vault))
    mkdirSync(sessions, { recursive: true })
    memory = join(vault, '.daemon', 'memory')
    mkdirSync(memory, { recursive: true })
    savedConfig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = config
})

afterEach(() => {
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfig
})

const settings = () => readFileSync(join(vault, '.settings'), 'utf8')

test('a hidden chat is a deny entry for both channels; chat-only only for the daemon', async () => {
    const [a, b] = [randomUUID(), randomUUID()]
    writeSession(a)
    writeSession(b)
    expect(await setChatVisibility(vault, { sessionId: a }, 'hidden')).toBe(true)
    expect(await setChatVisibility(vault, { sessionId: b }, 'chat-only')).toBe(true)
    const chatDeny = (await buildDenyPaths(vault, 'chat')).filter(e => e.kind === 'chat')
    expect(chatDeny.map(e => e.abs)).toEqual([join(sessions, `${a}.jsonl`)])
    const daemonDeny = (await buildDenyPaths(vault, 'daemon')).filter(e => e.kind === 'chat')
    expect(daemonDeny.map(e => e.abs).sort()).toEqual(
        [join(sessions, `${a}.jsonl`), join(sessions, `${b}.jsonl`)].sort(),
    )
    // The daemon's own copy of the walk agrees.
    const mirror = (await daemonBuildDenyPaths(vault)).filter(e => e.kind === 'chat')
    expect(mirror.map(e => e.abs).sort()).toEqual(daemonDeny.map(e => e.abs).sort())
})

test('the default covers every chat without its own level; Visible to all clears it', async () => {
    const [a, b] = [randomUUID(), randomUUID()]
    writeSession(a)
    writeSession(b)
    await setChatVisibility(vault, { default: true }, 'hidden')
    await setChatVisibility(vault, { sessionId: b }, 'all')
    expect(settings()).toContain('default: hidden')
    const deny = (await buildDenyPaths(vault, 'chat')).filter(e => e.kind === 'chat')
    expect(deny.map(e => e.abs)).toEqual([join(sessions, `${a}.jsonl`)])
    await setChatVisibility(vault, { default: true }, 'all')
    expect(existsSync(join(vault, '.settings')) ? settings() : '').not.toContain('default:')
})

test('hiding a chat from the daemon removes its not-yet-dreamed transcript note', async () => {
    const a = randomUUID()
    writeSession(a)
    const note = `auto-20261017-120000-${a.slice(0, 8)}.md`
    writeFileSync(join(memory, note), '---\ntype: auto\n---\nbody\n')
    await setChatVisibility(vault, { sessionId: a }, 'chat-only')
    expect(readdirSync(memory)).not.toContain(note)
})

test('an invalid .settings is refused and nothing is written', async () => {
    writeFileSync(join(vault, '.settings'), 'chatVisibility: [\n')
    expect(await setChatVisibility(vault, { sessionId: 'x' }, 'hidden')).toBe(false)
    expect(settings()).toBe('chatVisibility: [\n')
    await expect(buildDenyPaths(vault, 'chat')).rejects.toThrow()
})

test('deleteChats moves the chat to the trash, restoreChats brings it back with its level', async () => {
    const [a, b] = [randomUUID(), randomUUID()]
    writeSession(a)
    writeSession(b)
    mkdirSync(join(sessions, a))
    await setChatVisibility(vault, { sessionId: a }, 'hidden')
    writeFileSync(join(memory, `auto-20261017-120000-${a.slice(0, 8)}.md`), 'x')
    expect(await deleteChats(vault, [a, 'not-a-session', '../escape'])).toEqual([a])
    expect(existsSync(join(sessions, `${a}.jsonl`))).toBe(false)
    expect(existsSync(join(sessions, CHAT_TRASH_DIR, `${a}.jsonl`))).toBe(true)
    expect(existsSync(join(sessions, CHAT_TRASH_DIR, a))).toBe(true)
    expect(existsSync(join(sessions, `${b}.jsonl`))).toBe(true)
    expect(readdirSync(memory)).toEqual([])
    // A hidden chat stays denied while it waits in the trash.
    const deny = (await buildDenyPaths(vault, 'chat')).map(e => e.abs)
    expect(deny).toContain(join(sessions, CHAT_TRASH_DIR, `${a}.jsonl`))

    expect(await restoreChats(vault, [a])).toBe(1)
    expect(existsSync(join(sessions, `${a}.jsonl`))).toBe(true)
    expect(existsSync(join(sessions, a))).toBe(true)
    expect(settings()).toContain(`${a}: hidden`)
})

test('purgeChatTrash removes trashed chats past the undo window, with their level', async () => {
    const [a, b] = [randomUUID(), randomUUID()]
    writeSession(a)
    writeSession(b)
    await setChatVisibility(vault, { sessionId: a }, 'chat-only')
    await deleteChats(vault, [a, b])
    await purgeChatTrash(vault, Date.now() + CHAT_TRASH_TTL_MS - 1000)
    expect(existsSync(join(sessions, CHAT_TRASH_DIR, `${a}.jsonl`))).toBe(true)
    await purgeChatTrash(vault, Date.now() + CHAT_TRASH_TTL_MS + 1000)
    expect(readdirSync(join(sessions, CHAT_TRASH_DIR))).toEqual([])
    expect(existsSync(join(vault, '.settings')) ? settings() : '').not.toContain(a)
    expect(await restoreChats(vault, [a])).toBe(0)
})

test('deleteChatsInScope deletes every chat in the scope', async () => {
    for (let i = 0; i < 3; i++) writeSession(randomUUID())
    expect((await deleteChatsInScope(vault, 'all')).length).toBe(3)
    expect(readdirSync(sessions).filter(f => f.endsWith('.jsonl'))).toEqual([])
})

test('the chat visibility and delete routes are owner-only and validate their bodies', async () => {
    const a = randomUUID()
    writeSession(a)
    const server = createServer({ vault, port: 0 })
    const base = `http://localhost:${server.port}`
    const token = readRunRecords().find(r => r.vault === vault)!.token!
    const post = (path: string, body: unknown, owner = true) =>
        fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(owner ? { 'X-Bismuth-Token': token } : {}) },
            body: JSON.stringify(body),
        })
    try {
        expect((await fetch(`${base}/chat/visibility`)).status).toBe(403)
        expect((await post('/chat/visibility', { sessionId: a, level: 'hidden' }, false)).status).toBe(403)
        expect((await post('/chat/delete', { sessionIds: [a] }, false)).status).toBe(403)
        expect((await post('/chat/visibility', { sessionId: a, level: 'hiden' })).status).toBe(400)
        expect((await post('/chat/delete', { scope: 'everything' })).status).toBe(400)

        expect((await post('/chat/visibility', { sessionId: a, level: 'hidden' })).status).toBe(200)
        expect((await post('/chat/visibility', { default: 'chat-only' })).status).toBe(200)
        const def = await (await fetch(`${base}/chat/visibility`, { headers: { 'X-Bismuth-Token': token } })).json()
        expect(def).toEqual({ default: 'chat-only' })
        const list = await (
            await fetch(`${base}/chat/sessions?scope=all`, { headers: { 'X-Bismuth-Token': token } })
        ).json()
        expect(list.sessions.find((s: { sessionId: string }) => s.sessionId === a)).toMatchObject({
            visibility: 'hidden',
            ownVisibility: 'hidden',
        })

        const del = await post('/chat/delete', { sessionIds: [a] })
        expect(await del.json()).toEqual({ deleted: 1, sessionIds: [a] })
        expect(existsSync(join(sessions, `${a}.jsonl`))).toBe(false)
        expect((await post('/chat/restore', { sessionIds: [a] }, false)).status).toBe(403)
        expect((await post('/chat/restore', {})).status).toBe(400)
        expect(await (await post('/chat/restore', { sessionIds: [a] })).json()).toEqual({ restored: 1 })
        expect(existsSync(join(sessions, `${a}.jsonl`))).toBe(true)
    } finally {
        server.stop(true)
    }
})

test('hiding only chats sandboxes their files but leaves the vault .git readable', async () => {
    const a = randomUUID()
    writeSession(a)
    await setChatVisibility(vault, { sessionId: a }, 'hidden')
    const deny = sandboxDenyRead(await buildDenyPaths(vault, 'chat'), vault)
    expect(deny).toContain(join(sessions, `${a}.jsonl`))
    expect(deny).not.toContain(join(vault, '.git'))
})
