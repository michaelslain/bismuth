import { describe, expect, test } from 'bun:test'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { runtimeSection } from '../../src/doctor/sections/runtime'
import { fakeCtx } from './fakeCtx'

function put(path: string, body: string = 'x') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
}

describe('runtime section', () => {
    test('an empty home reports nothing', async () => {
        expect(await runtimeSection.check(fakeCtx())).toEqual([])
    })

    test('a run record with a dead pid is removed; a live one is not reported', async () => {
        const dead = fakeCtx()
        const rec = join(dead.bismuthHome, 'run', 'L3ZhdWx0.json')
        put(rec, JSON.stringify({ port: 1, vault: '/vault', pid: 4242, token: 't' }))
        const fs = await runtimeSection.check(dead)
        expect(fs.map(f => f.id)).toEqual(['runtime.stale-run-record'])
        expect(fs[0].title).toBe('1 run record of a core no longer running')
        expect(fs[0].detail).toBe('/vault')
        expect(fs[0].repair?.risk).toBe('safe')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(rec)).toBe(false)
        expect(await runtimeSection.check(dead)).toEqual([])

        put(rec, JSON.stringify({ port: 1, vault: '/vault', pid: 4242, token: 't' }))
        expect(
            await runtimeSection.check({ ...dead, pidAlive: () => true }),
        ).toEqual([])
    })

    test('trusted-commands orphans are dropped, keeping the existing vault, mode 0600', async () => {
        const ctx = fakeCtx()
        const live = join(ctx.home, 'vault')
        mkdirSync(live, { recursive: true })
        const gone = join(ctx.home, 'gone-vault')
        const file = join(ctx.bismuthHome, 'trusted-commands.json')
        put(file, JSON.stringify({ [live]: ['abc'], [gone]: ['def'] }))
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.trusted-commands-orphans'])
        expect(fs[0].severity).toBe('info')
        expect(fs[0].repair?.risk).toBe('safe')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ [live]: ['abc'] })
        expect(statSync(file).mode & 0o777).toBe(0o600)
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await runtimeSection.check(ctx)).toEqual([])
    })

    test('a trusted-commands key whose parent dir is missing is not orphaned (unmounted volume)', async () => {
        const ctx = fakeCtx()
        const file = join(ctx.bismuthHome, 'trusted-commands.json')
        put(file, JSON.stringify({ [join(ctx.home, 'no-such-volume', 'vault')]: ['abc'] }))
        expect(await runtimeSection.check(ctx)).toEqual([])
    })

    test('a trusted-commands key with an existing parent and a missing leaf is orphaned', async () => {
        const ctx = fakeCtx()
        const file = join(ctx.bismuthHome, 'trusted-commands.json')
        const gone = join(ctx.home, 'gone-leaf')
        put(file, JSON.stringify({ [gone]: ['abc'] }))
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.trusted-commands-orphans'])
        expect(fs[0].detail).toBe(gone)
    })

    test('BISMUTH_TRUST_FILE decides which trust file is read and rewritten', async () => {
        const ctx = fakeCtx()
        const custom = join(ctx.home, 'elsewhere', 'trust.json')
        const live = join(ctx.home, 'vault')
        mkdirSync(live, { recursive: true })
        put(custom, JSON.stringify({ [live]: ['a'], [join(ctx.home, 'gone')]: ['b'] }))
        const saved = process.env.BISMUTH_TRUST_FILE
        process.env.BISMUTH_TRUST_FILE = custom
        try {
            const fs = await runtimeSection.check(ctx)
            expect(fs.map(f => f.id)).toEqual(['runtime.trusted-commands-orphans'])
            expect(await fs[0].repair!.apply()).toEqual([])
            expect(JSON.parse(readFileSync(custom, 'utf8'))).toEqual({ [live]: ['a'] })
            expect(existsSync(join(ctx.bismuthHome, 'trusted-commands.json'))).toBe(false)
        } finally {
            if (saved === undefined) delete process.env.BISMUTH_TRUST_FILE
            else process.env.BISMUTH_TRUST_FILE = saved
        }
    })

    test('a gcal key for a missing vault is info only, with no repair', async () => {
        const ctx = fakeCtx()
        const live = join(ctx.home, 'vault')
        mkdirSync(live, { recursive: true })
        put(
            join(ctx.bismuthHome, 'gcal', 'sync.json'),
            JSON.stringify({
                bases: {
                    [`${live}::cal.md`]: { links: {} },
                    [`${join(ctx.home, 'gone')}::cal.md`]: { links: {} },
                    'legacy.md': { links: {} },
                },
            }),
        )
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.gcal-orphan-keys'])
        expect(fs[0].severity).toBe('info')
        expect(fs[0].repair).toBeUndefined()
    })

    test('an app config naming a missing vault is info only on darwin, silent elsewhere', async () => {
        const ctx = fakeCtx()
        put(
            join(
                ctx.home,
                'Library',
                'Application Support',
                'com.bismuth.app',
                'config.json',
            ),
            JSON.stringify({ vault: join(ctx.home, 'gone'), memory: '' }),
        )
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.app-config-vault-missing'])
        expect(fs[0].severity).toBe('info')
        expect(fs[0].repair).toBeUndefined()
        expect(
            await runtimeSection.check({ ...ctx, platform: 'linux' }),
        ).toEqual([])
    })

    test('an old agent shim dir is removed; a fresh one and a foreign dir are left', async () => {
        const ctx = fakeCtx()
        const old = join(ctx.tmpDir, 'bismuth-agent-shim-x')
        const fresh = join(ctx.tmpDir, 'bismuth-agent-shim-y')
        const foreign = join(ctx.tmpDir, 'other-thing')
        for (const d of [old, fresh, foreign]) put(join(d, 'claude'))
        const t = (ctx.now - 2 * 86_400_000) / 1000
        utimesSync(old, t, t)
        utimesSync(foreign, t, t)
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.agent-shim'])
        expect(fs[0].title).toBe('1 leftover terminal agent shim directory')
        expect(fs[0].repair?.risk).toBe('safe')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(old)).toBe(false)
        expect(existsSync(fresh)).toBe(true)
        expect(existsSync(foreign)).toBe(true)
        expect(await runtimeSection.check(ctx)).toEqual([])
    })

    test('a malformed trusted-commands file does not throw', async () => {
        const ctx = fakeCtx()
        put(join(ctx.bismuthHome, 'trusted-commands.json'), '{not json')
        expect(await runtimeSection.check(ctx)).toEqual([])
    })

    test('many dead run records come back as ONE finding naming vaults, not base64 file names', async () => {
        const ctx = fakeCtx()
        const files: string[] = []
        for (let i = 0; i < 12; i++) {
            const f = join(ctx.bismuthHome, 'run', `b64-${i}.json`)
            files.push(f)
            put(f, JSON.stringify({ port: 1, vault: `/vaults/v${i}`, pid: 4242 }))
        }
        put(join(ctx.bismuthHome, 'run', 'novault.json'), JSON.stringify({ pid: 7 }))
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.stale-run-record'])
        expect(fs[0].title).toBe('13 run records of cores no longer running')
        const lines = fs[0].detail!.split('\n')
        expect(lines).toHaveLength(11)
        expect(lines[10]).toBe('+3 more')
        expect(fs[0].detail).not.toContain('b64-')
        expect(lines).toContain('/vaults/v0')
        expect(fs[0].repair!.description).toBe('remove 13 stale run records')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(files.some(f => existsSync(f))).toBe(false)
        expect(await runtimeSection.check(ctx)).toEqual([])
    })

    test('a record with no vault is named by its file name', async () => {
        const ctx = fakeCtx()
        put(join(ctx.bismuthHome, 'run', 'orphan.json'), JSON.stringify({ pid: 7 }))
        const fs = await runtimeSection.check(ctx)
        expect(fs[0].detail).toBe('orphan.json')
    })

    test('two old shim dirs come back as ONE finding', async () => {
        const ctx = fakeCtx()
        const a = join(ctx.tmpDir, 'bismuth-agent-shim-a')
        const b = join(ctx.tmpDir, 'bismuth-agent-shim-b')
        for (const d of [a, b]) put(join(d, 'claude'))
        const t = (ctx.now - 2 * 86_400_000) / 1000
        utimesSync(a, t, t)
        utimesSync(b, t, t)
        const fs = await runtimeSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['runtime.agent-shim'])
        expect(fs[0].title).toBe('2 leftover terminal agent shim directories')
        expect(fs[0].repair!.description).toBe(
            'remove 2 leftover terminal agent shim directories',
        )
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(a) || existsSync(b)).toBe(false)
    })
})
