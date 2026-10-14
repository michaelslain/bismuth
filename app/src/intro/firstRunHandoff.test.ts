import { describe, expect, test } from 'bun:test'
import {
    convertPrompt,
    restoreFirstRunHandoff,
    runFirstRunHandoff,
    type FirstRunApi,
} from './firstRunHandoff'
import {
    FIRST_RUN_AGENT_KEY,
    FIRST_RUN_CONVERT_KEY,
    FIRST_RUN_DAEMON_NAME_KEY,
    FIRST_RUN_POWERUPS_KEY,
} from '../storageKeys'

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
        setDaemonName: async (name: string) => {
            calls.push(`setDaemonName:${name}`)
            return { name }
        },
    } as unknown as FirstRunApi
    return { api, settings, calls }
}

const run = (init: Record<string, string>) => {
    const storage = fakeStorage(init)
    const { api, settings, calls } = fakeApi()
    const toasts: string[] = []
    const drafts: string[] = []
    runFirstRunHandoff({
        api,
        storage: storage as unknown as Storage,
        pushToast: m => void toasts.push(m),
        setAgentStatus: () => {},
        openChatAndSend: text => void drafts.push(text),
        delayMs: 0,
    })
    return { storage, settings, calls, toasts, drafts }
}
const settle = () => new Promise(r => setTimeout(r, 20))

describe('runFirstRunHandoff', () => {
    test('absent keys mean no calls', async () => {
        const r = run({})
        await settle()
        expect(r.settings).toEqual([])
        expect(r.calls).toEqual([])
        expect(r.toasts).toEqual([])
        expect(r.drafts).toEqual([])
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

    test('a daemon name is written through the api, toasted and cleared', async () => {
        const r = run({ [FIRST_RUN_DAEMON_NAME_KEY]: 'ada' })
        await settle()
        expect(r.calls).toEqual(['setDaemonName:ada'])
        expect(r.toasts).toEqual(['Your daemon is named ada'])
        expect(r.storage.has(FIRST_RUN_DAEMON_NAME_KEY)).toBe(false)
    })

    test('a conversion opens one chat that sends the prompt naming source and target', async () => {
        const job = { source: '/v/Notes', target: '/v/Notes-bismuth' }
        const r = run({ [FIRST_RUN_CONVERT_KEY]: JSON.stringify(job) })
        await settle()
        expect(r.drafts).toEqual([convertPrompt(job)])
        expect(r.drafts[0]).toContain('"/v/Notes"')
        expect(r.drafts[0]).toContain('"/v/Notes-bismuth"')
        expect(r.drafts[0]).toContain('guides/converting-obsidian-to-bismuth.md')
        expect(r.storage.has(FIRST_RUN_CONVERT_KEY)).toBe(false)
    })

    test('the conversion waits for the agent hand-off to settle', async () => {
        const job = { source: '/v/Notes', target: '/v/Notes-bismuth' }
        const order: string[] = []
        const storage = fakeStorage({
            [FIRST_RUN_AGENT_KEY]: 'codex',
            [FIRST_RUN_CONVERT_KEY]: JSON.stringify(job),
        })
        const { api } = fakeApi()
        api.setSetting = async () => {
            await new Promise(r => setTimeout(r, 30))
            order.push('provider')
        }
        runFirstRunHandoff({
            api,
            storage: storage as unknown as Storage,
            pushToast: () => {},
            setAgentStatus: () => {},
            openChatAndSend: () => void order.push('chat'),
            delayMs: 0,
        })
        await new Promise(r => setTimeout(r, 80))
        expect(order).toEqual(['provider', 'chat'])
    })

    test('the conversion waits for the cli + mcp install, which registers the MCP the chat reads', async () => {
        const job = { source: '/v/Notes', target: '/v/Notes-bismuth' }
        const order: string[] = []
        const storage = fakeStorage({
            [FIRST_RUN_POWERUPS_KEY]: JSON.stringify(['bismuth-install']),
            [FIRST_RUN_CONVERT_KEY]: JSON.stringify(job),
        })
        const { api } = fakeApi()
        api.bismuthInstall = async () => {
            await new Promise(r => setTimeout(r, 30))
            order.push('mcp')
            return { action: 'installed' }
        }
        runFirstRunHandoff({
            api,
            storage: storage as unknown as Storage,
            pushToast: () => {},
            setAgentStatus: () => {},
            openChatAndSend: () => void order.push('chat'),
            delayMs: 0,
        })
        await new Promise(r => setTimeout(r, 80))
        expect(order).toEqual(['mcp', 'chat'])
    })

    test('a failed cli + mcp install still lets the conversion chat open', async () => {
        const job = { source: '/v/Notes', target: '/v/Notes-bismuth' }
        const storage = fakeStorage({
            [FIRST_RUN_POWERUPS_KEY]: JSON.stringify(['bismuth-install']),
            [FIRST_RUN_CONVERT_KEY]: JSON.stringify(job),
        })
        const { api } = fakeApi()
        api.bismuthInstall = async () => {
            throw new Error('boom')
        }
        const chats: string[] = []
        runFirstRunHandoff({
            api,
            storage: storage as unknown as Storage,
            pushToast: () => {},
            setAgentStatus: () => {},
            openChatAndSend: t => void chats.push(t),
            delayMs: 0,
        })
        await new Promise(r => setTimeout(r, 40))
        expect(chats.length).toBe(1)
    })

    test('a malformed conversion key is cleared and opens nothing', async () => {
        const r = run({ [FIRST_RUN_CONVERT_KEY]: '1' })
        await settle()
        expect(r.drafts).toEqual([])
        expect(r.storage.has(FIRST_RUN_CONVERT_KEY)).toBe(false)
    })
})

describe('restoreFirstRunHandoff', () => {
    test('copies every string entry of the Rust hand-off into storage', () => {
        const storage = fakeStorage()
        restoreFirstRunHandoff(
            JSON.stringify({ [FIRST_RUN_AGENT_KEY]: 'codex', n: 3 }),
            storage,
        )
        expect(storage.getItem(FIRST_RUN_AGENT_KEY)).toBe('codex')
        expect(storage.has('n')).toBe(false)
    })
    test('absent or malformed changes nothing', () => {
        const storage = fakeStorage()
        restoreFirstRunHandoff(null, storage)
        restoreFirstRunHandoff('{nope', storage)
        restoreFirstRunHandoff('"str"', storage)
        expect(storage.getItem(FIRST_RUN_AGENT_KEY)).toBeNull()
    })
})
