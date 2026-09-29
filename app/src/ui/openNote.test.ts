import { afterEach, beforeEach, expect, test } from 'bun:test'
import { openNote } from './openNote'

const saved = (globalThis as any).window
let seen: unknown[] = []

beforeEach(() => {
    seen = []
    const target = new EventTarget()
    target.addEventListener('bismuth-open', e => seen.push((e as CustomEvent).detail))
    ;(globalThis as any).window = target
})
afterEach(() => {
    if (saved === undefined) delete (globalThis as any).window
    else (globalThis as any).window = saved
})

test('a bare path is sent as a string', () => {
    openNote('a/b.md')
    expect(seen).toEqual(['a/b.md'])
})

test('a heading rides along as an object', () => {
    openNote('a/b.md', 'Intro')
    expect(seen).toEqual([{ path: 'a/b.md', heading: 'Intro' }])
})
