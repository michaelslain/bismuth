import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from '../src/server'
import { makeSampleVault } from './helpers'

// Point the chat scratch dir at a throwaway location for this whole file. Without it, both the
// POST /tmp-file route AND createServer()'s boot-time prune would reach into the real
// ~/.bismuth/tmp.
process.env.BISMUTH_TMP_DIR = mkdtempSync(join(tmpdir(), 'bismuth-intake-tmp-'))
const SCRATCH = process.env.BISMUTH_TMP_DIR

const CAN_MINT_HEIC =
    process.platform === 'darwin' && existsSync('/usr/bin/sips')

/** A real HEIC minted by sips (macOS only) — same approach as heic.test.ts, kept local so this
 *  file can be read on its own. */
async function heicFixture(): Promise<Uint8Array | null> {
    if (!CAN_MINT_HEIC) return null
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-intake-heic-'))
    try {
        const png = join(dir, 's.png'),
            heic = join(dir, 's.heic')
        // A 1×1 PNG is enough — the route test cares about transport, not image content.
        await writeFile(
            png,
            Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64',
            ),
        )
        const proc = Bun.spawn(
            ['/usr/bin/sips', '-s', 'format', 'heic', png, '--out', heic],
            {
                stdout: 'ignore',
                stderr: 'ignore',
            },
        )
        if ((await proc.exited) !== 0)
            throw new Error('sips could not mint the HEIC fixture')
        return new Uint8Array(await readFile(heic))
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}

test('POST /convert/heic returns JPEG bytes for a real HEIC', async () => {
    const heic = await heicFixture()
    if (!CAN_MINT_HEIC) return // no encoder on this platform to build the fixture with
    expect(heic).not.toBeNull()

    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const r = await fetch(`http://localhost:${server.port}/convert/heic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: heic! as unknown as BodyInit,
        })
        expect(r.status).toBe(200)
        expect(r.headers.get('content-type')).toBe('image/jpeg')
        const out = new Uint8Array(await r.arrayBuffer())
        // JPEG SOI — and NOT the HEIC echoed back unchanged.
        expect([out[0], out[1]]).toEqual([0xff, 0xd8])
        expect(out.byteLength).toBeGreaterThan(100)
        expect(out.byteLength).not.toBe(heic!.byteLength)
    } finally {
        server.stop()
    }
})

test('POST /convert/heic rejects non-HEIC bytes with 400, not 500', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const r = await fetch(`http://localhost:${server.port}/convert/heic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new TextEncoder().encode(
                'this is not an image at all',
            ) as unknown as BodyInit,
        })
        // 400 is what lets the composer say "that file isn't a readable photo" rather than
        // surfacing an opaque server error.
        expect(r.status).toBe(400)
    } finally {
        server.stop()
    }
})

test('POST /tmp-file stages bytes outside the vault and returns the absolute path', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const r = await fetch(
            `http://localhost:${server.port}/tmp-file?name=${encodeURIComponent('report.pdf')}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: new TextEncoder().encode(
                    '%PDF-1.4 fake',
                ) as unknown as BodyInit,
            },
        )
        expect(r.status).toBe(200)
        const { path } = (await r.json()) as { path: string }

        expect(dirname(path)).toBe(SCRATCH)
        // The whole point of staging: NOT in the vault, so a file dropped into a chat never becomes
        // a tracked vault attachment.
        expect(path.startsWith(vault)).toBe(false)
        expect(new TextDecoder().decode(await readFile(path))).toBe(
            '%PDF-1.4 fake',
        )
    } finally {
        server.stop()
    }
})

test('POST /tmp-file cannot be walked out of the scratch dir by a hostile name', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const hostile = '../../../../../../tmp/bismuth-escaped-marker.txt'
        const r = await fetch(
            `http://localhost:${server.port}/tmp-file?name=${encodeURIComponent(hostile)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: new TextEncoder().encode('x') as unknown as BodyInit,
            },
        )
        expect(r.status).toBe(200)
        const { path } = (await r.json()) as { path: string }
        expect(dirname(path)).toBe(SCRATCH)
        expect(existsSync('/tmp/bismuth-escaped-marker.txt')).toBe(false)
        expect(
            (await readdir(SCRATCH)).some(
                f => f === 'bismuth-escaped-marker.txt',
            ),
        ).toBe(true)
    } finally {
        server.stop()
    }
})

test('POST /tmp-file requires a name', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    try {
        const r = await fetch(`http://localhost:${server.port}/tmp-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new TextEncoder().encode('x') as unknown as BodyInit,
        })
        expect(r.status).toBe(400)
    } finally {
        server.stop()
    }
})
