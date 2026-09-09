import { test, expect } from 'bun:test'
import { migrateTaskLine, migrateContent } from '../src/taskMigrate'
import { parseTaskLine } from '../src/tasks'

test('rewrites every signifier on a line', () => {
    expect(migrateTaskLine('- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week')).toBe(
        '- [ ] buy milk [due 2026-09-14] [high] [every week]',
    )
})

test('leaves a line that is already migrated alone', () => {
    const line = '- [ ] buy milk [due 2026-09-14] [high]'
    expect(migrateTaskLine(line)).toBe(line)
})

test('migrating twice is a no-op', () => {
    const once = migrateContent('- [ ] x 📅 2026-09-14').content
    expect(migrateContent(once).content).toBe(once)
    expect(migrateContent(once).changed).toBe(0)
})

test('leaves non-task lines untouched', () => {
    const text = 'a paragraph 📅 2026-09-14\n- [ ] x 📅 2026-09-14'
    const out = migrateContent(text)
    expect(out.content.split('\n')[0]).toBe('a paragraph 📅 2026-09-14')
    expect(out.changed).toBe(1)
})

// A calendar-impossible date: the emoji path accepts it by shape alone
// (`\d{4}-\d{2}-\d{2}`), but the bracket grammar additionally requires a real
// calendar date. Rebuilding naively would drop the date and leave `[due
// 2026-02-30]` sitting in the description as plain text — a silent data loss.
// migrateTaskLine must detect that the round trip does not survive and leave
// the line in its original, still-fully-parseable, emoji spelling.
test('an impossible date is left in its emoji spelling, not silently dropped', () => {
    const line = '- [ ] x 📅 2026-02-30'
    expect(migrateTaskLine(line)).toBe(line)
    const reparsed = parseTaskLine(line, 'f.md', 0)!
    expect(reparsed.due).toBe('2026-02-30')
})

test('a shape-invalid date (bad month) is also left alone', () => {
    const line = '- [ ] x 📅 2026-13-45'
    expect(migrateTaskLine(line)).toBe(line)
    const reparsed = parseTaskLine(line, 'f.md', 0)!
    expect(reparsed.due).toBe('2026-13-45')
})

test('a normal multi-field line still migrates despite the guard', () => {
    expect(migrateTaskLine('- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week')).toBe(
        '- [ ] buy milk [due 2026-09-14] [high] [every week]',
    )
})

test('migrateContent does not count an unconvertible line as changed', () => {
    const text = '- [ ] x 📅 2026-02-30\n- [ ] buy milk 📅 2026-09-14 ⏫'
    const out = migrateContent(text)
    expect(out.changed).toBe(1)
    expect(out.content.split('\n')[0]).toBe('- [ ] x 📅 2026-02-30')
})
