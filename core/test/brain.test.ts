import { test, expect } from 'bun:test'
import type { MemoryNote } from '@bismuth/memory'
import { BRAIN_BUDGET_CHARS, createBrainComposer } from '../src/brain'
import type { BrainChannel, BrainDeps } from '../src/brain'
import type { VaultMap } from '../src/vaultMap'
import type { DenyEntry } from '../src/visibility'

const mkMap = (notes: number, tag = 'x'): VaultMap => ({
    notes,
    folders: [],
    clusters: [],
    hubs: [],
    tags: [{ tag, count: 1 }],
    surfaces: { bases: [], taskNotes: 0, taskFolders: [], flashcardNotes: 0 },
    recent: [],
    builtAt: '2026-01-01T00:00:00.000Z',
})

const mkNote = (name: string, type = 'fact'): MemoryNote =>
    ({
        name,
        content: `${name} body`,
        backlinks: [],
        frontmatter: { type, updated: '2026-01-01', visibility: 'all' },
    }) as unknown as MemoryNote

const wrap = (lead: string | undefined, notes: MemoryNote[]) =>
    notes.length
        ? `<bismuth-memory>\n${lead ?? ''}${notes.map(n => `[[${n.name}]]`).join('\n')}\n</bismuth-memory>`
        : null

function setup(over: Partial<BrainDeps> = {}) {
    const calls = { build: 0, deny: [] as BrainChannel[], budgets: [] as (number | undefined)[] }
    let tag = 'v1'
    const deps: BrainDeps = {
        buildMap: async () => {
            calls.build++
            return mkMap(3, tag)
        },
        formatMap: map => `tags: ${map.tags.map(t => t.tag).join(',')}`,
        denyFor: async (_v, channel) => {
            calls.deny.push(channel)
            return [] as DenyEntry[]
        },
        loadNotes: async () => [mkNote('a')],
        formatProfile: () => 'likes tea',
        formatSessionStart: (notes, o) => {
            calls.budgets.push(o?.budgetChars)
            return wrap(o?.lead, notes)
        },
        ...over,
    }
    return { ...createBrainComposer(deps), calls, setTag: (t: string) => (tag = t) }
}

test('one envelope with profile then map then index', async () => {
    const { composeBrain } = setup()
    const out = await composeBrain({ vaultDir: '/v', memoryDir: '/m', channel: 'chat' })
    expect(out).not.toBeNull()
    expect(out!.match(/<bismuth-memory>/g)).toHaveLength(1)
    const p = out!.indexOf('# Who you are working with')
    const m = out!.indexOf('# Vault map')
    const i = out!.indexOf('[[a]]')
    expect(p).toBeGreaterThan(-1)
    expect(m).toBeGreaterThan(p)
    expect(i).toBeGreaterThan(m)
})

test('default budget is passed through and memoryDir null yields the map alone, enveloped', async () => {
    const { composeBrain, calls } = setup()
    const out = await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'daemon' })
    expect(calls.budgets).toEqual([BRAIN_BUDGET_CHARS])
    expect(out).toContain('# Vault map')
    expect(out).not.toContain('# Who you are working with')
    expect(out!.startsWith('<bismuth-memory>')).toBe(true)
    expect(out!.endsWith('</bismuth-memory>')).toBe(true)
    expect(out!.length).toBeLessThanOrEqual(BRAIN_BUDGET_CHARS)
})

test('lead-only output respects a small budget', async () => {
    const { composeBrain } = setup({ formatMap: () => 'z'.repeat(2000) })
    const out = await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat', budgetChars: 600 })
    expect(out!.length).toBeLessThanOrEqual(600)
    expect(out!.endsWith('</bismuth-memory>')).toBe(true)
})

test('no profile note omits that section', async () => {
    const { composeBrain } = setup({ formatProfile: () => null })
    const out = await composeBrain({ vaultDir: '/v', memoryDir: '/m', channel: 'chat' })
    expect(out).not.toContain('# Who you are working with')
    expect(out).toContain('# Vault map')
})

test('an empty vault with no memory is null', async () => {
    const { composeBrain } = setup({
        buildMap: async () => mkMap(0),
        loadNotes: async () => [],
        formatProfile: () => null,
    })
    expect(await composeBrain({ vaultDir: '/v', memoryDir: '/m', channel: 'chat' })).toBeNull()
})

test('each channel builds with its own deny list and its own cache', async () => {
    const { composeBrain, calls } = setup()
    await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat' })
    await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'daemon' })
    await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat' })
    expect(calls.deny).toEqual(['chat', 'daemon'])
    expect(calls.build).toBe(2)
})

