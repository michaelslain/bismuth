import { test, expect } from 'bun:test'
import { withBusy } from './withBusy'
import { toasts, dismissToast } from '../ui/toastStore'

function state() {
    let v = false
    return { get: () => v, set: (n: boolean) => (v = n) }
}

test('runs, then clears busy', async () => {
    const b = state()
    expect(await withBusy(b, 'x failed', async () => {})).toBe(true)
    expect(b.get()).toBe(false)
})

test('refuses a second call while busy', async () => {
    const b = state()
    let release = () => {}
    const first = withBusy(b, 'x', () => new Promise<void>(r => (release = r)))
    expect(await withBusy(b, 'x', async () => {})).toBe(false)
    release()
    expect(await first).toBe(true)
})

test('a throw toasts, clears busy and resolves false', async () => {
    const b = state()
    const ok = await withBusy(b, 'Save failed', async () => {
        throw new Error('disk full')
    })
    expect(ok).toBe(false)
    expect(b.get()).toBe(false)
    const t = toasts().find(x => x.message === 'Save failed: disk full')
    expect(t).toBeTruthy()
    toasts().forEach(x => dismissToast(x.id))
})
