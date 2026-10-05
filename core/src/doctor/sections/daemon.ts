// Daemon section: the launchd/systemd unit, the installed binary and the debris the daemon's own
// install + atomic writes + never-rotated logs leave under ~/.bismuth. Every path comes from ctx.
// Repairs return warnings and never throw. Log truncation rewrites the file IN PLACE: launchd holds
// the log open O_APPEND, so unlinking or renaming it would leave the daemon writing to a dead inode.
import {
    closeSync,
    existsSync,
    openSync,
    readdirSync,
    readFileSync,
    readSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { installDaemonFromBundle, runSetup } from '../../daemonInstall'
import { isOldHomeBismuthPath } from '../../ownership'
import {
    BISMUTH_DAEMON_UNIT,
    removeServiceUnit,
    serviceUnitPath,
} from '../../serviceUnit'
import { itemLines } from '../format'
import type { DoctorContext, DoctorSection, Finding, Repair } from '../types'

export const ATOMIC_TMP_AGE_MS = 3_600_000
export const LOG_MAX_BYTES = 10 * 1024 * 1024
export const LOG_KEEP_BYTES = 1024 * 1024

const BIN_REST = 'bin/bismuth-daemon'
const TEMP_BINARY = /^bismuth-daemon\.new-(\d+)$/
const ATOMIC_TMP = /\.\d+(\.\d+)?\.tmp$/
const DAEMON_LOG = /^bismuth-daemon\.(stdout|stderr)\.log$/
// every absolute path in a unit file that ends in the daemon binary, whatever home it names
const BIN_IN_UNIT = /[^\s<>"'=]*\/\.bismuth\/bin\/bismuth-daemon/g

function listDir(dir: string): string[] {
    try {
        return readdirSync(dir)
    } catch {
        return []
    }
}

function fileStat(path: string) {
    try {
        const st = statSync(path)
        return st.isFile() ? st : null
    } catch {
        return null
    }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** A repair that removes every file in `paths`. A no-op once they are gone; one warning per failure, never a throw. */
function unlinkRepair(paths: string[], description: string): Repair {
    return {
        risk: 'safe',
        description,
        apply: async () => {
            const warnings: string[] = []
            for (const path of paths) {
                try {
                    rmSync(path, { force: true })
                } catch (e) {
                    warnings.push(`failed to remove ${path}: ${msg(e)}`)
                }
            }
            return warnings
        },
    }
}

/** Rewrite `path` in place with only its last `keep` bytes (same inode, truncating write). */
function truncateInPlace(path: string, keep: number): string[] {
    try {
        const size = statSync(path).size
        if (size <= keep) return []
        const buf = Buffer.alloc(keep)
        const fd = openSync(path, 'r')
        try {
            readSync(fd, buf, 0, keep, size - keep)
        } finally {
            closeSync(fd)
        }
        writeFileSync(path, buf)
        return []
    } catch (e) {
        return [`failed to truncate ${path}: ${msg(e)}`]
    }
}

function unitFindings(ctx: DoctorContext): Finding[] {
    const unit = serviceUnitPath(ctx.platform, ctx.home, BISMUTH_DAEMON_UNIT)
    if (!unit || !existsSync(unit)) return []
    const bin = join(ctx.bismuthHome, 'bin', 'bismuth-daemon')
    if (!existsSync(bin)) {
        return [
            {
                id: 'daemon.unit-missing-binary',
                severity: 'warn',
                title: 'daemon service points at a binary that is not installed',
                detail: `${unit} exists but ${bin} does not, so the service fails on every start`,
                repair: {
                    risk: 'destructive',
                    description: `unload and remove ${unit}`,
                    apply: () =>
                        removeServiceUnit(
                            {
                                platform: ctx.platform,
                                home: ctx.home,
                                exec: ctx.exec,
                            },
                            BISMUTH_DAEMON_UNIT,
                        ),
                },
            },
        ]
    }
    let text = ''
    try {
        text = readFileSync(unit, 'utf8')
    } catch {
        return []
    }
    const old = (text.match(BIN_IN_UNIT) ?? []).filter(p =>
        isOldHomeBismuthPath(p, BIN_REST, ctx.home),
    )
    if (old.length === 0) return []
    return [
        {
            id: 'daemon.unit-old-home',
            severity: 'warn',
            title: 'daemon service was written for an older home directory',
            detail: `${unit} runs ${old[0]}, not ${bin}`,
            repair: {
                risk: 'safe',
                description:
                    'rewrite the daemon service for this home (daemon --ensure-installed)',
                apply: async () => {
                    try {
                        const r = await runSetup()
                        return r.ok ? [] : [r.error ?? 'daemon setup failed']
                    } catch (e) {
                        return [`daemon setup failed: ${msg(e)}`]
                    }
                },
            },
        },
    ]
}

function skewFindings(ctx: DoctorContext): Finding[] {
    if (!ctx.daemonBundle) return []
    const src = fileStat(join(ctx.daemonBundle, 'bin', 'bismuth-daemon'))
    if (!src) return []
    const sig = `${src.size}:${Math.floor(src.mtimeMs)}`
    let prev = ''
    try {
        prev = readFileSync(
            join(ctx.bismuthHome, '.daemon-installed'),
            'utf8',
        ).trim()
    } catch {
        /* never installed from a bundle */
    }
    if (prev === sig) return []
    return [
        {
            id: 'daemon.binary-skew',
            severity: 'warn',
            title: 'installed daemon is older than the bundled one',
            detail: `bundle ${sig}, installed marker ${prev || 'none'}`,
            repair: {
                risk: 'safe',
                description: 'copy the bundled daemon over the installed one',
                apply: async () => {
                    try {
                        await installDaemonFromBundle()
                        return []
                    } catch (e) {
                        return [`daemon install failed: ${msg(e)}`]
                    }
                },
            },
        },
    ]
}

function tempBinaryFindings(ctx: DoctorContext): Finding[] {
    const dir = join(ctx.bismuthHome, 'bin')
    const paths: string[] = []
    for (const name of listDir(dir)) {
        const m = TEMP_BINARY.exec(name)
        if (!m) continue
        // a live installer may still be copying it
        if (ctx.pidAlive(Number(m[1]))) continue
        paths.push(join(dir, name))
    }
    if (paths.length === 0) return []
    const n = paths.length
    return [
        {
            id: 'daemon.temp-binary',
            severity: 'warn',
            title: `${n} leftover daemon ${plural(n, 'binary', 'binaries')} from a failed install`,
            detail: itemLines(paths),
            repair: unlinkRepair(
                paths,
                `remove ${n} leftover daemon ${plural(n, 'binary', 'binaries')}`,
            ),
        },
    ]
}

function atomicTmpFindings(ctx: DoctorContext): Finding[] {
    const dir = join(ctx.bismuthHome, 'daemon')
    const paths: string[] = []
    for (const name of listDir(dir)) {
        if (!ATOMIC_TMP.test(name)) continue
        const st = fileStat(join(dir, name))
        if (!st || ctx.now - st.mtimeMs < ATOMIC_TMP_AGE_MS) continue
        paths.push(join(dir, name))
    }
    if (paths.length === 0) return []
    const n = paths.length
    return [
        {
            id: 'daemon.atomic-tmp',
            severity: 'info',
            title: `${n} leftover temp ${plural(n, 'file', 'files')} from interrupted writes`,
            detail: itemLines(paths),
            repair: unlinkRepair(
                paths,
                `remove ${n} leftover temp ${plural(n, 'file', 'files')}`,
            ),
        },
    ]
}

function logFindings(ctx: DoctorContext): Finding[] {
    const dir = join(ctx.bismuthHome, 'daemon', 'logs')
    const paths: string[] = []
    const lines: string[] = []
    for (const name of listDir(dir)) {
        if (!DAEMON_LOG.test(name)) continue
        const path = join(dir, name)
        const st = fileStat(path)
        if (!st || st.size <= LOG_MAX_BYTES) continue
        paths.push(path)
        lines.push(`${path} (${Math.round(st.size / (1024 * 1024))} MB)`)
    }
    if (paths.length === 0) return []
    const n = paths.length
    const keep = LOG_KEEP_BYTES / (1024 * 1024)
    return [
        {
            id: 'daemon.log-size',
            severity: 'info',
            title: `${n} daemon ${plural(n, 'log', 'logs')} over ${LOG_MAX_BYTES / (1024 * 1024)} MB`,
            detail: itemLines(lines),
            repair: {
                risk: 'safe',
                description: `keep the last ${keep} MiB of ${n} daemon ${plural(n, 'log', 'logs')}, in place`,
                apply: async () =>
                    paths.flatMap(p => truncateInPlace(p, LOG_KEEP_BYTES)),
            },
        },
    ]
}

export const daemonSection: DoctorSection = {
    id: 'daemon',
    title: 'daemon',
    check: async ctx => [
        ...unitFindings(ctx),
        ...skewFindings(ctx),
        ...tempBinaryFindings(ctx),
        ...atomicTmpFindings(ctx),
        ...logFindings(ctx),
    ],
}
