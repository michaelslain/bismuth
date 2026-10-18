import { describe, expect, it } from 'bun:test'
import {
    FIRST_RUN_AGENT_KEY,
    FIRST_RUN_CONVERT_KEY,
    FIRST_RUN_DAEMON_NAME_KEY,
    FIRST_RUN_POWERUPS_KEY,
    FIRST_RUN_PRIVACY_KEY,
    THEME_VARS_KEY,
} from '../storageKeys'
import {
    convertSourceMissing,
    enterVault,
    type EnterVaultDeps,
} from './introEnterVault'
import { introThemeVars } from './introTheme'
import { DEFAULT_PRIVACY, applyLevel, privacyWrites } from './introPrivacy'

const choice = { theme: 'paper' as const, icon: 'hopper-crystal', powerups: ['cli', 'daemon', 'x'], agent: 'free-agent' }

function rig(over: Partial<EnterVaultDeps> & { ok?: boolean } = {}) {
    const calls = {
        invoke: [] as unknown[],
        set: [] as [string, string][],
        removed: [] as string[],
        errors: [] as string[],
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
        storage: {
            setItem: (k, v) => void calls.set.push([k, v]),
            removeItem: k => void calls.removed.push(k),
        },
        onError: m => void calls.errors.push(m),
        navigate: href => void calls.nav.push(href),
        log: {
            info: (...a) => void calls.info.push(a),
            error: (...a) => void calls.error.push(a),
        },
        ...over,
    }
    return { calls, deps }
}

describe('convertSourceMissing', () => {
    it('from obsidian with no vault picked waits for one', () => {
        expect(convertSourceMissing(['cli'], 'obsidian', '')).toBe(true)
        expect(convertSourceMissing(['cli'], 'obsidian', '   ')).toBe(true)
    })
    it('a picked vault, new vault, or cli + mcp off never waits', () => {
        expect(convertSourceMissing(['cli'], 'obsidian', '/a/Notes')).toBe(false)
        expect(convertSourceMissing(['cli'], 'new', '')).toBe(false)
        expect(convertSourceMissing([], 'obsidian', '')).toBe(false)
    })
})

describe('enterVault', () => {
    // The hand-off object Rust writes to disk before the relaunch, for a given choice.
    const handoffOf = (args: unknown) =>
        JSON.parse((args as { handoff: string }).handoff) as Record<string, string>
    const argsOf = (calls: { invoke: unknown[] }) =>
        (calls.invoke[0] as [string, Record<string, unknown>])[1]

    it('prod + picked: hands the four keys to Rust, mirrors them to storage, opened', async () => {
        const { calls, deps } = rig()
        expect(await enterVault(choice, deps)).toBe('opened')
        const expected = {
            [FIRST_RUN_POWERUPS_KEY]: JSON.stringify(['daemon-setup', 'bismuth-install']),
            [FIRST_RUN_AGENT_KEY]: 'free-agent',
            [THEME_VARS_KEY]: JSON.stringify(introThemeVars('paper')),
            [FIRST_RUN_PRIVACY_KEY]: JSON.stringify(privacyWrites(DEFAULT_PRIVACY)),
        }
        const args = argsOf(calls)
        expect(args.theme).toBe('paper')
        expect(args.icon).toBe('hopper-crystal')
        expect(args.convertFrom).toBeUndefined()
        expect(handoffOf(args)).toEqual(expected)
        expect(Object.fromEntries(calls.set)).toEqual(expected)
        expect(calls.nav).toEqual([])
    })

    it('prod: clears name and conversion keys left by an earlier attempt', async () => {
        const { calls, deps } = rig()
        await enterVault(choice, deps)
        expect(calls.removed).toEqual([
            FIRST_RUN_DAEMON_NAME_KEY,
            FIRST_RUN_PRIVACY_KEY,
            FIRST_RUN_CONVERT_KEY,
        ])
    })

    it('prod: hands over a typed daemon name, and the Obsidian source for Rust to resolve', async () => {
        const { calls, deps } = rig()
        await enterVault(
            { ...choice, daemonName: '  ada  ', obsidianSource: '/v/Notes/' },
            deps,
        )
        const args = argsOf(calls)
        expect(handoffOf(args)[FIRST_RUN_DAEMON_NAME_KEY]).toBe('ada')
        // Rust resolves the source and adds the conversion job; the app never writes it.
        expect(args.convertFrom).toBe('/v/Notes')
        expect(handoffOf(args)[FIRST_RUN_CONVERT_KEY]).toBeUndefined()
    })

    it('prod: hands over the privacy writes only with the daemon power-up on', async () => {
        const privacy = applyLevel('assist')
        const { calls, deps } = rig()
        await enterVault({ ...choice, privacy }, deps)
        const raw = handoffOf(argsOf(calls))[FIRST_RUN_PRIVACY_KEY]
        expect(JSON.parse(raw)).toEqual(privacyWrites(privacy))
        expect(JSON.parse(raw)).toHaveLength(7)
        for (const powerups of [['cli'], []]) {
            const r = rig()
            await enterVault({ ...choice, powerups, privacy }, r.deps)
            expect(handoffOf(argsOf(r.calls))[FIRST_RUN_PRIVACY_KEY]).toBeUndefined()
        }
    })

    it('prod: the default or a blank name hands over no name key', async () => {
        for (const daemonName of ['daemon', '   ']) {
            const { calls, deps } = rig()
            await enterVault({ ...choice, daemonName }, deps)
            expect(handoffOf(argsOf(calls))[FIRST_RUN_DAEMON_NAME_KEY]).toBeUndefined()
        }
    })

    it('prod: a choice whose power-up was cleared is dropped', async () => {
        const { calls, deps } = rig()
        await enterVault(
            { ...choice, powerups: [], daemonName: 'ada', obsidianSource: '/v/Notes' },
            deps,
        )
        const args = argsOf(calls)
        expect(handoffOf(args)[FIRST_RUN_DAEMON_NAME_KEY]).toBeUndefined()
        // Without cli + mcp there is no conversion, so the picker opens as usual.
        expect(args.convertFrom).toBeUndefined()
    })

    it('a refused source path is reported in words and fails', async () => {
        const { calls, deps } = rig({
            invoke: async () => {
                throw 'no folder at /v/Nope'
            },
        })
        expect(await enterVault({ ...choice, obsidianSource: '/v/Nope' }, deps)).toBe('failed')
        expect(calls.errors).toEqual(['no folder at /v/Nope'])
    })

    it('dev: never converts, so no folder is made beside the real Obsidian vault', async () => {
        const { calls, deps } = rig({ dev: true })
        await enterVault({ ...choice, obsidianSource: '/v/Notes' }, deps)
        expect(calls.invoke).toEqual([
            ['choose_first_vault', { theme: 'paper', icon: 'hopper-crystal' }],
        ])
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

    it('a setItem that throws still reaches invoke, and every later write is still tried', async () => {
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
        expect(attempted).toEqual([
            FIRST_RUN_POWERUPS_KEY,
            FIRST_RUN_AGENT_KEY,
            THEME_VARS_KEY,
            FIRST_RUN_PRIVACY_KEY,
        ])
        expect(calls.invoke.length).toBe(1)
    })

    it('a missing storage still reaches invoke', async () => {
        const { calls, deps } = rig({ storage: undefined })
        expect(await enterVault(choice, deps)).toBe('opened')
        expect(calls.invoke.length).toBe(1)
    })
})
