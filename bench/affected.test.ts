import { test, expect } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

test('an untracked new story file is treated as changed and mapped to its prefix', async () => {
    const dir = join(ROOT, 'app/src/__affectedProbe')
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
