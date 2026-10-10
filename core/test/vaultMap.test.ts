import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { buildVaultMap, formatVaultMap, vaultNeighbourhood } from '../src/vaultMap'
import type { DenyEntry } from '../src/visibility'

function put(root: string, rel: string, content: string) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
}

// Three folders; projects/ is a tight clique around hub.md; journal/ holds dated notes.
function fixture(): string {
    const root = tempDir('bismuth-vaultmap-')
    for (let i = 0; i < 12; i++)
        put(
            root,
            `projects/p${i}.md`,
            `---\ntype: project\nstatus: open\n---\nSee [[hub]] and [[p${(i + 1) % 12}]] #work\n- [ ] do thing ${i}\n`,
        )
    put(root, 'projects/hub.md', `# hub\n${Array.from({ length: 12 }, (_, i) => `[[p${i}]]`).join(' ')}\n`)
    for (let i = 1; i <= 12; i++)
        put(root, `journal/2026-09-${String(i).padStart(2, '0')}.md`, `day ${i} [[j-hub]]\n`)
    put(root, 'journal/j-hub.md', '# journal hub\n')
    for (let i = 0; i < 6; i++)
        put(root, `reading/book${i}.md`, `---\ntags: [flashcards]\n---\nbook ${i} [[book${(i + 1) % 6}]] [[book${(i + 2) % 6}]]\n`)
    put(root, 'templates/daily.md', '# template\n')
    put(root, 'views/all.base.jsonl', '{"view":"table"}\n')
    put(root, 'index.md', 'root note [[hub]]\n')
    return root
}

const NOW = new Date(Date.now() + 60_000)

test('folders, surfaces, hubs and clusters', async () => {
    const root = fixture()
    const map = await buildVaultMap(root, { now: NOW })
    expect(map.notes).toBe(12 + 1 + 12 + 1 + 6 + 1 + 1)
    const projects = map.folders.find(f => f.path === 'projects')!
    expect(projects.notes).toBe(13)
    expect(projects.kinds).toContain('project')
    expect(projects.keys).toContain('status')
    expect(projects.recent).toBe(13)
    const journal = map.folders.find(f => f.path === 'journal')!
    expect(journal.naming).toBe('YYYY-MM-DD')
    expect(map.surfaces.dailyFolder).toBe('journal')
    expect(map.surfaces.templatesFolder).toBe('templates')
    expect(map.surfaces.bases).toEqual(['views/all.base.jsonl'])
    expect(map.surfaces.taskNotes).toBe(12)
    expect(map.surfaces.taskFolders).toEqual(['projects'])
    expect(map.surfaces.flashcardNotes).toBe(6)
    expect(map.hubs[0].path).toBe('projects/hub.md')
    expect(map.hubs.length).toBeLessThanOrEqual(10)
    expect(map.clusters.length).toBeGreaterThan(0)
    for (const c of map.clusters) {
        expect(c.size).toBeGreaterThanOrEqual(3)
        expect(c.exemplars.length).toBeLessThanOrEqual(3)
    }
    expect(map.tags.find(t => t.tag === 'work')?.count).toBe(12)
})

test('a vault under the clustering threshold has no clusters', async () => {
    const root = tempDir('bismuth-vaultmap-small-')
    put(root, 'a.md', '[[b]]')
    put(root, 'b.md', '[[a]]')
    put(root, 'c.md', '[[a]]')
    const map = await buildVaultMap(root, { now: NOW })
    expect(map.clusters).toEqual([])
})

test('a denied note contributes to nothing, even as the top hub', async () => {
    const root = fixture()
    const deny: DenyEntry[] = [{ rel: 'projects/hub.md', abs: join(root, 'projects/hub.md') }]
    const map = await buildVaultMap(root, { deny, now: NOW })
    const json = JSON.stringify(map)
    expect(json).not.toContain('projects/hub')
    expect(map.notes).toBe(33)
    expect(map.folders.find(f => f.path === 'projects')!.notes).toBe(12)
    expect(map.hubs.every(h => h.path !== 'projects/hub.md')).toBe(true)
    expect(await vaultNeighbourhood(root, 'projects/hub.md', { deny })).toBeNull()
    const near = await vaultNeighbourhood(root, 'projects/p0.md', { deny })
    expect(near!.outLinks).not.toContain('projects/hub.md')
    expect(formatVaultMap(map, 6000)).not.toContain('projects/hub')
})

test('formatVaultMap respects the budget and keeps every top-level folder', async () => {
    const root = fixture()
    const map = await buildVaultMap(root, { now: NOW })
    const full = formatVaultMap(map, 100_000)
    expect(full).toContain('## recent')
    for (const n of [200, 400, 800, 1500, 3000]) {
        const out = formatVaultMap(map, n)
        expect(out.length).toBeLessThanOrEqual(n)
    }
    const small = formatVaultMap(map, 3000)
    for (const f of ['projects', 'journal', 'reading', 'templates', 'views'])
        expect(small).toContain(`${f}/`)
    const trimmed = formatVaultMap(map, full.length - 1)
    expect(trimmed).not.toContain('## recent')
})

