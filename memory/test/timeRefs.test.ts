import { describe, test, expect } from 'bun:test'
import { timeRefs } from '../src/timeRefs.ts'

// Friday 2026-11-06, local
const now = new Date(2026, 10, 6, 14, 30)
const range = (text: string) => timeRefs(text, now).map(r => `${r.start}..${r.end}`)

describe('timeRefs', () => {
    const positives: [string, string[]][] = [
        ['what did I do today', ['2026-11-06..2026-11-06']],
        ['what did we do yesterday', ['2026-11-05..2026-11-05']],
        ['the other day we talked about it', ['2026-11-02..2026-11-04']],
        ['what happened last week', ['2026-10-26..2026-11-01']],
        ['summarize this week', ['2026-11-02..2026-11-06']],
        ["I want to plan this week's tasks", ['2026-11-02..2026-11-06']],
        ['what did I do on tuesday', ['2026-11-03..2026-11-03']],
        ['last tuesday we decided', ['2026-11-03..2026-11-03']],
        ["tuesday's lecture notes", ['2026-11-03..2026-11-03']],
        ['on friday I shipped it', ['2026-11-06..2026-11-06']],
        ['tuesday’s lecture', ['2026-11-03..2026-11-03']],
        ['last friday', ['2026-10-30..2026-10-30']],
        ['3 days ago I fixed the graph', ['2026-11-03..2026-11-03']],
        ['three days ago', ['2026-11-03..2026-11-03']],
        ['1 day ago', ['2026-11-05..2026-11-05']],
        ['nov 3', ['2026-11-03..2026-11-03']],
        ['November 3rd planning', ['2026-11-03..2026-11-03']],
        ['3 nov standup', ['2026-11-03..2026-11-03']],
        ['3rd of november', ['2026-11-03..2026-11-03']],
        ['dec 20', ['2025-12-20..2025-12-20']],
        ['on 2026-10-15 we met', ['2026-10-15..2026-10-15']],
        ['last month', ['2026-10-01..2026-10-31']],
        ['this month so far', ['2026-11-01..2026-11-06']],
        ['last weekend', ['2026-10-31..2026-11-01']],
        ['yesterday and last week', ['2026-11-05..2026-11-05', '2026-10-26..2026-11-01']],
        ['Yesterday I worked on it', ['2026-11-05..2026-11-05']],
        ['what did I do on Monday?', ['2026-11-02..2026-11-02']],
    ]
    for (const [text, want] of positives)
        test(`hit: ${text}`, () => expect(range(text)).toEqual(want))

    const negatives = [
        'check Monday.com for the board',
        'may I ask a question',
        'the last time series was wrong',
        'open the weekly report',
        'this weekend plan is vague',
        'days ago is not a number',
        'I may have 3 apples',
        'the version 2026-13-45 failed',
        'last year we shipped',
        'the monday column in the table',
        'sunday brunch spot ideas',
        'March madness',
        'tuesdays are busy',
        'what is the plan',
        'on monday.com tuesday.io',
        'the today button in the calendar does nothing',
        'fix the this week view of the calendar base',
        'const today = todayISO()',
        'round to 2 dec places',
        'march 3 steps forward',
        'the 1 jan default',
    ]
    for (const text of negatives) test(`miss: ${text}`, () => expect(range(text)).toEqual([]))

    test('labels carry the phrase and the date', () => {
        expect(timeRefs('what happened yesterday', now)[0]!.label).toBe('yesterday (2026-11-05)')
        expect(timeRefs('last week', now)[0]!.label).toBe('last week (2026-10-26..2026-11-01)')
    })

    test('uses the local calendar, not UTC', () => {
        const late = new Date(2026, 10, 6, 23, 59)
        expect(timeRefs('today', late)[0]!.start).toBe('2026-11-06')
    })
})
