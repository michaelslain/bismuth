// core/test/daemonMemory.test.ts
// Unit tests for core/src/daemonMemory.ts — the daemon page's memory panel: list/search this
// vault's 3rd-brain notes, and forget one. Fixture notes are written via @bismuth/memory's own
// `writeNote` so they round-trip through the exact reader the daemon/relay/MCP use.
import { tempDir } from './helpers'
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeNote, type NoteFrontmatter } from '@bismuth/memory'
import { listDaemonMemory, forgetDaemonMemory } from '../src/daemonMemory'

let dir: string

function fm(overrides: Partial<NoteFrontmatter> = {}): NoteFrontmatter {
    return {
        type: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        ...overrides,
    }
}

beforeEach(() => {
    dir = tempDir('daemon-memory-fixture-')
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

test('listDaemonMemory lists every visible note, sorted by updated desc', async () => {
    await writeNote(
        'alpha',
        fm({ updated: '2026-01-01' }),
        'Alpha note body.',
        dir,
    )
    await writeNote(
        'beta',
        fm({ type: 'project', updated: '2026-01-05' }),
        'Beta note body.',
        dir,
    )
    await writeNote(
        'gamma',
        fm({ type: 'person', updated: '2026-01-03' }),
        'Gamma note body.',
        dir,
    )

    const list = await listDaemonMemory(dir, '', 50)
    expect(list.total).toBe(3)
    expect(list.items.map(i => i.name)).toEqual(['beta', 'gamma', 'alpha'])
})

test('listDaemonMemory excludes chat-only/hidden notes from both the list and the total', async () => {
    await writeNote('visible', fm(), 'visible body', dir)
    await writeNote(
        'secret',
        fm({ visibility: 'hidden' }),
        'secret body',
        dir,
    )
    await writeNote(
        'muted',
        fm({ visibility: 'chat-only' }),
        'muted body',
        dir,
    )

    const list = await listDaemonMemory(dir, '', 50)
    expect(list.total).toBe(1)
    expect(list.items.map(i => i.name)).toEqual(['visible'])
})

test('listDaemonMemory with q searches by relevance, but total stays the full visible count', async () => {
    await writeNote(
        'housing',
        fm(),
        'Signed the lease on the new apartment.',
        dir,
    )
    await writeNote(
        'unrelated',
        fm(),
        'Completely different topic entirely, nothing to do with that.',
        dir,
    )

    const list = await listDaemonMemory(dir, 'lease apartment', 50)
    expect(list.total).toBe(2)
    expect(list.items.map(i => i.name)).toEqual(['housing'])
})

test('listDaemonMemory caps items at limit, but total is unaffected', async () => {
    for (let i = 0; i < 5; i++) {
        await writeNote(
            `note-${i}`,
            fm({ updated: `2026-01-0${i + 1}` }),
            `body ${i}`,
            dir,
        )
    }
    const list = await listDaemonMemory(dir, '', 2)
    expect(list.total).toBe(5)
    expect(list.items.length).toBe(2)
})

test('listDaemonMemory shapes each item: path, name, type, updated, excerpt (first non-empty line, ≤160 chars)', async () => {
    const longLine = 'x'.repeat(200)
    await writeNote(
        'note-a',
        fm({ type: 'workflow', updated: '2026-02-02' }),
        `\n\n${longLine}\nsecond line`,
        dir,
    )
    const list = await listDaemonMemory(dir, '', 50)
    expect(list.items).toHaveLength(1)
    const item = list.items[0]
    expect(item.path).toBe('.daemon/memory/note-a.md')
    expect(item.name).toBe('note-a')
    expect(item.type).toBe('workflow')
    expect(item.updated).toBe('2026-02-02')
    expect(item.excerpt).toBe(longLine.slice(0, 160))
    expect(item.excerpt.length).toBe(160)
})

test('listDaemonMemory never throws — degrades to {total:0, items:[]} on a read failure', async () => {
    // Point at a path that can't be a directory (a file occupying it), so the memory
    // reader's own mkdir fails and the function must degrade rather than throw.
    const bogus = join(dir, 'not-a-dir')
    writeFileSync(bogus, 'x')
    const list = await listDaemonMemory(join(bogus, 'nested'), '', 50)
    expect(list).toEqual({ total: 0, items: [] })
})

test("forgetDaemonMemory deletes a note by its vault-relative path (returned by listDaemonMemory)", () => {
    return (async () => {
        await writeNote('to-delete', fm(), 'body', dir)
        await forgetDaemonMemory(dir, '.daemon/memory/to-delete.md')
        const list = await listDaemonMemory(dir, '', 50)
        expect(list.items.map(i => i.name)).not.toContain('to-delete')
        expect(list.total).toBe(0)
    })()
})

test('forgetDaemonMemory rejects a path outside .daemon/memory/ with a 400 EINVAL', async () => {
    await expect(forgetDaemonMemory(dir, '.settings')).rejects.toThrow(
        expect.objectContaining({ code: 'EINVAL', statusCode: 400 }),
    )
})

test('forgetDaemonMemory rejects a path carrying a `..` traversal segment with a 400 EINVAL', async () => {
    await expect(
        forgetDaemonMemory(dir, '.daemon/memory/../../etc/passwd'),
    ).rejects.toThrow(
        expect.objectContaining({ code: 'EINVAL', statusCode: 400 }),
    )
})

test('forgetDaemonMemory 404s (ENOENT) on an unknown note', async () => {
    await expect(
        forgetDaemonMemory(dir, '.daemon/memory/nope.md'),
    ).rejects.toThrow(
        expect.objectContaining({ code: 'ENOENT', statusCode: 404 }),
    )
})

test('forgetDaemonMemory rejects a leading-dash name with a 400 EINVAL instead of deleting the sanitized-collision note', async () => {
    await writeNote('housing', fm(), 'body', dir)
    await expect(
        forgetDaemonMemory(dir, '.daemon/memory/-housing.md'),
    ).rejects.toThrow(
        expect.objectContaining({ code: 'EINVAL', statusCode: 400 }),
    )
    const list = await listDaemonMemory(dir, '', 50)
    expect(list.items.map(i => i.name)).toContain('housing')
})

test('forgetDaemonMemory rejects an empty name (".md") with a 400 EINVAL', async () => {
    await expect(
        forgetDaemonMemory(dir, '.daemon/memory/.md'),
    ).rejects.toThrow(
        expect.objectContaining({ code: 'EINVAL', statusCode: 400 }),
    )
})