test('vaultNeighbourhood lists links, siblings, tags and memories', async () => {
    const root = fixture()
    const mem = tempDir('bismuth-vaultmap-mem-')
    put(mem, 'about-p0.md', 'thinking about [[p0]]\n')
    put(mem, 'other.md', 'nothing\n')
    const n = await vaultNeighbourhood(root, 'projects/p0.md', { memoryDir: mem })
    expect(n!.path).toBe('projects/p0.md')
    expect(n!.outLinks).toEqual(['projects/hub.md', 'projects/p1.md'])
    expect(n!.backLinks).toContain('projects/hub.md')
    expect(n!.backLinks).toContain('projects/p11.md')
    expect(n!.tags).toEqual(['work'])
    expect(n!.memories).toEqual(['about-p0'])
    expect(n!.siblings).not.toContain('projects/p0.md')
    expect(n!.siblings.some(s => s.startsWith('projects/'))).toBe(true)
    expect(await vaultNeighbourhood(root, 'nope/missing.md')).toBeNull()
})

test('vaultNeighbourhood drops hidden memory notes whatever the root spelling', async () => {
    const root = fixture()
    const mem = join(root, '.daemon', 'memory')
    put(mem, 'open-mem.md', 'about [[p0]]\n')
    put(mem, 'hid-mem.md', '---\nvisibility: hidden\n---\nabout [[p0]]\n')
    put(mem, 'chat-mem.md', '---\nvisibility: chat-only\n---\nabout [[p0]]\n')
    const outside = tempDir('bismuth-vaultmap-outside-')
    put(outside, 'open-mem.md', 'about [[p0]]\n')
    put(outside, 'hid-mem.md', '---\nvisibility: hidden\n---\nabout [[p0]]\n')
    const deny: DenyEntry[] = []
    for (const r of [root, `${root}/`, join(root, 'projects', '..')]) {
        const n = await vaultNeighbourhood(r, 'projects/p0.md', { deny, memoryDir: mem })
        expect(n!.memories).toEqual(['open-mem'])
    }
    const o = await vaultNeighbourhood(root, 'projects/p0.md', { memoryDir: outside })
    expect(o!.memories).toEqual(['open-mem'])
    const chat = await vaultNeighbourhood(root, 'projects/p0.md', { memoryDir: mem, channel: 'chat' })
    expect(chat!.memories).toEqual(['chat-mem', 'open-mem'])
})

test('2000 notes build in a bounded time', async () => {
    const root = tempDir('bismuth-vaultmap-big-')
    for (let i = 0; i < 2000; i++)
        put(root, `f${i % 20}/sub${i % 4}/n${i}.md`, `---\ntype: t${i % 3}\n---\n[[n${(i * 7) % 2000}]] [[n${(i * 13 + 1) % 2000}]] #tag${i % 10}\n`)
    const t0 = performance.now()
    const map = await buildVaultMap(root, { now: NOW })
    const ms = performance.now() - t0
    expect(map.notes).toBe(2000)
    expect(ms).toBeLessThan(3000)
    expect(formatVaultMap(map, 3000).length).toBeLessThanOrEqual(3000)
}, 20_000)

test('40 bases do not push clusters or subfolders out of a 3000 char map', async () => {
    const root = fixture()
    for (let i = 0; i < 40; i++)
        put(root, `views/deep/folder-number-${i}/some-long-base-name-${i}.base.jsonl`, '{"view":"table"}\n')
    for (let i = 0; i < 3; i++) put(root, `reading/shelf/s${i}.md`, `shelf ${i}\n`)
    const map = await buildVaultMap(root, { now: NOW })
    expect(map.clusters.length).toBeGreaterThan(0)
    const out = formatVaultMap(map, 3000)
    expect(out.length).toBeLessThanOrEqual(3000)
    expect(out).toContain('## clusters')
    expect(out).toMatch(/^ {2}- /m)
    expect(out).toContain('bases: 41 (mostly in views')
})

test('the daily folder is the recent dated one, not a bigger archive', async () => {
    const root = tempDir('bismuth-vaultmap-daily-')
    for (let i = 1; i <= 9; i++) put(root, `archive/2020-01-0${i}.md`, 'old\n')
    for (let i = 1; i <= 4; i++) put(root, `self/2026-09-0${i}.md`, 'new\n')
    const old = new Date('2020-01-10')
    const { utimesSync } = await import('node:fs')
    for (let i = 1; i <= 9; i++) utimesSync(join(root, `archive/2020-01-0${i}.md`), old, old)
    const map = await buildVaultMap(root, { now: NOW })
    expect(map.surfaces.dailyFolder).toBe('self')
})

test('a lone typed note does not label a whole folder with its type', async () => {
    const root = tempDir('bismuth-vaultmap-kinds-')
    put(root, 'mix/one.md', '---\ntype: base\n---\nx\n')
    for (let i = 0; i < 9; i++) put(root, `mix/n${i}.md`, `plain ${i}\n`)
    const map = await buildVaultMap(root, { now: NOW })
    expect(map.folders.find(f => f.path === 'mix')!.kinds).toEqual([])
})

test('template placeholder frontmatter builds without yaml warnings', async () => {
    const root = tempDir('bismuth-vaultmap-quiet-')
    put(root, 'tpl.md', '---\ndate: {{date}}\ntitle: {{title}}\n---\nbody\n')
    put(root, 'b.md', 'plain\n')
    const warns: unknown[] = []
    const origWarn = console.warn
    const origEmit = process.emitWarning
    console.warn = (...a: unknown[]) => void warns.push(a)
    process.emitWarning = ((w: unknown) => void warns.push(w)) as typeof process.emitWarning
    try {
        await buildVaultMap(root, { now: NOW })
    } finally {
        console.warn = origWarn
        process.emitWarning = origEmit
    }
    expect(warns).toEqual([])
})
