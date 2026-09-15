import { describe, expect, test } from 'bun:test'
import {
    LAST_EFFORT_KEY,
    LAST_MODE_KEY,
    readLastEffort,
    readLastMode,
    readLastModel,
    readProviderChoice,
    rememberEffort,
    rememberMode,
    rememberModel,
    rememberProvider,
    type StorageLike,
} from './chatSessionPrefs'
import { DEFAULT_PERMISSION_MODE } from '../chatPermissionMode'
import { modelStorageKeys, providerStorageKey } from '../chatProvider'

/** A Map-backed Storage stand-in; `entries` is exposed so tests assert on what was actually written. */
function memoryStorage(seed: Record<string, string> = {}) {
    const entries = new Map(Object.entries(seed))
    const storage: StorageLike = {
        getItem: k => entries.get(k) ?? null,
        setItem: (k, v) => void entries.set(k, v),
    }
    return { storage, entries }
}

/** A storage whose every access throws — what a sandboxed/blocked localStorage does. */
const throwingStorage: StorageLike = {
    getItem: () => {
        throw new Error('blocked')
    },
    setItem: () => {
        throw new Error('blocked')
    },
}

describe('permission mode', () => {
    test('first run (nothing stored) falls back to the default mode', () => {
        expect(readLastMode(memoryStorage().storage)).toBe(
            DEFAULT_PERMISSION_MODE,
        )
    })

    test('a remembered mode round-trips under the persisted key', () => {
        const { storage, entries } = memoryStorage()
        rememberMode(storage, 'plan')
        expect(entries.get(LAST_MODE_KEY)).toBe('plan')
        expect(readLastMode(storage)).toBe('plan')
    })

    test('a garbage stored value is sanitized to the default', () => {
        const { storage } = memoryStorage({ [LAST_MODE_KEY]: 'not-a-mode' })
        expect(readLastMode(storage)).toBe(DEFAULT_PERMISSION_MODE)
    })

    test('unavailable storage never throws', () => {
        expect(readLastMode(throwingStorage)).toBe(DEFAULT_PERMISSION_MODE)
        expect(readLastMode(null)).toBe(DEFAULT_PERMISSION_MODE)
        expect(() => rememberMode(throwingStorage, 'plan')).not.toThrow()
    })
})

describe('model', () => {
    test('per-chat key wins over the global fallback', () => {
        const keys = modelStorageKeys('claude', 'c1')
        const { storage } = memoryStorage({
            [keys.perChat]: 'sonnet',
            [keys.global]: 'opus',
        })
        expect(readLastModel(storage, 'claude', 'c1')).toBe('sonnet')
    })

    test('a brand-new chat seeds from the global key', () => {
        const keys = modelStorageKeys('claude', 'c1')
        const { storage } = memoryStorage({ [keys.global]: 'opus' })
        expect(readLastModel(storage, 'claude', 'c1')).toBe('opus')
        expect(readLastModel(storage, 'claude')).toBe('opus')
    })

    test('nothing stored reads empty', () => {
        expect(readLastModel(memoryStorage().storage, 'claude', 'c1')).toBe('')
        expect(readLastModel(throwingStorage, 'claude', 'c1')).toBe('')
    })

    test('keys are provider-scoped: a claude model never seeds opencode', () => {
        const { storage } = memoryStorage()
        rememberModel(storage, 'claude', 'c1', 'opus')
        expect(readLastModel(storage, 'opencode', 'c1')).toBe('')
        expect(readLastModel(storage, 'claude', 'c1')).toBe('opus')
    })

    test('global:false writes only the per-chat key', () => {
        const keys = modelStorageKeys('claude', 'c1')
        const { storage, entries } = memoryStorage({ [keys.global]: 'haiku' })
        rememberModel(storage, 'claude', 'c1', 'opus', { global: false })
        expect(entries.get(keys.perChat)).toBe('opus')
        expect(entries.get(keys.global)).toBe('haiku')
    })

    test('default and global:true write both keys', () => {
        const keys = modelStorageKeys('claude', 'c1')
        const { storage, entries } = memoryStorage()
        rememberModel(storage, 'claude', 'c1', 'opus')
        expect(entries.get(keys.perChat)).toBe('opus')
        expect(entries.get(keys.global)).toBe('opus')
        rememberModel(storage, 'claude', 'c1', 'sonnet', { global: true })
        expect(entries.get(keys.global)).toBe('sonnet')
    })

    test('an empty model is never written', () => {
        const { storage, entries } = memoryStorage()
        rememberModel(storage, 'claude', 'c1', '')
        expect(entries.size).toBe(0)
    })
})

describe('provider choice', () => {
    test('never chosen reads null', () => {
        expect(readProviderChoice(memoryStorage().storage, 'c1')).toBeNull()
        expect(readProviderChoice(throwingStorage, 'c1')).toBeNull()
    })

    test('claude and opencode round-trip per chat', () => {
        const { storage, entries } = memoryStorage()
        rememberProvider(storage, 'c1', 'opencode')
        expect(entries.get(providerStorageKey('c1'))).toBe('opencode')
        expect(readProviderChoice(storage, 'c1')).toBe('opencode')
        expect(readProviderChoice(storage, 'c2')).toBeNull()
        rememberProvider(storage, 'c2', 'claude')
        expect(readProviderChoice(storage, 'c2')).toBe('claude')
    })

    test('any other stored value reads null', () => {
        const { storage } = memoryStorage({
            [providerStorageKey('c1')]: 'codex',
        })
        expect(readProviderChoice(storage, 'c1')).toBeNull()
    })
})

describe('effort', () => {
    test('never chosen reads empty', () => {
        expect(readLastEffort(memoryStorage().storage)).toBe('')
        expect(readLastEffort(throwingStorage)).toBe('')
    })

    test('a remembered level round-trips; an empty level is ignored', () => {
        const { storage, entries } = memoryStorage()
        rememberEffort(storage, 'medium')
        expect(entries.get(LAST_EFFORT_KEY)).toBe('medium')
        rememberEffort(storage, '')
        expect(readLastEffort(storage)).toBe('medium')
        expect(() => rememberEffort(throwingStorage, 'high')).not.toThrow()
    })
})
