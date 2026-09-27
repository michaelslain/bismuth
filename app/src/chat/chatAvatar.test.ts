import { test, expect } from 'bun:test'
import { avatarIndex, chatAvatarMood } from './chatAvatar'
import type { TurnItem } from '../chatTranscript'

const user: TurnItem = { role: 'user', text: 'hi' }
const bot: TurnItem = {
    role: 'assistant',
    parts: [{ kind: 'text', text: 'hello' }],
    footer: null,
}
const note: TurnItem = { role: 'system', text: 'model switched' }

test('the face sits on the last assistant turn', () => {
    expect(avatarIndex([user, bot, user, bot], false)).toBe(3)
})

test('a user turn or system note after it does not move the face', () => {
    expect(avatarIndex([user, bot, user], false)).toBe(1)
    expect(avatarIndex([user, bot, note], false)).toBe(1)
})

test('no assistant turn yet → no item carries the face', () => {
    expect(avatarIndex([], false)).toBe(-1)
    expect(avatarIndex([user], false)).toBe(-1)
})

test('awaiting a reply → the working row takes the face, no item does', () => {
    expect(avatarIndex([user, bot, user], true)).toBe(-1)
})

test('chat mood follows liveness', () => {
    const idle = { busy: false, speaking: false, composing: false }
    expect(chatAvatarMood(idle)).toBe('idle')
    expect(chatAvatarMood({ ...idle, composing: true })).toBe('listening')
    expect(chatAvatarMood({ ...idle, busy: true })).toBe('thinking')
    expect(chatAvatarMood({ ...idle, busy: true, speaking: true })).toBe(
        'talking',
    )
    // busy wins over a draft typed while the reply streams
    expect(
        chatAvatarMood({ busy: true, speaking: true, composing: true }),
    ).toBe('talking')
})
