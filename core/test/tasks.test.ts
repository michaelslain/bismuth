import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import { parseTaskLine, extractTasks } from '../src/tasks'

test('parses a plain todo', () => {
    const t = parseTaskLine('- [ ] buy milk', 'shopping.md', 0)!
    expect(t.status).toBe('todo')
    expect(t.description).toBe('buy milk')
    expect(t.path).toBe('shopping.md')
    expect(t.line).toBe(0)
})

test('parses a completed task', () => {
    const t = parseTaskLine('- [x] done thing', 'f.md', 3)!
    expect(t.status).toBe('done')
    expect(t.description).toBe('done thing')
})

test('recognizes in-progress and cancelled status chars', () => {
    expect(parseTaskLine('- [/] wip', 'f.md', 0)!.status).toBe('in-progress')
    expect(parseTaskLine('- [-] nope', 'f.md', 0)!.status).toBe('cancelled')
})

test('returns null for non-task lines', () => {
    expect(parseTaskLine('just text', 'f.md', 0)).toBeNull()
    expect(parseTaskLine('# heading', 'f.md', 0)).toBeNull()
    expect(parseTaskLine('- bullet, no checkbox', 'f.md', 0)).toBeNull()
})

test('preserves indentation in raw + indent', () => {
    const t = parseTaskLine('    - [ ] nested', 'f.md', 0)!
    expect(t.indent).toBe('    ')
    expect(t.raw).toBe('    - [ ] nested')
    expect(t.description).toBe('nested')
})

