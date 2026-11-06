import { test, expect, afterEach, afterAll } from 'bun:test'
import { tempDir, sweepTempDirs } from './tempDirs'
import { writeFileSync, chmodSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js'
import { handleCallTool, server, ALL_TOOL_NAMES } from '../src/server'
import { cliTimeoutMs, LONG_TIMEOUT_MS } from '../src/cli'

// Reviewer's point: reverting just the one-line `bismuth_cli` wiring in
// server.ts (while leaving cliToolResult itself intact) passed every test in
// cli.test.ts, because those only exercise the helpers directly — never the actual switch/case
// dispatch an agent's tool call goes through. These tests call the exported `handleCallTool`
// (the same function `server.setRequestHandler(CallToolRequestSchema, ...)` registers) with a
// fabricated MCP request, so a regression in the wiring itself — not just the helpers — fails.

const originalBismuthCli = process.env.BISMUTH_CLI

afterEach(() => {
    if (originalBismuthCli === undefined) delete process.env.BISMUTH_CLI
    else process.env.BISMUTH_CLI = originalBismuthCli
})

afterAll(sweepTempDirs)

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

test('outside a daemon-enabled vault the server lists only bismuth_cli', async () => {
    const saved = { mem: process.env.BISMUTH_MEMORY_DIR, vault: process.env.BISMUTH_VAULT, cwd: process.cwd() }
    const empty = tempDir('mcp-tools-')
    delete process.env.BISMUTH_MEMORY_DIR
    delete process.env.BISMUTH_VAULT
    process.chdir(empty)
    try {
        const handlers = (server as unknown as {
            _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: { name: string }[] }>>
        })._requestHandlers
        const { tools } = await handlers.get('tools/list')!({ method: 'tools/list' }, {})
        expect(tools.map(t => t.name)).toEqual(['bismuth_cli'])
    } finally {
        process.chdir(saved.cwd)
        if (saved.mem !== undefined) process.env.BISMUTH_MEMORY_DIR = saved.mem
        if (saved.vault !== undefined) process.env.BISMUTH_VAULT = saved.vault
    }
})

test('remember type description lists profile and hub', () => {
    const handlers = (server as unknown as {
        _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: { name: string; inputSchema: { properties: { type?: { description: string } } } }[] }>>
    })._requestHandlers
    const saved = process.env.BISMUTH_MEMORY_DIR
    process.env.BISMUTH_MEMORY_DIR = join(tempDir('mcp-rt-'), '.daemon', 'memory')
    return handlers.get('tools/list')!({ method: 'tools/list' }, {}).then(({ tools }) => {
        if (saved === undefined) delete process.env.BISMUTH_MEMORY_DIR
        else process.env.BISMUTH_MEMORY_DIR = saved
        const desc = tools.find(t => t.name === 'remember')!.inputSchema.properties.type!.description
        expect(desc).toBe('person | project | workflow | fact | preference | daily | auto | profile | hub')
    })
})

test('ALL_TOOL_NAMES is bismuth_cli plus the memory tools, with no duplicates', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual(['bismuth_cli', 'forget', 'recall', 'remember'])
})

test('bismuth_cli runs the CLI in the session working directory, so a flagless command reaches its vault', async () => {
    const dir = tempDir('mcp-cwd-')
    const bin = join(dir, 'bismuth')
    writeFileSync(bin, '#!/bin/sh\npwd -P\n')
    chmodSync(bin, 0o755)
    process.env.BISMUTH_CLI = bin
    const vault = tempDir('mcp-cwd-vault-')
    const origCwd = process.cwd()
    try {
        process.chdir(vault)
        const result = await callTool('bismuth_cli', { args: ['task', 'list'] })
        expect((result.content[0] as { text: string }).text.trim()).toBe(realpathSync(vault))
    } finally {
        process.chdir(origCwd)
    }
})

test('ocr and pdf get minutes through bismuth_cli, everything else two', () => {
    expect(cliTimeoutMs(['ocr', 'x.pdf'])).toBe(LONG_TIMEOUT_MS)
    expect(cliTimeoutMs(['pdf', 'md', 'x.pdf'])).toBe(LONG_TIMEOUT_MS)
    expect(LONG_TIMEOUT_MS).toBeGreaterThan(10 * 60_000)
    expect(cliTimeoutMs(['task', 'list'])).toBe(120_000)
    expect(cliTimeoutMs([])).toBe(120_000)
})

test('the spawned CLI always sees a BISMUTH_MCP_CHANNEL, so doctor treats MCP calls as an agent', async () => {
    const dir = tempDir('mcp-channel-')
    const bin = join(dir, 'bismuth')
    writeFileSync(bin, '#!/bin/sh\necho "channel=$BISMUTH_MCP_CHANNEL"\n')
    chmodSync(bin, 0o755)
    process.env.BISMUTH_CLI = bin
    const saved = process.env.BISMUTH_MCP_CHANNEL
    delete process.env.BISMUTH_MCP_CHANNEL
    const unset = await callTool('bismuth_cli', { args: ['doctor', '--fix'] })
    expect((unset.content[0] as { text: string }).text.trim()).toBe('channel=daemon')
    process.env.BISMUTH_MCP_CHANNEL = 'chat'
    const chat = await callTool('bismuth_cli', { args: ['doctor', '--fix'] })
    expect((chat.content[0] as { text: string }).text.trim()).toBe('channel=chat')
    if (saved === undefined) delete process.env.BISMUTH_MCP_CHANNEL
    else process.env.BISMUTH_MCP_CHANNEL = saved
})
