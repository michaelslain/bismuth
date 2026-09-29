import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOOLEAN_FLAGS, bool, flag, positionals } from '../src/args'

describe('flag', () => {
    test('--name value', () => {
        expect(flag(['--vault', '/v'], 'vault')).toBe('/v')
        expect(flag(['--vault'], 'vault')).toBeUndefined()
    })

    test('--name=value', () => {
        expect(flag(['--vault=/v'], 'vault')).toBe('/v')
    })

    test('--name= is the empty string', () => {
        expect(flag(['--vault='], 'vault')).toBe('')
    })

    test('a value containing = splits on the first =', () => {
        expect(flag(['--q=a=b'], 'q')).toBe('a=b')
    })

    test('both spellings: first occurrence wins', () => {
        expect(flag(['--vault=/a', '--vault', '/b'], 'vault')).toBe('/a')
        expect(flag(['--vault', '/b', '--vault=/a'], 'vault')).toBe('/b')
    })

    test('a longer name sharing the prefix does not match', () => {
        expect(flag(['--vaults=/x'], 'vault')).toBeUndefined()
    })
})

describe('bool', () => {
    test('exact match only: --pretty=1 is not true', () => {
        expect(bool(['--pretty'], 'pretty')).toBe(true)
        expect(bool(['--pretty=1'], 'pretty')).toBe(false)
    })
})

describe('positionals', () => {
    test('boolean flag first does not swallow the positional', () => {
        expect(positionals(['--pretty', 'a.md'])).toEqual(['a.md'])
        expect(positionals(['--regex', 'foo'])).toEqual(['foo'])
    })

    test('boolean flag last keeps the positional', () => {
        expect(positionals(['a.md', '--pretty'])).toEqual(['a.md'])
    })

    test('valued flag first consumes its value', () => {
        expect(positionals(['--vault', '/v', 'a.md'])).toEqual(['a.md'])
    })

    test('valued flag last keeps the positional', () => {
        expect(positionals(['a.md', '--vault', '/v'])).toEqual(['a.md'])
    })

    test('--name=value is a single token', () => {
        expect(positionals(['--vault=/v', 'a.md'])).toEqual(['a.md'])
        expect(positionals(['a.md', '--vault=/v'])).toEqual(['a.md'])
    })

    test('status is valued by default, boolean when the caller says so', () => {
        expect(BOOLEAN_FLAGS).not.toContain('status')
        expect(positionals(['--status', 'open', 'a.md'])).toEqual(['a.md'])
        expect(positionals(['--status', 'a.md'], ['status'])).toEqual(['a.md'])
    })
})

describe('export file pick', () => {
    const dirs: string[] = []
    afterEach(() => {
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    })

    test('--format md note.md exports note.md, not "md"', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bismuth-export-'))
        dirs.push(dir)
        mkdirSync(join(dir, 'vault'))
        writeFileSync(join(dir, 'vault', 'note.md'), '# hi\n')
        const outFile = join(dir, 'out.md')
        const proc = Bun.spawn(
            [
                'bun',
                join(import.meta.dir, '../src/index.ts'),
                'export',
                '--format',
                'md',
                'note.md',
                '--out',
                outFile,
                '--vault',
                join(dir, 'vault'),
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const code = await proc.exited
        expect(code).toBe(0)
        expect(readFileSync(outFile, 'utf8')).toContain('hi')
    })
})
