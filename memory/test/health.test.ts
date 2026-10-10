import { describe, test, expect } from 'bun:test'
import type { MemoryNote } from '../src/graph.ts'
import { brainHealth, formatBrainHealth } from '../src/health.ts'

const links = (content: string) => [...content.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1]!)
const note = (
    name: string,
    content: string,
    type: string = 'fact',
    extra: Partial<MemoryNote['frontmatter']> = {},
): MemoryNote => ({
    name,
    frontmatter: { type: type as MemoryNote['frontmatter']['type'], tags: [], created: '2026-01-01', updated: '2026-01-01', ...extra },
    content,
    backlinks: links(content),
})

const now = new Date('2026-10-08T12:00:00Z')
const kinds = (notes: MemoryNote[], opts: Parameters<typeof brainHealth>[1] = { now }) =>
    brainHealth(notes, { now, ...opts }).items

// The shape seen in practice: a 9-14 KB person note of "Oct 7: overdue at 18" status lines.
const personBody = () => {
    const days = ['Sep 3', 'Sep 9', 'Sep 12', 'Sep 15', 'Sep 18', 'Sep 21', 'Oct 1', 'Oct 3', 'Oct 5', 'Oct 6', 'Oct 7', 'Oct 7']
    const status = days.map(d => `- ${d}: overdue at 18, 4 due this week, inbox at 31, nothing resolved yet`).join('\n')
    return `# Michael\n\n## Current status\n${status}\n\n## Background\n${'Builds Bismuth and keeps a long running log of what happened. '.repeat(120)}`
}

describe('brainHealth', () => {
    test('a long hub is not oversized', () => {
        const hub = note('michael', `# Michael\n${'- [[x]] one line per member\n'.repeat(120)}`, 'hub')
        expect(hub.content.length).toBeGreaterThan(3000)
        expect(kinds([hub]).some(i => i.kind === 'oversized')).toBe(false)
    })

    test('the person fixture reports oversized, status-lines and dated-tags', () => {
        const person = note('michael-status', personBody(), 'person', {
            tags: ['michael', 'status', 'profile', 'comprehensive', 'october-2026', 'latest'],
        })
        expect(person.content.length).toBeGreaterThan(7000)
        const items = kinds([person, note('user-profile', 'x', 'profile')])
        for (const kind of ['oversized', 'status-lines', 'dated-tags'] as const) {
            const hit = items.find(i => i.kind === kind)
            expect(hit?.notes).toEqual(['michael-status'])
        }
    })

    test('dated lines under a History heading and recent ones do not count', () => {
        const old = Array.from({ length: 5 }, (_, i) => `- 2026-08-0${i + 1}: thing`).join('\n')
        expect(kinds([note('a', `## History\n${old}\n\n## Now\nfine`)]).map(i => i.kind)).not.toContain('status-lines')
        expect(kinds([note('a', old)]).map(i => i.kind)).toContain('status-lines')
        const recent = Array.from({ length: 5 }, (_, i) => `- Oct ${i + 1}: thing`).join('\n')
        expect(kinds([note('a', recent)]).map(i => i.kind)).not.toContain('status-lines')
    })

    test('dated names and clusters', () => {
        const items = kinds([
            note('deploy-status-oct-7', 'x'),
            note('deploy-final', 'x'),
            note('deploy', 'x'),
            note('plain', 'x'),
        ])
        expect(items.find(i => i.kind === 'dated-name')!.notes.sort()).toEqual(['deploy-final', 'deploy-status-oct-7'])
        expect(items.find(i => i.kind === 'cluster')!.notes.sort()).toEqual(['deploy', 'deploy-final', 'deploy-status-oct-7'])
    })

    test('orphans, no-source and broken links', () => {
        const notes = [
            note('a', 'about [[b]] and [[Vault Note]] and [[ghost]]'),
            note('b', 'back to [[a]]'),
            note('lonely', 'nothing'),
            note('user-profile', 'x', 'profile'),
        ]
        const items = kinds(notes, { now, vaultNames: new Set(['Vault Note']) })
        expect(items.find(i => i.kind === 'orphan')!.notes).toEqual(['lonely', 'user-profile'])
        expect(items.find(i => i.kind === 'no-source')!.notes).toEqual(['b', 'lonely'])
        const broken = items.find(i => i.kind === 'broken-link')!
        expect(broken.notes).toEqual(['a'])
        expect(broken.detail).toContain('ghost')
        const noVault = kinds(notes)
        expect(noVault.map(i => i.kind)).not.toContain('no-source')
        expect(noVault.map(i => i.kind)).not.toContain('broken-link')
    })

    test('duplicates, no-profile, no-hub', () => {
        const mk = (n: string) => note(n, 'x', 'fact', { tags: ['infra'], description: 'how the railway deploy works' })
        const items = kinds([mk('railway-deploy'), mk('railway-deploys'), note('x1', 'x', 'fact', { tags: ['infra'] }), note('x2', 'x', 'fact', { tags: ['infra'] })])
        expect(items.find(i => i.kind === 'duplicate')!.notes).toEqual(['railway-deploy', 'railway-deploys'])
        expect(items.map(i => i.kind)).toContain('no-profile')
        expect(items.find(i => i.kind === 'no-hub')!.detail).toContain('infra')
        const hub = note('infra-hub', '[[railway-deploy]] [[railway-deploys]] [[x1]] [[x2]]', 'hub')
        expect(kinds([mk('railway-deploy'), mk('railway-deploys'), note('x1', 'x', 'fact', { tags: ['infra'] }), note('x2', 'x', 'fact', { tags: ['infra'] }), hub]).map(i => i.kind)).not.toContain('no-hub')
    })

    test('lists are capped at 10 notes and worst comes first', () => {
        const notes = Array.from({ length: 25 }, (_, i) => note(`big-${i}`, 'z'.repeat(2100 + i)))
        const h = brainHealth(notes, { now })
        const over = h.items.find(i => i.kind === 'oversized')!
        expect(over.notes).toHaveLength(10)
        expect(over.notes[0]).toBe('big-24')
        expect(h.items[0]!.kind).toBe('no-profile')
    })

    test('deterministic', () => {
        const notes = [note('b', 'z'.repeat(2500)), note('a', 'z'.repeat(2500))]
        expect(brainHealth(notes, { now })).toEqual(brainHealth([...notes].reverse(), { now }))
    })
})

