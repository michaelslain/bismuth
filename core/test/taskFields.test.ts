import { test, expect } from 'bun:test'
import { parseFields, formatDateField } from '../src/taskFields'

test('reads every date key', () => {
    const f = parseFields('buy milk [due 2026-09-14] [scheduled 2026-09-12]')
    expect(f.dates.due).toBe('2026-09-14')
    expect(f.dates.scheduled).toBe('2026-09-12')
    expect(f.rest).toBe('buy milk')
})

test('reads a bare priority word', () => {
    expect(parseFields('x [high]').priority).toBe('high')
    expect(parseFields('x [lowest]').priority).toBe('lowest')
})

test('reads a multi-word recurrence rule', () => {
    expect(parseFields('x [every 2 weeks]').recurrence).toBe('every 2 weeks')
    expect(parseFields('x [every weekday]').recurrence).toBe('every weekday')
})

test('leaves a markdown link alone', () => {
    const f = parseFields('see [due 2026-09-14](http://x) now')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('see [due 2026-09-14](http://x) now')
})

test('leaves a wikilink alone', () => {
    const f = parseFields('about [[due 2026-09-14]] here')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('about [[due 2026-09-14]] here')
})

test('leaves an unknown key alone', () => {
    const f = parseFields('read [chapter 3] tonight')
    expect(f.rest).toBe('read [chapter 3] tonight')
})

test('a malformed date stays visible instead of vanishing', () => {
    const f = parseFields('pay rent [due sept 14]')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('pay rent [due sept 14]')
})

test('formatDateField round-trips', () => {
    expect(formatDateField('due', '2026-09-14')).toBe('[due 2026-09-14]')
    expect(parseFields(formatDateField('due', '2026-09-14')).dates.due).toBe(
        '2026-09-14',
    )
})
