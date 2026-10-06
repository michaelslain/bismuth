import { afterEach, describe, expect, test } from 'bun:test'
import {
    existsSync,
    mkdirSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import {
    assetForPlatform,
    getFreeAgentStatus,
    installFreeAgent,
    pickReleaseAsset,
    startFreeAgentInstall,
    type FreeAgentIO,
    type FreeAgentProgress,
} from '../src/freeAgent'

describe('assetForPlatform', () => {
    test('maps the four platforms opencode ships', () => {
        expect(assetForPlatform('darwin', 'arm64')).toBe(
            'opencode-darwin-arm64.zip',
        )
        expect(assetForPlatform('darwin', 'x64')).toBe(
            'opencode-darwin-x64.zip',
        )
        expect(assetForPlatform('linux', 'arm64')).toBe(
            'opencode-linux-arm64.tar.gz',
        )
        expect(assetForPlatform('linux', 'x64')).toBe(
            'opencode-linux-x64.tar.gz',
        )
    })
    test('returns null where opencode has no build', () => {
        expect(assetForPlatform('win32', 'x64')).toBeNull()
        expect(assetForPlatform('linux', 'ia32')).toBeNull()
    })
})

const BYTES = new TextEncoder().encode('pretend this is a zip archive')
const SHA = new Bun.CryptoHasher('sha256').update(BYTES).digest('hex')
const ASSET = 'opencode-darwin-arm64.zip'
const release = (digest: string | null = `sha256:${SHA}`) => ({
    tag_name: 'v1.18.34',
    assets: [
        {
            name: ASSET,
            size: BYTES.length,
            browser_download_url: `https://example.test/${ASSET}`,
            digest,
        },
        {
            name: 'opencode-linux-x64.tar.gz',
            size: 1,
            browser_download_url: 'https://example.test/other',
            digest: 'sha256:00',
        },
    ],
})

describe('pickReleaseAsset', () => {
    test('returns url, bare sha256, size and version without the v', () => {
        expect(pickReleaseAsset(release(), ASSET)).toEqual({
            url: `https://example.test/${ASSET}`,
            sha256: SHA,
            size: BYTES.length,
            version: '1.18.34',
        })
    })
    test('null for a missing asset, a null digest, a non-sha256 digest, junk', () => {
        expect(pickReleaseAsset(release(), 'nope.zip')).toBeNull()
        expect(pickReleaseAsset(release(null), ASSET)).toBeNull()
        expect(pickReleaseAsset(release('md5:abc'), ASSET)).toBeNull()
        expect(pickReleaseAsset(null, ASSET)).toBeNull()
        expect(pickReleaseAsset({ assets: 3 }, ASSET)).toBeNull()
    })
})

function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(c) {
            c.enqueue(bytes.slice(0, 10))
            c.enqueue(bytes.slice(10))
            c.close()
        },
    })
}

type Calls = { fetch: string[]; exec: string[][] }
function fakeIO(
    over: Partial<FreeAgentIO> = {},
    opts: { rel?: unknown; bytes?: Uint8Array } = {},
): { io: Partial<FreeAgentIO>; calls: Calls; binDir: string; tmpDir: string } {
    const root = tempDir('free-agent-')
    const binDir = join(root, 'bin')
    const tmpDir = join(root, 'tmp')
    const calls: Calls = { fetch: [], exec: [] }
    const io: Partial<FreeAgentIO> = {
        platform: 'darwin',
        arch: 'arm64',
        binDir,
        tmpDir,
        which: () => null,
        fetch: (async (url: string | URL | Request) => {
            const u = String(url)
            calls.fetch.push(u)
            if (u.includes('api.github.com'))
                return Response.json(opts.rel ?? release())
            return new Response(bodyOf(opts.bytes ?? BYTES), {
                headers: { 'content-length': String(BYTES.length) },
            })
        }) as unknown as typeof fetch,
        exec: async cmd => {
            calls.exec.push(cmd)
            if (cmd[0] === 'unzip' || cmd[0] === 'tar') {
                const flag = cmd[0] === 'unzip' ? '-d' : '-C'
                const dir = cmd[cmd.indexOf(flag) + 1]!
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, 'opencode'), '#!/bin/sh\n')
                return { code: 0, stdout: '', stderr: '' }
            }
            if (cmd[1] === '--version')
                return { code: 0, stdout: '1.18.34\n', stderr: '' }
            return { code: 0, stdout: '', stderr: '' }
        },
        ...over,
    }
    return { io, calls, binDir, tmpDir }
}

