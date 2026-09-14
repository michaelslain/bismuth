import { test, expect } from 'bun:test'
import { decideGraphRefresh } from './graphRefreshGate'

test('version 0 (no live change yet) never refreshes, and never marks a first change seen', () => {
    expect(decideGraphRefresh({ version: 0 }, false)).toEqual({
        refresh: false,
        sawFirstLiveChange: false,
    })
    expect(decideGraphRefresh({ version: 0 }, true)).toEqual({
        refresh: false,
        sawFirstLiveChange: true,
    })
})

test('the first live change with no `dirty` field (the SSE snapshot / fallback-poll shape) is skipped and marks a first change seen — the mount fetch already covers it', () => {
    expect(decideGraphRefresh({ version: 5 }, false)).toEqual({
        refresh: false,
        sawFirstLiveChange: true,
    })
})

test('the first live change CAN be a real structural change (installed app: fresh core, no boot version-bump) — dirty.graph true still refreshes', () => {
    expect(
        decideGraphRefresh(
            { version: 5, dirty: { graph: true, tree: true } },
            false,
        ),
    ).toEqual({ refresh: true, sawFirstLiveChange: true })
})

test('a later change with no `dirty` field still refreshes — absent dirty means "assume everything changed" (poll/reconnect), not "this is the boot snapshot"', () => {
    expect(decideGraphRefresh({ version: 6 }, true)).toEqual({
        refresh: true,
        sawFirstLiveChange: true,
    })
})

test('dirty.graph === false never refreshes, whether or not it is the first change seen', () => {
    expect(
        decideGraphRefresh(
            { version: 7, dirty: { graph: false, tree: true } },
            true,
        ),
    ).toEqual({ refresh: false, sawFirstLiveChange: true })
    expect(
        decideGraphRefresh(
            { version: 7, dirty: { graph: false, tree: true } },
            false,
        ),
    ).toEqual({ refresh: false, sawFirstLiveChange: true })
})
