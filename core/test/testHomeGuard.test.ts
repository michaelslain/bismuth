import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { bismuthHome } from '../src/bismuthHome'
import {
    daemonMachineDir,
    isEphemeralVaultRoot,
    registerVaultRoot,
} from '../src/daemon'
import { runRegistryDir } from '../src/runRegistry'
import { tmpFilesDir } from '../src/tmpFiles'
import { gcalDir } from '../src/gcal/manifest'
import { notifierPointerPath } from '../src/notifierPointer'
import { isTempPath } from '../src/tempPath'
import { bismuthHome as daemonBismuthHome } from '../../daemon/src/lib/bismuthPaths'
import { MACHINE_DIR, VAULTS_FILE } from '../../daemon/src/lib/config'
import { notifierPointerPath as daemonNotifierPointerPath } from '../../daemon/src/lib/platform'

// The guard for "a test run must never touch the user's real ~/.bismuth". The preload
// (core/test/setup.ts) points BISMUTH_HOME at a throwaway dir; these tests fail the moment that
// stops being true for any machine-wide path, or a throwaway vault can reach the REAL registry.

const REAL_HOME = join(homedir(), '.bismuth')
const REAL_VAULTS = join(REAL_HOME, 'daemon', 'vaults.json')

const inside = (p: string, root: string) =>
    p === root || p.startsWith(root + '/')
const realTmp = () => realpathSync(tmpdir())

/** The real registry's text, or '' — read only, this file never writes it. */
const realRegistry = () =>
    existsSync(REAL_VAULTS) ? readFileSync(REAL_VAULTS, 'utf8') : ''

const savedDaemonDir = process.env.BISMUTH_DAEMON_DIR
afterEach(() => {
    if (savedDaemonDir === undefined) delete process.env.BISMUTH_DAEMON_DIR
    else process.env.BISMUTH_DAEMON_DIR = savedDaemonDir
})

test('the preload points BISMUTH_HOME at a temp dir, never at the real ~/.bismuth', () => {
    const home = process.env.BISMUTH_HOME
    expect(home).toBeTruthy()
    expect(inside(home!, REAL_HOME)).toBe(false)
    expect(inside(home!, tmpdir()) || inside(home!, realTmp())).toBe(true)
})

test('every machine-wide path resolves inside the temp home, in core and in the daemon copy', () => {
    delete process.env.BISMUTH_DAEMON_DIR
    const paths = {
        bismuthHome: bismuthHome(),
        daemonBismuthHome: daemonBismuthHome(),
        daemonMachineDir: daemonMachineDir(),
        runRegistryDir: runRegistryDir(),
        tmpFilesDir: tmpFilesDir(),
        gcalDir: gcalDir(),
        notifierPointerPath: notifierPointerPath(),
        daemonNotifierPointerPath: daemonNotifierPointerPath(),
        MACHINE_DIR,
        VAULTS_FILE,
    }
    for (const [name, p] of Object.entries(paths)) {
        expect(
            inside(p, REAL_HOME),
            `${name} = ${p} is inside the real ~/.bismuth`,
        ).toBe(false)
    }
    expect(daemonMachineDir()).toBe(join(bismuthHome(), 'daemon'))
    expect(daemonBismuthHome('x')).toBe(bismuthHome('x'))
    expect(daemonNotifierPointerPath()).toBe(notifierPointerPath())
})

test('a realpath-spelled temp path is a temp path (macOS /var is a symlink to /private/var)', () => {
    const dir = realpathSync(tempDir('bismuth-vault-guard-'))
    expect(isTempPath(dir)).toBe(true)
    expect(isEphemeralVaultRoot(dir)).toBe(true)
    expect(isTempPath('/private/var/folders/ab/cd/T/bismuth-vault-XyZ')).toBe(
        true,
    )
    expect(isTempPath('/Users/someone/vault')).toBe(false)
})

test('registering a realpath temp vault with the default home lands in the temp home, not the real registry', () => {
    delete process.env.BISMUTH_DAEMON_DIR
    const vault = realpathSync(tempDir('bismuth-vault-guard-'))
    registerVaultRoot(vault)
    expect(realRegistry()).not.toContain(vault)
    expect(
        readFileSync(join(daemonMachineDir(), 'vaults.json'), 'utf8'),
    ).toContain(vault)
})

test('a Bun.spawn child with no env of its own sees the temp BISMUTH_HOME, not the real home', () => {
    const child = Bun.spawnSync([
        'sh',
        '-c',
        'printf %s "$BISMUTH_HOME|$BISMUTH_RUN_DIR"',
    ])
    expect(child.stdout.toString()).toBe(
        `${process.env.BISMUTH_HOME}|${process.env.BISMUTH_RUN_DIR}`,
    )
    // and an explicit env is the caller's to choose
    const own = Bun.spawnSync(
        ['sh', '-c', 'printf %s "${BISMUTH_HOME:-none}"'],
        {
            env: { PATH: process.env.PATH },
        },
    )
    expect(own.stdout.toString()).toBe('none')
})
