import { test, expect } from 'bun:test'
import { isOpenableUrl } from './openableUrl'

test('http, https and mailto open', () => {
    expect(isOpenableUrl('https://example.com/a')).toBe(true)
    expect(isOpenableUrl('HTTP://example.com')).toBe(true)
    expect(isOpenableUrl('mailto:a@b.co')).toBe(true)
})

test('every other scheme, and nothing, does not', () => {
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableUrl('data:text/html,x')).toBe(false)
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('example.com')).toBe(false)
    expect(isOpenableUrl('')).toBe(false)
    expect(isOpenableUrl(undefined)).toBe(false)
})
