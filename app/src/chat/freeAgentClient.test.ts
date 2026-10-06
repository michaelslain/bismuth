import { describe, expect, test } from 'bun:test'
import {
    ZEN_FREE_ROTATE_ID,
    freeAgentDefaults,
    freeAgentLine,
    completeFreeAgentSetup,
    runFreeAgentSetup,
    type FreeAgentApi,
} from './freeAgentClient'
import { ZEN_FREE_ROTATE_ID as CORE } from '../../../core/src/chatProviders/opencode/opencodeTranslate'
import type {
    FreeAgentProgress,
    FreeAgentStatus,
} from '../../../core/src/freeAgent'

const status = (claude: boolean, p: FreeAgentProgress = { phase: 'ready' }): FreeAgentStatus => ({
    opencode: { installed: true, path: '/x/opencode', managed: true },
    claude: { installed: claude },
    backends: [
        { id: 'claude', label: 'Claude Code', installed: claude },
        { id: 'opencode', label: 'opencode', installed: true },
    ],
    progress: p,
})

const mem = (init: Record<string, string> = {}) => {
    const m = { ...init }
    return {
        m,
        getItem: (k: string) => m[k] ?? null,
        setItem: (k: string, v: string) => void (m[k] = v),
    }
}

describe('runFreeAgentSetup', () => {
    test('walks downloading -> verifying -> ready and reports each step', async () => {
        const seq: FreeAgentProgress[] = [
            { phase: 'verifying' },
            { phase: 'ready', action: 'installed' },
        ]
        const api: FreeAgentApi = {
            freeAgentInstall: async () => ({ phase: 'downloading', received: 1, total: 2 }),
            freeAgentStatus: async () => status(false, seq.shift()!),
        }
        const seen: string[] = []
        const out = await runFreeAgentSetup(api, p => seen.push(p.phase), {
            sleep: async () => {},
        })
        expect(seen).toEqual(['downloading', 'verifying', 'ready'])
        expect(out.phase).toBe('ready')
    })
    test('an error result stops polling', async () => {
        let polls = 0
        const api: FreeAgentApi = {
            freeAgentInstall: async () => ({ phase: 'downloading' }),
            freeAgentStatus: async () => {
                polls++
                return status(false, { phase: 'error', message: 'boom' })
            },
        }
        const out = await runFreeAgentSetup(api, () => {}, { sleep: async () => {} })
        expect(out).toEqual({ phase: 'error', message: 'boom' })
        expect(polls).toBe(1)
    })
    test('already-installed resolves immediately', async () => {
        let polls = 0
        const api: FreeAgentApi = {
            freeAgentInstall: async () => ({ phase: 'ready', action: 'already-installed' }),
            freeAgentStatus: async () => (polls++, status(true)),
        }
        const out = await runFreeAgentSetup(api, () => {}, { sleep: async () => {} })
        expect(out.action).toBe('already-installed')
        expect(polls).toBe(0)
    })
    test('a thrown install request becomes an error progress', async () => {
        const api: FreeAgentApi = {
            freeAgentInstall: async () => {
                throw new Error('offline')
            },
            freeAgentStatus: async () => status(false),
        }
        const out = await runFreeAgentSetup(api, () => {}, { sleep: async () => {} })
        expect(out).toEqual({ phase: 'error', message: 'offline' })
    })
})

describe('freeAgentDefaults', () => {
    const KEY = 'bismuth.chat.lastModel.oc'
    test('leaves an existing last model alone', () => {
        const s = mem({ [KEY]: 'opencode/other' })
        freeAgentDefaults(s)
        expect(s.m[KEY]).toBe('opencode/other')
    })
    test('sets Zen Free when empty', () => {
        const s = mem()
        freeAgentDefaults(s)
        expect(s.m[KEY]).toBe(ZEN_FREE_ROTATE_ID)
    })
})

describe('freeAgentLine', () => {
    test('acceptance strings', () => {
        expect(freeAgentLine({ phase: 'downloading', received: 12.4e6, total: 45e6 })).toBe(
            'downloading opencode  12 / 45 MB',
        )
        expect(freeAgentLine({ phase: 'downloading', received: 12e6 })).toBe(
            'downloading opencode  12 MB',
        )
        expect(freeAgentLine({ phase: 'verifying' })).toBe('checking the download…')
        expect(freeAgentLine({ phase: 'installing' })).toBe('installing…')
        expect(freeAgentLine({ phase: 'error', message: 'x' })).toBe(
            "couldn't set up the free agent: x",
        )
    })
})

