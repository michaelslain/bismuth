import { afterEach, expect, test } from 'bun:test'
import { isMacPlatform } from './platform'

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function setNavigator(
    nav: { platform?: string; userAgent?: string } | undefined,
) {
    Object.defineProperty(globalThis, 'navigator', {
        value: nav,
        configurable: true,
        writable: true,
    })
}

afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete (globalThis as { navigator?: unknown }).navigator
})

test('a Mac platform is mac', () => {
    setNavigator({ platform: 'MacIntel', userAgent: 'x' })
    expect(isMacPlatform()).toBe(true)
})

test('iPhone, iPad and iPod count as mac-like (iOS/iPadOS chrome)', () => {
    for (const platform of ['iPhone', 'iPad', 'iPod']) {
        setNavigator({ platform, userAgent: 'x' })
        expect(isMacPlatform()).toBe(true)
    }
})

test('Windows and Linux are not mac', () => {
    setNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' })
    expect(isMacPlatform()).toBe(false)
    setNavigator({ platform: 'Linux x86_64', userAgent: 'X11; Linux' })
    expect(isMacPlatform()).toBe(false)
})

test('a missing navigator.platform falls back to the userAgent', () => {
    setNavigator({ platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17)' })
    expect(isMacPlatform()).toBe(true)
    setNavigator({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
    expect(isMacPlatform()).toBe(false)
})

test('no navigator at all is not mac', () => {
    setNavigator(undefined)
    expect(isMacPlatform()).toBe(false)
})
