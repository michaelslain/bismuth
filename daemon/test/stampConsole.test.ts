import { test, expect } from 'bun:test'
import { stampPrefix } from '../src/lib/stampConsole'

test('every service-log line opens with its ISO time', () => {
    expect(stampPrefix(new Date('2026-10-12T22:43:36.534Z'))).toBe(
        '[2026-10-12T22:43:36.534Z] ',
    )
})
