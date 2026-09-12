import { test, expect } from 'bun:test'
import { parseFields, formatDateField, isFieldText, splitRecurrence } from '../src/taskFields'

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

test('an unknown key with a date-shaped value stays literal', () => {
    // Isolates the key whitelist from the date-shape/date-validity checks: this value
    // alone is exactly `YYYY-MM-DD` and a real calendar date, so only the whitelist
    // keeps `chapter` from being read as a date field.
    const f = parseFields('read [chapter 2026-09-14] tonight')
    expect(f.dates).toEqual({})
    expect(f.rest).toBe('read [chapter 2026-09-14] tonight')
})

test('a malformed date stays visible instead of vanishing', () => {
    const f = parseFields('pay rent [due sept 14]')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('pay rent [due sept 14]')
})

test('an impossible month stays visible instead of being silently absorbed', () => {
    const f = parseFields('x [due 2026-13-45]')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('x [due 2026-13-45]')
})

test('an impossible day of month stays visible', () => {
    const f = parseFields('x [due 2026-02-30]')
    expect(f.dates.due).toBeUndefined()
    expect(f.rest).toBe('x [due 2026-02-30]')
})

test('a real leap day is still accepted', () => {
    expect(parseFields('x [due 2028-02-29]').dates.due).toBe('2028-02-29')
})

test('a duplicate date key keeps the first occurrence', () => {
    const f = parseFields('x [due 2026-09-14] [due 2026-10-01]')
    expect(f.dates.due).toBe('2026-09-14')
})

test('a duplicate priority keeps the first occurrence', () => {
    expect(parseFields('x [high] [low]').priority).toBe('high')
})

test('a duplicate recurrence keeps the first occurrence', () => {
    expect(parseFields('x [every week] [every month]').recurrence).toBe('every week')
})

test('formatDateField round-trips', () => {
    expect(formatDateField('due', '2026-09-14')).toBe('[due 2026-09-14]')
    expect(parseFields(formatDateField('due', '2026-09-14')).dates.due).toBe(
        '2026-09-14',
    )
})

// isFieldText is the guard livePreview.ts's chip decoration filters FIELD_SCAN's candidates
// through, so a bracket that FIELD_SCAN merely matches but parseFields does not accept never
// renders as a chip — the raw text and the rendered chip must agree on what a field is.
test('isFieldText accepts a real date field', () => {
    expect(isFieldText('due 2026-09-14')).toBe(true)
})

test('isFieldText accepts a bare priority word', () => {
    expect(isFieldText('high')).toBe(true)
})

test('isFieldText accepts a recurrence rule', () => {
    expect(isFieldText('every 2 weeks')).toBe(true)
})

test('isFieldText rejects an unknown key', () => {
    expect(isFieldText('chapter 3')).toBe(false)
})

test('isFieldText rejects a known key with a date-shaped but unknown value', () => {
    expect(isFieldText('chapter 2026-09-14')).toBe(false)
})

test('isFieldText rejects a calendar-impossible date on a real key', () => {
    // The exact case a chip must never paper over: [due 2026-02-30] has to stay visible as
    // plain text, and a chip here would tell the user it IS a recognised date.
    expect(isFieldText('due 2026-02-30')).toBe(false)
})

test('isFieldText agrees with parseFields on every FIELD_SCAN candidate', () => {
    // Cross-check rather than trusting the two to stay in sync by construction: for each
    // fixture, isFieldText's verdict on the bracket's inner text must match whether
    // parseFields actually consumed it out of `rest`.
    const cases = [
        'due 2026-09-14',
        'high',
        'every week',
        'chapter 3',
        'chapter 2026-09-14',
        'due 2026-02-30',
        'due sept 14',
    ]
    for (const inner of cases) {
        const line = `x [${inner}]`
        const consumed = parseFields(line).rest !== line
        expect(isFieldText(inner)).toBe(consumed)
    }
})

test('splitRecurrence cuts the rule at the first tag', () => {
    expect(splitRecurrence('every month #home')).toEqual({
        rule: 'every month',
        trailing: '#home',
    })
})

test('splitRecurrence leaves a tagless rule whole', () => {
    expect(splitRecurrence('every 2 weeks')).toEqual({
        rule: 'every 2 weeks',
        trailing: '',
    })
})

test('a hash inside a word is not a tag boundary', () => {
    expect(splitRecurrence('every issue#3 days')).toEqual({
        rule: 'every issue#3 days',
        trailing: '',
    })
})

test('a bracket recurrence keeps its trailing tag in the description', () => {
    const f = parseFields('pay rent [every month #home]')
    expect(f.recurrence).toBe('every month')
    expect(f.rest).toBe('pay rent #home')
})

// A second recurrence bracket is inert as a FIELD — the first occurrence already won — but
// its trailing tag must still reach the description. That is why the drop.push carrying the
// trailing text sits OUTSIDE the `recurrence === undefined` guard in parseFields: only the
// assignment to `recurrence` is guarded, not the splice. A refactor that moved the splice
// inside the guard too would silently swallow this tag, and nothing else catches it.
test('a second recurrence bracket is inert but its trailing tag still survives', () => {
    const f = parseFields('x [every week] [every month #home]')
    expect(f.recurrence).toBe('every week')
    expect(f.rest).toBe('x #home')
})

