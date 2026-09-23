import { test, expect } from 'bun:test'
import { memoryEmptyMessage, memoryAge } from './memoryListModel'

test('a non-empty list never shows an empty message, regardless of query', () => {
    expect(memoryEmptyMessage('', 3)).toBeNull()
    expect(memoryEmptyMessage('anything', 3)).toBeNull()
})

test('no memory at all, no query', () => {
    expect(memoryEmptyMessage('', 0)).toBe('nothing remembered yet')
})

test('whitespace-only query reads as no query', () => {
    expect(memoryEmptyMessage('   ', 0)).toBe('nothing remembered yet')
})

test('a query with no matches quotes the trimmed query', () => {
    expect(memoryEmptyMessage('  ceramics  ', 0)).toBe(
        'no memory matches "ceramics"',
    )
})

test('memoryAge rounds seconds', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('2026-09-23T11:59:55.000Z', now)).toBe('5s ago')
})

test('memoryAge promotes 60 rounded seconds into a minute', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    // 59.5s rounds to 60s, which is >= the minute threshold — same chained-rounding promotion as
    // relTime.ts's format().
    expect(memoryAge('2026-09-23T11:59:00.500Z', now)).toBe('1m ago')
})

test('memoryAge in minutes', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('2026-09-23T11:30:00.000Z', now)).toBe('30m ago')
})

test('memoryAge in hours', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('2026-09-23T08:00:00.000Z', now)).toBe('4h ago')
})

test('memoryAge in days', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('2026-09-21T12:00:00.000Z', now)).toBe('2d ago')
})

test('memoryAge treats a future timestamp as just now, not negative', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('2026-09-23T12:05:00.000Z', now)).toBe('0s ago')
})

test('memoryAge falls back for an empty or unparseable timestamp', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(memoryAge('', now)).toBe('never seen')
    expect(memoryAge('not-a-date', now)).toBe('not-a-date')
})

// Date-only values (todayISO()'s YYYY-MM-DD, what the real memory API returns) are a LOCAL
// calendar date, not a UTC instant — Date.parse('2026-09-23') parses as UTC midnight, which reads
// as "0s ago" in a UTC+ zone for a note updated a minute ago. Compare local calendar days instead.
function localDateOnly(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('memoryAge for a date-only value updated today reads today', () => {
    const now = new Date(2026, 8, 23, 15, 30)
    expect(memoryAge(localDateOnly(now), now.getTime())).toBe('today')
})

test('memoryAge for a date-only value updated yesterday reads yesterday', () => {
    // just after local midnight, so a naive UTC/ms-diff comparison would misread this
    const now = new Date(2026, 8, 23, 0, 5)
    const yesterday = new Date(2026, 8, 22, 23, 55)
    expect(memoryAge(localDateOnly(yesterday), now.getTime())).toBe('yesterday')
})

test('memoryAge for a date-only value 5 days ago', () => {
    const now = new Date(2026, 8, 23, 12, 0)
    const fiveDaysAgo = new Date(2026, 8, 18, 9, 0)
    expect(memoryAge(localDateOnly(fiveDaysAgo), now.getTime())).toBe('5d ago')
})
