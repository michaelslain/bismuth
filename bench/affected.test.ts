import { test, expect } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

test('an untracked new story file is treated as changed and mapped to its prefix', async () => {
    // A DOT directory on purpose: Storybook's `../src/**/*.stories.*` glob skips dot-directories, so a
    // running Storybook never indexes the probe. A visible name made the watcher index the file, then
    // read it after the rmSync below and serve index.json as HTTP 500 until something forced a re-index.
    // `git ls-files --others` (what bench/affected.ts reads) still lists it, so the test is unchanged.
    const dir = join(ROOT, 'app/src/.affectedProbe')
    try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'Probe.stories.tsx'), "export default { title: 'Affected Probe Untracked' }\n")
        const p = Bun.spawn(['bun', 'bench/affected.ts', '--prefixes'], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' })
        const out = await new Response(p.stdout).text()
        await p.exited
        expect(out.split('\n')).toContain('affected-probe-untracked')
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
