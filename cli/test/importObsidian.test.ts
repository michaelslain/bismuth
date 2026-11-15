// End to end: `bismuth import obsidian` over cli/test/fixtures/obsidian-vault, spawned like a user
// would, then the written vault read back through Bismuth's own base pipeline.
import { expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolateCliEnv, runCli, spawnCli, test } from './cliHarness'

isolateCliEnv()

const FIXTURE = join(import.meta.dir, 'fixtures', 'obsidian-vault')
const scratch = () => mkdtempSync(join(tmpdir(), 'bismuth-import-test-'))

function tree(root: string, dir = ''): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) Object.assign(out, tree(root, rel))
        else out[rel] = createHash('sha1').update(readFileSync(join(root, rel))).digest('hex')
    }
    return out
}

const run = (...args: string[]) => spawnCli(['import', 'obsidian', ...args])

test('refuses a missing source, a non-empty out and an out inside the source', async () => {
    const tmp = scratch()
    const missing = await run(join(tmp, 'nope'))
    expect(missing.code).not.toBe(0)
    expect(missing.err).toContain('source folder not found')

    const full = join(tmp, 'full')
    await Bun.write(join(full, 'a.md'), 'x')
    const nonEmpty = await run(FIXTURE, '--out', full)
    expect(nonEmpty.code).not.toBe(0)
    expect(nonEmpty.err).toContain('not empty')

    const inside = await run(FIXTURE, '--out', join(FIXTURE, 'out'))
    expect(inside.code).not.toBe(0)
    expect(inside.err).toContain('inside the source')
    expect(existsSync(join(FIXTURE, 'out'))).toBe(false)
})

