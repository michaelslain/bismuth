import { test, expect, beforeEach, describe } from 'bun:test'
import {
    setChatColor,
    chatColor,
    resolveChatColorArg,
    CHAT_COLOR_SWATCHES,
} from './chatColors'

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

test('setChatColor then chatColor round-trips (survives via the reactive store)', () => {
    const id = `chat-${crypto.randomUUID()}`
    expect(chatColor(id)).toBeUndefined()
    setChatColor(id, '#3b82f6')
    expect(chatColor(id)).toBe('#3b82f6')
})

test('setChatColor overwrites, and null clears back to the theme default', () => {
    const id = `chat-${crypto.randomUUID()}`
    setChatColor(id, '#ef4444')
    setChatColor(id, '#22c55e')
    expect(chatColor(id)).toBe('#22c55e')
    setChatColor(id, null)
    expect(chatColor(id)).toBeUndefined()
})

test('setChatColor persists the JSON to localStorage so it survives reload', () => {
    const id = `chat-${crypto.randomUUID()}`
    setChatColor(id, '#a855f7')
    const raw = (globalThis as any).localStorage.getItem(
        'bismuth-chat-colors-v1',
    )
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw)).toEqual(
        expect.arrayContaining([{ chatId: id, color: '#a855f7' }]),
    )
})

test('setChatColor caps the stored list at 200, dropping the oldest', () => {
    const tag = crypto.randomUUID()
    for (let i = 0; i < 201; i++) setChatColor(`${tag}-${i}`, '#fff')
    const raw = JSON.parse(
        (globalThis as any).localStorage.getItem('bismuth-chat-colors-v1'),
    )
    expect(raw.length).toBe(200)
    expect(raw[199].chatId).toBe(`${tag}-200`)
    expect(chatColor(`${tag}-0`)).toBeUndefined()
})

test('setChatColor ignores an empty chat id', () => {
    setChatColor('', '#fff')
    expect(chatColor('')).toBeUndefined()
})

test('swatch palette is non-empty and every entry is a hex color', () => {
    expect(CHAT_COLOR_SWATCHES.length).toBeGreaterThan(0)
    for (const sw of CHAT_COLOR_SWATCHES) {
        expect(sw.name).toBeTruthy()
        expect(sw.value).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
})

// Row 75: `/color <token>` argument resolution.
describe('resolveChatColorArg', () => {
    test('resolves a named swatch (case-insensitive) to its hex value', () => {
        const blue = CHAT_COLOR_SWATCHES.find(s => s.name === 'Blue')!
        expect(resolveChatColorArg('blue')).toBe(blue.value)
        expect(resolveChatColorArg('BLUE')).toBe(blue.value)
    })
    test('passes a valid #rrggbb / #rgb hex through unchanged', () => {
        expect(resolveChatColorArg('#ffcc00')).toBe('#ffcc00')
        expect(resolveChatColorArg('#abc')).toBe('#abc')
    })
    test('clear keywords resolve to null (revert to theme)', () => {
        expect(resolveChatColorArg('none')).toBeNull()
        expect(resolveChatColorArg('clear')).toBeNull()
        expect(resolveChatColorArg('')).toBeNull()
        expect(resolveChatColorArg('  ')).toBeNull()
    })
    test('an unrecognized token resolves to undefined (caller reports an error)', () => {
        expect(resolveChatColorArg('chartreuse')).toBeUndefined()
        expect(resolveChatColorArg('#gggggg')).toBeUndefined()
        expect(resolveChatColorArg('#12')).toBeUndefined()
    })
})
