import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    convertHeicToJpeg,
    isHeicName,
    jpegNameFor,
    looksLikeHeic,
} from '../src/heic'
import { AppError } from '../src/error'

// A 8×8 checkerboard PNG, hand-built so the fixture needs no binary blob in the repo. Encoded
// with zlib STORED blocks (deflate's uncompressed mode) so we can emit a valid PNG without a
// compressor: each block is [final?, len LE, ~len LE, raw bytes].
function tinyPng(): Uint8Array {
    const w = 8,
        h = 8
    const raw: number[] = []
    for (let y = 0; y < h; y++) {
        raw.push(0) // filter byte: none
        for (let x = 0; x < w; x++) {
            const v = (x + y) % 2 === 0 ? 255 : 0
            raw.push(v, v, v)
        }
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        return c >>> 0
    })
    const crc32 = (b: number[]): number => {
        let c = 0xffffffff
        for (const byte of b) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
        return (c ^ 0xffffffff) >>> 0
    }
    const be32 = (n: number): number[] => [
        (n >>> 24) & 255,
        (n >>> 16) & 255,
        (n >>> 8) & 255,
        n & 255,
    ]
    const chunk = (type: string, data: number[]): number[] => {
        const body = [...[...type].map(c => c.charCodeAt(0)), ...data]
        return [...be32(data.length), ...body, ...be32(crc32(body))]
    }
    // zlib stream: 0x78 0x01 header, one stored block, adler32 trailer.
    const stored = [
        0x01,
        raw.length & 255,
        (raw.length >> 8) & 255,
        ~raw.length & 255,
        (~raw.length >> 8) & 255,
        ...raw,
    ]
    let a = 1,
        b = 0
    for (const byte of raw) {
        a = (a + byte) % 65521
        b = (b + a) % 65521
    }
    const zlib = [0x78, 0x01, ...stored, ...be32(((b << 16) | a) >>> 0)]
    const ihdr = [...be32(w), ...be32(h), 8, 2, 0, 0, 0] // 8-bit RGB
    return new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...chunk('IHDR', ihdr),
        ...chunk('IDAT', zlib),
        ...chunk('IEND', []),
    ])
}

/** True where we can MINT a HEIC fixture. Only macOS ships an encoder (sips); heic-convert
 *  decodes but cannot encode. The decode tests below key off this so "no fixture" is a real
 *  platform skip on Linux — and a hard FAILURE on macOS, where a silently-absent fixture would
 *  otherwise turn every decode test into a vacuous pass. */
const CAN_MINT_HEIC =
    process.platform === 'darwin' && existsSync('/usr/bin/sips')

/** A REAL HEIC, produced by macOS sips from the PNG above. Throws (never returns null) when
 *  CAN_MINT_HEIC is true, so a broken fixture surfaces as a failing test rather than a skip. */
