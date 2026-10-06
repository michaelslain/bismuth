import { test, expect, beforeEach } from 'bun:test'
import {
    readCache,
    writeCache,
    scopedKey,
    readRaw,
    writeRaw,
    readArray,
} from './viewCache'

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

test('writeCache then readCache round-trips an object', () => {
    writeCache('k', { a: 1, b: ['x', 'y'] })
    expect(readCache<{ a: number; b: string[] }>('k')).toEqual({
        a: 1,
        b: ['x', 'y'],
    })
})

test('readCache returns undefined for a missing key', () => {
    expect(readCache('absent')).toBeUndefined()
})

test('readCache returns undefined for malformed JSON', () => {
    ;(globalThis as any).localStorage.setItem('bad', '{not json')
    expect(readCache('bad')).toBeUndefined()
})

test('writeCache swallows quota / setItem failures', () => {
    ;(globalThis as any).localStorage = {
        getItem: () => null,
        setItem: () => {
            throw new Error('QuotaExceeded')
        },
        removeItem: () => {},
    }
    expect(() => writeCache('k', { big: 'x' })).not.toThrow()
})

test('readCache returns undefined when localStorage is absent', () => {
    delete (globalThis as any).localStorage
    expect(readCache('k')).toBeUndefined()
    expect(() => writeCache('k', 1)).not.toThrow()
})

test('scopedKey namespaces the same base key differently per backend', () => {
    const a = scopedKey('bismuth-tree-cache-v1', 'http://localhost:4321')
    const b = scopedKey('bismuth-tree-cache-v1', 'http://localhost:57853')
    expect(a).not.toEqual(b)
})

test("writes under one backend's scoped key don't leak into another's read", () => {
    const key = 'bismuth-tree-cache-v1'
    writeCache(scopedKey(key, 'http://localhost:4321'), { vault: 'A' })
    expect(readCache(scopedKey(key, 'http://localhost:57853'))).toBeUndefined()
    expect(readCache(scopedKey(key, 'http://localhost:4321'))).toEqual({
        vault: 'A',
    })
})

test('readRaw/writeRaw/readArray never throw when storage throws', () => {
    const boom = () => {
        throw new Error('blocked')
    }
    ;(globalThis as any).localStorage = { getItem: boom, setItem: boom }
    expect(readRaw('k')).toBeNull()
    expect(() => writeRaw('k', 'v')).not.toThrow()
    expect(readArray('k', (x): x is string => typeof x === 'string')).toEqual(
        [],
    )
})

test('readArray keeps accepted entries and reads junk as empty', () => {
    const isStr = (x: unknown): x is string => typeof x === 'string'
    writeCache('a', ['x', 1, 'y'])
    expect(readArray('a', isStr)).toEqual(['x', 'y'])
    writeCache('o', { not: 'array' })
    expect(readArray('o', isStr)).toEqual([])
    expect(readArray('missing', isStr)).toEqual([])
})
