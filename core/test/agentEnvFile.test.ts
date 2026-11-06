import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    agentEnvFileBody,
    agentEnvFilePath,
    agentShellEnv,
    ensureAgentEnvFile,
} from '../src/agentEnvFile'

/** Source `file` in a fresh sh with `env`, the way Claude Code does before a Bash command, and
 *  print the resulting PATH plus a marker the user's own env file may set. */
function sourceIn(file: string, env: Record<string, string>): { path: string; marker: string } {
    const r = Bun.spawnSync(['/bin/sh', '-c', `. '${file}'; printf '%s\\n%s' "$PATH" "$MARKER"`], {
        env,
    })
    const [path = '', marker = ''] = r.stdout.toString().split('\n')
    return { path, marker }
}

test('sourcing the env file puts the bismuth bin dir on PATH once, whatever PATH the shell started with', () => {
    const file = join(tempDir('bismuth-agent-env-'), 'agent-env.sh')
    writeFileSync(file, agentEnvFileBody('/opt/bismuth bin'))
    const { path } = sourceIn(file, { PATH: '/usr/bin:/bin' })
    expect(path).toBe('/opt/bismuth bin:/usr/bin:/bin')
    const again = sourceIn(file, { PATH: '/opt/bismuth bin:/usr/bin:/bin' })
    expect(again.path).toBe('/opt/bismuth bin:/usr/bin:/bin')
})

test("the user's own CLAUDE_ENV_FILE still runs, after Bismuth's PATH line", () => {
    const dir = tempDir('bismuth-agent-env-prev-')
    const file = join(dir, 'agent-env.sh')
    const prev = join(dir, 'mine.sh')
    writeFileSync(file, agentEnvFileBody('/b'))
    writeFileSync(prev, 'MARKER=mine\n')
    const { path, marker } = sourceIn(file, {
        PATH: '/usr/bin:/bin',
        BISMUTH_PREV_CLAUDE_ENV_FILE: prev,
    })
    expect(path.startsWith('/b:')).toBe(true)
    expect(marker).toBe('mine')
})

test('ensureAgentEnvFile writes the file once and rewrites it only when stale', () => {
    const file = join(tempDir('bismuth-agent-env-ensure-'), 'agent-env.sh')
    expect(ensureAgentEnvFile(file)).toBe(file)
    const body = readFileSync(file, 'utf8')
    expect(body).toBe(agentEnvFileBody())
    writeFileSync(file, 'stale\n')
    expect(ensureAgentEnvFile(file)).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe(body)
})

test('agentShellEnv names the env file, keeps a CLAUDE_ENV_FILE the user set, and aims at the vault', () => {
    const env = agentShellEnv({ CLAUDE_ENV_FILE: '/home/me/env.sh' }, '/vault')
    expect(env.CLAUDE_ENV_FILE).toBe(agentEnvFilePath())
    expect(env.BISMUTH_PREV_CLAUDE_ENV_FILE).toBe('/home/me/env.sh')
    expect(env.BISMUTH_VAULT).toBe('/vault')
    // Spawned from a session that already carries ours (a chat started inside a terminal tab): the
    // user's file is carried on, never replaced by ours.
    const nested = agentShellEnv({
        CLAUDE_ENV_FILE: agentEnvFilePath(),
        BISMUTH_PREV_CLAUDE_ENV_FILE: '/home/me/env.sh',
    })
    expect(nested.BISMUTH_PREV_CLAUDE_ENV_FILE).toBe('/home/me/env.sh')
    expect('BISMUTH_VAULT' in nested).toBe(false)
})
