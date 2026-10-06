import { expect, spyOn, test } from 'bun:test'
import { safeTick } from './safeTick.ts'

test('safeTick logs a failing tick instead of rejecting', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    await safeTick('cron', async () => {
        throw new Error('boom')
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]![0])).toContain('[cron] tick failed')
    spy.mockRestore()
})

test('safeTick lets the next tick run after a failure', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    let ran = 0
    await safeTick('cron', async () => {
        throw new Error('boom')
    })
    await safeTick('cron', async () => {
        ran++
    })
    expect(ran).toBe(1)
    spy.mockRestore()
})
