import { test, expect } from 'bun:test'
import { migrateTaskLine, migrateContent } from '../src/taskMigrate'

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
