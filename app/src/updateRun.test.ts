import { afterEach, expect, test } from 'bun:test'
import type { UpdateProgress } from '../../core/src/selfUpdate'
import { dismissToast, toasts } from './ui/toastStore'
import type { UpdateOutcome } from './updateFailure'
import { createUpdateRun, type UpdateRunDeps } from './updateRun'

afterEach(() => {
    for (const t of toasts()) dismissToast(t.id)
})

/** A scripted backend: `progress` answers from `phases` in order (the last one repeats), and every
 *  poll wait is a microtask, so a test steps the run with `tick()`. */
function harness(phases: UpdateProgress[], over: Partial<UpdateRunDeps> = {}) {
    const calls: string[] = []
    const failures: UpdateOutcome[] = []
    let i = 0
    const deps: UpdateRunDeps = {
        apply: async opts => {
            calls.push(opts.reset ? 'apply reset' : 'apply')
            return { phase: 'pulling' }
        },
        progress: async () => phases[Math.min(i++, phases.length - 1)],
        cancel: async () => {
            calls.push('cancel')
            return { phase: 'cancelled', message: 'update cancelled' }
        },
        quit: async () => {
            calls.push('quit')
        },
        recheck: () => calls.push('recheck'),
        showFailure: r => failures.push(r),
        wait: () => new Promise(r => setTimeout(r, 0)),
        ...over,
    }
    return { u: createUpdateRun(deps), calls, failures }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const messages = () => toasts().map(t => [t.message, t.action?.label])

test('a run reports each phase in the one progress toast, then relaunches', async () => {
    const { u, calls } = harness([{ phase: 'building' }, { phase: 'ready' }])
    const done = u.start()
    expect(u.run()?.phase).toBe('pulling')
    expect(messages()).toEqual([['Pulling update…', 'cancel']])
    await tick()
    await tick()
    expect(u.run()?.phase).toBe('building')
    expect(messages()).toEqual([['Building update… (a few min)', 'cancel']])
    expect(await done).toEqual({ result: 'relaunching' })
    expect(calls).toEqual(['apply', 'quit'])
    expect(messages()).toEqual([['Relaunching…', undefined]])
    expect(u.run()).toBeNull()
})

test('a second start joins the run in flight instead of starting another', async () => {
    const { u, calls } = harness([{ phase: 'building' }, { phase: 'ready' }])
    const a = u.start({ quiet: true })
    const b = u.start()
    expect(b).toBe(a)
    await a
    expect(calls.filter(c => c.startsWith('apply'))).toEqual(['apply'])
    expect(toasts().length).toBe(1)
})

test('cancel swaps the toast to cancelling, then ends cancelled with its own toast', async () => {
    const { u, calls } = harness([{ phase: 'building' }, { phase: 'cancelled' }])
    const done = u.start()
    await tick()
    void u.cancel()
    expect(u.run()?.cancelling).toBe(true)
    expect(messages()).toEqual([['Cancelling update…', undefined]])
    expect(await done).toEqual({ result: 'cancelled' })
    expect(calls).toEqual(['apply', 'cancel', 'recheck'])
    expect(messages()).toEqual([['Update cancelled', undefined]])
    expect(u.run()).toBeNull()
})

test('the toast cancel action cancels the shared run', async () => {
    const { u, calls } = harness([{ phase: 'building' }, { phase: 'cancelled' }])
    const done = u.start()
    toasts()[0].action!.onClick()
    expect(await done).toEqual({ result: 'cancelled' })
    expect(calls).toContain('cancel')
})

test('cancel with no run, or once ready, does nothing', async () => {
    const { u, calls } = harness([{ phase: 'ready' }], {
        quit: () => new Promise(() => {}),
    })
    await u.cancel()
    void u.start()
    await tick()
    await tick()
    expect(u.run()?.phase).toBe('ready')
    await u.cancel()
    expect(calls).not.toContain('cancel')
})

test('a failure is shown once, and a quiet (auto-update) failure only when the clone diverged', async () => {
    const loud = harness([{ phase: 'error', message: 'build failed' }])
    expect(await loud.u.start()).toEqual({ result: 'error', message: 'build failed' })
    expect(loud.failures).toEqual([{ result: 'error', message: 'build failed' }])
    expect(toasts()).toEqual([])

    const quiet = harness([{ phase: 'error', message: 'build failed' }])
    await quiet.u.start({ quiet: true })
    expect(quiet.failures).toEqual([])

    const diverged = harness([
        { phase: 'error', message: 'diverged', diverged: { ahead: 1, behind: 2 } },
    ])
    await diverged.u.start({ quiet: true })
    expect(diverged.failures).toEqual([
        { result: 'error', message: 'diverged', diverged: true },
    ])
})

test('joining a quiet run with a loud start makes its outcome loud', async () => {
    const { u, failures } = harness([{ phase: 'building' }, { phase: 'error', message: 'x' }])
    const a = u.start({ quiet: true })
    void u.start()
    await a
    expect(failures.length).toBe(1)
})

test('nothing to pull says up to date, unless quiet', async () => {
    const loud = harness([{ phase: 'idle' }])
    expect(await loud.u.start()).toEqual({ result: 'up-to-date' })
    expect(messages()).toEqual([['Bismuth is already up to date', undefined]])
    dismissToast(toasts()[0].id)
    const quiet = harness([{ phase: 'idle' }])
    await quiet.u.start({ quiet: true })
    expect(toasts()).toEqual([])
})

test('the caller’s toast becomes the progress toast', async () => {
    const { pushToast } = await import('./ui/toastStore')
    const id = pushToast('Checking for a Bismuth update…', { ttl: 0 })
    const { u } = harness([{ phase: 'building' }, { phase: 'ready' }])
    const done = u.start({ toastId: id })
    expect(messages()).toEqual([['Pulling update…', 'cancel']])
    await done
})

test('a dismissed progress toast stays away until showToast brings it back', async () => {
    const { u } = harness([{ phase: 'building' }])
    void u.start()
    dismissToast(toasts()[0].id)
    await tick()
    await tick()
    expect(toasts()).toEqual([])
    u.showToast()
    expect(messages()).toEqual([['Building update… (a few min)', 'cancel']])
})

test('adopt follows a run another caller started, and ignores an idle backend', async () => {
    const { u, calls } = harness([{ phase: 'ready' }])
    u.adopt({ phase: 'idle' })
    expect(u.run()).toBeNull()
    u.adopt({ phase: 'building' })
    expect(u.run()?.phase).toBe('building')
    expect(messages()).toEqual([['Building update… (a few min)', 'cancel']])
    await tick()
    await tick()
    expect(calls).toEqual(['quit'])
})

test('a cancel the backend refuses puts the cancel back', async () => {
    const { u } = harness([{ phase: 'building' }], {
        cancel: async () => {
            throw new Error('offline')
        },
    })
    void u.start()
    await tick()
    await tick()
    await u.cancel()
    expect(u.run()?.cancelling).toBe(false)
    expect(messages()).toEqual([
        ["Couldn't cancel the update: offline", undefined],
        ['Building update… (a few min)', 'cancel'],
    ])
})
