import { describe, expect, test } from 'bun:test'
import { isFrontmatterFolded, setFrontmatterFolded } from './frontmatterFold'

describe('frontmatterFold', () => {
    test('unknown key is open', () => {
        expect(isFrontmatterFolded('never-seen.pdf')).toBe(false)
    })
    test('remembers per key', () => {
        setFrontmatterFolded('a.pdf', true)
        expect(isFrontmatterFolded('a.pdf')).toBe(true)
        expect(isFrontmatterFolded('b.png')).toBe(false)
        setFrontmatterFolded('a.pdf', false)
        expect(isFrontmatterFolded('a.pdf')).toBe(false)
    })
})