async function makeHeicFixture(): Promise<Uint8Array | null> {
    if (!CAN_MINT_HEIC) return null
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-heic-fixture-'))
    try {
        const png = join(dir, 'src.png')
        const heic = join(dir, 'src.heic')
        await writeFile(png, tinyPng())
        const proc = Bun.spawn(
            ['/usr/bin/sips', '-s', 'format', 'heic', png, '--out', heic],
            {
                stdout: 'ignore',
                stderr: 'ignore',
            },
        )
        const exit = await proc.exited
        if (exit !== 0)
            throw new Error(
                `sips could not mint the HEIC fixture (exit ${exit})`,
            )
        return new Uint8Array(await readFile(heic))
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}

describe('isHeicName', () => {
    test('matches both Apple extensions, case-insensitively', () => {
        expect(isHeicName('photo.heic')).toBe(true)
        expect(isHeicName('photo.HEIC')).toBe(true)
        expect(isHeicName('photo.heif')).toBe(true)
        expect(isHeicName('/Users/me/Pictures/IMG_0042.HEIF')).toBe(true)
    })

    test('rejects other images and extension-less names', () => {
        for (const n of [
            'photo.jpg',
            'photo.png',
            'heic',
            'photo.heic.txt',
            'a/b.heicx',
        ]) {
            expect(isHeicName(n)).toBe(false)
        }
    })

    test('a directory named .heic does not make its child a HEIC', () => {
        expect(isHeicName('/tmp/album.heic/notes.txt')).toBe(false)
    })
})

describe('jpegNameFor', () => {
    test('swaps the extension and keeps any directory prefix', () => {
        expect(jpegNameFor('photo.heic')).toBe('photo.jpg')
        expect(jpegNameFor('/Users/me/IMG_1.HEIF')).toBe('/Users/me/IMG_1.jpg')
    })

    test('leaves a non-HEIC name untouched', () => {
        expect(jpegNameFor('photo.png')).toBe('photo.png')
        expect(jpegNameFor('README')).toBe('README')
    })
})

describe('looksLikeHeic', () => {
    test('rejects a PNG, a JPEG and truncated input', () => {
        expect(looksLikeHeic(tinyPng())).toBe(false)
        expect(
            looksLikeHeic(
                new Uint8Array([
                    0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0,
                ]),
            ),
        ).toBe(false)
        expect(looksLikeHeic(new Uint8Array([0, 1, 2]))).toBe(false)
    })

    test('rejects an ISO-BMFF container that is NOT HEIF (a plain MP4)', () => {
        // Same `ftyp` box shape, `isom` brand — the box test alone would wrongly accept this.
        const mp4 = new Uint8Array(24)
        mp4.set([...'\0\0\0\x18ftypisomisomiso2'].map(c => c.charCodeAt(0)))
        expect(looksLikeHeic(mp4)).toBe(false)
    })

    test('accepts a real HEIC', async () => {
        const heic = await makeHeicFixture()
        if (!CAN_MINT_HEIC) return // Linux: no encoder to mint a fixture with
        expect(heic).not.toBeNull()
        expect(looksLikeHeic(heic!)).toBe(true)
    })
})

describe('convertHeicToJpeg', () => {
    test('turns a real HEIC into decodable JPEG bytes', async () => {
        const heic = await makeHeicFixture()
        if (!CAN_MINT_HEIC) return
        expect(heic).not.toBeNull()
        const jpeg = await convertHeicToJpeg(heic!)
        // SOI marker + a non-trivial payload: proves we got an image back, not an empty file or
        // the HEIC echoed through unchanged.
        expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
        expect(jpeg.byteLength).toBeGreaterThan(100)
        expect(looksLikeHeic(jpeg)).toBe(false)
    })

    test('the portable (non-sips) engine decodes the same HEIC', async () => {
        const heic = await makeHeicFixture()
        if (!CAN_MINT_HEIC) return
        expect(heic).not.toBeNull()
        // Force the fallback engine that Windows/Linux always take, so macOS CI still exercises it
        // (otherwise sips would mask a broken portable path until someone ran a non-Mac build).
        const { default: convert } =
            (await import('heic-convert')) as unknown as {
                default: (o: {
                    buffer: Uint8Array
                    format: 'JPEG'
                    quality?: number
                }) => Promise<Uint8Array>
            }
        const jpeg = new Uint8Array(
            await convert({ buffer: heic!, format: 'JPEG', quality: 0.92 }),
        )
        expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
        expect(jpeg.byteLength).toBeGreaterThan(100)
    })

    test('rejects non-HEIC input as a 400 instead of surfacing a decoder crash', async () => {
        const caught = await convertHeicToJpeg(tinyPng()).then(
            () => null,
            (e: unknown) => e,
        )
        expect(caught).toBeInstanceOf(AppError)
        expect((caught as AppError).code).toBe('HEIC_DECODE_ERROR')
        expect((caught as AppError).statusCode).toBe(400)
    })
})
