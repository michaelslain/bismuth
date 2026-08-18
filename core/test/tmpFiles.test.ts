import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    utimes,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
    pruneTmpFiles,
    safeTmpName,
    stageTmpFile,
    tmpFilesDir,
} from '../src/tmpFiles'

let dir: string
let prevEnv: string | undefined

beforeEach(async () => {
    prevEnv = process.env.BISMUTH_TMP_DIR
    dir = await mkdtemp(join(tmpdir(), 'bismuth-tmpfiles-test-'))
    process.env.BISMUTH_TMP_DIR = join(dir, 'tmp')
})

afterEach(async () => {
    if (prevEnv === undefined) delete process.env.BISMUTH_TMP_DIR
    else process.env.BISMUTH_TMP_DIR = prevEnv
    await rm(dir, { recursive: true, force: true })
})

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('safeTmpName', () => {
    test('reduces a traversal-shaped name to a single harmless segment', () => {
        expect(safeTmpName('../../.ssh/authorized_keys')).toBe(
            'authorized_keys',
        )
        expect(safeTmpName('/etc/passwd')).toBe('passwd')
        expect(safeTmpName('a\\b\\c.txt')).toBe('c.txt')
    })

    test('strips leading dots so a staged file can never be a dotfile', () => {
        expect(safeTmpName('.bashrc')).toBe('bashrc')
        expect(safeTmpName('...')).toBe('file')
    })

    test('falls back to a boring name when nothing usable is left', () => {
        expect(safeTmpName('')).toBe('file')
        expect(safeTmpName('///')).toBe('file')
        expect(safeTmpName('   ')).toBe('file')
    })

    test('drops control characters and caps the length', () => {
        expect(safeTmpName('a\x00b\x1fc.txt')).toBe('abc.txt')
        expect(
            safeTmpName('x'.repeat(500) + '.txt').length,
        ).toBeLessThanOrEqual(120)
    })

    test('keeps an ordinary name untouched', () => {
        expect(safeTmpName('IMG_0042.HEIC')).toBe('IMG_0042.HEIC')
        expect(safeTmpName('quarterly report.pdf')).toBe('quarterly report.pdf')
    })
})

describe('stageTmpFile', () => {
    test('writes the bytes and returns an absolute path inside the scratch dir', async () => {
        const path = await stageTmpFile('notes.txt', bytes('hello'))
        expect(path.startsWith('/')).toBe(true)
        expect(dirname(path)).toBe(tmpFilesDir())
        expect(new TextDecoder().decode(await readFile(path))).toBe('hello')
    })

    test('a traversal-shaped name cannot escape the scratch dir', async () => {
        const path = await stageTmpFile('../../../../tmp/pwned.txt', bytes('x'))
        expect(dirname(path)).toBe(tmpFilesDir())
        expect(path.endsWith('/pwned.txt')).toBe(true)
    })

    test('de-collides repeats instead of overwriting, keeping the extension', async () => {
        const a = await stageTmpFile('photo.jpg', bytes('first'))
        const b = await stageTmpFile('photo.jpg', bytes('second'))
        const c = await stageTmpFile('photo.jpg', bytes('third'))
        expect(new Set([a, b, c]).size).toBe(3)
        for (const p of [a, b, c]) expect(p.endsWith('.jpg')).toBe(true)
        // The first file must still hold its ORIGINAL bytes — the point of de-colliding.
        expect(new TextDecoder().decode(await readFile(a))).toBe('first')
        expect(new TextDecoder().decode(await readFile(b))).toBe('second')
    })

    test('accepts an ArrayBuffer as well as a Uint8Array (the /tmp-file route hands over both)', async () => {
        const src = bytes('buffered')
        const path = await stageTmpFile(
            'b.bin',
            src.buffer.slice(0) as ArrayBuffer,
        )
        expect(new TextDecoder().decode(await readFile(path))).toBe('buffered')
    })

    test('creates the scratch dir on first use', async () => {
        await expect(stat(tmpFilesDir())).rejects.toThrow()
        await stageTmpFile('first.txt', bytes('x'))
        expect((await stat(tmpFilesDir())).isDirectory()).toBe(true)
    })
})

describe('pruneTmpFiles', () => {
    test('deletes entries older than the max age and keeps fresh ones', async () => {
        const old = await stageTmpFile('old.txt', bytes('old'))
        const fresh = await stageTmpFile('fresh.txt', bytes('fresh'))
        // Age `old` by backdating its mtime two days — prune reads mtime, so this is the real signal
        // rather than a stubbed clock.
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        await utimes(old, twoDaysAgo, twoDaysAgo)

        const removed = await pruneTmpFiles()

        expect(removed).toBe(1)
        const left = await readdir(tmpFilesDir())
        expect(left).toEqual(['fresh.txt'])
        expect(new TextDecoder().decode(await readFile(fresh))).toBe('fresh')
    })

    test('keeps everything when nothing has aged out', async () => {
        await stageTmpFile('a.txt', bytes('a'))
        await stageTmpFile('b.txt', bytes('b'))
        expect(await pruneTmpFiles()).toBe(0)
        expect((await readdir(tmpFilesDir())).length).toBe(2)
    })

    test('removes a stale sub-DIRECTORY too, not just files', async () => {
        const sub = join(tmpFilesDir(), 'leftover')
        await Bun.write(join(sub, 'inner.txt'), 'x')
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        await utimes(sub, twoDaysAgo, twoDaysAgo)
        expect(await pruneTmpFiles()).toBe(1)
        expect(await readdir(tmpFilesDir())).toEqual([])
    })

    test('is a no-op (never throws) when the scratch dir does not exist', async () => {
        expect(await pruneTmpFiles()).toBe(0)
    })

    test('respects an explicit max age', async () => {
        const p = await stageTmpFile('a.txt', bytes('a'))
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
        await utimes(p, tenMinAgo, tenMinAgo)
        expect(await pruneTmpFiles(60 * 60 * 1000)).toBe(0) // 1h window — too young
        expect(await pruneTmpFiles(5 * 60 * 1000)).toBe(1) // 5m window — aged out
    })

    test('BISMUTH_TMP_DIR overrides the default location', async () => {
        const custom = join(dir, 'elsewhere')
        process.env.BISMUTH_TMP_DIR = custom
        expect(tmpFilesDir()).toBe(custom)
        const p = await stageTmpFile('x.txt', bytes('x'))
        expect(dirname(p)).toBe(custom)
        await writeFile(join(custom, 'sentinel'), 's')
        expect((await readdir(custom)).sort()).toEqual(['sentinel', 'x.txt'])
    })
})
