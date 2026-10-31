import { tempDir } from './helpers'
import { test, expect, describe } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    enabledLine,
    migrateDreamSwitch,
    pendingEnabled,
    stripEnabled,
    takePendingEnabled,
    withEnabled,
    PENDING_ENABLED_FILE,
} from '../src/seededCronSwitch'
import { setCronEnabled } from '../src/daemon'
import { reconcileSettings } from '../src/settings'
import { writeNote } from '../src/files'

const STOCK = '---\nname: dream\nschedule: 0 * * * *\neffort: high\n---\n\nenabled: in the body is not the switch\n'

describe('the enabled line', () => {
    test('withEnabled adds the line last in the frontmatter and stripEnabled removes exactly it', () => {
        const on = withEnabled(STOCK, true)
        expect(on).toBe(
            '---\nname: dream\nschedule: 0 * * * *\neffort: high\nenabled: true\n---\n\nenabled: in the body is not the switch\n',
        )
        expect(stripEnabled(on)).toBe(STOCK)
        expect(enabledLine(on)).toBe(true)
        expect(enabledLine(STOCK)).toBeUndefined()
    })
    test('withEnabled replaces an existing line in place', () => {
        const off = withEnabled(withEnabled(STOCK, true), false)
        expect(off).toBe(withEnabled(STOCK, false))
        expect(enabledLine(off)).toBe(false)
    })
    test('a file with no frontmatter gets one', () => {
        expect(withEnabled('body\n', false)).toBe('---\nenabled: false\n---\nbody\n')
    })
})

describe('setCronEnabled on a seeded cron with no file yet', () => {
    test('saves the choice for the daemon instead of failing', async () => {
        const home = join(await tempDir('bismuth-switch-'), '.daemon')
        setCronEnabled('dream', true, home)
        expect(existsSync(join(home, 'crons', 'dream.md'))).toBe(false)
        expect(pendingEnabled(home, 'dream')).toBe(true)
        setCronEnabled('dream', false, home)
        expect(takePendingEnabled(home, 'dream')).toBe(false)
        expect(pendingEnabled(home, 'dream')).toBeUndefined()
    })
    test('a cron that is not seeded still 404s', async () => {
        const home = join(await tempDir('bismuth-switch-'), '.daemon')
        expect(() => setCronEnabled('nightly', true, home)).toThrow('not found')
    })
    test('a flip on an existing dream.md edits only the enabled line', async () => {
        const home = join(await tempDir('bismuth-switch-'), '.daemon')
        mkdirSync(join(home, 'crons'), { recursive: true })
        writeFileSync(join(home, 'crons', 'dream.md'), withEnabled(STOCK, false))
        setCronEnabled('dream', true, home)
        expect(readFileSync(join(home, 'crons', 'dream.md'), 'utf8')).toBe(withEnabled(STOCK, true))
        expect(existsSync(join(home, 'crons', PENDING_ENABLED_FILE))).toBe(false)
    })
})

describe('migrateDreamSwitch', () => {
    test('a dream.md with no line takes the old setting; one with a line is left alone', async () => {
        const home = join(await tempDir('bismuth-switch-'), '.daemon')
        mkdirSync(join(home, 'crons'), { recursive: true })
        const file = join(home, 'crons', 'dream.md')
        writeFileSync(file, STOCK)
        expect(migrateDreamSwitch(home, true)).toBe(true)
        expect(readFileSync(file, 'utf8')).toBe(withEnabled(STOCK, true))
        expect(migrateDreamSwitch(home, false)).toBe(false)
        expect(readFileSync(file, 'utf8')).toBe(withEnabled(STOCK, true))
    })
    test('no dream.md: a true setting is saved for the daemon, a false one writes nothing', async () => {
        const home = join(await tempDir('bismuth-switch-'), '.daemon')
        expect(migrateDreamSwitch(home, false)).toBe(false)
        expect(existsSync(home)).toBe(false)
        expect(migrateDreamSwitch(home, true)).toBe(true)
        expect(pendingEnabled(home, 'dream')).toBe(true)
    })
})

describe('reconcileSettings and daemon.dream', () => {
    test('carries daemon.dream into dream.md before pruning it from .settings', async () => {
        const vault = await tempDir('bismuth-switch-')
        mkdirSync(join(vault, '.daemon', 'crons'), { recursive: true })
        const file = join(vault, '.daemon', 'crons', 'dream.md')
        writeFileSync(file, STOCK)
        await writeNote(vault, '.settings', 'daemon:\n  enabled: true\n  dream: true\n')
        await reconcileSettings(vault)
        expect(readFileSync(file, 'utf8')).toBe(withEnabled(STOCK, true))
        const raw = readFileSync(join(vault, '.settings'), 'utf8')
        expect(raw).not.toContain('dream')
        expect(raw).toContain('enabled: true')
    })
    test('a vault that never set daemon.dream gets dream switched off', async () => {
        const vault = await tempDir('bismuth-switch-')
        mkdirSync(join(vault, '.daemon', 'crons'), { recursive: true })
        const file = join(vault, '.daemon', 'crons', 'dream.md')
        writeFileSync(file, STOCK)
        await writeNote(vault, '.settings', 'daemon:\n  enabled: true\n')
        await reconcileSettings(vault)
        expect(readFileSync(file, 'utf8')).toBe(withEnabled(STOCK, false))
    })
})
