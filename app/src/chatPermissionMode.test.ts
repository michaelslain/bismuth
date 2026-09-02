import { test, expect, describe } from 'bun:test'
import {
    DEFAULT_PERMISSION_MODE,
    PERMISSION_MODES,
    PERMISSION_MODE_OPTIONS,
    sanitizePermissionMode,
    reconcilePermissionMode,
} from './chatPermissionMode'

// FEATURE #35: "permissions keep resetting to default." These pure rules make the user's chosen
// permission mode (and the Bypass default) STICK — sanitizePermissionMode guards the persisted read,
// reconcilePermissionMode decides whether a later per-turn manifest may change the mode.

describe('sanitizePermissionMode (persisted-read guard)', () => {
    test('passes through every valid mode', () => {
        for (const m of [
            'default',
            'plan',
            'acceptEdits',
            'bypassPermissions',
        ]) {
            expect(sanitizePermissionMode(m)).toBe(m)
        }
    })

    test('falls back to the app default (Bypass) on null / unknown / empty', () => {
        expect(sanitizePermissionMode(null)).toBe(DEFAULT_PERMISSION_MODE)
        expect(sanitizePermissionMode(undefined)).toBe(DEFAULT_PERMISSION_MODE)
        expect(sanitizePermissionMode('')).toBe(DEFAULT_PERMISSION_MODE)
        expect(sanitizePermissionMode('garbage')).toBe(DEFAULT_PERMISSION_MODE)
        expect(DEFAULT_PERMISSION_MODE).toBe('bypassPermissions')
    })
})

describe("reconcilePermissionMode (don't let a manifest revert my choice)", () => {
    test('no-op when the reported mode already equals the desired one', () => {
        expect(
            reconcilePermissionMode('bypassPermissions', 'bypassPermissions'),
        ).toBeNull()
        expect(reconcilePermissionMode('default', 'default')).toBeNull()
    })

    test('re-enforces the desired mode when a manifest re-reports the SDK spawn default (the bug)', () => {
        // A mid-session query() re-init re-reports "default"; the user wants Bypass → re-push Bypass.
        expect(reconcilePermissionMode('bypassPermissions', 'default')).toEqual(
            { enforce: 'bypassPermissions' },
        )
        // Same for an explicit acceptEdits choice.
        expect(reconcilePermissionMode('acceptEdits', 'default')).toEqual({
            enforce: 'acceptEdits',
        })
    })

    test('adopts a genuine plan-mode EXIT (Claude leaving plan via ExitPlanMode)', () => {
        expect(reconcilePermissionMode('plan', 'default')).toEqual({
            adopt: 'default',
        })
        expect(reconcilePermissionMode('plan', 'acceptEdits')).toEqual({
            adopt: 'acceptEdits',
        })
    })

    test('re-enforces plan if a manifest tries to knock the user OUT of a plan they chose to keep', () => {
        // desired stays "plan" only when reported === "plan" → no-op; any non-plan report while desired
        // is plan is treated as an exit (adopt). But desired NON-plan never gets pulled INTO plan.
        expect(reconcilePermissionMode('bypassPermissions', 'plan')).toEqual({
            enforce: 'bypassPermissions',
        })
        expect(reconcilePermissionMode('default', 'plan')).toEqual({
            enforce: 'default',
        })
    })
})

// The header picker's options. These used to be a parallel literal array in ChatView.tsx — the same
// four values written a second time, out of reach of this file's tests and free to drift from the
// protocol tuple above.
describe('PERMISSION_MODE_OPTIONS (the header picker)', () => {
    test('offers exactly the protocol modes, in protocol order', () => {
        expect(PERMISSION_MODE_OPTIONS.map(o => o.value)).toEqual([
            ...PERMISSION_MODES,
        ])
    })

    test('every mode carries a non-empty label, and none repeat', () => {
        const labels = PERMISSION_MODE_OPTIONS.map(o => o.label)
        for (const l of labels) expect(l.length).toBeGreaterThan(0)
        expect(new Set(labels).size).toBe(labels.length)
    })

    test('the app default is one of the options the picker can show', () => {
        // Not decoration: the header seeds its Select to DEFAULT_PERMISSION_MODE, so a default that
        // is not in the list renders the control DESELECTED, with no indication of the mode the
        // session is actually running in — which for Bypass is the whole hazard the armed tint
        // exists to answer.
        expect(
            PERMISSION_MODE_OPTIONS.some(
                o => o.value === DEFAULT_PERMISSION_MODE,
            ),
        ).toBe(true)
    })
})
