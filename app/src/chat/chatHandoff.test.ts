import { test, expect, beforeEach } from 'bun:test'
import {
    canHandOff,
    initialBackendChatId,
    moveConversationPrefs,
} from './chatHandoff'
import { recallChatSession, rememberChatSession } from './chatSessionStore'
import { readProviderChoice, type StorageLike } from './chatSessionPrefs'
import { modelStorageKeys } from './chatProvider'

let storage: StorageLike & { map: Map<string, string> }

beforeEach(() => {
    const map = new Map<string, string>()
    storage = {
        map,
        getItem: k => (map.has(k) ? map.get(k)! : null),
        setItem: (k, v) => {
            map.set(k, String(v))
        },
        removeItem: k => {
            map.delete(k)
        },
    }
    // chatSessionStore reads the global localStorage.
    ;(globalThis as any).localStorage = storage
})

test('canHandOff needs a conversation; a turn in flight moves with it', () => {
    expect(canHandOff(0)).toBe(false)
    expect(canHandOff(3)).toBe(true)
})

test('moves the session id, provider and model onto the new chat and forgets the old one', () => {
    rememberChatSession('daemon', 'sess-1')
    storage.setItem(modelStorageKeys('claude', 'daemon').perChat, 'opus')
    moveConversationPrefs('daemon', 'tab-1', 'claude', 'sess-1', storage)
    expect(recallChatSession('tab-1')).toBe('sess-1')
    expect(recallChatSession('daemon')).toBeNull()
    expect(readProviderChoice(storage, 'tab-1')).toBe('claude')
    expect(storage.getItem(modelStorageKeys('claude', 'tab-1').perChat)).toBe(
        'opus',
    )
})

test('the model key follows the provider namespace', () => {
    storage.setItem(modelStorageKeys('opencode', 'daemon').perChat, 'gpt')
    moveConversationPrefs('daemon', 'tab-2', 'opencode', 'sess-2', storage)
    expect(storage.getItem(modelStorageKeys('opencode', 'tab-2').perChat)).toBe(
        'gpt',
    )
    expect(readProviderChoice(storage, 'tab-2')).toBe('opencode')
})

test('a first turn still streaming has no session id yet: the provider still moves', () => {
    moveConversationPrefs('daemon', 'tab-3', 'claude', null, storage)
    expect(recallChatSession('tab-3')).toBeNull()
    expect(readProviderChoice(storage, 'tab-3')).toBe('claude')
})

test('a private conversation passes no session id, so none is remembered under the new chat', () => {
    rememberChatSession('daemon', 'sess-old')
    moveConversationPrefs('daemon', 'tab-4', 'claude', null, storage)
    expect(recallChatSession('tab-4')).toBeNull()
    expect(recallChatSession('daemon')).toBeNull()
})

test('a new session binds to its own chat id unless a moved session still holds it', () => {
    const mint = () => 'fresh'
    expect(initialBackendChatId('daemon', new Set(), mint)).toBe('daemon')
    expect(initialBackendChatId('daemon', new Set(['tab-9']), mint)).toBe(
        'daemon',
    )
    expect(initialBackendChatId('daemon', new Set(['daemon']), mint)).toBe(
        'fresh',
    )
})
