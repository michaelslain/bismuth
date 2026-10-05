// The launchd / systemd user-service unit files Bismuth (and its predecessor, claude-bot) install.
// Path derivation + a never-throwing remove, with the process runner injected so tests can record
// the calls instead of touching a real service manager.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnWithTimeout } from './agentBackends/spawnWithTimeout'

export type ExecResult = { code: number; stdout: string; stderr: string }
export type Exec = (argv: string[], timeoutMs?: number) => Promise<ExecResult>
export interface ServiceUnit {
    launchdLabel: string
    systemdName: string
}

export const BISMUTH_DAEMON_UNIT: ServiceUnit = {
    launchdLabel: 'com.bismuth.daemon',
    systemdName: 'bismuth-daemon',
}
export const CLAUDE_BOT_UNIT: ServiceUnit = {
    launchdLabel: 'com.claude-bot.daemon',
    systemdName: 'claude-bot',
}

/** darwin: <home>/Library/LaunchAgents/<label>.plist; linux: <home>/.config/systemd/user/<name>.service; else null */
export function serviceUnitPath(
    platform: NodeJS.Platform,
    home: string,
    unit: ServiceUnit,
): string | null {
    if (platform === 'darwin')
        return join(
            home,
            'Library',
            'LaunchAgents',
            `${unit.launchdLabel}.plist`,
        )
    if (platform === 'linux')
        return join(
            home,
            '.config',
            'systemd',
            'user',
            `${unit.systemdName}.service`,
        )
    return null
}

/** Real process runner: 15s default, never throws (a spawn error → code -1, stderr = message). */
export const defaultExec: Exec = async (argv, timeoutMs = 15_000) => {
    const r = await spawnWithTimeout(argv, timeoutMs)
    if (r.error) return { code: -1, stdout: '', stderr: r.error }
    return {
        code: r.code ?? -1,
        stdout: r.stdout,
        stderr: r.timedOut ? `timed out after ${timeoutMs}ms` : r.stderr,
    }
}

/** Unload + delete the unit file. darwin: `launchctl unload <path>`; linux: `systemctl --user stop
 *  <name>.service`, `systemctl --user disable <name>.service`, rm, `systemctl --user daemon-reload`.
 *  No-op ([]) when the file is absent. Never throws; one warning per failed step. */
export async function removeServiceUnit(
    opts: { platform: NodeJS.Platform; home: string; exec: Exec },
    unit: ServiceUnit,
): Promise<string[]> {
    const path = serviceUnitPath(opts.platform, opts.home, unit)
    if (!path || !existsSync(path)) return []
    const warnings: string[] = []
    const run = async (argv: string[]) => {
        const r = await opts.exec(argv)
        if (r.code !== 0)
            warnings.push(
                `${argv.join(' ')} failed: ${r.stderr.trim() || `exit ${r.code}`}`,
            )
    }
    const rm = () => {
        try {
            rmSync(path, { force: true })
        } catch (e) {
            warnings.push(
                `failed to remove ${path}: ${e instanceof Error ? e.message : String(e)}`,
            )
        }
    }
    if (opts.platform === 'darwin') {
        await run(['launchctl', 'unload', path])
        rm()
    } else {
        const name = `${unit.systemdName}.service`
        await run(['systemctl', '--user', 'stop', name])
        await run(['systemctl', '--user', 'disable', name])
        rm()
        await run(['systemctl', '--user', 'daemon-reload'])
    }
    return warnings
}
