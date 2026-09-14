import { describe, expect, test } from 'bun:test'
import { bodyForPath, isForeignBody } from './prefetchedBody'

const MANAGER = 'tasks/Task Manager.md'
const CALENDAR = 'tasks/Task Calendar.md'

describe('bodyForPath', () => {
    test('prefers the noteCache peek for the mounted path', () => {
        expect(
            bodyForPath(MANAGER, 'manager text', {
                path: MANAGER,
                text: 'older manager text',
            }),
        ).toBe('manager text')
    })
    test('falls back to the loaded body when it was read for the same path', () => {
        expect(
            bodyForPath(MANAGER, undefined, {
                path: MANAGER,
                text: 'manager text',
            }),
        ).toBe('manager text')
    })
    test('refuses a loaded body read for a different path', () => {
        expect(
            bodyForPath(MANAGER, undefined, {
                path: CALENDAR,
                text: 'calendar text',
            }),
        ).toBe(undefined)
    })
    test('nothing cached and nothing loaded gives undefined', () => {
        expect(bodyForPath(MANAGER, undefined, undefined)).toBe(undefined)
    })
})

describe('isForeignBody', () => {
    test('true only for a loaded body tagged with another path', () => {
        expect(isForeignBody(MANAGER, { path: CALENDAR, text: 'x' })).toBe(true)
        expect(isForeignBody(MANAGER, { path: MANAGER, text: 'x' })).toBe(false)
        expect(isForeignBody(MANAGER, undefined)).toBe(false)
    })
})