test('extracts due/scheduled/start dates', () => {
    const t = parseTaskLine(
        '- [ ] pay rent [due 2026-06-01] [scheduled 2026-05-28] [start 2026-05-20]',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-06-01')
    expect(t.scheduled).toBe('2026-05-28')
    expect(t.start).toBe('2026-05-20')
    expect(t.description).toBe('pay rent')
})

test('extracts done/created/cancelled dates', () => {
    const t = parseTaskLine(
        '- [x] thing [done 2026-05-27] [created 2026-05-01]',
        'f.md',
        0,
    )!
    expect(t.done).toBe('2026-05-27')
    expect(t.created).toBe('2026-05-01')
})

test('extracts priority', () => {
    expect(parseTaskLine('- [ ] a [high]', 'f.md', 0)!.priority).toBe('high')
    expect(parseTaskLine('- [ ] b [medium]', 'f.md', 0)!.priority).toBe('medium')
    expect(parseTaskLine('- [ ] c [highest]', 'f.md', 0)!.priority).toBe('highest')
    expect(parseTaskLine('- [ ] d [lowest]', 'f.md', 0)!.priority).toBe('lowest')
    expect(parseTaskLine('- [ ] e', 'f.md', 0)!.priority).toBe('none')
})

test('extracts recurrence', () => {
    const t = parseTaskLine(
        '- [ ] standup [every weekday] [due 2026-05-28]',
        'f.md',
        0,
    )!
    expect(t.recurrence).toBe('every weekday')
    expect(t.due).toBe('2026-05-28')
    expect(t.description).toBe('standup')
})

test('extracts tags but keeps them in the description', () => {
    const t = parseTaskLine('- [ ] email boss #work #urgent', 'f.md', 0)!
    expect(t.tags.sort()).toEqual(['urgent', 'work'])
    expect(t.description).toContain('#work')
})

test('does not treat a mid-word # as a tag boundary', () => {
    const t = parseTaskLine('- [ ] see page#section #realtag', 'f.md', 0)!
    expect(t.tags).toEqual(['realtag'])
})

test('extractTasks finds only task lines with correct line numbers', () => {
    const md = '# Title\n\n- [ ] one\nsome prose\n- [x] two\n  - [ ] three\n'
    const tasks = extractTasks(md, 'n.md')
    expect(tasks.map(t => t.line)).toEqual([2, 4, 5])
    expect(tasks.map(t => t.description)).toEqual(['one', 'two', 'three'])
})

test('extractTasks handles CRLF line endings', () => {
    const md = '- [ ] one\r\nprose\r\n- [x] two\r\n'
    const tasks = extractTasks(md, 'n.md')
    expect(tasks.map(t => t.description)).toEqual(['one', 'two'])
    expect(tasks.map(t => t.line)).toEqual([0, 2])
})

test('an emoji recurrence marker is inert text, tags around it still count', () => {
    const t = parseTaskLine('- [ ] a #before 🔁 every week #after', 'f.md', 0)!
    expect(t.tags.sort()).toEqual(['after', 'before'])
    expect(t.recurrence).toBeUndefined()
    // the marker and its rule stay put, as literal description text
    expect(t.description).toBe('a #before 🔁 every week #after')
})

test('dedupes repeated tags', () => {
    const t = parseTaskLine('- [ ] x #work #work', 'f.md', 0)!
    expect(t.tags).toEqual(['work'])
})

import { toggleTaskLine, setTaskLineStatus } from '../src/tasks'
import { todayISO } from '../src/dates'

test('setTaskLineStatus sets in-progress', () => {
    expect(setTaskLineStatus('- [ ] buy milk', '/', '2026-05-27')).toBe(
        '- [/] buy milk',
    )
})

test('setTaskLineStatus sets cancelled', () => {
    expect(setTaskLineStatus('- [/] buy milk', '-', '2026-05-27')).toBe(
        '- [-] buy milk',
    )
})

test("setTaskLineStatus completing appends today's done date", () => {
    expect(setTaskLineStatus('- [/] buy milk', 'x', '2026-05-27')).toBe(
        '- [x] buy milk [done 2026-05-27]',
    )
})

test('setTaskLineStatus to a non-done status strips the done date', () => {
    expect(
        setTaskLineStatus('- [x] thing ✅ 2026-05-27', ' ', '2026-06-01'),
    ).toBe('- [ ] thing')
    expect(
        setTaskLineStatus('- [x] thing ✅ 2026-05-27', '-', '2026-06-01'),
    ).toBe('- [-] thing')
})

test('setTaskLineStatus preserves indentation and trailing CR', () => {
    expect(setTaskLineStatus('    - [ ] nested\r', '/', '2026-05-27')).toBe(
        '    - [/] nested\r',
    )
})

test('setTaskLineStatus throws on a non-task line', () => {
    expect(() => setTaskLineStatus('not a task', 'x', '2026-05-27')).toThrow()
})

test('setTaskLineStatus rejects control characters and multi-character status', () => {
    expect(() =>
        setTaskLineStatus('- [ ] buy milk', '\n', '2026-05-27'),
    ).toThrow()
    expect(() =>
        setTaskLineStatus('- [ ] buy milk', '\r', '2026-05-27'),
    ).toThrow()
    expect(() =>
        setTaskLineStatus('- [ ] buy milk', '\x7f', '2026-05-27'),
    ).toThrow()
    expect(() =>
        setTaskLineStatus('- [ ] buy milk', 'ab', '2026-05-27'),
    ).toThrow()
})

test('setTaskLineStatus accepts every legitimate single-character status', () => {
    // Tab is deliberately allowed — TASK_LINE's `.` matches it fine — plus a BMP
    // non-ASCII character, which is not a control character either.
    for (const status of [' ', 'x', 'X', '/', '-', '3', 'q', '\t', 'é']) {
        const out = setTaskLineStatus('- [ ] buy milk', status, '2026-05-27')
        expect(out).toContain(`[${status}]`)
    }
})

test("toggleTaskLine completes a todo and appends today's done date", () => {
    const out = toggleTaskLine('- [ ] buy milk', '2026-05-27')
    expect(out).toBe('- [x] buy milk [done 2026-05-27]')
})

test('toggleTaskLine un-completes a done task and strips the done date', () => {
    const out = toggleTaskLine('- [x] buy milk ✅ 2026-05-27', '2026-05-27')
    expect(out).toBe('- [ ] buy milk')
})

test('toggleTaskLine preserves indentation', () => {
    expect(toggleTaskLine('    - [ ] nested', '2026-05-27')).toBe(
        '    - [x] nested [done 2026-05-27]',
    )
})

test('toggleTaskLine does not duplicate an existing done date when completing', () => {
    const out = toggleTaskLine('- [ ] thing ✅ 2026-01-01', '2026-05-27')
    expect(out).toBe('- [x] thing ✅ 2026-01-01')
})

test('toggleTaskLine throws on a non-task line', () => {
    expect(() => toggleTaskLine('not a task', '2026-05-27')).toThrow()
})

test('toggleTaskLine preserves a trailing CR', () => {
    expect(toggleTaskLine('- [ ] x\r', '2026-05-27')).toBe(
        '- [x] x [done 2026-05-27]\r',
    )
})

test('todayISO formats a Date as YYYY-MM-DD', () => {
    // Construct from LOCAL y/m/d components (month is 0-based) so this isn't
    // timezone-fragile — todayISO formats local components, not the UTC slice.
    expect(todayISO(new Date(2026, 4, 27, 15, 0, 0))).toBe('2026-05-27')
})

// --- Recurring-task completion (B16): completing spawns the next occurrence ---

test('completing a daily recurring task inserts a not-done copy with due advanced by 1 day', () => {
    const out = toggleTaskLine(
        '- [ ] water plants [every day] [due 2026-05-31]',
        '2026-05-31',
    )
    // New occurrence above, completed line below.
    expect(out).toBe(
        '- [ ] water plants [every day] [due 2026-06-01]\n' +
            '- [x] water plants [every day] [due 2026-05-31] [done 2026-05-31]',
    )
})

test('the spawned recurrence copy is not-done and carries no done date', () => {
    const out = toggleTaskLine(
        '- [ ] standup [every day] [due 2026-05-31]',
        '2026-05-31',
    )
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith('- [ ] ')).toBe(true) // next occurrence, not done
    expect(lines[0]).not.toContain('[done')
    expect(lines[1].startsWith('- [x] ')).toBe(true) // completed
    expect(lines[1]).toContain('[done 2026-05-31]')
})