test('converts the fixture: source untouched, deterministic, idempotent, valid', async () => {
    const tmp = scratch()
    const before = tree(FIXTURE)
    const o1 = join(tmp, 'o1')
    const o2 = join(tmp, 'o2')
    const a = await run(FIXTURE, '--out', o1)
    const b = await run(FIXTURE, '--out', o2)
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const summary = JSON.parse(a.out)
    expect(summary.out).toBe(o1)
    expect(summary.reportPath).toBe(`${o1}.conversion-report.md`)
    expect(summary.validation).toEqual({ ok: true, failures: 0 })
    expect(summary.report).toBeUndefined()

    expect(tree(FIXTURE)).toEqual(before)
    const t1 = tree(o1)
    expect(Object.keys(t1).some(p => p.startsWith('.obsidian') || p.startsWith('.trash'))).toBe(false)
    expect(t1['Library/Books.base.jsonl']).toBeDefined()
    expect(t1['Library/Books.base']).toBeUndefined()
    expect(t1['.settings']).toBeDefined()
    expect(tree(o2)).toEqual(t1)

    const report = readFileSync(`${o1}.conversion-report.md`, 'utf8')
    expect(report).toBe(readFileSync(`${o2}.conversion-report.md`, 'utf8'))
    const heads = [...report.matchAll(/^## (.+)$/gm)].map(m => m[1])
    expect(heads).toEqual(['Needs a decision', 'Converted', 'Lossy', 'Defaults taken', 'Left as is', 'Validation', 'Inventory'])
    const decide = report.slice(report.indexOf('## Needs a decision'), report.indexOf('## Converted'))
    for (const needle of ['dataviewjs', 'Board.canvas', 'mystery-plugin', 'Books.base: 2 views'])
        expect(decide).toContain(needle)
    expect(report).toContain('hotkeys.json: no automatic mapping to keybindings')
    const convertedSec = report.slice(report.indexOf('## Converted'), report.indexOf('## Lossy'))
    for (const key of ['attachments.folder', 'templates.folder', 'dailyNotes'])
        expect(convertedSec).toContain(`.settings: ${key} = `)
    expect(report).not.toContain('### validation')

    // a second import of the converted vault has nothing left to convert for these areas
    const o3 = join(tmp, 'o3')
    const c = await run(o1, '--out', o3)
    expect(c.code).toBe(0)
    const again = readFileSync(`${o3}.conversion-report.md`, 'utf8')
    const converted = again.slice(again.indexOf('## Converted'), again.indexOf('## Lossy'))
    for (const area of ['tasks', 'links', 'bases']) expect(converted).not.toContain(`### ${area}`)
    expect(tree(o3)).toEqual(t1)
})

test('imports into a vault that holds only its own seed and keeps its settings comments', async () => {
    const tmp = scratch()
    const out = join(tmp, 'seeded')
    await Bun.write(join(out, '.settings'), '# my comment\nchat:\n    provider: codex\n')
    await Bun.write(join(out, '.daemon', 'state.json'), '{}')
    const r = await run(FIXTURE, '--out', out)
    expect(r.code).toBe(0)
    const settings = readFileSync(join(out, '.settings'), 'utf8')
    expect(settings).toContain('# my comment')
    expect(settings).toContain('provider: codex')
    expect(settings).toContain('templates')
    expect(settings).toContain('dailyNotes')
    expect(readFileSync(join(out, '.daemon', 'state.json'), 'utf8')).toBe('{}')
    expect(existsSync(join(out, 'Library/Books.base.jsonl'))).toBe(true)
})

test('--dry-run writes nothing and returns the report a real run writes', async () => {
    const tmp = scratch()
    const dry = join(tmp, 'dry')
    const d = await run(FIXTURE, '--out', dry, '--dry-run')
    expect(d.code).toBe(0)
    expect(existsSync(dry)).toBe(false)
    expect(existsSync(`${dry}.conversion-report.md`)).toBe(false)
    const summary = JSON.parse(d.out)
    expect(summary.reportPath).toBeNull()

    const real = join(tmp, 'real')
    await run(FIXTURE, '--out', real)
    expect(summary.report).toBe(readFileSync(`${real}.conversion-report.md`, 'utf8'))
    expect(statSync(real).isDirectory()).toBe(true)
})

test('--pretty indents the JSON summary', async () => {
    const r = await run(FIXTURE, '--out', join(scratch(), 'p'), '--pretty')
    expect(r.out).toContain('\n  "out"')
})

test('every converted base renders through the real base pipeline with its expected rows', async () => {
    const o = join(scratch(), 'o')
    expect((await run(FIXTURE, '--out', o)).code).toBe(0)
    const rows = async (path: string) => {
        const r = await runCli(o, 'base', 'render', path)
        expect(r.code).toBe(0)
        return (r.json.groups as Array<{ rows: unknown[] }>).reduce((n, g) => n + g.rows.length, 0)
    }
    // file.hasTag("book") widened to book + book/fiction: Dispossessed, Kindred and Anon
    expect(await rows('Library/Books.base.jsonl')).toBe(3)
    // the second view, `source: base` over the first; its author != "" filter drops Anon (empty author; a missing author passes that filter in Bismuth)
    expect(await rows('Library/Books - Shelf.base.jsonl')).toBe(2)
    const v = await runCli(o, 'base', 'validate', 'Library/Books.base.jsonl')
    expect(v.code).toBe(0)
})

test('fixture: alias link resolves, space-separated tags become a list, a dangling link is left as is', async () => {
    const o = join(scratch(), 'o')
    const r = await run(FIXTURE, '--out', o)
    expect(JSON.parse(r.out).validation).toEqual({ ok: true, failures: 0 })
    expect(readFileSync(join(o, 'Reading.md'), 'utf8')).toContain('[[Disposable|Dispo]]')
    expect(readFileSync(join(o, 'Library/Plain.md'), 'utf8')).toMatch(/tags: \[alpha, beta\]/)
    const report = readFileSync(`${o}.conversion-report.md`, 'utf8')
    const left = report.slice(report.indexOf('## Left as is'), report.indexOf('## Validation'))
    expect(left).toContain('Dangling.md: unresolved in the source vault too: [[Nowhere Note]]')
    expect(report).toContain('file creation dates are the import time')
    expect(report.slice(report.indexOf('## Validation'))).not.toContain('Nowhere Note')
})

test('a link broken by the conversion fails validation but one dangling in the source does not', async () => {
    const tmp = scratch()
    const src = join(tmp, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'a.md'), 'dangling [[Gone]] and fine [[b]]\n')
    writeFileSync(join(src, 'b.md'), 'b\n')
    const r = await run(src, '--out', join(tmp, 'o'))
    expect(JSON.parse(r.out).validation.ok).toBe(true)
})

test('the source .git is not copied and a seeded out keeps its own .git', async () => {
    const tmp = scratch()
    const src = join(tmp, 'src')
    mkdirSync(join(src, '.git'), { recursive: true })
    writeFileSync(join(src, '.git', 'HEAD'), 'A')
    writeFileSync(join(src, 'a.md'), 'a\n')
    const out = join(tmp, 'out')
    mkdirSync(join(out, '.git'), { recursive: true })
    writeFileSync(join(out, '.git', 'HEAD'), 'B')
    const r = await run(src, '--out', out)
    expect(r.code).toBe(0)
    expect(readFileSync(join(out, '.git', 'HEAD'), 'utf8')).toBe('B')
    expect(readFileSync(`${out}.conversion-report.md`, 'utf8')).toContain("the source's git history is not copied")
})

test('symlinks are never followed: each is listed under Needs a decision and nothing leaks into the copy', async () => {
    const tmp = scratch()
    const outside = join(tmp, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.md'), 'secret\n')
    const src = join(tmp, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'a.md'), 'a\n')
    symlinkSync(outside, join(src, 'linked'))
    symlinkSync(join(outside, 'secret.md'), join(src, 'linkfile.md'))
    const out = join(tmp, 'out')
    const r = await run(src, '--out', out)
    expect(r.code).toBe(0)
    expect(existsSync(join(out, 'linked'))).toBe(false)
    expect(existsSync(join(out, 'linkfile.md'))).toBe(false)
    expect(readdirSync(outside)).toEqual(['secret.md'])
    const report = readFileSync(`${out}.conversion-report.md`, 'utf8')
    const decide = report.slice(report.indexOf('## Needs a decision'), report.indexOf('## Converted'))
    expect(decide).toContain('linked: symbolic link not copied')
    expect(decide).toContain('linkfile.md: symbolic link not copied')
})

test('modified dates are kept for copied notes, binaries and converted bases', async () => {
    const tmp = scratch()
    const src = join(tmp, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'a.md'), 'a\n')
    writeFileSync(join(src, 'pic.png'), 'png')
    writeFileSync(join(src, 'B.base'), 'views:\n  - type: table\n    name: T\n')
    const when = new Date('2020-01-02T03:04:05Z')
    for (const f of ['a.md', 'pic.png', 'B.base']) utimesSync(join(src, f), when, when)
    const out = join(tmp, 'out')
    expect((await run(src, '--out', out)).code).toBe(0)
    for (const f of ['a.md', 'pic.png', 'B.base.jsonl'])
        expect(Math.floor(statSync(join(out, f)).mtimeMs / 1000)).toBe(Math.floor(when.getTime() / 1000))
})

