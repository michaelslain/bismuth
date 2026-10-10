import { test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { THEMES } from '../../core/src/theme/tokens'
import { DESIGN_TOKENS } from '../../core/src/theme/designTokens'
import { parseCustomTheme } from '../../core/src/theme/customTheme'
import { useSpawnBudget } from '../../core/test/spawnBudget'

useSpawnBudget()

async function run(vault: string, ...args: string[]) {
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', ...args, '--vault', vault],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } },
    )
    const [o, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    let json: any
    try {
        json = JSON.parse(o)
    } catch {}
    return { code, json, err, text: o.trim() }
}

test('create -> validate -> use -> settings get', async () => {
    const v = makeVault({ '.settings': '# s\n', 'a.md': '# a\n' })
    const c = await run(v, 'theme', 'create', 'dusk', '--label', 'Dusk')
    expect(c.code).toBe(0)
    expect(c.json).toEqual({ path: '.themes/dusk.yaml', name: 'dusk' })
    const val = await run(v, 'theme', 'validate', 'dusk')
    expect(val.code).toBe(0)
    expect(val.json.ok).toBe(true)
    const u = await run(v, 'theme', 'use', 'dusk')
    expect(u.code).toBe(0)
    expect(u.json).toEqual({ ok: true, theme: 'dusk' })
    expect(readFileSync(join(v, '.settings'), 'utf8')).toContain('theme: dusk')
    const g = await run(v, 'settings', 'get', '--key', 'appearance.theme')
    expect(g.code).toBe(0)
    expect(g.text).toBe('dusk')
    const l = await run(v, 'theme', 'list')
    expect(l.json.active).toBe('dusk')
    expect(l.json.themes.map((t: any) => t.name)).toEqual([
        'ink', 'paper', 'cathode', 'riso', 'dusk',
    ])
    expect(l.json.themes[4]).toMatchObject({ label: 'Dusk', extends: 'ink', valid: true, tokens: 0 })
    expect(l.json.configured).toBe('dusk')
})

test('--from cathode round-trips its tokens; show returns them', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    expect((await run(v, 'theme', 'create', 'neon', '--from', 'cathode')).code).toBe(0)
    const p = parseCustomTheme('neon', readFileSync(join(v, '.themes/neon.yaml'), 'utf8'))
    expect(p.theme?.colors).toEqual({ ...THEMES.cathode, isLight: false })
    expect(p.theme?.extends).toBe('cathode')
    expect(p.theme?.label).toBe('Neon')
    const s = await run(v, 'theme', 'show', 'neon')
    expect(s.json).toMatchObject({ name: 'neon', label: 'Neon', extends: 'cathode', diagnostics: [] })
    // a custom --from keeps its extends and carries its overrides
    expect((await run(v, 'theme', 'create', 'neon2', '--from', 'neon')).code).toBe(0)
    const p2 = parseCustomTheme('neon2', readFileSync(join(v, '.themes/neon2.yaml'), 'utf8'))
    expect(p2.theme?.extends).toBe('cathode')
    expect(p2.theme?.colors).toEqual({ ...THEMES.cathode, isLight: false })
    const b = await run(v, 'theme', 'show', 'riso')
    expect(b.json).toMatchObject({ extends: 'riso', label: 'Riso' })
})

test('refusals', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    expect((await run(v, 'theme', 'create', 'ink')).code).toBe(1)
    expect((await run(v, 'theme', 'create', 'Bad Name')).code).toBe(1)
    expect((await run(v, 'theme', 'create', 'x', '--from', 'nope')).code).toBe(1)
    expect((await run(v, 'theme', 'create', 'x')).code).toBe(0)
    expect((await run(v, 'theme', 'create', 'x')).code).toBe(1)
    expect((await run(v, 'theme', 'create', 'x', '--force')).code).toBe(0)
    expect((await run(v, 'theme', 'use', 'ghost')).code).toBe(1)
    expect((await run(v, 'theme', 'show', 'ghost')).code).toBe(1)
})

