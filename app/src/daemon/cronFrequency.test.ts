import { test, expect } from 'bun:test'
import cronFrequency from './cronFrequency'

test.each([
    ['*/5 * * * *', 'every 5m'],
    ['* * * * *', 'every min'],
    ['0 */3 * * *', 'every 3h'],
    ['0 * * * *', 'hourly'],
    ['0 9 * * *', 'daily'],
    ['0 9 * * 1', 'weekly'],
    ['0 9 1 * *', 'monthly'],
    ['', ''],
])('%s → %s', (expr, want) => {
    expect(cronFrequency(expr)).toBe(want)
})
