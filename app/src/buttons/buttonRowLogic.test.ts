import { describe, expect, test } from 'bun:test'
import type { ButtonState } from '../../../core/src/buttons/buttonTypes'
import { agoLabel, confirmLine, needsTrust, statusLine, STALE_GRACE_SECS, trustText, trustKey } from './buttonRowLogic'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const at = (secsAgo: number) => new Date(NOW - secsAgo * 1000).toISOString()
const state = (over: Partial<ButtonState>): ButtonState => ({
    status: 'done',
    host: 'note:a.md',
    label: 'go',
    prompt: 'p',
    model: 'haiku',
    timeoutSecs: 300,
    pressedAt: at(120),
    completedAt: at(120),
    note: 'ok',
    ...over,
})

describe('agoLabel', () => {
    test('scales', () => {
        expect(agoLabel(NOW - 5000, NOW)).toBe('just now')
        expect(agoLabel(NOW - 120e3, NOW)).toBe('2m ago')
        expect(agoLabel(NOW - 3 * 3600e3, NOW)).toBe('3h ago')
        expect(agoLabel(NOW - 2 * 86400e3, NOW)).toBe('2d ago')
    })
})

describe('statusLine', () => {
    test('idle is null', () => expect(statusLine(null, NOW)).toBeNull())
    test('working', () => {
        const s = state({ status: 'working', completedAt: null, note: null, pressedAt: at(10) })
        expect(statusLine(s, NOW)).toEqual({ text: 'working…', tone: 'muted' })
    })
    test('stale working', () => {
        const s = state({
            status: 'working',
            completedAt: null,
            note: null,
            pressedAt: at(300 + STALE_GRACE_SECS + 1),
        })
        expect(statusLine(s, NOW)).toEqual({
            text: 'failed // no response from the daemon // 6m ago',
            tone: 'danger',
        })
    })
    test('done uses the first line, ago from completedAt', () => {
        const s = state({ note: 'added the week\nsecond line' })
        const l = statusLine(s, NOW)!
        expect(l.text).toBe('done // added the week // 2m ago')
        expect(l.tone).toBe('muted')
        expect(l.full).toBe('added the week\nsecond line')
    })
    test('done truncates a long first line', () => {
        const l = statusLine(state({ note: 'x'.repeat(200) }), NOW)!
        expect(l.text).toBe(`done // ${'x'.repeat(80)}… // 2m ago`)
    })
    test('done with no note', () => {
        expect(statusLine(state({ note: null }), NOW)!.text).toBe('done // 2m ago')
    })
    test('failed', () => {
        const l = statusLine(state({ status: 'failed', note: 'timed out' }), NOW)!
        expect(l).toMatchObject({ text: 'failed // timed out // 2m ago', tone: 'danger' })
    })
    test('failed with no note', () => {
        expect(statusLine(state({ status: 'failed', note: null }), NOW)!.text).toBe(
            'failed // 2m ago',
        )
    })
})

describe('confirm + trust', () => {
    const prompt = { type: 'prompt', prompt: 'do it', model: 'haiku', timeoutSecs: 300 } as const
    const send = { type: 'send', text: 'hello' } as const
    const command = { type: 'command', id: 'open-daemon' } as const
    const note = { kind: 'note', path: 'a.md' } as const
    const chat = { kind: 'chat', chatId: 'c1' } as const
    test('confirmLine', () => {
        expect(confirmLine(prompt)).toBe('run this? do it')
        expect(confirmLine(send)).toBe('send this? hello')
        expect(confirmLine(command)).toBe('')
    })
    test('trustText', () => {
        expect(trustText(prompt)).toBe('do it')
        expect(trustText(send)).toBe('hello')
        expect(trustText(command)).toBe('')
    })
    test('needsTrust', () => {
        expect(needsTrust(note, prompt)).toBe(true)
        expect(needsTrust(note, send)).toBe(true)
        expect(needsTrust(note, command)).toBe(false)
        expect(needsTrust(chat, prompt)).toBe(false)
        expect(needsTrust(chat, send)).toBe(false)
    })
})

describe('trustKey', () => {
    const prompt = (over: Partial<{ prompt: string; model: string; timeoutSecs: number }> = {}) =>
        ({ type: 'prompt' as const, prompt: 'do it', model: 'haiku', timeoutSecs: 300, ...over })
    test('one character changes the key', () => {
        expect(trustKey(prompt())).not.toBe(trustKey(prompt({ prompt: 'do is' })))
    })
    test('the same text as send and as prompt differs', () => {
        expect(trustKey({ type: 'send', text: 'do it' })).not.toBe(trustKey(prompt()))
    })
    test('a changed model or timeout differs', () => {
        expect(trustKey(prompt({ model: 'opus' }))).not.toBe(trustKey(prompt()))
        expect(trustKey(prompt({ timeoutSecs: 60 }))).not.toBe(trustKey(prompt()))
    })
})