test('invalid theme: validate exits 1 naming the field, use writes nothing', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    await run(v, 'theme', 'create', 'bad', '--from', 'ink')
    const f = join(v, '.themes/bad.yaml')
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^  accent: .*$/m, "  accent: 'purple-ish'"))
    const r = await run(v, 'theme', 'validate', 'bad')
    expect(r.code).toBe(1)
    expect(r.json.ok).toBe(false)
    expect(r.err).toContain('accent: not a color: purple-ish')
    const all = await run(v, 'theme', 'validate')
    expect(all.code).toBe(1)
    const u = await run(v, 'theme', 'use', 'bad')
    expect(u.code).toBe(1)
    expect(readFileSync(join(v, '.settings'), 'utf8')).not.toContain('bad')
    const l = await run(v, 'theme', 'list')
    expect(l.json.themes.find((t: any) => t.name === 'bad').valid).toBe(false)
})

test('use works while appearance.theme already names a custom theme', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    await run(v, 'theme', 'create', 'one')
    await run(v, 'theme', 'create', 'two')
    expect((await run(v, 'theme', 'use', 'one')).code).toBe(0)
    expect((await run(v, 'theme', 'use', 'two')).code).toBe(0)
    expect((await run(v, 'theme', 'use', 'ink')).code).toBe(0)
})

test('tokens: count, group and kind filters, unknown values exit 1', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    const all = await run(v, 'theme', 'tokens')
    expect(all.json.length).toBe(DESIGN_TOKENS.length)
    const m = await run(v, 'theme', 'tokens', '--group', 'motion')
    expect(m.json.map((t: any) => t.key)).toContain('motion-scale')
    const k = await run(v, 'theme', 'tokens', '--kind', 'color')
    expect(k.json.every((t: any) => t.kind === 'color')).toBe(true)
    const bad = await run(v, 'theme', 'tokens', '--group', 'nope')
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('valid groups')
    expect((await run(v, 'theme', 'tokens', '--kind', 'nope')).code).toBe(1)
})

test('create is minimal without --from, honours --extends', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    expect((await run(v, 'theme', 'create', 'dusk', '--extends', 'paper')).code).toBe(0)
    const text = readFileSync(join(v, '.themes/dusk.yaml'), 'utf8')
    expect(text).toContain('tokens: {}')
    const p = parseCustomTheme('dusk', text)
    expect(p.theme?.extends).toBe('paper')
    expect(p.theme?.colors).toEqual({ ...THEMES.paper, isLight: true })
    expect((await run(v, 'theme', 'create', 'x', '--extends', 'nope')).code).toBe(1)
})

test('create --from paper is full and parses back to paper', async () => {
    const v = makeVault({ '.settings': '# s\n' })
    expect((await run(v, 'theme', 'create', 'dusk', '--from', 'paper')).code).toBe(0)
    const p = parseCustomTheme('dusk', readFileSync(join(v, '.themes/dusk.yaml'), 'utf8'))
    expect(p.theme?.extends).toBe('paper')
    expect(p.theme?.colors).toEqual({ ...THEMES.paper, isLight: true })
})

test('list: configured dusk while active is ink when dusk.yaml is invalid', async () => {
    const v = makeVault({
        '.settings': 'appearance:\n  theme: dusk\n',
        '.themes/dusk.yaml': "tokens:\n  accent: 'purple-ish'\n",
    })
    const l = await run(v, 'theme', 'list')
    expect(l.json.configured).toBe('dusk')
    expect(l.json.active).toBe('ink')
    const unset = await run(makeVault({ '.settings': '# s\n' }), 'theme', 'list')
    expect(unset.json.configured).toBeNull()
})

test('validate: stderr lines, built-in name exits 1', async () => {
    const v = makeVault({
        '.settings': '# s\n',
        '.themes/bad.yaml': "tokens:\n  accent: 'purple-ish'\n",
    })
    const r = await run(v, 'theme', 'validate', 'bad')
    expect(r.code).toBe(1)
    expect(r.err).toContain('bad: accent: not a color: purple-ish')
    expect((await run(v, 'theme', 'validate', 'ink')).code).toBe(1)
})
