import { describe, test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
    serviceUnitPath,
    removeServiceUnit,
    CLAUDE_BOT_UNIT,
    type Exec,
} from '../src/serviceUnit'
import { tempDir } from './tempDirs'

function rec(code = 0) {
    const calls: string[][] = []
    const exec: Exec = async argv => {
        calls.push(argv)
        return { code, stdout: '', stderr: code ? 'boom' : '' }
    }
    return { calls, exec }
}

describe('serviceUnitPath', () => {
    test('darwin / linux / other', () => {
        expect(serviceUnitPath('darwin', '/h', CLAUDE_BOT_UNIT)).toBe(
            '/h/Library/LaunchAgents/com.claude-bot.daemon.plist',
        )
        expect(serviceUnitPath('linux', '/h', CLAUDE_BOT_UNIT)).toBe(
            '/h/.config/systemd/user/claude-bot.service',
        )
        expect(serviceUnitPath('win32', '/h', CLAUDE_BOT_UNIT)).toBe(null)
    })
})

describe('removeServiceUnit', () => {
    test('darwin: unload then delete, idempotent', async () => {
        const home = tempDir('svc-')
        const p = serviceUnitPath('darwin', home, CLAUDE_BOT_UNIT)!
        mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true })
        writeFileSync(p, '<plist/>')
        const r = rec()
        expect(
            await removeServiceUnit(
                { platform: 'darwin', home, exec: r.exec },
                CLAUDE_BOT_UNIT,
            ),
        ).toEqual([])
        expect(r.calls[0]).toEqual(['launchctl', 'unload', p])
        expect(existsSync(p)).toBe(false)
        const r2 = rec()
        expect(
            await removeServiceUnit(
                { platform: 'darwin', home, exec: r2.exec },
                CLAUDE_BOT_UNIT,
            ),
        ).toEqual([])
        expect(r2.calls).toEqual([])
    })
    test('a failed unload still deletes the file and warns', async () => {
        const home = tempDir('svc-')
        const p = serviceUnitPath('darwin', home, CLAUDE_BOT_UNIT)!
        mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true })
        writeFileSync(p, '<plist/>')
        const warnings = await removeServiceUnit(
            { platform: 'darwin', home, exec: rec(1).exec },
            CLAUDE_BOT_UNIT,
        )
        expect(warnings.length).toBe(1)
        expect(existsSync(p)).toBe(false)
    })
    test('linux: stop, disable, rm, daemon-reload', async () => {
        const home = tempDir('svc-')
        const p = serviceUnitPath('linux', home, CLAUDE_BOT_UNIT)!
        mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
        writeFileSync(p, '[Unit]')
        const r = rec()
        await removeServiceUnit(
            { platform: 'linux', home, exec: r.exec },
            CLAUDE_BOT_UNIT,
        )
        expect(r.calls).toEqual([
            ['systemctl', '--user', 'stop', 'claude-bot.service'],
            ['systemctl', '--user', 'disable', 'claude-bot.service'],
            ['systemctl', '--user', 'daemon-reload'],
        ])
        expect(existsSync(p)).toBe(false)
    })
})
