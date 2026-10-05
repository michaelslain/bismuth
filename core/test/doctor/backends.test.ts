import { describe, test, expect } from 'bun:test'
import { backendFindings } from '../../src/doctor/sections/backends'
import type { BackendReport } from '../../src/agentBackends/doctor'

const surfaces: BackendReport['surfaces'] = {
    chat: true,
    terminal: true,
    relayReporting: 'none',
    daemon: false,
    mcp: 'none',
    memory: 'mcpOnly',
    localModel: false,
}

const rep = (over: Partial<BackendReport>): BackendReport => ({
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    path: '/bin/codex',
    installed: true,
    version: '1.0.0',
    surfaces,
    ...over,
})

describe('backendFindings', () => {
    test('installed but failing the probe is a warn with the problem', () => {
        const f = backendFindings([
            rep({ problem: 'no response within 5000ms', version: null }),
        ])
        expect(f).toEqual([
            {
                id: 'backends.codex',
                severity: 'warn',
                title: 'Codex installed but not answering',
                detail: 'no response within 5000ms',
            },
        ])
    })
    test('claude missing is a warn carrying the install hint', () => {
        const f = backendFindings([
            rep({
                id: 'claude',
                label: 'Claude',
                installed: false,
                path: null,
                installHint: 'npm i -g claude',
            }),
        ])
        expect(f).toEqual([
            {
                id: 'backends.claude',
                severity: 'warn',
                title: 'claude not found on PATH',
                detail: 'npm i -g claude',
            },
        ])
    })
    test('healthy backends, missing non-claude backends and adapters yield nothing', () => {
        expect(
            backendFindings([
                rep({}),
                rep({ id: 'gemini', installed: false, path: null }),
                rep({
                    id: 'x-acp',
                    adapterPackage: '@x/acp',
                    problem: 'whatever',
                }),
            ]),
        ).toEqual([])
    })
})
