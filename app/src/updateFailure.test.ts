import { afterEach, describe, expect, test } from 'bun:test'
import { dismissToast, toasts } from './ui/toastStore'
import {
    showUpdateFailureWith,
    updatePhaseText,
    type UpdateOutcome,
} from './updateFailure'

afterEach(() => {
    for (const t of toasts()) dismissToast(t.id)
})

const DIVERGED: UpdateOutcome = {
    result: 'error',
    message:
        'the Bismuth clone has 3 commits origin/main lacks — reset saves them on a backup branch and moves to origin/main',
    diverged: true,
}

describe('showUpdateFailureWith', () => {
    test('an ordinary failure is a plain toast and never re-runs the update', () => {
        let reapplied = false
        showUpdateFailureWith(
            { result: 'error', message: 'build failed' },
            {
                reapply: async () => {
                    reapplied = true
                    return { result: 'relaunching' }
                },
            },
        )
        expect(toasts().map(t => [t.message, t.action?.label, t.tone])).toEqual([
            ['Update failed: build failed', undefined, 'danger'],
        ])
        expect(reapplied).toBe(false)
    })
    test('a diverged clone asks first; the action re-runs the update (with reset)', () => {
        let calls = 0
        showUpdateFailureWith(DIVERGED, {
            reapply: async () => {
                calls++
                return { result: 'relaunching' }
            },
        })
        expect(calls).toBe(0)
        const ask = toasts()[0]
        expect(ask.message).toBe(`Update failed: ${DIVERGED.message}`)
        expect(ask.action?.label).toBe('reset')
        ask.action!.onClick()
        expect(calls).toBe(1)
    })
})

test('updatePhaseText names each phase', () => {
    expect(updatePhaseText('pulling')).toBe('Pulling update…')
    expect(updatePhaseText('building')).toBe('Building update… (a few min)')
    expect(updatePhaseText('ready')).toBe('Relaunching…')
    expect(updatePhaseText('cancelled')).toBe('Update cancelled')
    expect(
        updatePhaseText('building', {
            phase: 'building',
            backupBranch: 'backup/pre-update-20261013T184405Z',
        }),
    ).toBe(
        'Building update… (a few min) (old commits on backup/pre-update-20261013T184405Z)',
    )
    expect(updatePhaseText('')).toBe('Updating…')
})
