import { test, expect, beforeEach } from 'bun:test'
import {
    blockHeightKey,
    clearBlockHeights,
    estimateBlockHeight,
    MAX_ENTRIES,
    rememberBlockHeight,
} from './blockHeights'

beforeEach(clearBlockHeights)

test('an unseen block is unknown (-1, one line to CodeMirror)', () => {
    expect(estimateBlockHeight(blockHeightKey('table', '| a |'))).toBe(-1)
})

test('a measured block answers with its measured height', () => {
    const key = blockHeightKey('table', '| a |\n|---|\n| 1 |')
    rememberBlockHeight(key, 812)
    expect(estimateBlockHeight(key)).toBe(812)
})

test('the key depends on the source, not on which widget instance asks', () => {
    expect(blockHeightKey('query', 'from tasks')).toBe(
        blockHeightKey('query', 'from tasks'),
    )
    expect(blockHeightKey('query', 'from tasks')).not.toBe(
        blockHeightKey('query', 'from notes'),
    )
    expect(blockHeightKey('query', 'x')).not.toBe(blockHeightKey('graph', 'x'))
})

test('a block with new content falls back to its kind’s height per unit', () => {
    rememberBlockHeight(blockHeightKey('table', 'old'), 400, 10)
    expect(estimateBlockHeight(blockHeightKey('table', 'new'), 25)).toBe(1000)
    // no units → no fallback; another kind → no fallback
    expect(estimateBlockHeight(blockHeightKey('table', 'new'))).toBe(-1)
    expect(estimateBlockHeight(blockHeightKey('math', 'new'), 25)).toBe(-1)
})

test('a height under 1px is ignored (a hidden pane or unloaded content)', () => {
    const key = blockHeightKey('embed', 'img.png')
    rememberBlockHeight(key, 0)
    expect(estimateBlockHeight(key)).toBe(-1)
})

test('the oldest entry is dropped past the cap; a re-measured one is kept', () => {
    const first = blockHeightKey('html', 'first')
    const second = blockHeightKey('html', 'second')
    rememberBlockHeight(first, 10)
    rememberBlockHeight(second, 20)
    rememberBlockHeight(first, 11) // touched again: now the newest
    for (let i = 0; i < MAX_ENTRIES - 1; i++)
        rememberBlockHeight(blockHeightKey('html', `n${i}`), 30)
    expect(estimateBlockHeight(second)).toBe(-1)
    expect(estimateBlockHeight(first)).toBe(11)
})
