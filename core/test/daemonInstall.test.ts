// core/test/daemonInstall.test.ts
// The bundled-daemon installer is mostly thin spawn() wrappers over the daemon binary; here we
// cover the pure, side-effect-free branches (path resolution + the no-binary / no-bundle
// degradations) without a real binary or touching ~/.bismuth.
import { test, expect, afterEach } from 'bun:test'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
    lstatSync,
    readFileSync,
    readlinkSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import {
    daemonBinPath,
    daemonPlaced,
    installStatus,
    installDaemonFromBundle,
    linksDaemon,
    needsPlacement,
    placeDaemonBinary,
} from '../src/daemonInstall'
import { tempDir } from './helpers'

afterEach(() => {
    delete process.env.BISMUTH_DAEMON_BIN
    delete process.env.BISMUTH_DAEMON_BUNDLE
})

test('daemonBinPath honors BISMUTH_DAEMON_BIN, else ~/.bismuth/bin/bismuth-daemon', () => {
    delete process.env.BISMUTH_DAEMON_BIN
    expect(daemonBinPath()).toBe(
        join(homedir(), '.bismuth', 'bin', 'bismuth-daemon'),
    )
    process.env.BISMUTH_DAEMON_BIN = '/tmp/x/bismuth-daemon'
    expect(daemonBinPath()).toBe('/tmp/x/bismuth-daemon')
})

test('installStatus reports not-installed when the binary is absent (never throws)', async () => {
    process.env.BISMUTH_DAEMON_BIN = join('/tmp', 'no-such-daemon-binary-xyz')
    const s = await installStatus()
    expect(s.installed).toBe(false)
    expect(s.running).toBe(false)
})

test('installDaemonFromBundle is a no-op when BISMUTH_DAEMON_BUNDLE is unset (dev)', async () => {
    delete process.env.BISMUTH_DAEMON_BUNDLE
    await expect(installDaemonFromBundle()).resolves.toBeUndefined() // no throw, no work
})

test('linksDaemon: macOS links only from /Applications or ~/Applications; anywhere else and Linux copy', () => {
    const src = '/Applications/Bismuth.app/Contents/Resources/resources/daemon/bin/bismuth-daemon'
    expect(linksDaemon(src, 'darwin')).toBe(true)
    expect(linksDaemon(src, 'linux')).toBe(false)
    expect(
        linksDaemon(
            '/private/var/folders/x/T/AppTranslocation/ABC/d/Bismuth.app/Contents/Resources/resources/daemon/bin/bismuth-daemon',
            'darwin',
        ),
    ).toBe(false)
    expect(
        linksDaemon('/Volumes/Bismuth/Bismuth.app/Contents/Resources/resources/daemon/bin/bismuth-daemon', 'darwin'),
    ).toBe(false)
    const tail = 'Bismuth.app/Contents/Resources/resources/daemon/bin/bismuth-daemon'
    expect(linksDaemon(`/Users/u/Applications/${tail}`, 'darwin', '/Users/u')).toBe(true)
    expect(linksDaemon(`/Users/u/Applications-old/${tail}`, 'darwin', '/Users/u')).toBe(false)
    expect(
        linksDaemon(`/Users/u/dev/bismuth/app/src-tauri/target/release/bundle/macos/${tail}`, 'darwin', '/Users/u'),
    ).toBe(false)
    expect(linksDaemon(`/Users/u/Downloads/${tail}`, 'darwin', '/Users/u')).toBe(false)
})

test('needsPlacement: a new build or a wrong placement re-places; current and placed is left alone', () => {
    expect(needsPlacement('1:1', '1:1', true)).toBe(false)
    expect(needsPlacement('1:1', '2:2', true)).toBe(true)
    expect(needsPlacement('1:1', '1:1', false)).toBe(true) // copy → link, or the app moved
    expect(needsPlacement('', '1:1', false)).toBe(true) // first install
})

test('placeDaemonBinary never links the bundle binary to itself', () => {
    const dir = tempDir('daemon-self-')
    try {
        const src = join(dir, 'bismuth-daemon')
        writeFileSync(src, 'v1')
        placeDaemonBinary(src, src, true)
        expect(lstatSync(src).isSymbolicLink()).toBe(false)
        expect(readFileSync(src, 'utf8')).toBe('v1')
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('placeDaemonBinary links into the bundle, replaces an old copy, and daemonPlaced tracks it', () => {
    const dir = tempDir('daemon-place-')
    try {
        const src = join(dir, 'bundle-daemon')
        const moved = join(dir, 'moved-daemon')
        const bin = join(dir, 'bismuth-daemon')
        writeFileSync(src, 'v2')
        writeFileSync(moved, 'v2')
        writeFileSync(bin, 'old copy')
        expect(daemonPlaced(src, bin, true)).toBe(false) // a copy is not the link
        placeDaemonBinary(src, bin, true)
        expect(lstatSync(bin).isSymbolicLink()).toBe(true)
        expect(readlinkSync(bin)).toBe(src)
        expect(daemonPlaced(src, bin, true)).toBe(true)
        expect(daemonPlaced(moved, bin, true)).toBe(false) // bundle moved → re-link
        placeDaemonBinary(src, bin, false) // copy mode replaces the link with a real file
        expect(lstatSync(bin).isSymbolicLink()).toBe(false)
        expect(readFileSync(bin, 'utf8')).toBe('v2')
        expect(daemonPlaced(src, bin, false)).toBe(true)
        expect(lstatSync(bin).mode & 0o111).toBeTruthy()
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
