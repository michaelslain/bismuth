import { test, expect, mock } from 'bun:test'

mock.module('../api', () => ({
    ownerTokenHeaders: () => ({ 'X-Bismuth-Token': 't' }),
}))

const { keepaliveSaveInit } = await import('./keepaliveSave')

test('the unload save carries the owner token and keepalive', () => {
    const init = keepaliveSaveInit('a.md', 'text')
    expect(init.keepalive).toBe(true)
    expect((init.headers as Record<string, string>)['X-Bismuth-Token']).toBe('t')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'a.md', contents: 'text' })
})
