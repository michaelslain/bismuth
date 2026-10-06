import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bismuthHome } from '../src/lib/bismuthPaths'

test('bismuthHome joins parts under ~/.bismuth', () => {
    expect(bismuthHome('bin')).toBe(join(homedir(), '.bismuth', 'bin'))
    expect(bismuthHome()).toBe(join(homedir(), '.bismuth'))
})
