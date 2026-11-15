import { test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../helpers'
import { backendMockEnv } from './backendEnv'

const server = { name: 'bismuth', command: '/x', args: [], env: [] }
const file = (dir: string) => join(dir, 'data', 'settings', 'cline_mcp_settings.json')

test('cline mock env registers the given mcp server in its settings file', () => {
    const dir = tempDir('bmenv-')
    backendMockEnv('cline', 'http://127.0.0.1:1', dir, undefined, { mcp: server })
    expect(readFileSync(file(dir), 'utf8')).toContain('bismuth')
})

test('cline mock env with mcp null writes no settings file', () => {
    const dir = tempDir('bmenv-')
    backendMockEnv('cline', 'http://127.0.0.1:1', dir, undefined, { mcp: null })
    expect(existsSync(file(dir))).toBe(false)
})
