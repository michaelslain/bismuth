import { test, expect } from 'bun:test'
import { migrateTaskLine, migrateContent, fieldsSurvived } from '../src/taskMigrate'
import { parseTaskLine, type Task } from '../src/tasks'
import { DATE_KEYS } from '../src/taskFields'

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

// The emoji parser computes `tags` from the body BEFORE cutting the 🔁 recurrence
// tail, so a tag written AFTER the marker still counts today. Wrapping that tail into
// one bracket makes the reparse swallow it whole as the recurrence value, and the tag
// is never re-extracted — the round trip does not reproduce `tags`, so the guard must
// decline and leave the line in its emoji form rather than silently drop the tags.
test('a tag written after a recurrence marker is not lost', () => {
    const line = '- [ ] weekly sync 🔁 every week #meetings #recurring'
    expect(migrateTaskLine(line)).toBe(line)
    const reparsed = parseTaskLine(line, 'f.md', 0)!
    expect(reparsed.tags).toEqual(['meetings', 'recurring'])
})

test('a tag written before a recurrence marker still migrates safely', () => {
    const line = '- [ ] weekly sync #meetings 🔁 every week'
    const migrated = migrateTaskLine(line)
    expect(migrated).not.toBe(line)
    const reparsed = parseTaskLine(migrated, 'f.md', 0)!
    expect(reparsed.tags).toEqual(['meetings'])
    expect(reparsed.recurrence).toBe('every week')
})

// migrateContent must not normalize a file's line endings to one EOL — a file mixing
// CRLF and LF (common after edits from different tools/OSes) should keep every line's
// OWN original terminator, so migrating one task line stays a one-line diff instead of
// silently rewriting every other line's ending in a git-tracked vault.
test('migrateContent preserves each line own terminator in a mixed-ending file', () => {
    const text = 'prose one\r\n- [ ] x 📅 2026-09-14\nprose two\r\n'
    const out = migrateContent(text)
    expect(out.content).toBe(
        'prose one\r\n- [ ] x [due 2026-09-14]\nprose two\r\n',
    )
    expect(out.changed).toBe(1)
})

// fieldsSurvived is the round-trip guard migrateTaskLine relies on to decide whether a
// rebuild is safe. Test it directly, one case per compared field, so a comparison that
// silently stops being checked (a merge conflict, a careless edit) fails loudly here
// rather than only showing up as an unexplained refusal to migrate somewhere else.
function baseTask(): Task {
    return {
        path: 'f.md',
        line: 0,
        raw: '- [ ] x',
        indent: '',
        status: 'todo',
        statusChar: ' ',
        description: 'x',
        priority: 'medium',
        tags: ['a', 'b'],
        due: '2026-01-01',
        scheduled: '2026-01-02',
        start: '2026-01-03',
        done: '2026-01-04',
        created: '2026-01-05',
        cancelled: '2026-01-06',
        recurrence: 'every week',
    }
}

test('fieldsSurvived: identical tasks match', () => {
    expect(fieldsSurvived(baseTask(), baseTask())).toBe(true)
})

test('fieldsSurvived: tag order does not matter', () => {
    const before = baseTask()
    const after = { ...baseTask(), tags: [...before.tags].reverse() }
    expect(fieldsSurvived(before, after)).toBe(true)
})

test('fieldsSurvived: catches a changed statusChar', () => {
    expect(fieldsSurvived(baseTask(), { ...baseTask(), statusChar: 'x' })).toBe(false)
})

test('fieldsSurvived: catches a changed description', () => {
    expect(fieldsSurvived(baseTask(), { ...baseTask(), description: 'y' })).toBe(false)
})

test('fieldsSurvived: catches a changed priority', () => {
    expect(fieldsSurvived(baseTask(), { ...baseTask(), priority: 'high' })).toBe(false)
})

test('fieldsSurvived: catches a changed recurrence', () => {
    expect(
        fieldsSurvived(baseTask(), { ...baseTask(), recurrence: 'every month' }),
    ).toBe(false)
})

test('fieldsSurvived: catches a changed tag set', () => {
    expect(fieldsSurvived(baseTask(), { ...baseTask(), tags: ['a', 'c'] })).toBe(false)
})

test('fieldsSurvived: catches each date field individually', () => {
    for (const key of DATE_KEYS) {
        const before = baseTask()
        const after = { ...baseTask(), [key]: '2099-12-31' }
        expect(fieldsSurvived(before, after)).toBe(false)
    }
})
