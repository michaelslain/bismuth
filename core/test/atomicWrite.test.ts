import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic, writeFileAtomicSync } from '../src/atomicWrite'
import { tempDir } from './tempDirs'

function scratch(): string {
    return tempDir('atomic-')
}

describe('writeFileAtomic', () => {
    test('sync writes content, replaces existing, leaves no tmp', () => {
        const dir = scratch()
        const f = join(dir, 'a.json')
        writeFileAtomicSync(f, 'one')
        writeFileAtomicSync(f, 'two')
        expect(readFileSync(f, 'utf8')).toBe('two')
        expect(readdirSync(dir)).toEqual(['a.json'])
        rmSync(dir, { recursive: true })
    })

    test('async writes string + bytes, leaves no tmp', async () => {
        const dir = scratch()
        await writeFileAtomic(join(dir, 's'), 'hi')
        await writeFileAtomic(join(dir, 'b'), new Uint8Array([1, 2, 3]))
        expect(readFileSync(join(dir, 's'), 'utf8')).toBe('hi')
        expect([...readFileSync(join(dir, 'b'))]).toEqual([1, 2, 3])
        expect(readdirSync(dir).sort()).toEqual(['b', 's'])
        rmSync(dir, { recursive: true })
    })

    test('mode is honoured, sync and async', async () => {
        const dir = scratch()
        writeFileAtomicSync(join(dir, 'x'), 'x', { mode: 0o600 })
        await writeFileAtomic(join(dir, 'y'), 'y', { mode: 0o600 })
        expect(statSync(join(dir, 'x')).mode & 0o777).toBe(0o600)
        expect(statSync(join(dir, 'y')).mode & 0o777).toBe(0o600)
        rmSync(dir, { recursive: true })
    })

    test('failure throws and leaves no tmp behind', async () => {
        const dir = scratch()
        // destination is a non-empty directory, so the rename fails after the tmp is written
        const target = join(dir, 'd')
        writeFileAtomicSync(join(dir, 'seed'), 's')
        require('node:fs').mkdirSync(join(target, 'sub'), { recursive: true })
        expect(() => writeFileAtomicSync(target, 'x')).toThrow()
        await expect(writeFileAtomic(target, 'x')).rejects.toThrow()
        expect(readdirSync(dir).sort()).toEqual(['d', 'seed'])
        rmSync(dir, { recursive: true })
    })

    test('concurrent async writes to one file all land intact', async () => {
        const dir = scratch()
        const f = join(dir, 'c')
        await Promise.all(
            Array.from({ length: 20 }, (_, i) => writeFileAtomic(f, `v${i}`)),
        )
        expect(readFileSync(f, 'utf8')).toMatch(/^v\d+$/)
        expect(readdirSync(dir)).toEqual(['c'])
        rmSync(dir, { recursive: true })
    })
})
