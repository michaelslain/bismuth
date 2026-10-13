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
    test('a diverged clone asks first; the action re-runs with reset and reports the backup branch', async () => {
        const phases: string[] = []
        let calls = 0
        showUpdateFailureWith(DIVERGED, {
            reapply: async onPhase => {
                calls++
                onPhase('building', {
                    phase: 'building',
                    backupBranch: 'backup/pre-update-20261013T184405Z',
                })
                phases.push(toasts().at(-1)!.message)
                return { result: 'relaunching' }
            },
        })
        expect(calls).toBe(0)
        const ask = toasts()[0]
        expect(ask.message).toBe(`Update failed: ${DIVERGED.message}`)
        expect(ask.action?.label).toBe('reset')
        ask.action!.onClick()
        await new Promise(r => setTimeout(r, 0))
        expect(calls).toBe(1)
        expect(phases).toEqual([
            'Building update… (a few min) (old commits on backup/pre-update-20261013T184405Z)',
        ])
    })
    test('a reset that fails again shows the failure in place of the progress toast', async () => {
        showUpdateFailureWith(DIVERGED, {
            reapply: async () => ({ result: 'error', message: 'git reset failed' }),
        })
        toasts()[0].action!.onClick()
        await new Promise(r => setTimeout(r, 0))
        expect(toasts().map(t => t.message)).toEqual([
            `Update failed: ${DIVERGED.message}`,
            'Update failed: git reset failed',
        ])
    })
})

test('updatePhaseText names each phase', () => {
    expect(updatePhaseText('pulling')).toBe('Pulling update…')
    expect(updatePhaseText('building')).toBe('Building update… (a few min)')
    expect(updatePhaseText('ready')).toBe('Relaunching…')
    expect(updatePhaseText('')).toBe('Updating…')
})
