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
import { daemonSection } from '../../src/doctor/sections/daemon'
import { BISMUTH_DAEMON_UNIT, serviceUnitPath } from '../../src/serviceUnit'
import { fakeCtx } from './fakeCtx'

const MIB = 1024 * 1024

function put(path: string, body: string | Buffer = 'x') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
}

function age(path: string, ms: number, now: number) {
    const t = (now - ms) / 1000
    utimesSync(path, t, t)
}

describe('daemon section', () => {
    test('an empty home reports nothing', async () => {
        expect(await daemonSection.check(fakeCtx())).toEqual([])
    })

    test('unit with no installed binary is destructive and apply removes the unit', async () => {
        const calls: string[][] = []
        const ctx = fakeCtx({
            exec: async argv => {
                calls.push(argv)
                return { code: 0, stdout: '', stderr: '' }
            },
        })
        const unit = serviceUnitPath('darwin', ctx.home, BISMUTH_DAEMON_UNIT)!
        put(unit, `<string>${ctx.bismuthHome}/bin/bismuth-daemon</string>`)
        const f = (await daemonSection.check(ctx)).find(
            x => x.id === 'daemon.unit-missing-binary',
        )
        expect(f?.severity).toBe('warn')
        expect(f?.repair?.risk).toBe('destructive')
        expect(await f!.repair!.apply()).toEqual([])
        expect(existsSync(unit)).toBe(false)
        expect(calls[0]).toEqual(['launchctl', 'unload', unit])
        expect(await f!.repair!.apply()).toEqual([])
        expect(await daemonSection.check(ctx)).toEqual([])
    })

    test('unit naming an older home with an installed binary is a safe old-home finding', async () => {
        const ctx = fakeCtx()
        put(join(ctx.bismuthHome, 'bin', 'bismuth-daemon'))
        const unit = serviceUnitPath('darwin', ctx.home, BISMUTH_DAEMON_UNIT)!
        put(unit, '<string>/Users/old/.bismuth/bin/bismuth-daemon</string>')
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.unit-old-home'])
        expect(fs[0].repair?.risk).toBe('safe')
        expect(fs[0].repair?.description).toContain('ensure-installed')
    })

    test('unit naming the current home is clean; a lookalike path is ignored', async () => {
        const ctx = fakeCtx()
        put(join(ctx.bismuthHome, 'bin', 'bismuth-daemon'))
        const unit = serviceUnitPath('darwin', ctx.home, BISMUTH_DAEMON_UNIT)!
        put(
            unit,
            `<string>${ctx.bismuthHome}/bin/bismuth-daemon</string><string>/x/.bismuth-notes/bin/bismuth-daemon</string>`,
        )
        expect(await daemonSection.check(ctx)).toEqual([])
    })

    test('bundled binary that differs from the marker is binary-skew; a matching marker is clean', async () => {
        const ctx = fakeCtx()
        const daemonBundle = join(ctx.home, 'bundle')
        const src = join(daemonBundle, 'bin', 'bismuth-daemon')
        put(src, 'daemon-binary')
        const st = statSync(src)
        const marker = join(ctx.bismuthHome, '.daemon-installed')
        put(marker, '1:1')
        const withBundle = { ...ctx, daemonBundle }
        const fs = await daemonSection.check(withBundle)
        expect(fs.map(f => f.id)).toEqual(['daemon.binary-skew'])
        expect(fs[0].repair?.risk).toBe('safe')
        writeFileSync(marker, `${st.size}:${Math.floor(st.mtimeMs)}\n`)
        expect(await daemonSection.check(withBundle)).toEqual([])
    })

    test('a leaked bin/bismuth-daemon.new-<pid> is removed, twice; a live pid is left', async () => {
        const ctx = fakeCtx()
        const leak = join(ctx.bismuthHome, 'bin', 'bismuth-daemon.new-123')
        put(leak)
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.temp-binary'])
        expect(fs[0].title).toBe('1 leftover daemon binary from a failed install')
        expect(fs[0].repair?.risk).toBe('safe')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(leak)).toBe(false)
        expect(await daemonSection.check(ctx)).toEqual([])
        put(leak)
        expect(
            await daemonSection.check({ ...ctx, pidAlive: () => true }),
        ).toEqual([])
    })

    test('an old atomic tmp is removed; a fresh one is not reported', async () => {
        const ctx = fakeCtx()
        const old = join(ctx.bismuthHome, 'daemon', 'devices.json.1.2.tmp')
        const fresh = join(ctx.bismuthHome, 'daemon', 'vaults-seen.json.3.tmp')
        put(old)
        put(fresh)
        age(old, 2 * 3_600_000, ctx.now)
        age(fresh, 60_000, ctx.now)
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.atomic-tmp'])
        expect(fs[0].title).toBe('1 leftover temp file from interrupted writes')
        expect(fs[0].severity).toBe('info')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(old)).toBe(false)
        expect(existsSync(fresh)).toBe(true)
        expect(await daemonSection.check(ctx)).toEqual([])
    })

    test('a 12 MiB log is cut to its last 1 MiB in place; a 2 MiB log is left', async () => {
        const ctx = fakeCtx()
        const logs = join(ctx.bismuthHome, 'daemon', 'logs')
        const big = join(logs, 'bismuth-daemon.stdout.log')
        const small = join(logs, 'bismuth-daemon.stderr.log')
        const body = Buffer.alloc(12 * MIB, 'a')
        body.write('TAIL-MARKER', body.length - 11)
        put(big, body)
        put(small, Buffer.alloc(2 * MIB, 'b'))
        const inode = statSync(big).ino
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.log-size'])
        expect(fs[0].title).toBe('1 daemon log over 10 MB')
        expect(fs[0].repair?.risk).toBe('safe')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(statSync(big).size).toBe(MIB)
        expect(statSync(big).ino).toBe(inode)
        expect(readFileSync(big).subarray(-11).toString()).toBe('TAIL-MARKER')
        expect(statSync(small).size).toBe(2 * MIB)
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(statSync(big).size).toBe(MIB)
        expect(await daemonSection.check(ctx)).toEqual([])
    })

    test('several leaked binaries come back as ONE finding, counted, with one repair', async () => {
        const ctx = fakeCtx()
        const dir = join(ctx.bismuthHome, 'bin')
        for (let i = 1; i <= 12; i++)
            put(join(dir, `bismuth-daemon.new-${100 + i}`))
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.temp-binary'])
        expect(fs[0].title).toBe('12 leftover daemon binaries from a failed install')
        const lines = fs[0].detail!.split('\n')
        expect(lines).toHaveLength(11)
        expect(lines[10]).toBe('+2 more')
        expect(lines[0]).toContain(dir)
        expect(fs[0].repair!.description).toBe('remove 12 leftover daemon binaries')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await daemonSection.check(ctx)).toEqual([])
    })

    test('several old atomic tmps come back as ONE finding', async () => {
        const ctx = fakeCtx()
        const a = join(ctx.bismuthHome, 'daemon', 'a.json.1.2.tmp')
        const b = join(ctx.bismuthHome, 'daemon', 'b.json.3.4.tmp')
        for (const p of [a, b]) {
            put(p)
            age(p, 2 * 3_600_000, ctx.now)
        }
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.atomic-tmp'])
        expect(fs[0].title).toBe('2 leftover temp files from interrupted writes')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(existsSync(a) || existsSync(b)).toBe(false)
        expect(await fs[0].repair!.apply()).toEqual([])
    })

    test('two oversized logs come back as ONE finding; one repair cuts both in place', async () => {
        const ctx = fakeCtx()
        const logs = join(ctx.bismuthHome, 'daemon', 'logs')
        const out = join(logs, 'bismuth-daemon.stdout.log')
        const err = join(logs, 'bismuth-daemon.stderr.log')
        put(out, Buffer.alloc(12 * MIB, 'a'))
        put(err, Buffer.alloc(11 * MIB, 'b'))
        const fs = await daemonSection.check(ctx)
        expect(fs.map(f => f.id)).toEqual(['daemon.log-size'])
        expect(fs[0].title).toBe('2 daemon logs over 10 MB')
        expect(fs[0].detail).toContain('(12 MB)')
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(await fs[0].repair!.apply()).toEqual([])
        expect(statSync(out).size).toBe(MIB)
        expect(statSync(err).size).toBe(MIB)
        expect(await daemonSection.check(ctx)).toEqual([])
    })
})
