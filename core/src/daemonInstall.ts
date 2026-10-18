// core/src/daemonInstall.ts
// Installs the bundled @bismuth/daemon runtime as a launchd/systemd SERVICE so it keeps
// running while the Bismuth app is closed. Replaces the old claude-bot git-clone provisioning:
// the app stages the compiled daemon at resources/daemon (path in BISMUTH_DAEMON_BUNDLE); on
// boot, core places it at ~/.bismuth/bin and runs `<bin> --ensure-installed` (which writes the
// plist/unit pointing at that stable path). On macOS the placement is a symlink into the .app, not
// a copy: TCC attributes a process to the bundle its executable lives in, so a daemon run through
// the link asks for folder access as Bismuth and shares the app's grants, where a copy outside the
// bundle is its own "bismuth-daemon" client with its own prompts. A linked daemon also removes its
// own service when the app is deleted (daemon/src/lib/appRemoval.ts). Every function is best-effort and never throws —
// a failed daemon install must never block the app.
import { bismuthHome } from './bismuthHome'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
    mkdirSync,
    copyFileSync,
    chmodSync,
    existsSync,
    readFileSync,
    writeFileSync,
    statSync,
    renameSync,
    readlinkSync,
    symlinkSync,
    lstatSync,
    rmSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'

/** Stable installed path of the daemon binary (env override BISMUTH_DAEMON_BIN). */
export function daemonBinPath(): string {
    return (
        process.env.BISMUTH_DAEMON_BIN ||
        bismuthHome('bin', 'bismuth-daemon')
    )
}

/** The daemon's record of the binary it started from (daemon/src/lib/config.ts MACHINE_BIN_SIG_FILE). */
function daemonBinSigPath(): string {
    return join(
        process.env.BISMUTH_DAEMON_DIR || bismuthHome('daemon'),
        'daemon.bin-sig',
    )
}

export interface InstallStatus {
    installed: boolean
    running: boolean
    binPath: string
}

/** Query the installed daemon (`<bin> --status` → { installed, running }). Never throws. */
export async function installStatus(): Promise<InstallStatus> {
    const bin = daemonBinPath()
    if (!existsSync(bin))
        return { installed: false, running: false, binPath: bin }
    try {
        const r = spawnSync(bin, ['--status'], {
            encoding: 'utf8',
            timeout: 5000,
        })
        const parsed = JSON.parse((r.stdout || '').trim() || '{}') as {
            installed?: unknown
            running?: unknown
        }
        return {
            installed: Boolean(parsed.installed),
            running: Boolean(parsed.running),
            binPath: bin,
        }
    } catch {
        return { installed: false, running: false, binPath: bin }
    }
}

export interface SetupResult {
    ok: boolean
    binPath: string
    error?: string
}

/** Run the daemon's self-install (`<bin> --ensure-installed`). Idempotent. Never throws. */
export async function runSetup(): Promise<SetupResult> {
    const bin = daemonBinPath()
    if (!existsSync(bin))
        return {
            ok: false,
            binPath: bin,
            error: 'daemon binary not installed (no bundle staged)',
        }
    try {
        const r = spawnSync(bin, ['--ensure-installed'], {
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, BISMUTH_DAEMON_BIN: bin },
        })
        return r.status === 0
            ? { ok: true, binPath: bin }
            : { ok: false, binPath: bin, error: (r.stderr || '').trim() }
    } catch (e) {
        return { ok: false, binPath: bin, error: String(e) }
    }
}

/** Link (rather than copy) the bundled daemon into place? Only on macOS, and only from an app
 *  installed in /Applications or ~/Applications. A bundle anywhere else (a dmg, a translocated
 *  download, a build's staging folder) is one that gets moved or deleted, and the machine-wide
 *  daemon would stop with it. */
export function linksDaemon(
    src: string,
    platform: NodeJS.Platform,
    home: string = homedir(),
): boolean {
    return (
        platform === 'darwin' &&
        (src.startsWith('/Applications/') ||
            src.startsWith(join(home, 'Applications') + '/'))
    )
}

/** Re-place the daemon? When the bundled build changed (marker differs) or `bin` is not the
 *  placement linksDaemon asks for. */
export function needsPlacement(prev: string, sig: string, placed: boolean): boolean {
    return prev !== sig || !placed
}

/** Is `bin` already what placeDaemonBinary would make it? A link must point at `src`; a copy is
 *  current when it exists (the caller's marker vouches for its version). */
export function daemonPlaced(src: string, bin: string, link: boolean): boolean {
    try {
        if (!link) return existsSync(bin) && !lstatSync(bin).isSymbolicLink()
        return lstatSync(bin).isSymbolicLink() && readlinkSync(bin) === src
    } catch {
        return false
    }
}

/** Put the daemon at `bin`: a symlink to `src` when `link`, else a copy. Built at a temp name then
 *  renamed over `bin`. A direct copyFileSync TRUNCATES the destination, which on Linux throws
 *  ETXTBSY when `bin` is the currently-executing daemon binary (the service outlives the app, so
 *  the old version is running during an update). rename() swaps the directory entry without
 *  opening the busy inode — the running process keeps its old inode, and the new binary is in
 *  place for the next (re)start. */
export function placeDaemonBinary(src: string, bin: string, link: boolean): void {
    if (resolve(bin) === resolve(src)) return // a link to itself would replace the bundle's binary
    const tmp = `${bin}.new-${process.pid}`
    rmSync(tmp, { force: true })
    if (link) symlinkSync(src, tmp)
    else {
        copyFileSync(src, tmp)
        chmodSync(tmp, 0o755)
    }
    renameSync(tmp, bin)
}

/**
 * Boot-time install: place the bundled daemon binary (BISMUTH_DAEMON_BUNDLE/bin/bismuth-daemon,
 * staged by the app's Tauri lib.rs) at ~/.bismuth/bin (linksDaemon decides link or copy) and
 * register the service. Version-gated by a marker (the source binary's size+mtime) so it only
 * re-places when a new app build ships a new daemon or the bundle moved. No-op in dev (no bundle
 * env). Best-effort; never throws.
 */
export async function installDaemonFromBundle(): Promise<void> {
    const bundle = process.env.BISMUTH_DAEMON_BUNDLE
    if (!bundle) return // dev / not the bundled app
    const src = join(bundle, 'bin', 'bismuth-daemon')
    if (!existsSync(src)) return
    const bin = daemonBinPath()
    const marker = bismuthHome('.daemon-installed')
    try {
        const st = statSync(src)
        const sig = `${st.size}:${Math.floor(st.mtimeMs)}`
        let prev = ''
        try {
            prev = readFileSync(marker, 'utf8').trim()
        } catch {
            /* first run */
        }
        const link = linksDaemon(src, process.platform)
        if (!needsPlacement(prev, sig, daemonPlaced(src, bin, link))) {
            await runSetup()
            return
        } // current → just ensure the service
        mkdirSync(bismuthHome('bin'), { recursive: true })
        placeDaemonBinary(src, bin, link)
        writeFileSync(marker, sig)
        // The running daemon's start signature can equal the new placement's (a copy keeps its
        // source's mtime), and --ensure-installed then leaves the old process running. Dropping
        // it forces exactly one restart onto what was just placed.
        rmSync(daemonBinSigPath(), { force: true })
        await runSetup()
    } catch {
        // best-effort — a failed daemon install never blocks the app
    }
}
