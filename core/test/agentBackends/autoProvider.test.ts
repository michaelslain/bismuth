import { describe, expect, test } from 'bun:test'
import {
    AUTO_ORDER,
    AUTO_PROVIDER,
    BACKENDS,
    resolveAutoProvider,
    resolveBackendId,
} from '../../src/agentBackends/catalog'
import { getFreeAgentStatus, installedBackendIds } from '../../src/freeAgent'
import { DEFAULTS } from '../../src/schema/settingsSchema'

describe('chat.provider: auto', () => {
    test('is the schema default', () => {
        expect((DEFAULTS as { chat: { provider: string } }).chat.provider).toBe(
            AUTO_PROVIDER,
        )
    })

    test('AUTO_ORDER is every picker-visible backend, claude first', () => {
        expect(AUTO_ORDER[0]).toBe('claude')
        expect(AUTO_ORDER).not.toContain('claude-code-acp')
        expect(AUTO_ORDER).not.toContain('codex-acp')
        for (const id of AUTO_ORDER) expect(BACKENDS[id].hidden).toBeFalsy()
    })

    test('picks the first installed backend in AUTO_ORDER', () => {
        expect(resolveAutoProvider(['gemini', 'codex'])).toBe('codex')
        expect(resolveAutoProvider(['opencode', 'claude'])).toBe('claude')
        expect(resolveAutoProvider([])).toBeNull()
    })

    test('resolveBackendId resolves an auto fallback against what is installed', () => {
        expect(resolveBackendId(undefined, 'auto', ['codex'])).toBe('codex')
        expect(resolveBackendId(undefined, 'auto', () => ['opencode'])).toBe(
            'opencode',
        )
        // nothing installed bottoms out at the default, which then surfaces its own setup screen
        expect(resolveBackendId(undefined, 'auto', [])).toBe('claude')
    })

    test('an explicit request or explicit setting is never swapped', () => {
        expect(resolveBackendId('gemini', 'auto', ['codex'])).toBe('gemini')
        expect(resolveBackendId(undefined, 'claude', ['codex'])).toBe('claude')
    })

    test('the installed probe only runs when auto is reached', () => {
        let probed = 0
        const probe = () => {
            probed++
            return ['codex']
        }
        resolveBackendId('claude', 'auto', probe)
        resolveBackendId(undefined, 'codex', probe)
        expect(probed).toBe(0)
        resolveBackendId(undefined, 'auto', probe)
        expect(probed).toBe(1)
    })
})

describe('installed backends', () => {
    const which = (have: string[]) => (name: string) =>
        have.includes(name) ? `/usr/local/bin/${name}` : null

    test('installedBackendIds keeps AUTO_ORDER and matches on each backend binary', () => {
        expect(installedBackendIds(which(['gemini', 'codex']))).toEqual([
            'codex',
            'gemini',
        ])
    })

    test('the free-agent status lists every auto backend with its install state', () => {
        const status = getFreeAgentStatus({ which: which(['opencode']) })
        expect(status.backends.map(b => b.id)).toEqual([...AUTO_ORDER])
        expect(status.backends.find(b => b.id === 'opencode')).toEqual({
            id: 'opencode',
            label: BACKENDS.opencode.label,
            installed: true,
        })
        expect(status.backends.filter(b => b.installed)).toHaveLength(1)
    })
})
