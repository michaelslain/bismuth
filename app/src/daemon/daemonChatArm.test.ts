import { test, expect, beforeEach } from 'bun:test'
import {
    armDaemonChat,
    clearDaemonChatResume,
    daemonChatArmed,
    disarmDaemonChat,
    resumeDaemonChat,
} from './daemonChatArm'
import {
    recallChatSession,
    rememberChatSession,
} from '../chat/chatSessionStore'
import { DAEMON_CHAT_ID } from '../tabIds'

/** Minimal in-memory Storage stub (Bun test env has no localStorage). */
beforeEach(() => {
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
    disarmDaemonChat()
    clearDaemonChatResume()
    rememberChatSession(DAEMON_CHAT_ID, 'sess-old')
})

const press = { type: 'pointerdown', isTrusted: true }

test('an ordinary arm starts a new conversation', () => {
    expect(armDaemonChat(press)).toBe(true)
    expect(daemonChatArmed()).toBe(true)
    expect(recallChatSession(DAEMON_CHAT_ID)).toBeNull()
})

test('a reopen with a trusted keydown arms now and keeps the conversation', () => {
    resumeDaemonChat({ isTrusted: true })
    expect(daemonChatArmed()).toBe(true)
    expect(recallChatSession(DAEMON_CHAT_ID)).toBe('sess-old')
})

test('an untrusted reopen only marks the page; the next gesture resumes', () => {
    resumeDaemonChat({ isTrusted: false })
    expect(daemonChatArmed()).toBe(false)
    expect(armDaemonChat(press)).toBe(true)
    expect(recallChatSession(DAEMON_CHAT_ID)).toBe('sess-old')
})

test('the resume mark is used once', () => {
    resumeDaemonChat()
    armDaemonChat(press)
    disarmDaemonChat()
    armDaemonChat(press)
    expect(recallChatSession(DAEMON_CHAT_ID)).toBeNull()
})

test('closing the page unarmed drops the mark', () => {
    resumeDaemonChat()
    clearDaemonChatResume()
    armDaemonChat(press)
    expect(recallChatSession(DAEMON_CHAT_ID)).toBeNull()
})
