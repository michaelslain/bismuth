import { test, expect } from 'bun:test'
import { chatBusy, chatComposing, publishChatBusy, publishChatComposing, clearChatActivity } from './chatActivity'

test('unknown chats are neither busy nor composing', () => {
    expect(chatBusy('nope')).toBe(false)
    expect(chatComposing('nope')).toBe(false)
})

test('publish and clear', () => {
    publishChatBusy('a', true)
    publishChatComposing('a', true)
    expect(chatBusy('a')).toBe(true)
    expect(chatComposing('a')).toBe(true)
    expect(chatBusy('b')).toBe(false)
    clearChatActivity('a')
    expect(chatBusy('a')).toBe(false)
    expect(chatComposing('a')).toBe(false)
})