test('completing a non-recurring task is unchanged (single line, no copy)', () => {
    const out = toggleTaskLine('- [ ] buy milk [due 2026-05-31]', '2026-05-31')
    expect(out).toBe('- [x] buy milk [due 2026-05-31] [done 2026-05-31]')
    expect(out).not.toContain('\n')
})

test('recurrence with only a scheduled date advances scheduled (no due)', () => {
    const out = toggleTaskLine(
        '- [ ] review [every day] [scheduled 2026-05-31]',
        '2026-05-31',
    )
    expect(out).toBe(
        '- [ ] review [every day] [scheduled 2026-06-01]\n' +
            '- [x] review [every day] [scheduled 2026-05-31] [done 2026-05-31]',
    )
})

test('weekly recurrence advances the due date by 7 days', () => {
    const out = toggleTaskLine(
        '- [ ] groceries [every week] [due 2026-05-31]',
        '2026-05-31',
    )
    expect(out.split('\n')[0]).toBe(
        '- [ ] groceries [every week] [due 2026-06-07]',
    )
})

test("'every N days' recurrence advances by N days", () => {
    const out = toggleTaskLine(
        '- [ ] meds [every 3 days] [due 2026-05-31]',
        '2026-05-31',
    )
    expect(out.split('\n')[0]).toBe('- [ ] meds [every 3 days] [due 2026-06-03]')
})

test('monthly recurrence advances by a calendar month, clamping overflow', () => {
    const out = toggleTaskLine(
        '- [ ] rent [every month] [due 2026-01-31]',
        '2026-05-31',
    )
    // Jan 31 + 1 month clamps to Feb 28 (2026 is not a leap year).
    expect(out.split('\n')[0]).toBe('- [ ] rent [every month] [due 2026-02-28]')
})

test("'every weekday' recurrence skips the weekend", () => {
    // 2026-05-29 is a Friday; next weekday is Monday 2026-06-01.
    const out = toggleTaskLine(
        '- [ ] standup [every weekday] [due 2026-05-29]',
        '2026-05-29',
    )
    expect(out.split('\n')[0]).toBe(
        '- [ ] standup [every weekday] [due 2026-06-01]',
    )
})

test('recurrence advances multiple date fields together', () => {
    const out = toggleTaskLine(
        '- [ ] plan [every day] [due 2026-05-31] [scheduled 2026-05-30] [start 2026-05-29]',
        '2026-05-31',
    )
    expect(out.split('\n')[0]).toBe(
        '- [ ] plan [every day] [due 2026-06-01] [scheduled 2026-05-31] [start 2026-05-30]',
    )
})

