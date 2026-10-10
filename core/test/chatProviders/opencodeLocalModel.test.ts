// opencode on the local model: the env the shared server spawns with, when it must be replaced, and
// what a new session defaults to. No opencode binary — the pure helpers and the lifecycle's own
// state machine are driven directly.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { localSpawnFor } from '../../src/agentBackends/localModel'
import {
    ensureOpencodeServer,
    opencodeServerConfigKey,
    registerOpencodeServerListener,
    serverSpawnEnv,
    planServerChange,
} from '../../src/chatProviders/opencode/opencodeServer'
import {
    acceptsModelPick,
    localSessionModel,
    resolveOpencodeLocal,
} from '../../src/chatProviders/opencode/opencode'
import type { ChatFrame } from '../../src/chat'
import { tempDir } from '../helpers'
import { useSpawnBudget } from '../spawnBudget'

useSpawnBudget()

const LM = { url: 'http://localhost:1234', model: 'qwen', apiKey: '' }
const local = () => {
    const l = localSpawnFor('opencode', LM, 'qwen', ['qwen', 'llama'])
    if (!l) throw new Error('opencode must support local models')
    return l
}

describe('serverSpawnEnv', () => {
    test('carries the full inline config the seam built', () => {
        const env = serverSpawnEnv({ PATH: '/bin' }, local())
        expect(env.OPENCODE_CONFIG_CONTENT).toBe(
            local().env.OPENCODE_CONFIG_CONTENT,
        )
        expect(env.PATH).toBe('/bin')
    })

    test('without a local config leaves the base env alone', () => {
        const env = serverSpawnEnv({ PATH: '/bin' }, null)
        expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
        expect(env.PATH).toBe('/bin')
    })
})

describe('opencodeServerConfigKey', () => {
    test('is the config content, and changes when the local config changes', () => {
        const a = opencodeServerConfigKey(local())
        const b = opencodeServerConfigKey(
            localSpawnFor(
                'opencode',
                { ...LM, url: 'http://localhost:11434' },
                'qwen',
            ),
        )
        expect(a).toBe(local().env.OPENCODE_CONFIG_CONTENT)
        expect(b).not.toBe(a)
        expect(opencodeServerConfigKey(null)).toBeNull()
    })
})

describe('planServerChange', () => {
    const K = 'cfg-a'
    test('no preference or the same config keeps the live server', () => {
        expect(
            planServerChange({
                live: true,
                liveKey: K,
                want: undefined,
                turns: 0,
            }),
        ).toBe('keep')
        expect(
            planServerChange({ live: true, liveKey: K, want: K, turns: 3 }),
        ).toBe('keep')
    })
    test('a different config with no turn running restarts now', () => {
        expect(
            planServerChange({
                live: true,
                liveKey: K,
                want: 'cfg-b',
                turns: 0,
            }),
        ).toBe('restart')
        expect(
            planServerChange({ live: true, liveKey: K, want: null, turns: 0 }),
        ).toBe('restart')
    })
    test('a different config while a turn runs waits for it to settle', () => {
        expect(
            planServerChange({
                live: true,
                liveKey: K,
                want: 'cfg-b',
                turns: 1,
            }),
        ).toBe('wait')
    })
    test('nothing live yet just starts', () => {
        expect(
            planServerChange({
                live: false,
                liveKey: null,
                want: 'cfg-b',
                turns: 0,
            }),
        ).toBe('restart')
    })
})

describe('localSessionModel', () => {
    test('a session with no picked model defaults to local/<model>', () => {
        expect(localSessionModel(undefined, { model: 'qwen' })).toBe(
            'local/qwen',
        )
    })
    test('a picked model is kept', () => {
        expect(localSessionModel('anthropic/claude', { model: 'qwen' })).toBe(
            'anthropic/claude',
        )
    })
    test('no local config leaves the model untouched', () => {
        expect(localSessionModel(undefined, null)).toBeUndefined()
        expect(localSessionModel('x/y', null)).toBe('x/y')
    })
})

describe('acceptsModelPick', () => {
    const env = local().env
    test('a remembered cloud model is refused while local is on', () => {
        expect(acceptsModelPick(env, 'anthropic/claude-sonnet-4-5')).toBe(false)
    })
    test('a local/ model is accepted while local is on', () => {
        expect(acceptsModelPick(env, 'local/qwen')).toBe(true)
    })
    test('a nested id (LM Studio shape) is accepted', () => {
        expect(acceptsModelPick(env, 'local/qwen/qwen3-coder-30b')).toBe(true)
        expect(acceptsModelPick(null, 'local/qwen/qwen3-coder-30b')).toBe(true)
    })
    test('with local off any provider/model passes, a bare id does not', () => {
        expect(acceptsModelPick(null, 'anthropic/claude-sonnet-4-5')).toBe(true)
        expect(acceptsModelPick(null, 'claude-sonnet-4-5')).toBe(false)
    })
})

