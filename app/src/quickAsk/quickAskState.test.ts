import { afterEach, describe, expect, test } from 'bun:test'
import { getChatInstruction, setChatInstruction } from '../chat/chatContext'
import {
    recallChatSession,
    rememberChatSession,
} from '../chat/chatSessionStore'
import {
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

const pane = (key: string | null, leafId: string | null = null) =>
    ({ kind: 'pane', leafId, key }) as const

describe('quickAskState', () => {
    test('opening picks a quick-<uuid> chat and shows the anchor', () => {
        const id = openQuickAsk(pane('a.md'))
        expect(id).toMatch(/^quick-[0-9a-f-]{36}$/)
        expect(quickAskChatId()).toBe(id)
        expect(quickAskOpen()).toEqual(pane('a.md'))
    })

    test('the same key resumes the same chat after a close', () => {
        const id = openQuickAsk(pane('a.md'))
        closeQuickAsk()
        expect(quickAskChatId()).toBeNull()
        expect(quickAskOpen()).toBeNull()
        expect(openQuickAsk(pane('a.md'))).toBe(id)
    })

    test('another key gets another chat; re-opening while open switches to it', () => {
        const a = openQuickAsk(pane('a.md'))
        const b = openQuickAsk(pane('b.md'))
        expect(b).not.toBe(a)
        expect(quickAskChatId()).toBe(b)
        closeQuickAsk()
        expect(openQuickAsk(pane('a.md'))).toBe(a)
    })

    test('a null key is never remembered', () => {
        const id = openQuickAsk(pane(null))
        closeQuickAsk()
        expect(openQuickAsk(pane(null))).not.toBe(id)
    })

    test('close keeps the session entry; close with forget drops it and the slot', () => {
        const id = openQuickAsk(pane('a.md'))
        rememberChatSession(id, 'sess-1')
        closeQuickAsk()
        expect(recallChatSession(id)).toBe('sess-1')

        openQuickAsk(pane('a.md'))
        closeQuickAsk({ forget: true })
        expect(recallChatSession(id)).toBeNull()
        expect(openQuickAsk(pane('a.md'))).not.toBe(id)
    })

    test('hand-off returns the id, keeps its session, and frees the key', () => {
        const id = openQuickAsk(pane('a.md'))
        rememberChatSession(id, 'sess-2')
        expect(handOffQuickAsk()).toBe(id)
        expect(quickAskChatId()).toBeNull()
        expect(quickAskOpen()).toBeNull()
        expect(recallChatSession(id)).toBe('sess-2')
        expect(handOffQuickAsk()).toBeNull()
        expect(openQuickAsk(pane('a.md'))).not.toBe(id)
    })

    test('close and hand-off both clear the quick-ask instruction', () => {
        const id = openQuickAsk(pane('a.md'))
        setChatInstruction(id, 'answer only')
        closeQuickAsk()
        expect(getChatInstruction(id)).toBeNull()

        const id2 = openQuickAsk(pane('b.md'))
        setChatInstruction(id2, 'answer only')
        handOffQuickAsk()
        expect(getChatInstruction(id2)).toBeNull()
    })
})
