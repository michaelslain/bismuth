import { describe, expect, test } from 'bun:test'
import { DEFAULTS } from '../settings'
import { ICON_NAMES } from '../icons/iconNames'
import {
    DEFAULT_PRIVACY,
    PRIVACY_LEVELS,
    PRIVACY_OPTIONS,
    applyLevel,
    levelOf,
    privacyWrites,
    togglePrivacy,
} from './introPrivacy'

describe('introPrivacy', () => {
    test('default is all off and private', () => {
        expect(Object.values(DEFAULT_PRIVACY).every(v => v === false)).toBe(true)
        expect(levelOf(DEFAULT_PRIVACY)).toBe('private')
    })

    test('every level round-trips', () => {
        for (const level of PRIVACY_LEVELS) expect(levelOf(applyLevel(level.id))).toBe(level.id)
    })

    test('full turns everything on', () => {
        expect(Object.values(applyLevel('full')).every(v => v === true)).toBe(true)
    })

    test('toggling saveSessions from assist is custom', () => {
        expect(levelOf(togglePrivacy(applyLevel('assist'), 'saveSessions'))).toBe('custom')
    })

    test('recall off clears midTurn', () => {
        const on = togglePrivacy(togglePrivacy(DEFAULT_PRIVACY, 'recall'), 'midTurn')
        expect(on.midTurn).toBe(true)
        const off = togglePrivacy(on, 'recall')
        expect(off.recall).toBe(false)
        expect(off.midTurn).toBe(false)
    })

    test('midTurn is a no-op while recall is off', () => {
        expect(togglePrivacy(DEFAULT_PRIVACY, 'midTurn')).toEqual(DEFAULT_PRIVACY)
    })

    test('writes are seven false entries in option order', () => {
        const writes = privacyWrites(DEFAULT_PRIVACY)
        expect(writes).toEqual(PRIVACY_OPTIONS.map(o => ({ path: o.path, value: false })))
        expect(writes).toHaveLength(7)
    })

    test('icons exist', () => {
        for (const o of PRIVACY_OPTIONS) expect(ICON_NAMES).toContain(o.icon)
    })

    test('every option path resolves in DEFAULTS to a boolean that is false', () => {
        for (const o of PRIVACY_OPTIONS) {
            let v: unknown = DEFAULTS
            for (const k of o.path) v = (v as Record<string, unknown>)?.[k]
            expect(typeof v).toBe('boolean')
            expect(v).toBe(false)
        }
    })
})
