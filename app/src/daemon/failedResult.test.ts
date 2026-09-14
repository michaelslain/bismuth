import { test, expect } from 'bun:test'
import { isFailedResult } from './failedResult'

test('failed and killed and error all count as failure', () => {
    expect(isFailedResult('failed')).toBe(true)
    expect(isFailedResult('killed')).toBe(true)
    expect(isFailedResult('error')).toBe(true)
})

test('success, skipped, undefined and null are not failures', () => {
    expect(isFailedResult('success')).toBe(false)
    expect(isFailedResult('skipped')).toBe(false)
    expect(isFailedResult(undefined)).toBe(false)
    expect(isFailedResult(null)).toBe(false)
})
