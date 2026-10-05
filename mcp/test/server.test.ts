import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js'
import { handleCallTool, doctorCliArgs, server, ALL_TOOL_NAMES } from '../src/server'

// Reviewer's point: reverting just the one-line `bismuth_cli`/`bismuth_cli_help` wiring in
// server.ts (while leaving cliToolResult/cliHelp themselves intact) passed every test in
// cli.test.ts, because those only exercise the helpers directly — never the actual switch/case
// dispatch an agent's tool call goes through. These tests call the exported `handleCallTool`
// (the same function `server.setRequestHandler(CallToolRequestSchema, ...)` registers) with a
// fabricated MCP request, so a regression in the wiring itself — not just the helpers — fails.

const originalBismuthCli = process.env.BISMUTH_CLI

afterEach(() => {
    if (originalBismuthCli === undefined) delete process.env.BISMUTH_CLI
    else process.env.BISMUTH_CLI = originalBismuthCli
})

function callTool(name: string, args: Record<string, unknown> = {}) {
    const request: CallToolRequest = {
        method: 'tools/call',
        params: { name, arguments: args },
    }
    return handleCallTool(request)
}

test('dispatching bismuth_cli through the real handler flags a failing invocation as isError', async () => {
    const result = await callTool('bismuth_cli', {
        args: ['definitely-not-a-command'],
    })
    expect(result.isError).toBe(true)
}, 30_000)

test('dispatching bismuth_cli through the real handler leaves a clean help call unflagged', async () => {
    delete process.env.BISMUTH_CLI
    const result = await callTool('bismuth_cli', { args: ['--help'] })
    expect(result.isError).not.toBe(true)
}, 30_000)

test('dispatching bismuth_cli_help through the real handler flags an unreachable CLI as isError', async () => {
    process.env.BISMUTH_CLI = '/definitely/not/a/real/bismuth-binary-xyz'
    const result = await callTool('bismuth_cli_help', {})
    expect(result.isError).toBe(true)
}, 30_000)

test('dispatching bismuth_cli_help through the real handler leaves a normal lookup unflagged', async () => {
    delete process.env.BISMUTH_CLI
    const result = await callTool('bismuth_cli_help', {})
    expect(result.isError).not.toBe(true)
}, 30_000)

// --- bismuth_doctor + the always-on set --------------------------------------------------------

test('outside a daemon-enabled vault the server lists exactly the six always-on tools', async () => {
    const saved = { mem: process.env.BISMUTH_MEMORY_DIR, vault: process.env.BISMUTH_VAULT, cwd: process.cwd() }
    const empty = mkdtempSync(join(tmpdir(), 'mcp-tools-'))
    delete process.env.BISMUTH_MEMORY_DIR
    delete process.env.BISMUTH_VAULT
    process.chdir(empty)
    try {
        const handlers = (server as unknown as {
            _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: { name: string }[] }>>
        })._requestHandlers
        const { tools } = await handlers.get('tools/list')!({ method: 'tools/list' }, {})
        expect(tools.map(t => t.name)).toEqual([
            'bismuth_docs_list',
            'bismuth_docs_search',
            'bismuth_docs_read',
            'bismuth_doctor',
            'bismuth_cli',
            'bismuth_cli_help',
        ])
    } finally {
        process.chdir(saved.cwd)
        if (saved.mem !== undefined) process.env.BISMUTH_MEMORY_DIR = saved.mem
        if (saved.vault !== undefined) process.env.BISMUTH_VAULT = saved.vault
        rmSync(empty, { recursive: true, force: true })
    }
})

test('ALL_TOOL_NAMES covers the always-on, memory and daemon tools with no duplicates', () => {
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length)
    expect(ALL_TOOL_NAMES).toEqual(expect.arrayContaining(['bismuth_doctor', 'remember', 'recall', 'forget', 'daemon_status', 'page_resolve']))
    expect(ALL_TOOL_NAMES).toHaveLength(6 + 3 + 11)
})

test('doctorCliArgs: no input is a bare json report', () => {
    expect(doctorCliArgs({})).toEqual(['doctor', '--json'])
})

test('doctorCliArgs maps every input to its CLI flag', () => {
    expect(
        doctorCliArgs({ fix: true, safeOnly: true, only: ['a.b', 'c.d'], section: ['legacy'], vault: '/v' }),
    ).toEqual(['doctor', '--json', '--fix', '--safe-only', '--only', 'a.b,c.d', '--section', 'legacy', '--vault', '/v'])
})

test('doctorCliArgs ignores false/empty inputs', () => {
    expect(doctorCliArgs({ fix: false, safeOnly: false, only: [], section: [], vault: '' })).toEqual(['doctor', '--json'])
})

test('dispatching bismuth_doctor runs the CLI with the mapped argv', async () => {
    // A stand-in `bismuth` that echoes the argv it was given, so the test sees exactly what
    // handleCallTool -> runCli executed.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-doctor-'))
    const bin = join(dir, 'bismuth')
    writeFileSync(bin, '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n')
    chmodSync(bin, 0o755)
    process.env.BISMUTH_CLI = bin
    try {
        const result = await callTool('bismuth_doctor', { fix: true, only: ['a.b'] })
        expect(result.isError).toBe(false)
        const text = (result.content[0] as { text: string }).text
        expect(text.trim().split('\n')).toEqual(['doctor', '--json', '--fix', '--only', 'a.b'])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('the spawned CLI always sees a BISMUTH_MCP_CHANNEL, so doctor treats MCP calls as an agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-channel-'))
    const bin = join(dir, 'bismuth')
    writeFileSync(bin, '#!/bin/sh\necho "channel=$BISMUTH_MCP_CHANNEL"\n')
    chmodSync(bin, 0o755)
    process.env.BISMUTH_CLI = bin
    const saved = process.env.BISMUTH_MCP_CHANNEL
    try {
        delete process.env.BISMUTH_MCP_CHANNEL
        const unset = await callTool('bismuth_cli', { args: ['doctor', '--fix'] })
        expect((unset.content[0] as { text: string }).text.trim()).toBe('channel=daemon')
        process.env.BISMUTH_MCP_CHANNEL = 'chat'
        const chat = await callTool('bismuth_cli', { args: ['doctor', '--fix'] })
        expect((chat.content[0] as { text: string }).text.trim()).toBe('channel=chat')
    } finally {
        if (saved === undefined) delete process.env.BISMUTH_MCP_CHANNEL
        else process.env.BISMUTH_MCP_CHANNEL = saved
        rmSync(dir, { recursive: true, force: true })
    }
})

test('bismuth_doctor flags a failing doctor run as isError', async () => {
    process.env.BISMUTH_CLI = '/definitely/not/a/real/bismuth-binary-xyz'
    const result = await callTool('bismuth_doctor', {})
    expect(result.isError).toBe(true)
})
