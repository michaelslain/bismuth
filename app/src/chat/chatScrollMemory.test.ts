import { test, expect } from 'bun:test'
import {
    clearChatScroll,
    loadChatScroll,
    saveChatScroll,
    spotAt,
    topFor,
} from './chatScrollMemory'

const tops = [0, 300, 900, 1000, 2400]
const box = { scrollHeight: 3000, clientHeight: 600 }

test('a scroll top inside a row names that row and the offset into it', () => {
    expect(spotAt(tops, { ...box, scrollTop: 950 })).toEqual({
        bottom: false,
        row: 2,
        offset: 50,
    })
})

test('a scroll top exactly on a row edge names that row', () => {
    expect(spotAt(tops, { ...box, scrollTop: 1000 })).toEqual({
        bottom: false,
        row: 3,
        offset: 0,
    })
})

test('the top of the list is row 0', () => {
    expect(spotAt(tops, { ...box, scrollTop: 0 })).toEqual({
        bottom: false,
        row: 0,
        offset: 0,
    })
})

test('within the follow slack of the end is the bottom', () => {
    expect(spotAt(tops, { ...box, scrollTop: 2370 })).toEqual({ bottom: true })
    expect(spotAt(tops, { ...box, scrollTop: 2400 })).toEqual({ bottom: true })
})

test('an empty list is the bottom', () => {
    expect(spotAt([], { ...box, scrollTop: 0 })).toEqual({ bottom: true })
})

test('a row spot follows its row when the rows above it grow', () => {
    const spot = spotAt(tops, { ...box, scrollTop: 950 })
    // every message above mounted its note view and grew by 200px
    const grown = [0, 500, 1300, 1600, 3200]
    expect(topFor(spot, grown, { scrollHeight: 4000, clientHeight: 600 })).toBe(
        1350,
    )
})

test('the bottom spot lands on the end, however much the list grew', () => {
    expect(
        topFor({ bottom: true }, tops, { scrollHeight: 9000, clientHeight: 600 }),
    ).toBe(8400)
})

test('a row that no longer exists falls back to the bottom', () => {
    expect(
        topFor({ bottom: false, row: 9, offset: 10 }, tops, box),
    ).toBe(2400)
})

test('a row spot never lands past the end', () => {
    expect(
        topFor({ bottom: false, row: 4, offset: 500 }, tops, box),
    ).toBe(2400)
})

test('spots are kept per chat', () => {
    saveChatScroll('a', { bottom: false, row: 3, offset: 12 })
    saveChatScroll('b', { bottom: true })
    expect(loadChatScroll('a')).toEqual({ bottom: false, row: 3, offset: 12 })
    expect(loadChatScroll('b')).toEqual({ bottom: true })
    clearChatScroll('a')
    expect(loadChatScroll('a')).toBeUndefined()
})
