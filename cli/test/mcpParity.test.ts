import { describe, test, expect } from 'bun:test'
import { ALL_TOOL_NAMES } from '../../mcp/src/server'
import { CLI_TWINS } from '../../mcp/src/cliTwins'
import { daemonCliArgs } from '../../mcp/src/daemon'
import { resolveCommand } from '../src/registry'

// MCP <=> CLI parity. Every MCP tool has a CLI twin (CLI_TWINS), and every CLI command is reachable
// from MCP through bismuth_cli. A tool added without a twin fails here, not in a user's session.
describe('mcp <=> cli parity', () => {
    test('every mcp tool declares its cli twin', () => {
        for (const name of ALL_TOOL_NAMES) expect(Object.hasOwn(CLI_TWINS, name)).toBe(true)
    })
    test('every twin names a real mcp tool', () => {
        for (const tool of Object.keys(CLI_TWINS)) expect(ALL_TOOL_NAMES).toContain(tool)
    })
    test('every twin resolves to a real cli command', () => {
        for (const [tool, phrase] of Object.entries(CLI_TWINS)) {
            if (phrase === null) continue
            expect({ tool, resolved: resolveCommand(phrase.split(' ')) }).toEqual({ tool, resolved: phrase })
        }
    })
    test('only the cli bridge itself has no twin', () => {
        const nulls = Object.entries(CLI_TWINS).filter(([, p]) => p === null).map(([t]) => t).sort()
        expect(nulls).toEqual(['bismuth_cli', 'bismuth_cli_help'])
    })
    test('bismuth_cli makes every cli command reachable from mcp', () => {
        expect(ALL_TOOL_NAMES).toContain('bismuth_cli')
    })
    test('a daemon tool twin is the command its daemonCliArgs mapper really runs', () => {
        const args = { name: 'n', slug: 's', path: 'p', action: 'a' }
        for (const [tool, phrase] of Object.entries(CLI_TWINS)) {
            if (phrase === null) continue
            let argv: string[]
            try {
                argv = daemonCliArgs(tool, args, '/v')
            } catch {
                continue // not a daemon tool
            }
            expect({ tool, head: argv.slice(0, phrase.split(' ').length).join(' ') }).toEqual({ tool, head: phrase })
        }
    })
})