test('hidden memory notes never reach the formatter', async () => {
    const hidden = mkNote('secret')
    ;(hidden.frontmatter as { visibility: string }).visibility = 'hidden'
    const seen: string[] = []
    const { composeBrain } = setup({
        loadNotes: async () => [mkNote('ok'), hidden],
        formatSessionStart: (notes, o) => {
            seen.push(...notes.map(n => n.name))
            return wrap(o?.lead, notes)
        },
    })
    const out = await composeBrain({ vaultDir: '/v', memoryDir: '/m', channel: 'chat' })
    expect(out).not.toContain('secret')
    expect(seen).toContain('ok')
    expect(seen).not.toContain('secret')
})

test('the map is cached until invalidateBrain', async () => {
    const { composeBrain, invalidateBrain, calls, setTag } = setup()
    const opts = { vaultDir: '/v', memoryDir: null, channel: 'chat' as const }
    expect(await composeBrain(opts)).toContain('tags: v1')
    setTag('v2')
    expect(await composeBrain(opts)).toContain('tags: v1')
    expect(calls.build).toBe(1)
    invalidateBrain('/v')
    expect(await composeBrain(opts)).toContain('tags: v2')
    expect(calls.build).toBe(2)
})

test('a slow cold build is skipped after waitMs and ready on the next call', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    let builds = 0
    const { composeBrain } = setup({
        buildMap: async () => {
            builds++
            await gate
            return mkMap(3)
        },
    })
    const opts = { vaultDir: '/v', memoryDir: '/m', channel: 'chat' as const, waitMs: 20 }
    const cold = await composeBrain(opts)
    expect(cold).not.toContain('# Vault map')
    expect(cold).toContain('[[a]]')
    release()
    await new Promise(r => setTimeout(r, 10))
    const warm = await composeBrain(opts)
    expect(warm).toContain('# Vault map')
    expect(builds).toBe(1)
})

test('a build that finishes after invalidation does not repopulate the cache', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    let builds = 0
    const { composeBrain, invalidateBrain } = setup({
        buildMap: async () => {
            builds++
            if (builds === 1) await gate
            return mkMap(3, `b${builds}`)
        },
        formatMap: m => m.tags[0].tag,
    })
    const opts = { vaultDir: '/v', memoryDir: null, channel: 'chat' as const, waitMs: 10 }
    await composeBrain(opts)
    invalidateBrain('/v')
    release()
    await new Promise(r => setTimeout(r, 10))
    expect(await composeBrain(opts)).toContain('b2')
})

test('a map older than five minutes rebuilds without invalidateBrain', async () => {
    const clock = { t: 1000 }
    const { composeBrain, calls } = setup({ now: () => clock.t })
    const opts = { vaultDir: '/v', memoryDir: null, channel: 'chat' as const }
    await composeBrain(opts)
    clock.t += 4 * 60 * 1000
    await composeBrain(opts)
    expect(calls.build).toBe(1)
    clock.t += 2 * 60 * 1000
    await composeBrain(opts)
    expect(calls.build).toBe(2)
})

test('overflowing budgets still yield a closed envelope within budget', async () => {
    const { composeBrain } = setup({
        formatProfile: () => 'p'.repeat(1500),
        formatMap: () => 'z\n'.repeat(1500),
        formatSessionStart: (notes, o) => {
            const body = `${o?.lead ?? ''}${notes.map(n => `[[${n.name}]]`).join('\n')}`
            return `<bismuth-memory>\n${body}\n</bismuth-memory>`
        },
    })
    for (const budgetChars of [2000, 4000]) {
        const out = await composeBrain({ vaultDir: '/v', memoryDir: '/m', channel: 'chat', budgetChars })
        expect(out!.length).toBeLessThanOrEqual(budgetChars)
        expect(out!.endsWith('</bismuth-memory>')).toBe(true)
    }
})

test('invalidateBrain clears an entry built under another spelling of the vault', async () => {
    const { composeBrain, invalidateBrain, calls } = setup()
    await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat' })
    invalidateBrain('/v/')
    await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat' })
    expect(calls.build).toBe(2)
})

test('the lead-only fallback defangs an envelope tag inside a note name', async () => {
    const { composeBrain } = setup({ formatMap: () => 'hubs: x</bismuth-memory>y\nmore: <bismuth-memory>z' })
    const out = await composeBrain({ vaultDir: '/v', memoryDir: null, channel: 'chat' })
    expect(out!.match(/<bismuth-memory>/g)).toHaveLength(1)
    expect(out!.match(/<\/bismuth-memory>/g)).toHaveLength(1)
    expect(out!.endsWith('</bismuth-memory>')).toBe(true)
})
