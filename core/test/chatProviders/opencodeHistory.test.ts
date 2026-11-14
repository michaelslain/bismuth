import { describe, expect, test } from 'bun:test'
import {
    isOpencodeSessionId,
    opencodeChatRow,
    restoreOpencodeChats,
    searchTexts,
    trashOpencodeChats,
} from '../../src/chatProviders/opencode/opencodeHistory'

describe('opencode chats in the history', () => {
    test('an opencode id is told apart from a Claude session id', () => {
        expect(isOpencodeSessionId('ses_e242d2f54ffeUXaxS7QRJDzuUF')).toBe(true)
        expect(isOpencodeSessionId('0ef199f6-7c8e-4f77-821d-76e79968c2ff')).toBe(false)
        expect(isOpencodeSessionId('ses_../etc')).toBe(false)
    })

    test('a session is a row with its title and last update', () => {
        expect(
            opencodeChatRow({
                id: 'ses_abc',
                title: 'what tests/quizzes do i have tmrw',
                time: { created: 1, updated: 5 },
            }),
        ).toEqual({
            sessionId: 'ses_abc',
            summary: 'what tests/quizzes do i have tmrw',
            lastModified: 5,
            origin: 'user',
            provider: 'opencode',
        })
    })

    test('a subagent child session and a malformed entry are not rows', () => {
        expect(
            opencodeChatRow({ id: 'ses_child', parentID: 'ses_parent', time: {} }),
        ).toBeNull()
        expect(opencodeChatRow({ title: 'no id' })).toBeNull()
        expect(opencodeChatRow(null)).toBeNull()
    })

    test('an untitled session gets a stand-in title', () => {
        expect(opencodeChatRow({ id: 'ses_x', time: { created: 2 } })?.summary).toBe(
            'opencode chat',
        )
    })

    test('search reads the user and assistant text only', () => {
        expect(
            searchTexts([
                { type: 'user-message', text: 'quiz tomorrow?' },
                { type: 'thinking', text: 'hidden' } as never,
                { type: 'assistant-text', text: 'MATH 128A quiz' },
                { type: 'assistant-text', text: '  ' },
            ]),
        ).toEqual(['quiz tomorrow?', 'MATH 128A quiz'])
    })

    test('a deleted chat can be restored inside the trash window', () => {
        expect(trashOpencodeChats(['ses_t1', 'not-opencode'])).toEqual(['ses_t1'])
        expect(restoreOpencodeChats(['ses_t1', 'ses_never'])).toEqual(['ses_t1'])
        expect(restoreOpencodeChats(['ses_t1'])).toEqual([])
    })
})
