import { describe, expect, test } from 'bun:test'
import { DEFAULTS } from '../settings'
import { ICON_NAMES } from '../icons/iconNames'
import {
    DEFAULT_PRIVACY,
    PRIVACY_LEVELS,
    PRIVACY_OPTIONS,
    applyLevel,
    levelOf,
    privacyOptions,
    privacyWrites,
    togglePrivacy,
} from './introPrivacy'

describe('introPrivacy', () => {
    test('the slide starts at ask: only ask from find on', () => {
        const on = Object.entries(DEFAULT_PRIVACY).filter(([, v]) => v).map(([k]) => k)
        expect(on).toEqual(['findAsksAi'])
        expect(levelOf(DEFAULT_PRIVACY)).toBe('ask')
        expect(levelOf(applyLevel('private'))).toBe('private')
    })

    test('without the daemon only ask from find shows and is written', () => {
        expect(privacyOptions(false).map(o => o.id)).toEqual(['findAsksAi'])
        expect(privacyWrites(DEFAULT_PRIVACY, false)).toEqual([{ path: ['editor', 'findAsksAi'], value: true }])
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

    test('with the daemon, one write per switch in option order', () => {
        const writes = privacyWrites(DEFAULT_PRIVACY)
        expect(writes).toEqual(
            PRIVACY_OPTIONS.map(o =>
                o.cron
                    ? { cron: o.cron, value: DEFAULT_PRIVACY[o.id] }
                    : { path: o.path, value: DEFAULT_PRIVACY[o.id] },
            ),
        )
        expect(writes).toContainEqual({ cron: 'dream', value: false })
        expect(writes).toHaveLength(8)
    })

    test('icons exist', () => {
        for (const o of PRIVACY_OPTIONS) expect(ICON_NAMES).toContain(o.icon)
    })

    test('every option path resolves in DEFAULTS to a boolean that is false', () => {
        for (const o of PRIVACY_OPTIONS) {
            if (!o.path) continue
            let v: unknown = DEFAULTS
            for (const k of o.path) v = (v as Record<string, unknown>)?.[k]
            expect(typeof v).toBe('boolean')
            expect(v).toBe(false)
        }
    })
})
