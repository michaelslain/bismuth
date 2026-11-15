import { describe, expect, test } from 'bun:test'
import { clineContextSettings } from '../../src/chatProviders/acp/clineSizing'

describe('clineContextSettings', () => {
    test('maps a window to cline contextWindow', () => {
        expect(clineContextSettings(8192)).toEqual({ contextWindow: 8192 })
    })
    test('no or unusable window adds nothing', () => {
        expect(clineContextSettings(null)).toEqual({})
        expect(clineContextSettings(0)).toEqual({})
        expect(clineContextSettings(NaN)).toEqual({})
    })
})
