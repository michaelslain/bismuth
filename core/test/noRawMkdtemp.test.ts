import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// core/test/tempDirs.ts: a raw mkdtemp is untracked and leaks. Test files allocate with tempDir().
// relay, memory and mcp carry their own copy of the helper (they do not import core's test helpers).
const ROOT = join(import.meta.dir, '..', '..')
const WORKSPACES: { dir: string; allowed: string[]; globs: string[] }[] = [
    { dir: 'core', allowed: ['test/tempDirs.ts', 'test/tempDirs.test.ts', 'test/noRawMkdtemp.test.ts'], globs: ['test/**/*.ts', 'src/**/*.test.ts'] },
    { dir: 'relay', allowed: ['test/tempDirs.ts'], globs: ['test/**/*.ts', 'src/**/*.test.ts'] }, // src globs guard future colocated tests
    { dir: 'memory', allowed: ['test/tempDirs.ts'], globs: ['test/**/*.ts', 'src/**/*.test.ts'] },
    { dir: 'mcp', allowed: ['test/tempDirs.ts'], globs: ['test/**/*.ts', 'src/**/*.test.ts'] },
]
const RAW = /\bmkdtemp(Sync)?\s*\(/

test('no core, relay, memory or mcp test file calls mkdtemp directly', () => {
    const offenders: string[] = []
    for (const { dir, allowed, globs } of WORKSPACES) {
        const cwd = join(ROOT, dir)
        const files = globs.flatMap(g => [...new Glob(g).scanSync({ cwd })])
        for (const f of files) {
            if (allowed.includes(f)) continue
            if (RAW.test(readFileSync(join(cwd, f), 'utf8'))) offenders.push(join(dir, f))
        }
    }
    expect(offenders).toEqual([])
})
