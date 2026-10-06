import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bismuthHome } from './bismuthHome'

test('bismuthHome joins parts under ~/.bismuth', () => {
    expect(bismuthHome()).toBe(join(homedir(), '.bismuth'))
    expect(bismuthHome('bin', 'bismuth-mcp')).toBe(join(homedir(), '.bismuth', 'bin', 'bismuth-mcp'))
})
