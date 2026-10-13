// app/src/calendar/state.defaultView.test.ts
//
// Each calendar owns its period and date (`CalendarNav`). A calendar that has not picked a period
// follows the saved `defaultView`, including when settings hydrate after the nav exists; once it
// picks one it keeps it, and no other calendar sees the pick.
import { afterEach, describe, expect, it } from 'bun:test'
import { calendarNavFor, createCalendarNav } from './state'
import { setSettings, DEFAULTS } from '../settings'

afterEach(() => setSettings('calendar', 'defaultView', DEFAULTS.calendar.defaultView))

describe('calendar nav', () => {
    it('follows the saved defaultView until the calendar picks a period', () => {
        const nav = createCalendarNav()
        expect(nav.view.value).toBe(DEFAULTS.calendar.defaultView)
        // Settings hydration lands after the nav was created.
        setSettings('calendar', 'defaultView', 'month')
        expect(nav.view.value).toBe('month')
    })

    it('keeps its own pick when the saved default changes', () => {
        const nav = createCalendarNav()
        nav.view.value = 'day'
        setSettings('calendar', 'defaultView', 'month')
        expect(nav.view.value).toBe('day')
    })

    it('a pick on one calendar does not reach another', () => {
        const a = calendarNavFor('cal/a.base.jsonl')
        const b = calendarNavFor('cal/b.base.jsonl')
        b.view.value = 'month'
        a.view.value = '3day'
        expect(b.view.value).toBe('month')
        a.date.value = new Date(2026, 0, 5)
        expect(b.date.value.getMonth()).not.toBe(0)
    })

    it('returns the same nav for the same base, so a remount restores its pick', () => {
        const first = calendarNavFor('cal/c.base.jsonl')
        first.view.value = 'week'
        expect(calendarNavFor('cal/c.base.jsonl')).toBe(first)
        expect(calendarNavFor('cal/c.base.jsonl').view.value).toBe('week')
    })
})
