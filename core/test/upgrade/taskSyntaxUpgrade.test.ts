import { test, expect } from 'bun:test'
import { extractTasks } from '../../src/tasks'

// An emoji-era note, verbatim. This file exists so that deleting the emoji read path
// fails loudly instead of silently un-parsing every task written before 2026-09.
const LEGACY = [
    '- [ ] buy milk 📅 2026-09-14 ⏫',
    '- [ ] pay rent ⏳ 2026-09-12 🔁 every month',
    '- [x] renew passport ✅ 2026-09-02',
    '- [-] abandoned thing ❌ 2026-09-03',
].join('\n')

test('an emoji-era note still parses in full', () => {
    const tasks = extractTasks(LEGACY, 'legacy.md')
    expect(tasks).toHaveLength(4)
    expect(tasks[0].due).toBe('2026-09-14')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[1].scheduled).toBe('2026-09-12')
    expect(tasks[1].recurrence).toContain('month')
    expect(tasks[2].done).toBe('2026-09-02')
    expect(tasks[3].status).toBe('cancelled')
    expect(tasks[0].description).toBe('buy milk')
})