describe('installFreeAgent', () => {
    test('skips the download when opencode is already on the machine', async () => {
        const { io, calls, binDir } = fakeIO({
            which: n => (n === 'opencode' ? '/opt/homebrew/bin/opencode' : null),
        })
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('ready')
        expect(r.action).toBe('already-installed')
        expect(r.path).toBe('/opt/homebrew/bin/opencode')
        expect(calls.fetch).toEqual([])
        expect(existsSync(join(binDir, 'opencode'))).toBe(false)
    })

    test('downloads, verifies, extracts and installs a 0755 binary', async () => {
        const { io, binDir } = fakeIO()
        const seen: FreeAgentProgress[] = []
        const r = await installFreeAgent(io, p => seen.push({ ...p }))
        expect(r).toMatchObject({
            phase: 'ready',
            action: 'installed',
            version: '1.18.34',
        })
        const bin = join(binDir, 'opencode')
        expect(existsSync(bin)).toBe(true)
        expect(statSync(bin).mode & 0o777).toBe(0o755)
        const phases = seen.map(p => p.phase)
        const i = phases.indexOf('downloading')
        const j = phases.indexOf('verifying')
        const k = phases.indexOf('installing')
        expect(i).toBeGreaterThanOrEqual(0)
        expect(j).toBeGreaterThan(i)
        expect(k).toBeGreaterThan(j)
        const last = seen.filter(p => p.phase === 'downloading').pop()!
        expect(last.received).toBe(BYTES.length)
        expect(last.total).toBe(BYTES.length)
    })

    test('a digest mismatch is an error and leaves nothing at the final path', async () => {
        const tampered = new TextEncoder().encode('something else entirely!!')
        const { io, binDir } = fakeIO({}, { bytes: tampered })
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(r.message).toContain('checksum')
        expect(existsSync(join(binDir, 'opencode'))).toBe(false)
    })

    test('a release with no digest is refused', async () => {
        const { io, binDir } = fakeIO({}, { rel: release(null) })
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(existsSync(join(binDir, 'opencode'))).toBe(false)
    })

    test('a non-2xx download is an error', async () => {
        const { io, binDir } = fakeIO({
            fetch: (async (url: string | URL | Request) =>
                String(url).includes('api.github.com')
                    ? Response.json(release())
                    : new Response('nope', { status: 404 })) as unknown as typeof fetch,
        })
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(existsSync(join(binDir, 'opencode'))).toBe(false)
    })

    const clean = (binDir: string, tmpDir: string) => {
        expect(existsSync(join(binDir, 'opencode'))).toBe(false)
        expect(readdirSync(tmpDir)).toEqual([])
    }

    test('an unpack failure is an error and leaves nothing behind', async () => {
        const { io, binDir, tmpDir } = fakeIO()
        const base = io.exec!
        io.exec = async (cmd, o) =>
            cmd[0] === 'unzip'
                ? { code: 1, stdout: '', stderr: 'bad zip' }
                : base(cmd, o)
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(r.message).toContain('bad zip')
        clean(binDir, tmpDir)
    })

    test('an archive with no opencode inside is an error', async () => {
        const { io, binDir, tmpDir } = fakeIO()
        const base = io.exec!
        io.exec = async (cmd, o) =>
            cmd[0] === 'unzip'
                ? { code: 0, stdout: '', stderr: '' }
                : base(cmd, o)
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(r.message).toContain('did not contain')
        clean(binDir, tmpDir)
    })

    test('a binary whose --version fails after install is removed', async () => {
        const { io, binDir, tmpDir } = fakeIO()
        const base = io.exec!
        io.exec = async (cmd, o) =>
            cmd[1] === '--version'
                ? { code: 1, stdout: '', stderr: 'boom' }
                : base(cmd, o)
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(r.message).toContain('boom')
        clean(binDir, tmpDir)
    })

    test('a stalled download times out as an error and leaves nothing', async () => {
        const { io, binDir, tmpDir } = fakeIO({ idleTimeoutMs: 50 })
        io.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).includes('api.github.com'))
                return Response.json(release())
            const body = new ReadableStream<Uint8Array>({
                start(c) {
                    c.enqueue(BYTES.slice(0, 5))
                    init?.signal?.addEventListener('abort', () =>
                        c.error(new Error('aborted')),
                    )
                },
            })
            return new Response(body)
        }) as unknown as typeof fetch
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        clean(binDir, tmpDir)
    })

    test('an opencode that will not run is an error, not ready', async () => {
        const { io } = fakeIO({
            which: n => (n === 'opencode' ? '/opt/homebrew/bin/opencode' : null),
        })
        io.exec = async () => ({ code: 1, stdout: '', stderr: 'dyld error' })
        const r = await installFreeAgent(io)
        expect(r.phase).toBe('error')
        expect(r.message).toContain('dyld error')
    })

    test('a broken managed binary is replaced by a fresh download', async () => {
        const { io, binDir } = fakeIO()
        mkdirSync(binDir, { recursive: true })
        const mine = join(binDir, 'opencode')
        writeFileSync(mine, 'broken')
        io.which = n => (n === 'opencode' && existsSync(mine) ? mine : null)
        let first = true
        const base = io.exec!
        io.exec = async (cmd, o) => {
            if (cmd[1] === '--version' && first) {
                first = false
                return { code: 1, stdout: '', stderr: 'corrupt' }
            }
            return base(cmd, o)
        }
        const r = await installFreeAgent(io)
        expect(r).toMatchObject({ phase: 'ready', action: 'installed' })
        expect(existsSync(mine)).toBe(true)
    })

    test('an unsupported platform reports that opencode has no build', async () => {
        const { io, calls } = fakeIO({ platform: 'win32', arch: 'x64' })
        const r = await installFreeAgent(io)
        expect(r).toMatchObject({
            phase: 'error',
            message: 'opencode has no build for this platform',
        })
        expect(calls.fetch).toEqual([])
    })
})

