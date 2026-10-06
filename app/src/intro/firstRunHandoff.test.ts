import { describe, expect, test } from 'bun:test'
import { runFirstRunHandoff, type FirstRunApi } from './firstRunHandoff'
import { FIRST_RUN_AGENT_KEY, FIRST_RUN_POWERUPS_KEY } from '../storageKeys'

const fakeStorage = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init))
    return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
        has: (k: string) => m.has(k),
    }
}

const fakeApi = () => {
    const settings: [string[], unknown][] = []
    const calls: string[] = []
    const api = {
        setSetting: async (path: string[], value: unknown) => {
            settings.push([path, value])
        },
        daemonSetup: async () => {
            calls.push('daemonSetup')
            return { ok: true }
        },
        bismuthInstall: async () => {
            calls.push('bismuthInstall')
            return { action: 'installed' }
        },
        freeAgentStatus: async () => {
            calls.push('freeAgentStatus')
            return { phase: 'ready' }
        },
        freeAgentInstall: async () => {
            calls.push('freeAgentInstall')
            return { phase: 'ready' }
        },
    } as unknown as FirstRunApi
    return { api, settings, calls }
}

const run = (init: Record<string, string>) => {
    const storage = fakeStorage(init)
    const { api, settings, calls } = fakeApi()
    const toasts: string[] = []
    runFirstRunHandoff({
        api,
        storage: storage as unknown as Storage,
        pushToast: m => void toasts.push(m),
        setAgentStatus: () => {},
        delayMs: 0,
    })
    return { storage, settings, calls, toasts }
}
const settle = () => new Promise(r => setTimeout(r, 20))

describe('runFirstRunHandoff', () => {
    test('absent keys mean no calls', async () => {
        const r = run({})
        await settle()
        expect(r.settings).toEqual([])
        expect(r.calls).toEqual([])
        expect(r.toasts).toEqual([])
    })

    test('power-ups with daemon-setup enable the daemon and clear the key', async () => {
        const r = run({ [FIRST_RUN_POWERUPS_KEY]: JSON.stringify(['daemon-setup']) })
        await settle()
        expect(r.settings).toEqual([[['daemon', 'enabled'], true]])
        expect(r.calls).toEqual(['daemonSetup'])
        expect(r.storage.has(FIRST_RUN_POWERUPS_KEY)).toBe(false)
    })

    test('power-ups without daemon-setup disable the daemon', async () => {
        const r = run({ [FIRST_RUN_POWERUPS_KEY]: JSON.stringify([]) })
        await settle()
        expect(r.settings).toEqual([[['daemon', 'enabled'], false]])
        expect(r.calls).toEqual([])
    })

    test('an agent that names a provider sets chat.provider and clears the key', async () => {
        const r = run({ [FIRST_RUN_AGENT_KEY]: 'codex' })
        await settle()
        expect(r.settings.length).toBe(1)
        expect(r.settings[0][0]).toEqual(['chat', 'provider'])
        expect(r.storage.has(FIRST_RUN_AGENT_KEY)).toBe(false)
        expect(r.toasts.length).toBe(1)
    })

    test('both keys are cleared together', async () => {
        const r = run({
            [FIRST_RUN_AGENT_KEY]: 'claude',
            [FIRST_RUN_POWERUPS_KEY]: '[]',
        })
        await settle()
        expect(r.storage.has(FIRST_RUN_AGENT_KEY)).toBe(false)
        expect(r.storage.has(FIRST_RUN_POWERUPS_KEY)).toBe(false)
    })
})
