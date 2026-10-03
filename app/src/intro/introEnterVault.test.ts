import { describe, expect, it } from 'bun:test'
import { FIRST_RUN_POWERUPS_KEY, THEME_VARS_KEY } from '../storageKeys'
import { enterVault, type EnterVaultDeps } from './introEnterVault'
import { introThemeVars } from './introTheme'

const choice = { theme: 'paper' as const, icon: 'hopper-crystal', powerups: ['cli', 'daemon', 'x'] }

function rig(over: Partial<EnterVaultDeps> & { ok?: boolean } = {}) {
    const calls = {
        invoke: [] as unknown[],
        set: [] as [string, string][],
        nav: [] as string[],
        info: [] as unknown[][],
        error: [] as unknown[][],
    }
    const deps: EnterVaultDeps = {
        dev: false,
        tauri: true,
        invoke: async (cmd, args) => {
            calls.invoke.push([cmd, args])
            return over.ok ?? true
        },
        storage: { setItem: (k, v) => void calls.set.push([k, v]) },
        navigate: href => void calls.nav.push(href),
        log: {
            info: (...a) => void calls.info.push(a),
            error: (...a) => void calls.error.push(a),
        },
        ...over,
    }
    return { calls, deps }
}

describe('enterVault', () => {
    it('prod + picked: persists both keys, invokes, opened', async () => {
        const { calls, deps } = rig()
        expect(await enterVault(choice, deps)).toBe('opened')
        expect(calls.invoke).toEqual([['choose_first_vault', { theme: 'paper', icon: 'hopper-crystal' }]])
        expect(calls.set).toEqual([
            [FIRST_RUN_POWERUPS_KEY, JSON.stringify(['daemon-setup', 'bismuth-install'])],
            [THEME_VARS_KEY, JSON.stringify(introThemeVars('paper'))],
        ])
        expect(calls.nav).toEqual([])
    })

    it('prod + picker dismissed: cancelled', async () => {
        const { deps } = rig({ ok: false })
        expect(await enterVault(choice, deps)).toBe('cancelled')
    })

    it('dev + picked: navigates home, opened, and writes no storage', async () => {
        const { calls, deps } = rig({ dev: true })
        expect(await enterVault(choice, deps)).toBe('opened')
        expect(calls.nav).toEqual(['/'])
        expect(calls.set).toEqual([])
    })

    it('dev + dismissed: cancelled, no navigation, no storage', async () => {
        const { calls, deps } = rig({ dev: true, ok: false })
        expect(await enterVault(choice, deps)).toBe('cancelled')
        expect(calls.nav).toEqual([])
        expect(calls.set).toEqual([])
    })

    it('invoke throwing: logs and fails, without navigating', async () => {
        const boom = new Error('boom')
        const { calls, deps } = rig({
            dev: true,
            invoke: async () => {
                throw boom
            },
        })
        expect(await enterVault(choice, deps)).toBe('failed')
        expect(calls.error).toEqual([['enter vault failed', boom]])
        expect(calls.nav).toEqual([])
    })

    it('not tauri: logs the browser notice and never invokes', async () => {
        const { calls, deps } = rig({ tauri: false })
        expect(await enterVault(choice, deps)).toBe('browser')
        expect(calls.info).toEqual([
            ['[intro] Enter your vault — native folder picker is available in the desktop app.'],
        ])
        expect(calls.invoke).toEqual([])
        expect(calls.set).toEqual([])
    })

    it('a setItem that throws still reaches invoke, and the second write is still tried', async () => {
        const attempted: string[] = []
        const { calls, deps } = rig({
            storage: {
                setItem: k => {
                    attempted.push(k)
                    throw new Error('quota')
                },
            },
        })
        expect(await enterVault(choice, deps)).toBe('opened')
        expect(attempted).toEqual([FIRST_RUN_POWERUPS_KEY, THEME_VARS_KEY])
        expect(calls.invoke.length).toBe(1)
    })

    it('a missing storage still reaches invoke', async () => {
        const { calls, deps } = rig({ storage: undefined })
        expect(await enterVault(choice, deps)).toBe('opened')
        expect(calls.invoke.length).toBe(1)
    })
})