describe('startFreeAgentInstall', () => {
    let release_: (() => void) | undefined
    afterEach(() => release_?.())

    test('a second call while busy starts no second download', async () => {
        const gate = new Promise<void>(res => (release_ = res))
        const { io, calls } = fakeIO()
        const inner = io.fetch!
        io.fetch = (async (...a: Parameters<typeof fetch>) => {
            await gate
            return inner(...a)
        }) as typeof fetch
        const first = startFreeAgentInstall(io)
        const second = startFreeAgentInstall(io)
        expect(first.phase).toBe('downloading')
        expect(second.phase).toBe(first.phase)
        release_!()
        for (let i = 0; i < 200; i++) {
            const ph = getFreeAgentStatus(io).progress.phase
            if (ph === 'ready' || ph === 'error') break
            await Bun.sleep(10)
        }
        expect(getFreeAgentStatus(io).progress.phase).toBe('ready')
        expect(
            calls.fetch.filter(u => u.includes('api.github.com')),
        ).toHaveLength(1)
    })
})

describe('startFreeAgentInstall progress reset', () => {
    test('a stale error is not returned when the next run finds opencode', async () => {
        const bad = fakeIO({}, { rel: release(null) })
        await installFreeAgent(bad.io)
        expect(getFreeAgentStatus(bad.io).progress.phase).toBe('error')
        const ok = fakeIO({
            which: n => (n === 'opencode' ? '/opt/homebrew/bin/opencode' : null),
        })
        const ret = startFreeAgentInstall(ok.io)
        expect(ret.phase).not.toBe('error')
        for (let i = 0; i < 200; i++) {
            if (getFreeAgentStatus(ok.io).progress.phase === 'ready') break
            await Bun.sleep(10)
        }
    })
})

describe('getFreeAgentStatus', () => {
    test('reports managed only for a path under binDir', () => {
        const { io, binDir } = fakeIO({
            which: n => (n === 'opencode' ? `${'/x'}/opencode` : null),
        })
        const s = getFreeAgentStatus(io)
        expect(s.opencode).toEqual({
            installed: true,
            path: '/x/opencode',
            managed: false,
        })
        expect(s.claude.installed).toBe(false)
        const m = getFreeAgentStatus({
            ...io,
            which: n => (n === 'opencode' ? join(binDir, 'opencode') : null),
        })
        expect(m.opencode.managed).toBe(true)
    })
})
