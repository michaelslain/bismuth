import { test, expect, beforeEach } from 'bun:test'
import { canHandOff, handOffConversation } from './chatHandoff'
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

test('canHandOff needs a conversation and no turn in flight', () => {
    expect(canHandOff({ items: 0, streaming: false })).toBe(false)
    expect(canHandOff({ items: 3, streaming: true })).toBe(false)
    expect(canHandOff({ items: 3, streaming: false })).toBe(true)
})

test('moves the session id, provider and model onto the new chat and forgets the old one', () => {
    rememberChatSession('daemon', 'sess-1')
    storage.setItem(modelStorageKeys('claude', 'daemon').perChat, 'opus')
    expect(handOffConversation('daemon', 'tab-1', 'claude', storage)).toBe(true)
    expect(recallChatSession('tab-1')).toBe('sess-1')
    expect(recallChatSession('daemon')).toBeNull()
    expect(readProviderChoice(storage, 'tab-1')).toBe('claude')
    expect(storage.getItem(modelStorageKeys('claude', 'tab-1').perChat)).toBe(
        'opus',
    )
})

test('the model key follows the provider namespace', () => {
    rememberChatSession('daemon', 'sess-2')
    storage.setItem(modelStorageKeys('opencode', 'daemon').perChat, 'gpt')
    handOffConversation('daemon', 'tab-2', 'opencode', storage)
    expect(storage.getItem(modelStorageKeys('opencode', 'tab-2').perChat)).toBe(
        'gpt',
    )
    expect(readProviderChoice(storage, 'tab-2')).toBe('opencode')
})

test('no remembered session: nothing changes', () => {
    expect(handOffConversation('daemon', 'tab-3', 'claude', storage)).toBe(
        false,
    )
    expect(recallChatSession('tab-3')).toBeNull()
    expect(readProviderChoice(storage, 'tab-3')).toBeNull()
})