test('recurring completion preserves a trailing CR on both emitted lines', () => {
    const out = toggleTaskLine(
        '- [ ] x [every day] [due 2026-05-31]\r',
        '2026-05-31',
    )
    expect(out).toBe(
        '- [ ] x [every day] [due 2026-06-01]\r\n' +
            '- [x] x [every day] [due 2026-05-31] [done 2026-05-31]\r',
    )
})

test('recurring task with no reference date spawns no next occurrence', () => {
    const out = toggleTaskLine('- [ ] floss [every day]', '2026-05-31')
    expect(out).toBe('- [x] floss [every day] [done 2026-05-31]')
    expect(out).not.toContain('\n')
})

test('unrecognized recurrence rule does not spawn a next occurrence', () => {
    const out = toggleTaskLine(
        '- [ ] odd [every blue moon] [due 2026-05-31]',
        '2026-05-31',
    )
    expect(out).toBe(
        '- [x] odd [every blue moon] [due 2026-05-31] [done 2026-05-31]',
    )
    expect(out).not.toContain('\n')
})

test('un-completing a recurring task stays a single line (no new occurrence)', () => {
    const out = toggleTaskLine(
        '- [x] water plants [every day] [due 2026-05-31] [done 2026-05-31]',
        '2026-05-31',
    )
    expect(out).toBe('- [ ] water plants [every day] [due 2026-05-31]')
    expect(out).not.toContain('\n')
})

import { collectVaultTasks } from '../src/tasks'
import { writeNote } from '../src/files'

test('collectVaultTasks scans every markdown file in the vault', async () => {
    const vault = tempDir('bismuth-tasks-')
    await writeNote(vault, 'a.md', '# A\n- [ ] task a [due 2026-06-01]\n')
    await writeNote(
        vault,
        'sub/b.md',
        '- [x] task b [done 2026-05-01]\nprose\n- [ ] task c\n',
    )
    const tasks = await collectVaultTasks(vault)
    const byDesc = Object.fromEntries(tasks.map(t => [t.description, t]))
    expect(Object.keys(byDesc).sort()).toEqual(['task a', 'task b', 'task c'])
    expect(byDesc['task a'].path).toBe('a.md')
    expect(byDesc['task a'].due).toBe('2026-06-01')
    expect(byDesc['task b'].path).toBe('sub/b.md')
    expect(byDesc['task c'].line).toBe(2)
})

import { collectTasksFromPaths } from '../src/tasks'

test('collectTasksFromPaths only scans the given paths', async () => {
    const root = tempDir('bismuth-scoped-')
    await writeNote(root, 'keep/a.md', '- [ ] inside keep')
    await writeNote(root, 'keep/b.md', 'no tasks here')
    await writeNote(root, 'other/c.md', '- [ ] outside keep')

    const tasks = await collectTasksFromPaths(root, ['keep/a.md', 'keep/b.md'])
    expect(tasks.map(t => t.description)).toEqual(['inside keep'])
})

test('collectTasksFromPaths skips unreadable paths', async () => {
    const root = tempDir('bismuth-scoped2-')
    await writeNote(root, 'keep/a.md', '- [ ] real task')
    const tasks = await collectTasksFromPaths(root, [
        'keep/a.md',
        'keep/missing.md',
    ])
    expect(tasks.map(t => t.description)).toEqual(['real task'])
})

import {
    reorderTaskBlocks,
    archiveResolvedTasks,
    isResolvedStatus,
} from '../src/tasks'

test('isResolvedStatus is true only for done/cancelled', () => {
    expect(isResolvedStatus('done')).toBe(true)
    expect(isResolvedStatus('cancelled')).toBe(true)
    expect(isResolvedStatus('todo')).toBe(false)
    expect(isResolvedStatus('in-progress')).toBe(false)
})

test('reorderTaskBlocks sinks done + cancelled to the bottom, stable', () => {
    const input = ['- [ ] a', '- [x] b', '- [ ] c', '- [-] d', '- [ ] e'].join(
        '\n',
    )
    expect(reorderTaskBlocks(input)).toBe(
        ['- [ ] a', '- [ ] c', '- [ ] e', '- [x] b', '- [-] d'].join('\n'),
    )
})

