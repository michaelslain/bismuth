import { test, expect } from 'bun:test'
import { checkStatus, isOverdue, PRIORITY_MARK } from './taskDisplay'

test('checkStatus maps each TaskStatus onto its glyph state', () => {
    expect(checkStatus('todo')).toBe('todo')
    expect(checkStatus('done')).toBe('done')
    expect(checkStatus('in-progress')).toBe('doing')
    expect(checkStatus('cancelled')).toBe('cancelled')
})

test('an unknown or missing status reads as an empty box, never as done', () => {
    // A stored task row may omit `status` entirely, and `statusFromChar` maps any unrecognised
    // box char onto "other". Both must render UNTICKED — the failure that matters here is the
    // one in the other direction, where an unknown status paints a check the user never made.
    expect(checkStatus(undefined)).toBe('todo')
    expect(checkStatus('other')).toBe('todo')
    expect(checkStatus('banana')).toBe('todo')
    expect(checkStatus(7)).toBe('todo')
})

test('the priority marks are the bracket words, with no emoji anywhere', () => {
    expect(PRIORITY_MARK.high).toBe('[high]')
    expect(Object.keys(PRIORITY_MARK).sort()).toEqual([
        'high',
        'highest',
        'low',
        'lowest',
        'medium',
    ])
    // "No emoji, ever" is a design-system rule, and this table is where the emoji ladder used
    // to live — so it is worth pinning rather than trusting the diff.
    const emoji = /\p{Extended_Pictographic}/u
    for (const mark of Object.values(PRIORITY_MARK))
        expect(emoji.test(mark)).toBe(false)
})

test('a past due date on an unfinished task is overdue', () => {
    expect(isOverdue({ due: '2026-09-06', resolved: false }, '2026-09-09')).toBe(
        true,
    )
})

test('today is not yet overdue', () => {
    // Strictly BEFORE today. A task due today is due, not late — the boundary is the one thing
    // a `<=` typo would get wrong, and nothing else in the repo would notice.
    expect(isOverdue({ due: '2026-09-09', resolved: false }, '2026-09-09')).toBe(
        false,
    )
})

test('a future due date is never overdue', () => {
    expect(isOverdue({ due: '2026-09-19', resolved: false }, '2026-09-09')).toBe(
        false,
    )
})

test('a RESOLVED task is not overdue, however late its due date', () => {
    // `resolved` is done-OR-cancelled, which is the whole reason isOverdue reads it rather than
    // `status === 'done'`: a cancelled task is nobody's problem and cannot be late.
    expect(isOverdue({ due: '2026-09-06', resolved: true }, '2026-09-09')).toBe(
        false,
    )
})

test('with no `resolved` key it falls back to the raw status', () => {
    // A row that never passed through either producer — a hand-built fixture, or a `source:
    // notes` row in tasks mode — has no derived boolean, and the status is all there is.
    expect(isOverdue({ due: '2026-09-06', status: 'todo' }, '2026-09-09')).toBe(
        true,
    )
    expect(isOverdue({ due: '2026-09-06', status: 'done' }, '2026-09-09')).toBe(
        false,
    )
})

test('a stored `resolved` column of the wrong type does not tick the fallback off', () => {
    // Only a real boolean counts. A user column called `resolved` holding a string is data, not
    // a derived flag — reading it as truthy would silently stop a genuinely late task showing
    // as late, which is exactly the class of bug the `derived` record exists to prevent.
    expect(
        isOverdue(
            { due: '2026-09-06', resolved: 'shelf 3', status: 'todo' },
            '2026-09-09',
        ),
    ).toBe(true)
})

test('no due date is never overdue', () => {
    expect(isOverdue({ status: 'todo' }, '2026-09-09')).toBe(false)
    expect(isOverdue({ due: '', status: 'todo' }, '2026-09-09')).toBe(false)
    expect(isOverdue({ due: 42, status: 'todo' }, '2026-09-09')).toBe(false)
})
