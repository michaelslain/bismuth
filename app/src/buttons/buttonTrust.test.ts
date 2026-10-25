import { test, expect, beforeEach } from 'bun:test'
import { isTrusted, trust, TRUST_CAP } from './buttonTrust'

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

test('untrusted until trusted, then trusted', () => {
    expect(isTrusted('run the thing')).toBe(false)
    trust('run the thing')
    expect(isTrusted('run the thing')).toBe(true)
    expect(isTrusted('run another thing')).toBe(false)
})

test('trusting twice keeps one entry', () => {
    trust('a')
    trust('a')
    const map = (globalThis as any).localStorage
    expect(JSON.parse(map.getItem('bismuth.buttonTrust.v2')).length).toBe(1)
})

test('the cap keeps the newest entries', () => {
    for (let i = 0; i < TRUST_CAP + 10; i++) trust(`text ${i}`)
    expect(isTrusted('text 0')).toBe(false)
    expect(isTrusted('text 9')).toBe(false)
    expect(isTrusted('text 10')).toBe(true)
    expect(isTrusted(`text ${TRUST_CAP + 9}`)).toBe(true)
})

test('a throwing storage reads as untrusted and never throws', () => {
    const boom = () => {
        throw new Error('blocked')
    }
    ;(globalThis as any).localStorage = { getItem: boom, setItem: boom }
    expect(() => trust('x')).not.toThrow()
    expect(isTrusted('x')).toBe(false)
})

test('a one-character change is untrusted and storage keeps the key itself', () => {
    trust('prompt\nhaiku\n300\nrun a')
    expect(isTrusted('prompt\nhaiku\n300\nrun b')).toBe(false)
    const raw = (globalThis as any).localStorage.getItem('bismuth.buttonTrust.v2')
    expect(JSON.parse(raw)).toContain('prompt\nhaiku\n300\nrun a')
})
