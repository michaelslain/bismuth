import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeLookupPath, nvmBinPaths } from './claudeWhich.ts'

// Bun.which returns the FIRST hit, so the order of this list is behavior. Pinned to the literal
// list claudeLookupPath hardcoded before it was derived from childEnv's extraBinDirs().
test('claudeLookupPath keeps the original order and set (no ~/.bismuth/bin)', () => {
    const env = { PATH: '/usr/bin:/bin', NVM_DIR: '/nonexistent-nvm-dir' }
    expect(claudeLookupPath(env)).toBe(
        [
            '/usr/bin:/bin',
            '/opt/homebrew/bin',
            '/usr/local/bin',
            join(homedir(), '.bun', 'bin'),
            join(homedir(), '.local', 'bin'),
            ...nvmBinPaths(env),
        ].join(':'),
    )
    expect(claudeLookupPath(env)).not.toContain('.bismuth')
})

test('claudeLookupPath drops an unset PATH rather than emitting a leading colon', () => {
    expect(
        claudeLookupPath({ NVM_DIR: '/nonexistent-nvm-dir' }).startsWith(
            '/opt/homebrew/bin:/usr/local/bin:',
        ),
    ).toBe(true)
})