test('reorderTaskBlocks leaves an already-sorted block unchanged (idempotent)', () => {
    const sorted = ['- [ ] a', '- [ ] b', '- [x] c'].join('\n')
    expect(reorderTaskBlocks(sorted)).toBe(sorted)
})

test('reorderTaskBlocks keeps sub-task children with their parent', () => {
    const input = ['- [x] parent', '  - [ ] child', '- [ ] open'].join('\n')
    expect(reorderTaskBlocks(input)).toBe(
        ['- [ ] open', '- [x] parent', '  - [ ] child'].join('\n'),
    )
})

test('reorderTaskBlocks treats blocks separated by prose independently', () => {
    const input = [
        '- [x] a',
        '- [ ] b',
        '',
        'text',
        '',
        '- [x] c',
        '- [ ] d',
    ].join('\n')
    expect(reorderTaskBlocks(input)).toBe(
        ['- [ ] b', '- [x] a', '', 'text', '', '- [ ] d', '- [x] c'].join('\n'),
    )
})

test('reorderTaskBlocks preserves a trailing newline', () => {
    expect(reorderTaskBlocks('- [x] a\n- [ ] b\n')).toBe('- [ ] b\n- [x] a\n')
})

test('archiveResolvedTasks removes done + cancelled items and counts them', () => {
    const input = [
        '# Todo',
        '- [ ] keep',
        '- [x] done',
        '- [-] cancelled',
        '- [/] doing',
    ].join('\n')
    const { content, removed } = archiveResolvedTasks(input)
    expect(removed).toBe(2)
    expect(content).toBe(['# Todo', '- [ ] keep', '- [/] doing'].join('\n'))
})

test('archiveResolvedTasks removes a resolved parent together with its children', () => {
    const input = ['- [x] parent', '  - [ ] child', '- [ ] keep'].join('\n')
    const { content, removed } = archiveResolvedTasks(input)
    expect(removed).toBe(1)
    expect(content).toBe('- [ ] keep')
})

test('archiveResolvedTasks is a no-op when nothing is resolved', () => {
    const input = ['- [ ] a', '- [/] b'].join('\n')
    const { content, removed } = archiveResolvedTasks(input)
    expect(removed).toBe(0)
    expect(content).toBe(input)
})

