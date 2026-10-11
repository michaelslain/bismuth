import { expect, test } from 'bun:test'
import { budgetNotes, orderMatches } from '../src/resultBudget'
import type { MemoryNote } from '../src/graph'

const note = (name: string, content: string, extra: Partial<MemoryNote['frontmatter']> = {}): MemoryNote => ({
    name,
    content,
    backlinks: [],
    frontmatter: {
        type: 'fact',
        tags: [],
        created: '2026-09-01',
        updated: '2026-09-01',
        description: `about ${name}`,
        ...extra,
    } as MemoryNote['frontmatter'],
})

test('budgetNotes returns notes whole until the budget, then pointers for every later one', () => {
    const notes = [note('a', 'x'.repeat(600)), note('b', 'y'.repeat(600)), note('c', 'z')]
    const r = budgetNotes(notes, 1000)
    expect(r.notes.map(n => n.name)).toEqual(['a'])
    // `c` would fit, but once one note is a pointer every later one is too, so order stays rank order.
    expect(r.more).toEqual([
        { name: 'b', type: 'fact', description: 'about b' },
        { name: 'c', type: 'fact', description: 'about c' },
    ])
    expect(budgetNotes(notes, 100_000).more).toEqual([])
})

test('budgetNotes always returns the first note, cut when it alone is over budget', () => {
    const r = budgetNotes([note('huge', 'q'.repeat(50_000)), note('small', 'ok')], 9000)
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]!.content.length).toBeLessThan(9100)
    expect(r.notes[0]!.content).toContain('cut at the result budget')
    expect(r.more.map(p => p.name)).toEqual(['small'])
})

test('orderMatches puts the note about the keyword first, and orders a filter-only query by updated', () => {
    const passing = note('weekly-groceries', 'milk eggs and a bside sticker mention', { updated: '2026-10-01' })
    const about = note('bside-team', 'the bside design team and its people', { tags: ['bside'], updated: '2026-09-01' })
    expect(orderMatches([passing, about], ['bside'])[0]!.name).toBe('bside-team')
    expect(orderMatches([about, passing], []).map(n => n.name)).toEqual(['weekly-groceries', 'bside-team'])
})
