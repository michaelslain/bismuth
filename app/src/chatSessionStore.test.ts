import { test, expect, beforeEach } from 'bun:test'
import { rememberChatSession, recallChatSession } from './chatSessionStore'

/** Minimal in-memory Storage stub (Bun test env has no localStorage). */
function installMemoryStorage(): Map<string, string> {
    const map = new Map<string, string>()
    ;(globalThis as any).localStorage = {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => {
            map.set(k, String(v))
        },
        removeItem: (k: string) => {
            map.delete(k)
        },
    }
    return map
}
beforeEach(() => {
    installMemoryStorage()
})

test('remember then recall round-trips through localStorage', () => {
    rememberChatSession('chat-1', 'sess-1')
    rememberChatSession('chat-2', 'sess-2')
    expect(recallChatSession('chat-1')).toBe('sess-1')
    expect(recallChatSession('chat-2')).toBe('sess-2')
    expect(recallChatSession('chat-3')).toBeNull()
})

test("remember overwrites a tab's session when the conversation changes (New / resume)", () => {
    rememberChatSession('chat-1', 'sess-old')
    rememberChatSession('chat-1', 'sess-new')
    expect(recallChatSession('chat-1')).toBe('sess-new')
})

test('recall survives a fresh module read of the same storage (relaunch / cross-window)', () => {
    rememberChatSession('chat-1', 'sess-1')
    // Same shared localStorage, as another window / a relaunch would see it.
    expect(recallChatSession('chat-1')).toBe('sess-1')
})

test('rememberChatSession ignores empty ids', () => {
    rememberChatSession('', 'sess')
    rememberChatSession('chat', '')
    expect(recallChatSession('')).toBeNull()
    expect(recallChatSession('chat')).toBeNull()
})

test('tolerates malformed stored JSON', () => {
    ;(globalThis as any).localStorage.setItem(
        'bismuth-chat-sessions-v1',
        '{not json',
    )
    expect(recallChatSession('chat-1')).toBeNull()
    rememberChatSession('chat-1', 'sess-1')
    expect(recallChatSession('chat-1')).toBe('sess-1')
})

test('filters out malformed entries in the stored array', () => {
    ;(globalThis as any).localStorage.setItem(
        'bismuth-chat-sessions-v1',
        JSON.stringify([
            { chatId: 'ok', sessionId: 's' },
            { chatId: 3 },
            null,
            'x',
            { sessionId: 'no-chat' },
        ]),
    )
    expect(recallChatSession('ok')).toBe('s')
})

test('remember caps the stored list at 50, dropping the oldest', () => {
    for (let i = 0; i < 51; i++) rememberChatSession(`c${i}`, `s${i}`)
    expect(recallChatSession('c0')).toBeNull()
    expect(recallChatSession('c1')).toBe('s1')
    expect(recallChatSession('c50')).toBe('s50')
})
