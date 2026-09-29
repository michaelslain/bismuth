import { test, expect } from 'bun:test'
import { isOpenableUrl, openableHref } from './openableUrl'

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

test('openableHref keeps safe urls and prefixes bare hosts', () => {
    expect(openableHref(' https://example.com/a ')).toBe('https://example.com/a')
    expect(openableHref('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(openableHref('example.com')).toBe('https://example.com')
    expect(openableHref('www.example.com:8080/a/b?q=1')).toBe(
        'https://www.example.com:8080/a/b?q=1',
    )
})

test('openableHref refuses other schemes, words and whitespace', () => {
    expect(openableHref('javascript:alert(1)')).toBeUndefined()
    expect(openableHref('data:text/html,x')).toBeUndefined()
    expect(openableHref('file:///etc/passwd')).toBeUndefined()
    expect(openableHref('ftp://example.com')).toBeUndefined()
    expect(openableHref('hello')).toBeUndefined()
    expect(openableHref('my site.com')).toBeUndefined()
    expect(openableHref('')).toBeUndefined()
    expect(openableHref(undefined)).toBeUndefined()
})
