import { expect, test } from 'bun:test'
import { isExternalHref } from './externalLinks'

const o = 'http://localhost:1420'
test('external hrefs', () => {
    expect(isExternalHref('https://example.com', o)).toBe(true)
    expect(isExternalHref('mailto:a@b.c', o)).toBe(true)
    expect(isExternalHref('http://localhost:1420/x', o)).toBe(false)
    expect(isExternalHref('#heading', o)).toBe(false)
    expect(isExternalHref('notes/x.md', o)).toBe(false)
})
