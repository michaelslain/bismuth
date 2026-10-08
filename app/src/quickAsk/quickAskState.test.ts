import { afterEach, describe, expect, test } from 'bun:test'
import { getChatInstruction, setChatInstruction } from '../chat/chatContext'
import { recallChatSession, rememberChatSession } from '../chat/chatSessionStore'
import {
    beginQuickAsk,
    closeQuickAsk,
    handOffQuickAsk,
    openQuickAsk,
    quickAskChatId,
    quickAskOpen,
} from './quickAskState'

// Bun's test env has no localStorage; the session store reads the global.
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
}

afterEach(() => closeQuickAsk())

describe('quickAskState', () => {
    test('opening creates no chat id', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        expect(quickAskOpen()).toEqual({ kind: 'pane', leafId: null })
        expect(quickAskChatId()).toBeNull()
    })

    test('an untrusted event mints nothing', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        expect(beginQuickAsk({ isTrusted: false })).toBeNull()
        expect(quickAskChatId()).toBeNull()
    })

    test('a trusted event mints quick-<uuid> once', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        const id = beginQuickAsk({ isTrusted: true })
        expect(id).toMatch(/^quick-[0-9a-f-]{36}$/)
        expect(quickAskChatId()).toBe(id)
        expect(beginQuickAsk({ isTrusted: true })).toBe(id)
    })

    test('close releases the id', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        beginQuickAsk({ isTrusted: true })
        closeQuickAsk()
        expect(quickAskChatId()).toBeNull()
        expect(quickAskOpen()).toBeNull()
    })

    test('hand-off returns the id and clears state', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        const id = beginQuickAsk({ isTrusted: true })
        expect(handOffQuickAsk()).toBe(id)
        expect(quickAskChatId()).toBeNull()
        expect(quickAskOpen()).toBeNull()
        expect(handOffQuickAsk()).toBeNull()
    })

    test('re-opening starts a fresh question', () => {
        openQuickAsk({ kind: 'pane', leafId: 'a' })
        beginQuickAsk({ isTrusted: true })
        openQuickAsk({ kind: 'pane', leafId: 'b' })
        expect(quickAskChatId()).toBeNull()
    })

    test('close forgets the minted chat session entry; hand-off keeps it', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        const id = beginQuickAsk({ isTrusted: true })!
        rememberChatSession(id, 'sess-1')
        closeQuickAsk()
        expect(recallChatSession(id)).toBeNull()

        openQuickAsk({ kind: 'pane', leafId: null })
        const id2 = beginQuickAsk({ isTrusted: true })!
        rememberChatSession(id2, 'sess-2')
        expect(handOffQuickAsk()).toBe(id2)
        expect(recallChatSession(id2)).toBe('sess-2')
    })

    test('close and hand-off both clear the quick-ask instruction', () => {
        openQuickAsk({ kind: 'pane', leafId: null })
        const id = beginQuickAsk({ isTrusted: true })!
        setChatInstruction(id, 'answer only')
        closeQuickAsk()
        expect(getChatInstruction(id)).toBeNull()

        openQuickAsk({ kind: 'pane', leafId: null })
        const id2 = beginQuickAsk({ isTrusted: true })!
        setChatInstruction(id2, 'answer only')
        handOffQuickAsk()
        expect(getChatInstruction(id2)).toBeNull()
    })
})
