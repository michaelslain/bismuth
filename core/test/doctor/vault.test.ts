import { describe, test, expect, spyOn } from 'bun:test'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { vaultSection } from '../../src/doctor/sections/vault'
import { parseFrontmatter } from '../../src/frontmatter'
import type { Finding } from '../../src/doctor/types'
import { tempDir } from '../helpers'
import { fakeCtx } from './fakeCtx'

const DAY = 24 * 60 * 60 * 1000

function vaultWith(files: Record<string, string> = {}): string {
    const vault = tempDir('doctor-vault-')
    writeFileSync(join(vault, '.settings'), '')
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(vault, rel)
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, content)
    }
    return vault
}

const run = async (vault: string, now?: number): Promise<Finding[]> =>
    vaultSection.check(fakeCtx(now === undefined ? { vault } : { vault, now }))
const find = (fs: Finding[], id: string) => fs.find(f => f.id === id)

describe('vaultSection', () => {
    test('is a vault-needing section named vault', () => {
        expect(vaultSection.id).toBe('vault')
        expect(vaultSection.needsVault).toBe(true)
    })

    test('a clean vault reports nothing', async () => {
        expect(await run(vaultWith())).toEqual([])
    })

    test('no vault in the context reports nothing', async () => {
        expect(await vaultSection.check(fakeCtx())).toEqual([])
    })

    test('settings.yaml at the root: warn, apply moves it, then clean', async () => {
        const vault = tempDir('doctor-vault-')
        writeFileSync(join(vault, 'settings.yaml'), '# mine\nterminal:\n  fontSize: 15\n')
        const f = find(await run(vault), 'vault.settings-location')!
        expect(f.severity).toBe('warn')
        expect(f.repair!.risk).toBe('safe')
        await f.repair!.apply()
        await f.repair!.apply()
        expect(readFileSync(join(vault, '.settings'), 'utf8')).toContain('# mine')
        expect(find(await run(vault), 'vault.settings-location')).toBeUndefined()
    })

    test('the interim .settings/settings.yaml folder is also found', async () => {
        const vault = tempDir('doctor-vault-')
        mkdirSync(join(vault, '.settings'))
        writeFileSync(join(vault, '.settings', 'settings.yaml'), 'terminal:\n  fontSize: 15\n')
        const f = find(await run(vault), 'vault.settings-location')!
        await f.repair!.apply()
        expect(readFileSync(join(vault, '.settings'), 'utf8')).toContain('fontSize: 15')
        expect(find(await run(vault), 'vault.settings-location')).toBeUndefined()
    })

    test('retired daemon.home: info, apply removes it and keeps comments, twice', async () => {
        const vault = tempDir('doctor-vault-')
        writeFileSync(
            join(vault, '.settings'),
            '# my comment\nterminal:\n  fontSize: 15\ndaemon:\n  home: /x\n  autoUpdate: true\nupdate:\n  autoUpdate: true\n',
        )
        const f = find(await run(vault), 'vault.settings-retired-keys')!
        expect(f.severity).toBe('info')
        expect(f.detail).toContain('daemon.home')
        expect(f.detail).toContain('daemon.autoUpdate')
        expect(f.repair!.risk).toBe('safe')
        await f.repair!.apply()
        await f.repair!.apply()
        const after = readFileSync(join(vault, '.settings'), 'utf8')
        expect(after).not.toContain('home:')
        expect(after).toContain('# my comment')
        expect(after).toContain('fontSize: 15')
        // update.autoUpdate is live and must survive
        expect(after).toContain('update:')
        expect(find(await run(vault), 'vault.settings-retired-keys')).toBeUndefined()
    })

    test('emoji task syntax: warn with the file count; repair is safe and is not applied here', async () => {
        const vault = vaultWith({
            'a.md': '- [ ] x 📅 2026-01-01\n',
            'sub/b.md': '- [ ] y ⏫\n',
            'c.md': '- [ ] z [due 2026-01-01]\n',
        })
        const f = find(await run(vault), 'vault.task-syntax')!
        expect(f.severity).toBe('warn')
        expect(f.detail).toContain('2 notes')
        expect(f.repair!.risk).toBe('safe')
    })

    test('task syntax inside .git, .daemon and .trash is ignored', async () => {
        const vault = vaultWith({
            '.daemon/a.md': '- [ ] x 📅 2026-01-01\n',
            '.trash/a.md': '- [ ] x 📅 2026-01-01\n',
            '.git/a.md': '- [ ] x 📅 2026-01-01\n',
        })
        expect(find(await run(vault), 'vault.task-syntax')).toBeUndefined()
    })

    test('a base with one views: entry: info, destructive, apply flattens, then clean', async () => {
        const vault = vaultWith({
            'b.md': '---\ntype: base\nviews:\n  - type: table\n    name: All\n---\nbody\n',
        })
        const f = find(await run(vault), 'vault.base-views-list')!
        expect(f.title).toBe('1 base uses the legacy views: list')
        expect(f.detail).toBe('b.md')
        expect(f.severity).toBe('info')
        expect(f.repair!.risk).toBe('destructive')
        await f.repair!.apply()
        await f.repair!.apply()
        const after = readFileSync(join(vault, 'b.md'), 'utf8')
        expect(after).not.toContain('views:')
        expect(parseFrontmatter(after).data.view).toBe('table')
        expect(after).toContain('body')
        expect((await run(vault)).filter(x => x.id.startsWith('vault.base-views'))).toEqual([])
    })

    test('a vault past the yield interval is still scanned in full (bases after the 200th note found)', async () => {
        const files: Record<string, string> = {}
        for (let i = 0; i < 450; i++) files[`n${String(i).padStart(3, '0')}.md`] = `# note ${i}\n`
        files['z-base.md'] = '---\ntype: base\nviews:\n  - type: table\n---\n'
        const f = find(await run(vaultWith(files)), 'vault.base-views-list')!
        expect(f.detail).toContain('z-base.md')
    })

    test('a base with two views: warn, no repair', async () => {
        const vault = vaultWith({
            'dir/b.md':
                '---\ntype: base\nviews:\n  - type: table\n  - type: list\n---\n',
        })
        const f = find(await run(vault), 'vault.base-views-multi')!
        expect(f.title).toBe('1 base declares more than one view, so writes to it fail')
        expect(f.detail).toBe('dir/b.md')
        expect(f.severity).toBe('warn')
        expect(f.repair).toBeUndefined()
        expect(find(await run(vault), 'vault.base-views-list')).toBeUndefined()
    })

    test('many legacy bases come back as ONE finding; detail stops at 10; one repair flattens all, twice', async () => {
        const files: Record<string, string> = {}
        for (let i = 0; i < 12; i++)
            files[`b${String(i).padStart(2, '0')}.md`] =
                '---\ntype: base\nviews:\n  - type: table\n---\nbody\n'
        const vault = vaultWith(files)
        const fs = (await run(vault)).filter(x => x.id.startsWith('vault.base-views'))
        expect(fs.map(f => f.id)).toEqual(['vault.base-views-list'])
        const f = fs[0]
        expect(f.title).toBe('12 bases use the legacy views: list')
        const lines = f.detail!.split('\n')
        expect(lines).toHaveLength(11)
        expect(lines[0]).toBe('b00.md')
        expect(lines[10]).toBe('+2 more')
        expect(f.repair!.description).toBe(
            'rewrite 12 bases with their single view flattened to top-level keys',
        )
        expect(await f.repair!.apply()).toEqual([])
        const once = readFileSync(join(vault, 'b11.md'), 'utf8')
        expect(once).not.toContain('views:')
        expect(await f.repair!.apply()).toEqual([])
        expect(readFileSync(join(vault, 'b11.md'), 'utf8')).toBe(once)
        expect((await run(vault)).filter(x => x.id.startsWith('vault.base-views'))).toEqual([])
    })

    test('a repair that cannot read one base warns for it and still flattens the rest', async () => {
        const vault = vaultWith({
            'a.md': '---\ntype: base\nviews:\n  - type: table\n---\n',
            'b.md': '---\ntype: base\nviews:\n  - type: table\n---\n',
        })
        const f = find(await run(vault), 'vault.base-views-list')!
        rmSync(join(vault, 'a.md'))
        const warnings = await f.repair!.apply()
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('a.md')
        expect(readFileSync(join(vault, 'b.md'), 'utf8')).not.toContain('views:')
    })

    test('two multi-view bases come back as ONE finding', async () => {
        const body = '---\ntype: base\nviews:\n  - type: table\n  - type: list\n---\n'
        const vault = vaultWith({ 'a.md': body, 'b.md': body })
        const fs = (await run(vault)).filter(x => x.id.startsWith('vault.base-views'))
        expect(fs.map(f => f.id)).toEqual(['vault.base-views-multi'])
        expect(fs[0].title).toBe('2 bases declare more than one view, so writes to them fail')
        expect(fs[0].detail).toBe('a.md\nb.md')
    })

    test('a frontmatter with a collection key raises no yaml warning', async () => {
        const vault = vaultWith({
            'n.md': '---\n? { date }\n: x\ntype: base\nviews:\n  - type: table\n---\n',
        })
        const warned: unknown[] = []
        const orig = process.emitWarning
        process.emitWarning = ((w: unknown) => {
            warned.push(w)
        }) as typeof process.emitWarning
        const spy = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            await run(vault)
        } finally {
            process.emitWarning = orig
        }
        expect(warned).toEqual([])
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    test('a note that is not a base never trips the views check', async () => {
        const vault = vaultWith({ 'n.md': '---\nviews:\n  - a\n---\n' })
        expect(await run(vault)).toEqual([])
    })

    test('empty .ink sidecars: destructive, apply removes the dir, twice', async () => {
        const vault = vaultWith({ '.ink/a.ink': '' })
        const f = find(await run(vault), 'vault.ink-dir')!
        expect(f.severity).toBe('info')
        expect(f.repair!.risk).toBe('destructive')
        await f.repair!.apply()
        await f.repair!.apply()
        expect(existsSync(join(vault, '.ink'))).toBe(false)
        expect(find(await run(vault), 'vault.ink-dir')).toBeUndefined()
    })

    test('non-empty .ink content: info and no repair', async () => {
        const vault = vaultWith({ '.ink/a.ink': '', '.ink/b.ink': '{"strokes":[1]}' })
        const f = find(await run(vault), 'vault.ink-dir')!
        expect(f.severity).toBe('info')
        expect(f.repair).toBeUndefined()
    })

    test('an apply that finds data in .ink since the check leaves it', async () => {
        const vault = vaultWith({ '.ink/a.ink': '' })
        const f = find(await run(vault), 'vault.ink-dir')!
        writeFileSync(join(vault, '.ink', 'a.ink'), 'data')
        const warnings = await f.repair!.apply()
        expect(warnings.length).toBe(1)
        expect(existsSync(join(vault, '.ink', 'a.ink'))).toBe(true)
    })

    test('DAEMON.md: info, no repair', async () => {
        const f = find(await run(vaultWith({ 'DAEMON.md': '# old' })), 'vault.daemon-md')!
        expect(f.severity).toBe('info')
        expect(f.repair).toBeUndefined()
    })

    test('visibility profiles: only those older than 7 days are removed', async () => {
        const vault = vaultWith({
            '.daemon/tmp/visibility-ab.sb': '(old)',
            '.daemon/tmp/visibility-cd.sb': '(new)',
            '.daemon/tmp/other.txt': 'keep',
        })
        const now = Date.now()
        const old = (now - 8 * DAY) / 1000
        utimesSync(join(vault, '.daemon/tmp/visibility-ab.sb'), old, old)
        utimesSync(join(vault, '.daemon/tmp/other.txt'), old, old)
        const f = find(await run(vault, now), 'vault.visibility-profiles')!
        expect(f.repair!.risk).toBe('safe')
        await f.repair!.apply()
        await f.repair!.apply()
        expect(existsSync(join(vault, '.daemon/tmp/visibility-ab.sb'))).toBe(false)
        expect(existsSync(join(vault, '.daemon/tmp/visibility-cd.sb'))).toBe(true)
        expect(existsSync(join(vault, '.daemon/tmp/other.txt'))).toBe(true)
        expect(find(await run(vault, now), 'vault.visibility-profiles')).toBeUndefined()
    })

    test('stale settings.yaml in .git/info/exclude: apply prunes it and keeps the user lines', async () => {
        const vault = vaultWith({
            '.git/info/exclude': '# mine\nscratch/\nsettings.yaml\n',
        })
        const f = find(await run(vault), 'vault.backup-exclude')!
        expect(f.severity).toBe('info')
        expect(f.repair!.risk).toBe('safe')
        await f.repair!.apply()
        await f.repair!.apply()
        const after = readFileSync(join(vault, '.git/info/exclude'), 'utf8')
        expect(after).not.toContain('settings.yaml')
        expect(after).toContain('scratch/')
        expect(after).toContain('# mine')
        expect(find(await run(vault), 'vault.backup-exclude')).toBeUndefined()
    })

    test('finding ids are unique within one report', async () => {
        const vault = vaultWith({
            'DAEMON.md': 'x',
            '.ink/a.ink': '',
            'a.md': '- [ ] x 📅 2026-01-01\n',
        })
        const ids = (await run(vault)).map(f => f.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
})
