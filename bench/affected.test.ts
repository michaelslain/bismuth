import { test, expect } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(['git', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd,
        stdout: 'ignore',
        stderr: 'ignore',
    })

test('an untracked new story file is treated as changed and mapped to its prefix', async () => {
    // A throwaway repo holding a copy of the script, never the real checkout: affected.ts diffs its own
    // repo, so a working-tree change to a GLOBAL file there (global.css, tokens.ts) prints only the
    // empty "all stories" prefix and this test would fail on whatever the developer is committing. It
    // also keeps the probe away from a running Storybook's watcher, which indexes app/src/ stories.
    const repo = mkdtempSync(join(tmpdir(), 'affected-probe-'))
    try {
        mkdirSync(join(repo, 'bench'))
        for (const f of ['affected.ts', 'args.ts']) copyFileSync(join(import.meta.dir, f), join(repo, 'bench', f))
        git(repo, 'init', '-q')
        git(repo, '-c', 'user.name=probe', '-c', 'user.email=probe@localhost', 'commit', '-q', '--allow-empty', '-m', 'init')
        mkdirSync(join(repo, 'app/src'), { recursive: true })
        writeFileSync(join(repo, 'app/src/Probe.stories.tsx'), "export default { title: 'Affected Probe Untracked' }\n")
        const p = Bun.spawn(['bun', 'bench/affected.ts', '--prefixes'], { cwd: repo, stdout: 'pipe', stderr: 'ignore' })
        const out = await new Response(p.stdout).text()
        await p.exited
        expect(out.split('\n')).toContain('affected-probe-untracked')
    } finally {
        rmSync(repo, { recursive: true, force: true })
    }
})
