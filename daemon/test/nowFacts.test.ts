import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { NOW_FACTS_PLACEHOLDER, nowFacts } from '../src/daemon/nowFacts.ts'
import { substituteNowFacts } from '../src/daemon/cron.ts'
import { vaultPaths } from '../src/lib/config.ts'

const NOW = new Date('2026-11-06T12:00:00Z')
const DAY = 86_400_000

let root: string
let memory: string

function put(rel: string, content: string, ageDays = 0) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
    const t = new Date(NOW.getTime() - ageDays * DAY)
    utimesSync(p, t, t)
}

const day = (name: string, desc: string, type = 'daily') =>
    put(`.daemon/memory/${name}.md`, `---\nname: ${name}\ntype: ${type}\ndescription: ${desc}\n---\n\nbody\n`)

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bismuth-nowfacts-'))
    memory = join(root, '.daemon', 'memory')
    mkdirSync(memory, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('the placeholder is {{nowFacts}}', () => {
    expect(NOW_FACTS_PLACEHOLDER).toBe('{{nowFacts}}')
})

test('an empty vault gives (none) in every section', async () => {
    const out = await nowFacts(root, memory, NOW)
    expect(out.match(/\(none\)/g)?.length).toBe(3)
})

test('lists due tasks in date order within 7 days, skipping done, later and undated tasks', async () => {
    put(
        'projects/a.md',
        [
            '- [ ] write report [due 2026-11-09]',
            '- [ ] pay rent [due 2026-11-07]',
            '- [x] finished thing [due 2026-11-08]',
            '- [ ] far away [due 2026-12-30]',
            '- [ ] no date',
        ].join('\n'),
    )
    const out = await nowFacts(root, memory, NOW)
    expect(out).toContain('- pay rent [due 2026-11-07] — [[projects/a]]')
    expect(out).toContain('- write report [due 2026-11-09] — [[projects/a]]')
    expect(out.indexOf('pay rent')).toBeLessThan(out.indexOf('write report'))
    expect(out).not.toContain('finished thing')
    expect(out).not.toContain('far away')
    expect(out).not.toContain('no date')
})

test('counts folders with notes modified in the last 7 days; old notes and dot folders are left out', async () => {
    put('projects/a.md', 'x', 1)
    put('projects/b.md', 'x', 2)
    put('journal/c.md', 'x', 3)
    put('journal/old.md', 'x', 30)
    put('.hidden/d.md', 'x', 0)
    const out = await nowFacts(root, memory, NOW)
    expect(out).toContain('- projects: 2 notes')
    expect(out).toContain('- journal: 1 note\n')
    expect(out).not.toContain('.hidden')
    expect(out.indexOf('projects: 2')).toBeLessThan(out.indexOf('journal: 1'))
})

test('a path the daemon channel may not read is excluded from tasks and folders', async () => {
    put('.settings', 'folderVisibility:\n  private: hidden\n')
    put('private/secret.md', '- [ ] secret errand [due 2026-11-07]', 0)
    put('open/ok.md', '- [ ] open errand [due 2026-11-07]', 0)
    const out = await nowFacts(root, memory, NOW)
    expect(out).toContain('open errand')
    expect(out).not.toContain('secret errand')
    expect(out).not.toContain('- private:')
})

test('names the 3 newest day notes with their descriptions; other daily-looking notes are ignored', async () => {
    day('day-2026-11-01', 'one')
    day('day-2026-11-03', 'three')
    day('day-2026-11-04', 'four')
    day('day-2026-11-05', 'five')
    day('day-notes', 'not a digest')
    day('day-2026-11-06', 'wrong type', 'fact')
    const out = await nowFacts(root, memory, NOW)
    expect(out).toContain('- [[day-2026-11-05]] five')
    expect(out).toContain('- [[day-2026-11-04]] four')
    expect(out).toContain('- [[day-2026-11-03]] three')
    expect(out).not.toContain('day-2026-11-01')
    expect(out).not.toContain('day-notes')
    expect(out).not.toContain('wrong type')
})

test('stays within 2,500 characters however much there is', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- [ ] task number ${i} with some words [due 2026-11-08]`)
    put('big.md', lines.join('\n'))
    expect((await nowFacts(root, memory, NOW)).length).toBeLessThanOrEqual(2500)
})

test('cron substitutes {{nowFacts}} everywhere and leaves a prompt without it unchanged', async () => {
    put('a.md', '- [ ] pay rent [due 2026-11-07]')
    const ctx = vaultPaths(root)
    // the real clock is used by cron, so only the shape is pinned here
    const out = await substituteNowFacts('x {{nowFacts}} y {{nowFacts}}', ctx)
    expect(out).not.toContain('{{nowFacts}}')
    expect(out).toContain('### Tasks due before')
    expect(await substituteNowFacts('no placeholder', ctx)).toBe('no placeholder')
})

test('today and the 7-day horizon follow the local calendar', async () => {
    const late = new Date(2026, 10, 6, 23, 30)
    const out = await nowFacts(root, memory, late)
    expect(out).toContain('today is 2026-11-06')
    expect(out).toContain('due before 2026-11-13')
})
