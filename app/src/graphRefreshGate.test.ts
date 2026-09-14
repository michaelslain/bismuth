import { test, expect } from 'bun:test'
import { decideGraphRefresh } from './graphRefreshGate'

test('version 0 (no live change yet) never refreshes', () => {
    expect(decideGraphRefresh({ version: 0 })).toBe(false)
})

test('a poll catch-up with no `dirty` field, even as the very FIRST change this effect ever sees, still refreshes — controller ruling 2026-09-13: absent `dirty` means "assume everything changed" (poll catch-up / reconnect snapshot), never "this must be an inert boot snapshot, skip it"', () => {
    expect(decideGraphRefresh({ version: 3 })).toBe(true)
})

test('a later change with no `dirty` field also refreshes, same as the first', () => {
    expect(decideGraphRefresh({ version: 6 })).toBe(true)
})

test('dirty.graph === false never refreshes, first change or not', () => {
    expect(
        decideGraphRefresh({ version: 7, dirty: { graph: false, tree: true } }),
    ).toBe(false)
})

test('dirty.graph === true always refreshes', () => {
    expect(
        decideGraphRefresh({ version: 5, dirty: { graph: true, tree: true } }),
    ).toBe(true)
})
