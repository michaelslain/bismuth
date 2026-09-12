// Coverage for the emoji reader in its new home. Every test here was an assertion about
// `parseTaskLine` before the reader moved: the behaviour did not change, its only caller
// did. Migration is the one thing standing between an emoji-era vault and losing its dates,
// priorities and recurrences, so this reader needs the same coverage it had as a parse path.
import { test, expect } from 'bun:test'
import { hasLegacySignifier, readLegacyLine } from '../src/taskLegacy'

test('hasLegacySignifier finds each signifier family', () => {
    expect(hasLegacySignifier('- [ ] a 📅 2026-01-01')).toBe(true)
    expect(hasLegacySignifier('- [ ] a ⏫')).toBe(true)
    expect(hasLegacySignifier('- [ ] a 🔁 every week')).toBe(true)
    expect(hasLegacySignifier('- [ ] a [due 2026-01-01]')).toBe(false)
})

test('hasLegacySignifier does not leak lastIndex between calls', () => {
    // ANY_SIGNIFIER is shared and non-global for exactly this reason: a global regex's
    // `.test()` advances lastIndex, so the same input would alternate true/false.
    const line = '- [ ] a 📅 2026-01-01 ⏫'
    expect(hasLegacySignifier(line)).toBe(true)
    expect(hasLegacySignifier(line)).toBe(true)
})

test('the legacy reader still reads a full emoji line', () => {
    const t = readLegacyLine('- [ ] buy milk 📅 2026-09-14 ⏫', 'a.md', 0)!
    expect(t.due).toBe('2026-09-14')
    expect(t.priority).toBe('high')
    expect(t.description).toBe('buy milk')
})

test('the legacy reader returns null for a non-task line', () => {
    expect(readLegacyLine('just text 📅 2026-09-14', 'a.md', 0)).toBeNull()
})

// --- moved from tasks.test.ts: `still reads the emoji signifiers` ---

test('the legacy reader reads date, priority and recurrence signifiers together', () => {
    const t = readLegacyLine(
        '- [ ] buy milk 📅 2026-09-14 ⏫ 🔁 every week',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-09-14')
    expect(t.priority).toBe('high')
    expect(t.recurrence).toBe('every week')
    expect(t.description).toBe('buy milk')
})

test('the legacy reader reads every emoji date field', () => {
    const t = readLegacyLine(
        '- [x] thing 📅 2026-06-01 ⏳ 2026-05-28 🛫 2026-05-20 ✅ 2026-05-27 ➕ 2026-05-01 ❌ 2026-05-30',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-06-01')
    expect(t.scheduled).toBe('2026-05-28')
    expect(t.start).toBe('2026-05-20')
    expect(t.done).toBe('2026-05-27')
    expect(t.created).toBe('2026-05-01')
    expect(t.cancelled).toBe('2026-05-30')
    expect(t.description).toBe('thing')
})

test('the legacy reader reads every emoji priority', () => {
    expect(readLegacyLine('- [ ] a 🔺', 'f.md', 0)!.priority).toBe('highest')
    expect(readLegacyLine('- [ ] b ⏫', 'f.md', 0)!.priority).toBe('high')
    expect(readLegacyLine('- [ ] c 🔼', 'f.md', 0)!.priority).toBe('medium')
    expect(readLegacyLine('- [ ] d 🔽', 'f.md', 0)!.priority).toBe('low')
    expect(readLegacyLine('- [ ] e ⏬', 'f.md', 0)!.priority).toBe('lowest')
    expect(readLegacyLine('- [ ] f', 'f.md', 0)!.priority).toBe('none')
})

// --- moved from tasks.test.ts: `an emoji recurrence stops at a trailing tag` ---

test('the legacy reader stops a recurrence rule at a trailing tag', () => {
    const t = readLegacyLine('- [ ] pay rent 🔁 every month #home', 'a.md', 0)!
    expect(t.recurrence).toBe('every month')
    expect(t.tags).toEqual(['home'])
    expect(t.description).toBe('pay rent #home')
})

// --- moved from tasks.test.ts: `captures tags on both sides of the recurrence signifier` ---

test('the legacy reader captures tags on both sides of the recurrence signifier', () => {
    const t = readLegacyLine('- [ ] a #before 🔁 every week #after', 'f.md', 0)!
    expect(t.tags.sort()).toEqual(['after', 'before'])
    expect(t.recurrence).toBe('every week')
})

// --- moved from tasks.test.ts: the two spellings contest each other, and the bracket wins.
// The contest is gone from parseTaskLine but very much alive HERE, because a real vault holds
// lines written in both spellings at once and migration has to pick one. ---

test('a bracket field beats an emoji for the same field in the legacy reader', () => {
    const t = readLegacyLine('- [ ] x [due 2026-09-14] 📅 2026-01-01', 'f.md', 0)!
    expect(t.due).toBe('2026-09-14')
})

test('a bracket priority beats an emoji priority, and the emoji is stripped', () => {
    const t = readLegacyLine('- [ ] x [high] ⏫', 'f.md', 0)!
    expect(t.priority).toBe('high')
    expect(t.description).toBe('x')
})

// --- moved from tasks.test.ts: `a recurring EMOJI task still rolls forward, in its own
// spelling`. Rolling forward is toggleTaskLine's job and it no longer happens for an emoji
// line — what survives, and what migration needs, is that the reader still sees both fields. ---

test('the legacy reader sees the date and rule of an emoji recurring task', () => {
    const t = readLegacyLine(
        '- [ ] pay rent 📅 2026-09-01 🔁 every month',
        'f.md',
        0,
    )!
    expect(t.due).toBe('2026-09-01')
    expect(t.recurrence).toBe('every month')
    expect(t.description).toBe('pay rent')
})

// Several of these emoji are commonly typed with a U+FE0F variation selector. ANY_SIGNIFIER
// matches the base codepoint, so such a file passes the pre-filter on every boot — but the
// per-field regexes require the date to follow the emoji directly, and U+FE0F is not
// whitespace. Without the optional selector the line is skipped forever while still costing a
// scan every launch, and a priority signifier converts but leaves the selector behind as
// invisible garbage written into the user's note.
test('the legacy reader reads a date signifier carrying a variation selector', () => {
    const t = readLegacyLine('- [ ] file taxes ✅️ 2026-01-01', 'a.md', 0)!
    expect(t.done).toBe('2026-01-01')
    expect(t.description).toBe('file taxes')
})

test('a priority signifier with a variation selector leaves no orphan in the description', () => {
    const t = readLegacyLine('- [ ] foo ⏫️', 'a.md', 0)!
    expect(t.priority).toBe('high')
    expect(t.description).toBe('foo')
})

test('a recurrence signifier with a variation selector yields a clean rule', () => {
    const t = readLegacyLine('- [ ] rent \u{1F501}️ every month', 'a.md', 0)!
    expect(t.recurrence).toBe('every month')
    expect(t.description).toBe('rent')
})
