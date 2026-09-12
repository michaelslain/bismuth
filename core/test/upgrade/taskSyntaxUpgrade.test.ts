import { test, expect } from 'bun:test'
import { extractTasks } from '../../src/tasks'
import { migrateContent } from '../../src/taskMigrate'

// An emoji-era note, verbatim. This file exists so that a regression in the MIGRATION path
// fails loudly instead of silently un-parsing every task written before 2026-09. The reader
// itself is gone; migration is now the only thing standing between an old vault and losing
// its dates, priorities and recurrences.
const LEGACY = [
    '- [ ] buy milk 📅 2026-09-14 ⏫',
    '- [ ] pay rent ⏳ 2026-09-12 🔁 every month #home',
    '- [x] renew passport ✅ 2026-09-02',
    '- [-] abandoned thing ❌ 2026-09-03',
].join('\n')

test('an emoji-era note migrates with every field intact', () => {
    const { content, changed, flagged } = migrateContent(LEGACY)
    expect(changed).toBe(4)
    expect(flagged).toEqual([])

    const tasks = extractTasks(content, 'legacy.md')
    expect(tasks).toHaveLength(4)
    expect(tasks[0].due).toBe('2026-09-14')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[0].description).toBe('buy milk')
    expect(tasks[1].scheduled).toBe('2026-09-12')
    expect(tasks[1].recurrence).toBe('every month')
    expect(tasks[1].tags).toEqual(['home'])
    expect(tasks[2].done).toBe('2026-09-02')
    expect(tasks[3].status).toBe('cancelled')
})

test('a calendar-impossible date migrates, is flagged, and stays visible', () => {
    const { content, flagged } = migrateContent('- [ ] taxes 📅 2026-02-30')
    expect(flagged).toEqual([0])
    expect(content).toBe('- [ ] taxes [due 2026-02-30]')
    // the bracket grammar rejects a date that is not a real day, so it stays literal text
    expect(extractTasks(content, 'a.md')[0].due).toBeUndefined()
})

test('migration is idempotent', () => {
    const once = migrateContent(LEGACY).content
    const twice = migrateContent(once)
    expect(twice.content).toBe(once)
    expect(twice.changed).toBe(0)
})