describe('formatBrainHealth', () => {
    test('numbered agenda, worst first, header line, under maxChars', () => {
        const notes = Array.from({ length: 30 }, (_, i) => note(`big-${i}`, 'z'.repeat(2100)))
        const h = brainHealth(notes, { now })
        const out = formatBrainHealth(h)
        const lines = out.split('\n')
        expect(lines[0]).toMatch(/^notes=30 size=\d+\.\dKB$/)
        expect(lines[1]).toMatch(/^1\. no-profile: /)
        expect(lines[2]).toMatch(/^2\. oversized: big-\d+/)
        const small = formatBrainHealth(h, 150)
        expect(small.length).toBeLessThanOrEqual(150)
        expect(small).toContain('1.')
    })

    test('always ends with the omitted-count tail and stays within maxChars', () => {
        const h = {
            notes: 50,
            bytes: 1024,
            items: Array.from({ length: 12 }, (_, i) => ({
                kind: 'oversized' as const,
                notes: [`note-${i}`],
                detail: 'd'.repeat(90),
            })),
        }
        for (const n of [200, 250, 300, 500, 1000]) {
            const out = formatBrainHealth(h, n)
            const shown = out.split('\n').filter(l => /^\d+\. /.test(l)).length
            expect(out.length).toBeLessThanOrEqual(n)
            expect(out.endsWith(`(${12 - shown} more not shown)`)).toBe(true)
            expect(shown).toBeLessThan(12)
        }
    })

    test('says so when nothing is wrong', () => {
        expect(formatBrainHealth(brainHealth([note('user-profile', '[[a]]', 'profile'), note('a', '[[b]]', 'fact', { description: 'a' }), note('b', '[[a]]', 'fact', { description: 'b' })], { now }))).toContain('no issues')
    })

    test('a (session YYYY-MM-DD) marker counts as a source', () => {
        const vaultNames = new Set(['alpha'])
        const flagged = (c: string) => kinds([note('fact-a', c)], { vaultNames }).some(i => i.kind === 'no-source')
        expect(flagged('learned in chat')).toBe(true)
        expect(flagged('learned in chat (session 2026-10-07)')).toBe(false)
    })

    test('the auto-* transcript queue produces no items', () => {
        const queue = Array.from({ length: 4 }, (_, i) =>
            note(`auto-2026-10-0${i + 1}-chat`, `raw transcript ${i}`, 'auto', { tags: ['auto', 'raw', 'session'] }),
        )
        const h = brainHealth([...queue, note('user-profile', '[[a]]', 'profile'), note('a', '[[b]]', 'fact', { description: 'a' }), note('b', '[[a]]', 'fact', { description: 'b' })], { now })
        expect(h.notes).toBe(7)
        expect(h.items).toEqual([])
        expect(brainHealth(queue, { now, vaultNames: new Set() }).items.filter(i => i.kind !== 'no-profile')).toEqual([])
    })

    test('the dream prompt worked-example names are all dated-name', () => {
        const names = [
            'michael-vault-review-july-22-2026-final',
            'michael-vault-review-july-26-2026-crisis-escalation',
            'michael-vault-review-july-26-evening-escalation',
            'michael-vault-review-july-27-2026-crisis-window-active',
            'michael-vault-review-july-27-evening-critical-update',
            'vault-review-2026-07-24-checkpoint',
            'vault-review-2026-07-25-checkpoint',
        ]
        const item = kinds(names.map(n => note(n, 'x'))).find(i => i.kind === 'dated-name')!
        expect([...item.notes].sort()).toEqual([...names].sort())
    })
})

describe('no-description', () => {
    test('lists notes without a frontmatter description, exempting profile and auto', () => {
        const items = kinds([
            note('a', 'x', 'fact', { description: 'when a matters' }),
            note('b', 'x'),
            note('user-profile', 'x', 'profile'),
            note('auto-1', 'x', 'auto'),
        ])
        const item = items.find(i => i.kind === 'no-description')!
        expect(item.notes).toEqual(['b'])
    })
})
