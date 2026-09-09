import { test, expect } from 'bun:test'
import { migrateTaskLine, migrateContent, fieldsSurvived } from '../src/taskMigrate'
import { parseTaskLine, type Task } from '../src/tasks'
import { DATE_KEYS } from '../src/taskFields'

test('rewrites every signifier on a line', () => {
    expect(
        migrateTaskLine('- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week'),
    ).toEqual({
        line: '- [ ] buy milk [due 2026-09-14] [high] [every week]',
        flagged: false,
    })
})

test('leaves a line that is already migrated alone', () => {
    const line = '- [ ] buy milk [due 2026-09-14] [high]'
    expect(migrateTaskLine(line)).toEqual({ line, flagged: false })
})

test('migrating twice is a no-op', () => {
    const once = migrateContent('- [ ] x 📅 2026-09-14').content
    expect(migrateContent(once).content).toBe(once)
    expect(migrateContent(once).changed).toBe(0)
    expect(migrateContent(once).flagged).toEqual([])
})

test('leaves non-task lines untouched', () => {
    const text = 'a paragraph 📅 2026-09-14\n- [ ] x 📅 2026-09-14'
    const out = migrateContent(text)
    expect(out.content.split('\n')[0]).toBe('a paragraph 📅 2026-09-14')
    expect(out.changed).toBe(1)
})

// A calendar-impossible date: the emoji path accepts it by shape alone
// (`\d{4}-\d{2}-\d{2}`), but the bracket grammar additionally requires a real calendar
// date. Migration used to REFUSE such a line and leave it in its emoji spelling, which was
// right while the emoji reader lived forever. With the reader gone a refused line silently
// stops being a task at all, so converting it visibly is now the lesser harm: the date lands
// as literal `[due 2026-02-30]` text the user can finally see, and the line is flagged so the
// report can name it.
test('an impossible date converts, is flagged, and stays visible', () => {
    const out = migrateTaskLine('- [ ] x 📅 2026-02-30')
    expect(out).toEqual({ line: '- [ ] x [due 2026-02-30]', flagged: true })
    // the bracket grammar rejects a date that is not a real day, so it is description text
    const reparsed = parseTaskLine(out.line, 'f.md', 0)!
    expect(reparsed.due).toBeUndefined()
    expect(reparsed.description).toBe('x [due 2026-02-30]')
})

test('a shape-invalid date (bad month) converts and is flagged too', () => {
    const out = migrateTaskLine('- [ ] x 📅 2026-13-45')
    expect(out).toEqual({ line: '- [ ] x [due 2026-13-45]', flagged: true })
    expect(parseTaskLine(out.line, 'f.md', 0)!.due).toBeUndefined()
})

test('a converted line that round-trips is not flagged', () => {
    expect(
        migrateTaskLine('- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week').flagged,
    ).toBe(false)
})

test('migrateContent counts a flagged line as changed and reports its line number', () => {
    const text = 'prose\n- [ ] x 📅 2026-02-30\n- [ ] buy milk 📅 2026-09-14 ⏫'
    const out = migrateContent(text)
    expect(out.changed).toBe(2)
    expect(out.flagged).toEqual([1])
    expect(out.content.split('\n')[1]).toBe('- [ ] x [due 2026-02-30]')
})

// splitRecurrence cuts a trailing tag off the recurrence rule, so the migrated bracket
// carries only "every week" and the tags land back in the description — the round trip
// reproduces `tags`, so this line converts cleanly and is not flagged.
test('a tag written after a recurrence marker converts, tags intact', () => {
    const line = '- [ ] weekly sync 🔁 every week #meetings #recurring'
    const migrated = migrateTaskLine(line).line
    expect(migrated).toBe('- [ ] weekly sync #meetings #recurring [every week]')
    const reparsed = parseTaskLine(migrated, 'f.md', 0)!
    expect(reparsed.tags).toEqual(['meetings', 'recurring'])
    expect(reparsed.recurrence).toBe('every week')
})

test('a tag written before a recurrence marker still migrates safely', () => {
    const line = '- [ ] weekly sync #meetings 🔁 every week'
    const migrated = migrateTaskLine(line).line
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

// fieldsSurvived is the round-trip predicate migrateTaskLine relies on to decide whether a
// rebuilt line reproduces every field. Test it directly, one case per compared field, so a
// comparison that silently stops being checked (a merge conflict, a careless edit) fails
// loudly here rather than only showing up as a line that quietly stops being flagged.
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