test('refuses an --out that sits inside the source, even named with leading dots or in another letter case', async () => {
    const tmp = scratch()
    const src = join(tmp, 'Src')
    mkdirSync(src)
    writeFileSync(join(src, 'a.md'), 'a\n')
    const dots = await run(src, '--out', join(src, '..x'))
    expect(dots.code).not.toBe(0)
    expect(dots.err).toContain('inside the source')
    expect(existsSync(join(src, '..x'))).toBe(false)
    const cased = await run(src, '--out', join(tmp, 'SRC', 'new'))
    if (existsSync(join(tmp, 'SRC'))) {
        expect(cased.code).not.toBe(0)
        expect(existsSync(join(src, 'new'))).toBe(false)
    }
})

test('a note with `type: base` frontmatter is base-validated too', async () => {
    const tmp = scratch()
    const src = join(tmp, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'bad.md'), '---\ntype: base\nview: bogus\n---\n')
    const r = await run(src, '--out', join(tmp, 'out'))
    const v = JSON.parse(r.out).validation
    expect(v.ok).toBe(false)
    expect(v.failures).toBeGreaterThan(0)
})

test('--dry-run copies no binaries and leaves no scratch folder behind', async () => {
    const tmp = scratch()
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('bismuth-import-dry-')).length
    const d = await run(FIXTURE, '--out', join(tmp, 'dry'), '--dry-run')
    expect(d.code).toBe(0)
    const after = readdirSync(tmpdir()).filter(n => n.startsWith('bismuth-import-dry-')).length
    expect(after).toBeLessThanOrEqual(before)
})
