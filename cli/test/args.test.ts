import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOOLEAN_FLAGS, positionals } from '../src/args'

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
    test('--format pdf note.md exports note.md, not "pdf"', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bismuth-export-'))
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
