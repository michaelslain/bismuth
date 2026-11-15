import { describe, test, expect } from 'bun:test'
import { hermesMissingMcp, shebangPython } from '../../src/agentBackends/doctor'
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

describe('hermes MCP extra', () => {
    test('a hermes whose python cannot import mcp is a warn naming the fix', () => {
        const f = backendFindings([
            rep({ id: 'hermes', label: 'Hermes Agent', missingMcpExtra: true }),
        ])
        expect(f).toHaveLength(1)
        expect(f[0].id).toBe('backends.hermes-mcp')
        expect(f[0].title).toContain(
            "hermes is missing its MCP extra, so Bismuth's tool is skipped in hermes chats",
        )
        expect(f[0].title).toContain(
            "fix: uv tool install --reinstall 'hermes-agent[acp,mcp]'",
        )
        expect(f[0].repair).toBeUndefined()
    })
    test('hermes with the extra yields nothing', () => {
        expect(backendFindings([rep({ id: 'hermes' })])).toEqual([])
    })

    const deps = (over: object = {}) => {
        const calls: string[] = []
        return {
            calls,
            d: {
                readFirstLine: () => '#!/u/tools/hermes-agent/bin/python',
                uvToolDir: async () => null,
                exists: () => true,
                importMcp: async (py: string) => {
                    calls.push(py)
                    return false
                },
                ...over,
            },
        }
    }
    test('runs import mcp with the shebang python and reports a failure', async () => {
        const { calls, d } = deps()
        expect(await hermesMissingMcp('/bin/hermes', d)).toBe(true)
        expect(calls).toEqual(['/u/tools/hermes-agent/bin/python'])
    })
    test('a passing import is silent', async () => {
        const { d } = deps({ importMcp: async () => true })
        expect(await hermesMissingMcp('/bin/hermes', d)).toBe(false)
    })
    test('falls back to uv tool dir when the shebang names no python', async () => {
        const { calls, d } = deps({
            readFirstLine: () => '#!/usr/bin/env python3',
            uvToolDir: async () => '/u/tools',
        })
        expect(await hermesMissingMcp('/bin/hermes', d)).toBe(true)
        expect(calls).toEqual(['/u/tools/hermes-agent/bin/python'])
    })
    test('no python found is silent, never a finding', async () => {
        const { calls, d } = deps({ exists: () => false })
        expect(await hermesMissingMcp('/bin/hermes', d)).toBe(false)
        expect(calls).toEqual([])
    })
    test('shebangPython ignores env shebangs', () => {
        expect(shebangPython('#!/usr/bin/env python3')).toBeNull()
        expect(shebangPython('#!/a/b/python')).toBe('/a/b/python')
    })
})
