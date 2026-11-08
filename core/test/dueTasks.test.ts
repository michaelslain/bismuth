import { test, expect } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dueTasks } from '../src/dueTasks'
import { tempDir } from './tempDirs'

function vault(files: Record<string, string>): string {
    const root = tempDir('bismuth-due-')
    for (const [rel, body] of Object.entries(files)) {
        const p = join(root, rel)
        mkdirSync(join(p, '..'), { recursive: true })
        writeFileSync(p, body)
    }
    return root
}

test('open tasks due before the date, earliest first; done, later and undated tasks are left out', async () => {
    const root = vault({
        'a.md': '- [ ] b task [due 2026-11-09]\n- [ ] a task [due 2026-11-07]\n- [x] done [due 2026-11-08]\n- [ ] far [due 2026-12-30]\n- [ ] undated\n',
    })
    try {
        const out = await dueTasks(root, { before: '2026-11-13', deny: [] })
        expect(out).toEqual([
            { text: 'a task', due: '2026-11-07', path: 'a.md' },
            { text: 'b task', due: '2026-11-09', path: 'a.md' },
        ])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('a denied path contributes no task', async () => {
    const root = vault({
        'open.md': '- [ ] ok [due 2026-11-07]\n',
        'private/s.md': '- [ ] secret [due 2026-11-07]\n',
    })
    try {
        const deny = [{ rel: 'private/s.md', abs: join(root, 'private/s.md') }]
        const out = await dueTasks(root, { before: '2026-11-13', deny })
        expect(out.map(t => t.text)).toEqual(['ok'])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
