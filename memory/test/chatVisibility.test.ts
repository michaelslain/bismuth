import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, realpathSync, readdirSync } from 'node:fs'
import { sweepTempDirs, tempDir } from './tempDirs.ts'
import { join } from 'node:path'
import {
    chatVisibilityFields,
    encodeProjectDir,
    isChatVisibleTo,
    listChatSessionIds,
    readChatVisibility,
    readChatVisibilityFrom,
    removeAutoNotes,
    resolveChatVisibility,
    restrictedChatFiles,
} from '../src'

let root: string
let vault: string
let sessions: string
let savedConfig: string | undefined

beforeEach(() => {
    root = realpathSync(tempDir('chatvis-'))
    vault = join(root, 'vault')
    mkdirSync(vault)
    sessions = join(root, 'config', 'projects', encodeProjectDir(vault))
    mkdirSync(sessions, { recursive: true })
    savedConfig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
    for (const id of ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3'])
        writeFileSync(join(sessions, `${id}.jsonl`), '{}\n')
    mkdirSync(join(sessions, 'bbbbbbbb-2'))
})

afterEach(() => {
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfig
})

afterAll(sweepTempDirs)

test('a chat resolves to its own level, else the default, else all', () => {
    const r = readChatVisibilityFrom({
        chatVisibility: { default: 'chat-only', x: 'all', y: 'hidden' },
    })
    if (!r.ok) throw new Error(r.reason)
    expect(resolveChatVisibility('x', r.rules)).toBe('all')
    expect(resolveChatVisibility('y', r.rules)).toBe('hidden')
    expect(resolveChatVisibility('z', r.rules)).toBe('chat-only')
    const none = readChatVisibilityFrom({})
    if (!none.ok) throw new Error(none.reason)
    expect(resolveChatVisibility('z', none.rules)).toBe('all')
})

test('the levels mean what they mean for notes', () => {
    expect(isChatVisibleTo('all', 'daemon')).toBe(true)
    expect(isChatVisibleTo('chat-only', 'chat')).toBe(true)
    expect(isChatVisibleTo('chat-only', 'daemon')).toBe(false)
    expect(isChatVisibleTo('hidden', 'chat')).toBe(false)
})

test('a malformed chatVisibility fails closed', () => {
    expect(readChatVisibilityFrom({ chatVisibility: ['x'] }).ok).toBe(false)
    expect(readChatVisibilityFrom({ chatVisibility: { x: 'hiden' } }).ok).toBe(false)
    expect(readChatVisibilityFrom({ chatVisibility: null }).ok).toBe(true)
})

test('readChatVisibility: absent file restricts nothing, broken YAML fails closed', async () => {
    expect(await readChatVisibility(vault)).toEqual({
        ok: true,
        rules: { default: 'all', sessions: {} },
    })
    writeFileSync(join(vault, '.settings'), 'chatVisibility: [\n')
    expect((await readChatVisibility(vault)).ok).toBe(false)
})

test('restrictedChatFiles lists each hidden chat and its subagent folder, per channel', async () => {
    const rules = { default: 'all' as const, sessions: { 'aaaaaaaa-1': 'chat-only' as const, 'bbbbbbbb-2': 'hidden' as const } }
    expect((await restrictedChatFiles([vault], rules, 'chat')).sort()).toEqual([
        join(sessions, 'bbbbbbbb-2'),
        join(sessions, 'bbbbbbbb-2.jsonl'),
    ])
    expect((await restrictedChatFiles([vault], rules, 'daemon')).length).toBe(3)
    expect(await restrictedChatFiles([vault], { default: 'all', sessions: {} }, 'daemon')).toEqual([])
})

test('a restricting default covers every chat except an explicit all', async () => {
    const rules = { default: 'hidden' as const, sessions: { 'cccccccc-3': 'all' as const } }
    const files = await restrictedChatFiles([vault, vault], rules, 'chat')
    expect(files.filter(f => f.endsWith('.jsonl')).sort()).toEqual([
        join(sessions, 'aaaaaaaa-1.jsonl'),
        join(sessions, 'bbbbbbbb-2.jsonl'),
    ])
})

test('chatVisibilityFields omits all and an inherited level', () => {
    const rules = { default: 'chat-only' as const, sessions: { a: 'all' as const, b: 'hidden' as const } }
    expect(chatVisibilityFields('a', rules)).toEqual({ ownVisibility: 'all' })
    expect(chatVisibilityFields('b', rules)).toEqual({ visibility: 'hidden', ownVisibility: 'hidden' })
    expect(chatVisibilityFields('c', rules)).toEqual({ visibility: 'chat-only' })
})

test('listChatSessionIds and removeAutoNotes', async () => {
    expect((await listChatSessionIds([vault])).sort()).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3'])
    const mem = join(root, 'memory')
    mkdirSync(mem)
    writeFileSync(join(mem, 'auto-20261017-120000-aaaaaaaa.md'), 'x')
    writeFileSync(join(mem, 'auto-20261017-120001-cccccccc.md'), 'x')
    writeFileSync(join(mem, 'user-profile.md'), 'x')
    expect(await removeAutoNotes(mem, ['aaaaaaaa-1'])).toBe(1)
    expect(readdirSync(mem).sort()).toEqual(['auto-20261017-120001-cccccccc.md', 'user-profile.md'])
})