test('ZEN_FREE_ROTATE_ID mirrors core', () => {
    expect(ZEN_FREE_ROTATE_ID).toBe(CORE)
})

const noSleep = async () => {}

describe('idle rearm', () => {
    test('a status of idle mid-poll re-requests the install', async () => {
        let installs = 0
        const api: FreeAgentApi = {
            freeAgentInstall: async () =>
                ++installs === 1 ? { phase: 'downloading' } : { phase: 'ready' },
            freeAgentStatus: async () => status(false, { phase: 'idle' }),
        }
        const r = await runFreeAgentSetup(api, () => {}, { sleep: noSleep })
        expect(r.phase).toBe('ready')
        expect(installs).toBe(2)
    })
})

describe('completeFreeAgentSetup', () => {
    const make = (claude: boolean) => {
        const calls = { installs: 0 }
        const api: FreeAgentApi = {
            freeAgentInstall: async () => {
                calls.installs++
                return { phase: 'ready' } as FreeAgentProgress
            },
            freeAgentStatus: async () => status(claude),
        }
        return { api, calls }
    }
    const session = (provider: string, setupError: string | null = provider) => {
        const log: string[] = []
        return {
            log,
            s: {
                provider: () => provider,
                setupError: () => setupError,
                retrySetup: () => void log.push('retry'),
                switchProvider: (p: string) => void log.push('switch:' + p),
            },
        }
    }

    test('an auto chat already moved onto opencode is left alone (one reconnect)', async () => {
        const { api } = make(true)
        const { s, log } = session('opencode', null)
        await completeFreeAgentSetup(api, mem(), () => {}, s, { sleep: noSleep })
        expect(log).toEqual([])
    })
    test('opencode provider still on the setup screen retries, never switches', async () => {
        const { api } = make(true)
        const { s, log } = session('opencode')
        await completeFreeAgentSetup(api, mem(), () => {}, s, { sleep: noSleep })
        expect(log).toEqual(['retry'])
    })
    test('claude provider switches to opencode', async () => {
        const { api } = make(true)
        const { s, log } = session('claude')
        await completeFreeAgentSetup(api, mem(), () => {}, s, { sleep: noSleep })
        expect(log).toEqual(['switch:opencode'])
    })
    test('onStatus gets the fresh status once, and no setting is ever written', async () => {
        const { api } = make(false)
        expect('setSetting' in api).toBe(false)
        const seen: FreeAgentStatus[] = []
        await completeFreeAgentSetup(api, mem(), () => {}, undefined, {
            sleep: noSleep,
            onStatus: st => void seen.push(st),
        })
        expect(seen).toEqual([status(false)])
    })
    test('a failed install never calls onStatus', async () => {
        const api: FreeAgentApi = {
            freeAgentInstall: async () => ({ phase: 'error', message: 'x' }),
            freeAgentStatus: async () => status(false),
        }
        let calls = 0
        await completeFreeAgentSetup(api, mem(), () => {}, undefined, {
            sleep: noSleep,
            onStatus: () => void calls++,
        })
        expect(calls).toBe(0)
    })
    test('a joiner gets its own session step', async () => {
        const { api, calls } = make(true)
        let release!: () => void
        const gate = new Promise<void>(r => (release = r))
        const slow = { ...api, freeAgentInstall: async () => (await gate, api.freeAgentInstall()) }
        const { s, log } = session('opencode')
        const a = completeFreeAgentSetup(slow, mem(), () => {}, undefined, { sleep: noSleep })
        const b = completeFreeAgentSetup(slow, mem(), () => {}, s, { sleep: noSleep })
        release()
        await Promise.all([a, b])
        expect(log).toEqual(['retry'])
        expect(calls.installs).toBe(1)
    })
    test('concurrent calls make one install request', async () => {
        const { api, calls } = make(true)
        await Promise.all([
            completeFreeAgentSetup(api, mem(), () => {}, undefined, { sleep: noSleep }),
            completeFreeAgentSetup(api, mem(), () => {}, undefined, { sleep: noSleep }),
        ])
        expect(calls.installs).toBe(1)
    })
})