describe('resolveOpencodeLocal (session open)', () => {
    const vaultWith = (url: string | null) => {
        const dir = tempDir('opencode-local-')
        if (url)
            writeFileSync(
                join(dir, '.settings'),
                `localModel:\n  enabled: true\n  url: ${url}\n  model: qwen\n`,
            )
        return dir
    }

    test('setting off -> no local config, no error frame', async () => {
        const frames: ChatFrame[] = []
        const res = await resolveOpencodeLocal(vaultWith(null), f =>
            frames.push(f),
        )
        expect(res).toEqual({ ok: true, local: null })
        expect(frames).toEqual([])
    })

    test('server answering -> the env for the server, no error frame', async () => {
        const srv = Bun.serve({
            port: 0,
            fetch: () =>
                Response.json({ data: [{ id: 'qwen' }, { id: 'llama' }] }),
        })
        try {
            const frames: ChatFrame[] = []
            const res = await resolveOpencodeLocal(
                vaultWith(`http://localhost:${srv.port}`),
                f => frames.push(f),
            )
            expect(res.ok).toBe(true)
            if (!res.ok || !res.local)
                throw new Error('expected a local config')
            expect(res.local.model).toBe('qwen')
            expect(res.local.env.OPENCODE_CONFIG_CONTENT).toContain(
                '"local/qwen"',
            )
            expect(frames).toEqual([])
        } finally {
            srv.stop(true)
        }
    })

    test('server down -> an error frame with the unreachable message, not a silent fallback', async () => {
        const srv = Bun.serve({ port: 0, fetch: () => new Response('') })
        const port = srv.port
        srv.stop(true) // the port is now closed
        const url = `http://localhost:${port}`
        const frames: ChatFrame[] = []
        const res = await resolveOpencodeLocal(vaultWith(url), f =>
            frames.push(f),
        )
        expect(res).toEqual({ ok: false })
        expect(frames).toHaveLength(1)
        expect(frames[0]).toMatchObject({ type: 'error' })
        expect((frames[0] as { message: string }).message).toContain(url)
        expect((frames[0] as { message: string }).message).toContain(
            'localModel',
        )
    })
})

// The shared server's lifecycle against a fake `opencode` that prints the listening banner, records
// the OPENCODE_CONFIG_CONTENT it was spawned with, and sleeps.
describe('ensureOpencodeServer replaces the server when the local config changes', () => {
    const dir = tempDir('opencode-fake-bin-')
    const bin = join(dir, 'opencode')
    const log = join(dir, 'spawns.log')
    const pidLog = join(dir, 'pids.log')
    writeFileSync(
        bin,
        `#!/bin/sh\necho "$OPENCODE_CONFIG_CONTENT" >> "${log}"\necho $$ >> "${pidLog}"\necho "opencode server listening on http://127.0.0.1:1"\nexec sleep 60\n`,
    )
    chmodSync(bin, 0o755)
    // one line per spawn (blank = spawned with no config)
    // `exec sleep` keeps the shell's pid, so each line is the live opencode process of that spawn
    const pids = () =>
        readFileSync(pidLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(Number)
    const alive = (pid: number) => {
        try {
            process.kill(pid, 0)
            return true
        } catch {
            return false
        }
    }
    const waitDead = async (pid: number) => {
        for (let i = 0; i < 40 && alive(pid); i++) await Bun.sleep(50)
    }
    const spawns = () => readFileSync(log, 'utf8').split('\n').slice(0, -1)
    const A = local()
    const B = localSpawnFor(
        'opencode',
        { ...LM, url: 'http://localhost:11434' },
        'qwen',
    )!

    test('first start carries the config; same config reuses; omitted preference reuses', async () => {
        const h1 = await ensureOpencodeServer(bin, A)
        expect(h1).not.toBeNull()
        expect(await ensureOpencodeServer(bin, A)).toBe(h1)
        expect(await ensureOpencodeServer(bin)).toBe(h1)
        expect(spawns()).toEqual([A.env.OPENCODE_CONFIG_CONTENT])
    })

    test('a different config with no turn running respawns with it', async () => {
        const before = await ensureOpencodeServer(bin)
        const next = await ensureOpencodeServer(bin, B)
        expect(next).not.toBeNull()
        expect(next).not.toBe(before)
        expect(spawns()).toEqual([
            A.env.OPENCODE_CONFIG_CONTENT,
            B.env.OPENCODE_CONFIG_CONTENT,
        ])
        const [oldPid, newPid] = pids()
        await waitDead(oldPid)
        expect(alive(oldPid)).toBe(false) // the replaced server is killed, not leaked
        expect(alive(newPid)).toBe(true)
    })

    test('with a turn in flight the old server stays until it settles, then the next session gets the new one', async () => {
        const old = await ensureOpencodeServer(bin)
        const done = registerOpencodeServerListener('ses_1', () => {})
        let resolved = false
        const wanted = ensureOpencodeServer(bin, A).then(h => {
            resolved = true
            return h
        })
        await Bun.sleep(150)
        expect(resolved).toBe(false) // waiting on the running turn
        expect(await ensureOpencodeServer(bin)).toBe(old) // the turn's own calls still hit the old server
        done() // the turn settles
        const fresh = await wanted
        expect(fresh).not.toBeNull()
        expect(fresh).not.toBe(old)
        expect(spawns().at(-1)).toBe(A.env.OPENCODE_CONFIG_CONTENT)
        expect(spawns()).toHaveLength(3)
    })

    test('turning the local model off restarts without the config', async () => {
        await ensureOpencodeServer(bin, null)
        expect(spawns().at(-1)).toBe('')
    })

    test('two concurrent opens with different configs leave exactly one live server', async () => {
        await ensureOpencodeServer(bin, A)
        const before = pids().length
        await Promise.all([
            ensureOpencodeServer(bin, A),
            ensureOpencodeServer(bin, B),
        ])
        const all = pids()
        for (const pid of all) await waitDead(pid).catch(() => {})
        const live = all.filter(alive)
        // the last spawn is the survivor; nothing spawned before the race may outlive it
        expect(live).toEqual([all.at(-1)!])
        expect(all.length).toBeGreaterThan(before - 1)
    })

    test('cleanup', async () => {
        for (const pid of pids())
            try {
                process.kill(pid, 'SIGTERM')
            } catch {
                /* gone */
            }
    })
})
