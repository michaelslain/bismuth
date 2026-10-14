import { test, expect } from 'bun:test'
import {
    writeFileSync,
    symlinkSync,
    lstatSync,
    readFileSync,
    chmodSync,
    statSync,
    readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { writeBinaryAtomic } from '../src/files'
import { tempDir } from './helpers'

const bytes = new Uint8Array([1, 2, 3, 4])

test('a symlinked file stays a symlink and the target gets the bytes', async () => {
    const root = tempDir('wba-')
    const outside = tempDir('wba-out-')
    const target = join(outside, 'real.pdf')
    writeFileSync(target, 'old')
    symlinkSync(target, join(root, 'a.pdf'))
    await writeBinaryAtomic(root, 'a.pdf', bytes)
    expect(lstatSync(join(root, 'a.pdf')).isSymbolicLink()).toBe(true)
    expect([...readFileSync(target)]).toEqual([...bytes])
    expect(readdirSync(outside)).toEqual(['real.pdf'])
})

test('the mode of the replaced file is kept', async () => {
    const root = tempDir('wba-')
    const p = join(root, 'b.pdf')
    writeFileSync(p, 'old')
    chmodSync(p, 0o400)
    await writeBinaryAtomic(root, 'b.pdf', bytes)
    expect(statSync(p).mode & 0o7777).toBe(0o400)
    expect([...readFileSync(p)]).toEqual([...bytes])
})

test('a new file in a new folder is created', async () => {
    const root = tempDir('wba-')
    await writeBinaryAtomic(root, 'sub/c.pdf', bytes)
    expect([...readFileSync(join(root, 'sub/c.pdf'))]).toEqual([...bytes])
    expect(readdirSync(join(root, 'sub'))).toEqual(['c.pdf'])
})