test('reads bracket fields off a task line', () => {
    const t = parseTaskLine(
        '- [ ] buy milk [due 2026-09-14] [high] [every week]',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-09-14')
    expect(t.priority).toBe('high')
    expect(t.recurrence).toBe('every week')
    expect(t.description).toBe('buy milk')
})

test('parseTaskLine no longer reads emoji signifiers', () => {
    const t = parseTaskLine('- [ ] buy milk 📅 2026-09-14 ⏫', 'a.md', 0)!
    expect(t.due).toBeUndefined()
    expect(t.priority).toBe('none')
    // the signifiers stay put, as literal description text, so nothing is silently eaten
    expect(t.description).toBe('buy milk 📅 2026-09-14 ⏫')
})

// There is no contest between the two spellings any more: the emoji is not a field, so it is
// neither read nor stripped. core/test/taskLegacy.test.ts covers the contest where it still
// exists — inside the migration's reader, which is the only thing that sees both.

test('an emoji date beside a bracket date is inert text', () => {
    const t = parseTaskLine(
        '- [ ] x [due 2026-09-14] 📅 2026-01-01',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-09-14')
    expect(t.description).toBe('x 📅 2026-01-01')
})

test('an emoji priority beside a bracket priority is no longer stripped', () => {
    const t = parseTaskLine('- [ ] x [high] ⏫', 'f.md', 0)!
    expect(t.priority).toBe('high')
    expect(t.description).toBe('x ⏫')
})

test('tags survive alongside bracket fields', () => {
    const t = parseTaskLine('- [ ] read #books [due 2026-09-14]', 'f.md', 0)!
    expect(t.tags).toEqual(['books'])
    expect(t.description).toBe('read #books')
})

test('a wikilink in a task description is untouched', () => {
    const t = parseTaskLine(
        '- [ ] review [[Some Note]] [due 2026-09-14]',
        'f.md',
        0,
    )!
    expect(t.description).toBe('review [[Some Note]]')
    expect(t.due).toBe('2026-09-14')
})

test('completing a task appends a bracket done date', () => {
    expect(toggleTaskLine('- [ ] buy milk', '2026-09-08')).toBe(
        '- [x] buy milk [done 2026-09-08]',
    )
})

test('un-completing strips a done date in either spelling', () => {
    expect(toggleTaskLine('- [x] x [done 2026-09-08]', '2026-09-09')).toBe(
        '- [ ] x',
    )
    expect(toggleTaskLine('- [x] x ✅ 2026-09-08', '2026-09-09')).toBe(
        '- [ ] x',
    )
})

test('a recurring bracket task rolls its dates forward', () => {
    expect(
        toggleTaskLine(
            '- [ ] pay rent [due 2026-09-01] [every month]',
            '2026-09-08',
        ),
    ).toBe(
        '- [ ] pay rent [due 2026-10-01] [every month]\n' +
            '- [x] pay rent [due 2026-09-01] [every month] [done 2026-09-08]',
    )
})

// Rolling an emoji line forward is gone with the reader — there is no recurrence on it to
// roll, so completing it just completes it. What migration still reads off this same line is
// covered in core/test/taskLegacy.test.ts.
test('an emoji recurring task no longer rolls forward', () => {
    expect(
        toggleTaskLine(
            '- [ ] pay rent 📅 2026-09-01 🔁 every month',
            '2026-09-08',
        ),
    ).toBe('- [x] pay rent 📅 2026-09-01 🔁 every month [done 2026-09-08]')
})

test('a recurring task with a trailing tag actually rolls forward', () => {
    const out = toggleTaskLine(
        '- [ ] pay rent [due 2026-09-12] [every month #home]',
        '2026-09-09',
    )
    expect(out.split('\n')[0]).toContain('[due 2026-10-12]')
})

test('an emoji recurring task with a trailing tag does not roll forward either', () => {
    const out = toggleTaskLine(
        '- [ ] pay rent 📅 2026-09-12 🔁 every month #home',
        '2026-09-09',
    )
    expect(out).toBe(
        '- [x] pay rent 📅 2026-09-12 🔁 every month #home [done 2026-09-09]',
    )
    expect(out).not.toContain('\n')
})

// --- A done-shaped bracket group inside a wikilink or markdown link is not a done date ---

test('completing does not mistake a done-shaped wikilink for an existing done date', () => {
    const out = toggleTaskLine(
        '- [ ] review [[done 2026-09-08]] notes',
        '2026-09-09',
    )
    expect(out).toBe(
        '- [x] review [[done 2026-09-08]] notes [done 2026-09-09]',
    )
})

test('un-completing does not destroy a done-shaped wikilink', () => {
    const out = toggleTaskLine(
        '- [x] see [[done 2026-09-08]] thing',
        '2026-09-09',
    )
    expect(out).toBe('- [ ] see [[done 2026-09-08]] thing')
})

test('completing does not mistake a done-shaped markdown link for an existing done date', () => {
    const out = toggleTaskLine(
        '- [ ] see [done 2026-09-08](http://x) thing',
        '2026-09-09',
    )
    expect(out).toBe(
        '- [x] see [done 2026-09-08](http://x) thing [done 2026-09-09]',
    )
})

test('un-completing does not destroy a done-shaped markdown link', () => {
    const out = toggleTaskLine(
        '- [x] see [done 2026-09-08](http://x) thing',
        '2026-09-09',
    )
    expect(out).toBe('- [ ] see [done 2026-09-08](http://x) thing')
})

test('un-completing strips two stale done markers, both spellings, in one pass', () => {
    const out = toggleTaskLine(
        '- [x] x [done 2026-09-08] ✅ 2026-09-07',
        '2026-09-09',
    )
    expect(out).toBe('- [ ] x')
})

test('the completion path is idempotent across two calls in a row (no lastIndex leak)', () => {
    const line = '- [ ] x [[done 2026-09-08]]'
    const first = toggleTaskLine(line, '2026-09-09')
    const second = toggleTaskLine(line, '2026-09-09')
    expect(first).toBe(second)
    expect(first).toBe('- [x] x [[done 2026-09-08]] [done 2026-09-09]')
})

// --- setTaskLineStatus gets the same coverage as toggleTaskLine, not a subset ---

test('setTaskLineStatus completing writes a bracket done date', () => {
    expect(setTaskLineStatus('- [ ] buy milk', 'x', '2026-09-09')).toBe(
        '- [x] buy milk [done 2026-09-09]',
    )
})

test('setTaskLineStatus un-completing strips a done date in either spelling', () => {
    expect(
        setTaskLineStatus('- [x] x [done 2026-09-08]', ' ', '2026-09-09'),
    ).toBe('- [ ] x')
    expect(setTaskLineStatus('- [x] x ✅ 2026-09-08', ' ', '2026-09-09')).toBe(
        '- [ ] x',
    )
})

test('setTaskLineStatus completing a recurring bracket task rolls its dates forward', () => {
    expect(
        setTaskLineStatus(
            '- [ ] pay rent [due 2026-09-01] [every month]',
            'x',
            '2026-09-08',
        ),
    ).toBe(
        '- [ ] pay rent [due 2026-10-01] [every month]\n' +
            '- [x] pay rent [due 2026-09-01] [every month] [done 2026-09-08]',
    )
})

import { setTaskLineDate } from '../src/tasks'

// --- setTaskLineDate: rewriting the field that PLACED a task (calendar drag-to-reschedule) ---

test('setTaskLineDate rewrites a bracket date field in place', () => {
    expect(
        setTaskLineDate(
            '- [ ] buy milk [scheduled 2026-09-01]',
            'scheduled',
            '2026-09-15',
        ),
    ).toBe('- [ ] buy milk [scheduled 2026-09-15]')
})

// setTaskLineDate strips the BRACKET field it replaces. It does not read or strip an emoji —
// this module cannot tell a date from any other text now, and eating characters it does not
// understand is how a description loses content — so a line still in the old spelling ends up
// carrying both until migration converts it.
test('setTaskLineDate leaves a stale emoji date beside the new bracket field', () => {
    expect(setTaskLineDate('- [ ] buy milk ⏳ 2026-09-01', 'scheduled', '2026-09-15')).toBe(
        '- [ ] buy milk ⏳ 2026-09-01 [scheduled 2026-09-15]',
    )
    expect(setTaskLineDate('- [ ] buy milk 📅 2026-09-01', 'due', '2026-09-15')).toBe(
        '- [ ] buy milk 📅 2026-09-01 [due 2026-09-15]',
    )
})

test('setTaskLineDate appends the field when the line has none yet', () => {
    expect(setTaskLineDate('- [ ] buy milk', 'due', '2026-09-20')).toBe(
        '- [ ] buy milk [due 2026-09-20]',
    )
})

test('setTaskLineDate only rewrites the named field, leaving the other date alone', () => {
    expect(
        setTaskLineDate(
            '- [ ] buy milk [scheduled 2026-09-01] [due 2026-09-30]',
            'scheduled',
            '2026-09-15',
        ),
    ).toBe('- [ ] buy milk [due 2026-09-30] [scheduled 2026-09-15]')
})

test('setTaskLineDate preserves indent, status char and a trailing CR', () => {
    expect(
        setTaskLineDate('  - [x] buy milk [due 2026-09-01]\r', 'due', '2026-09-02'),
    ).toBe('  - [x] buy milk [due 2026-09-02]\r')
})

test('setTaskLineDate throws on a non-task line', () => {
    expect(() => setTaskLineDate('just a paragraph', 'due', '2026-09-02')).toThrow()
})

test('un-completing strips a done marker carrying a variation selector', () => {
    // U+FE0F after the check mark: what most keyboards and phones actually emit.
    const line = '- [x] milk ✅️ 2026-01-01'
    expect(toggleTaskLine(line, '2026-09-09')).toBe('- [ ] milk')
})

test('a variation-selector done marker counts as already-present when completing', () => {
    const line = '- [ ] milk ✅️ 2026-01-01'
    // withDone must NOT append a second done date next to the emoji one.
    expect(toggleTaskLine(line, '2026-09-09')).toBe(
        '- [x] milk ✅️ 2026-01-01',
    )
})

test('a bare check mark with no date is still left alone', () => {
    // The required trailing date is what keeps a tick used as prose out of the match.
    const line = '- [x] shipped ✅ and celebrated'
    expect(toggleTaskLine(line, '2026-09-09')).toBe(
        '- [ ] shipped ✅ and celebrated',
    )
})
