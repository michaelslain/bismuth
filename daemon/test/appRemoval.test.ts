import { test, expect } from 'bun:test'
import {
    existsSync,
    lstatSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    REMOVAL_MISSES,
    appRemovalWatcher,
    bundledExecPath,
    nextRemovalCheck,
    removeOwnService,
} from '../src/lib/appRemoval'

const IN_APP =
    '/Applications/Bismuth.app/Contents/Resources/resources/daemon/bin/bismuth-daemon'

test('bundledExecPath: only a macOS daemon inside an app bundle is watched', () => {
    expect(bundledExecPath(IN_APP, 'darwin')).toBe(IN_APP)
    expect(bundledExecPath('/Users/u/.bismuth/bin/bismuth-daemon', 'darwin')).toBeNull()
    expect(bundledExecPath(IN_APP, 'linux')).toBeNull()
    expect(appRemovalWatcher('/Users/u/.bismuth/bin/bismuth-daemon', 'darwin')).toBeNull()
})

test('nextRemovalCheck: a present path resets, consecutive misses reach removal', () => {
    expect(nextRemovalCheck(0, true)).toEqual({ misses: 0, remove: false })
    expect(nextRemovalCheck(0, false)).toEqual({ misses: 1, remove: false })
    expect(nextRemovalCheck(REMOVAL_MISSES - 1, false).remove).toBe(true)
    expect(nextRemovalCheck(1, true)).toEqual({ misses: 0, remove: false })
})

test('appRemovalWatcher: a self-update blip is ignored, a deleted app removes once', () => {
    const removed: string[] = []
    const seen = [true, false, true, false, false, false]
    let i = 0
    const tick = appRemovalWatcher(IN_APP, 'darwin', () => seen[i++] ?? false, p => removed.push(p))!
    const results = seen.map(() => tick())
    expect(results).toEqual([false, false, false, false, true, true])
    expect(removed).toEqual([IN_APP])
})

test('removeOwnService removes our link and the plist, keeps a foreign link, never touches the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-removal-'))
    try {
        const exec = join(dir, 'gone', 'bismuth-daemon')
        const bin = join(dir, 'bismuth-daemon')
        const plist = join(dir, 'com.bismuth.daemon.plist')
        const keep = join(dir, 'memory.md')
        writeFileSync(plist, '<plist/>')
        writeFileSync(keep, 'x')
        symlinkSync(exec, bin)
        let unloads = 0
        removeOwnService(exec, bin, plist, () => unloads++)
        expect(existsSync(plist)).toBe(false)
        expect(() => lstatSync(bin)).toThrow()
        expect(existsSync(keep)).toBe(true)
        expect(unloads).toBe(1)

        symlinkSync(join(dir, 'newer-install'), bin)
        removeOwnService(exec, bin, plist, () => unloads++)
        expect(lstatSync(bin).isSymbolicLink()).toBe(true) // a newer install's link stays
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
