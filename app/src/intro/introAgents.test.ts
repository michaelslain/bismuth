import { describe, expect, it } from 'bun:test'
import { AUTO_ORDER, BACKENDS } from '../../../core/src/agentBackends/catalog'
import {
    binariesFor,
    defaultIntroAgent,
    idsForBinaries,
    introAgentOptions,
} from './introAgents'

describe('introAgentOptions', () => {
    it('is just the free agent when nothing is installed', () => {
        const o = introAgentOptions([])
        expect(o.map(x => x.id)).toEqual(['free-agent'])
        expect(o[0]).toEqual({
            id: 'free-agent',
            icon: 'Download',
            name: 'free agent',
            desc: 'Runs opencode on free models. No account, about 45 MB. Free models may keep your prompts.',
        })
        expect(defaultIntroAgent(o)).toBe('free-agent')
    })
    it('lists installed agents in AUTO_ORDER, then the free agent', () => {
        const o = introAgentOptions(['codex', 'claude'])
        expect(o.map(x => x.id)).toEqual(['claude', 'codex', 'free-agent'])
        expect(o[0]).toEqual({
            id: 'claude',
            icon: 'SquareTerminal',
            name: BACKENDS.claude.label.toLowerCase(),
            desc: 'Installed on this machine.',
        })
        expect(defaultIntroAgent(o)).toBe('claude')
    })
    it('drops ids that are not picker-visible backends', () => {
        expect(introAgentOptions(['nope']).map(x => x.id)).toEqual(['free-agent'])
    })
})

describe('binaries mapping', () => {
    it('maps ids to their binaries, picker-visible only, without duplicates', () => {
        expect(binariesFor(['claude', 'codex', 'nope'])).toEqual(['claude', 'codex'])
        const all = binariesFor(AUTO_ORDER)
        expect(new Set(all).size).toBe(all.length)
    })
    it('maps found binaries back to ids in AUTO_ORDER', () => {
        expect(idsForBinaries(['codex', 'claude', 'zzz'])).toEqual(['claude', 'codex'])
        expect(idsForBinaries([])).toEqual([])
    })
})
