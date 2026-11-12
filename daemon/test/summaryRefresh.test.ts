import { describe, expect, test } from 'bun:test'
import { REFRESH_ARGS, refreshSummaries } from '../src/daemon/summaryRefresh'

describe('refreshSummaries', () => {
    test('runs the CLI build for the vault, gated by --if-built', async () => {
        const calls: string[][] = []
        const r = await refreshSummaries('/v', {
            cli: () => '/bin/bismuth',
            exec: async (file, args) => {
                calls.push([file, ...args])
                return { stdout: '{"summarised":2}\n' }
            },
        })
        expect(r).toBe('{"summarised":2}')
        expect(calls).toEqual([['/bin/bismuth', ...REFRESH_ARGS, '--vault', '/v']])
        expect(REFRESH_ARGS).toContain('--if-built')
    })

    test('no CLI installed: nothing runs', async () => {
        expect(await refreshSummaries('/v', { cli: () => undefined, exec: async () => ({ stdout: 'x' }) })).toBeNull()
    })

    test('one refresh per vault at a time', async () => {
        let release!: () => void
        const gate = new Promise<void>(r => (release = r))
        const exec = async () => {
            await gate
            return { stdout: 'done' }
        }
        const first = refreshSummaries('/w', { cli: () => '/bin/bismuth', exec })
        expect(await refreshSummaries('/w', { cli: () => '/bin/bismuth', exec })).toBeNull()
        release()
        expect(await first).toBe('done')
    })
})
