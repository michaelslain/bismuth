// Runtime-state section: records the app and daemon write under ~/.bismuth and the OS temp dir that
// outlive whatever they described. Every path comes from ctx. Repairs return warnings and never
// throw. Reports only: gcal keys and the app config (deleting either has side effects we cannot see).
import {
    chmodSync,
    existsSync,
    lstatSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { isRecord } from '../../isRecord'
import { itemLines } from '../format'
import type { DoctorContext, DoctorSection, Finding } from '../types'

export const SHIM_AGE_MS = 86_400_000

const SHIM_PREFIX = 'bismuth-agent-shim-'

function listDir(dir: string): string[] {
    try {
        return readdirSync(dir)
    } catch {
        return []
    }
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
        return undefined
    }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** A repair that removes every path in `paths`; one warning per failure, never a throw. */
function removeRepair(
    paths: string[],
    description: string,
    recursive: boolean,
): Finding['repair'] {
    return {
        risk: 'safe',
        description,
        apply: async () => {
            const warnings: string[] = []
            for (const path of paths) {
                try {
                    rmSync(path, { recursive, force: true })
                } catch (e) {
                    warnings.push(`failed to remove ${path}: ${msg(e)}`)
                }
            }
            return warnings
        },
    }
}

function runRecordFindings(ctx: DoctorContext): Finding[] {
    const dir = join(ctx.bismuthHome, 'run')
    const paths: string[] = []
    const labels: string[] = []
    for (const name of listDir(dir)) {
        if (!name.endsWith('.json')) continue
        const path = join(dir, name)
        const rec = readJson(path)
        if (!isRecord(rec) || typeof rec.pid !== 'number') continue
        if (ctx.pidAlive(rec.pid)) continue
        paths.push(path)
        // the file name is base64 of the vault path: name the vault itself
        labels.push(
            typeof rec.vault === 'string' && rec.vault ? rec.vault : name,
        )
    }
    if (paths.length === 0) return []
    const n = paths.length
    return [
        {
            id: 'runtime.stale-run-record',
            severity: 'info',
            title: `${n} run ${plural(n, 'record', 'records')} of ${plural(n, 'a core', 'cores')} no longer running`,
            detail: itemLines(labels),
            repair: removeRepair(
                paths,
                `remove ${n} stale run ${plural(n, 'record', 'records')}`,
                false,
            ),
        },
    ]
}

/** True only when `path` provably does not exist: lstat says ENOENT AND its parent directory is
 *  there. existsSync is also false on EACCES/EPERM, an unmounted volume or an evicted iCloud path,
 *  none of which mean the vault is gone. */
function provablyMissing(path: string): boolean {
    try {
        lstatSync(path)
        return false
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') return false
    }
    try {
        return lstatSync(dirname(path)).isDirectory()
    } catch {
        return false
    }
}

/** The trust file: BISMUTH_TRUST_FILE when set (exactly as core/src/statusBarTrust.ts's
 *  trustFilePath() resolves it), else under ctx.bismuthHome so the doctor stays ctx-rooted. */
function trustFile(ctx: DoctorContext): string {
    return process.env.BISMUTH_TRUST_FILE || join(ctx.bismuthHome, 'trusted-commands.json')
}

function trustedCommandFindings(ctx: DoctorContext): Finding[] {
    const file = trustFile(ctx)
    const table = readJson(file)
    if (!isRecord(table)) return []
    const orphans = Object.keys(table).filter(provablyMissing)
    if (orphans.length === 0) return []
    return [
        {
            id: 'runtime.trusted-commands-orphans',
            severity: 'info',
            title: `approved commands for ${orphans.length} vault${orphans.length === 1 ? '' : 's'} that no longer exist`,
            detail: orphans.join('\n'),
            repair: {
                risk: 'safe',
                description: 'rewrite trusted-commands.json without those vaults',
                apply: async () => {
                    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
                    try {
                        // re-read: only drop keys that are still provably missing at apply time
                        const current = readJson(file)
                        if (!isRecord(current)) return []
                        const kept = Object.fromEntries(
                            Object.entries(current).filter(
                                ([k]) => !provablyMissing(k),
                            ),
                        )
                        if (
                            Object.keys(kept).length ===
                            Object.keys(current).length
                        )
                            return []
                        writeFileSync(tmp, JSON.stringify(kept, null, 2), {
                            mode: 0o600,
                        })
                        renameSync(tmp, file)
                        chmodSync(file, 0o600)
                        return []
                    } catch (e) {
                        rmSync(tmp, { force: true })
                        return [`failed to rewrite ${file}: ${msg(e)}`]
                    }
                },
            },
        },
    ]
}

function gcalFindings(ctx: DoctorContext): Finding[] {
    const manifest = readJson(join(ctx.bismuthHome, 'gcal', 'sync.json'))
    if (!isRecord(manifest) || !isRecord(manifest.bases)) return []
    const missing = new Set<string>()
    for (const key of Object.keys(manifest.bases)) {
        const i = key.indexOf('::')
        if (i <= 0) continue // a legacy bare key names no vault
        const vault = key.slice(0, i)
        if (!existsSync(vault)) missing.add(vault)
    }
    if (missing.size === 0) return []
    return [
        {
            id: 'runtime.gcal-orphan-keys',
            severity: 'info',
            title: `calendar sync state for ${missing.size} vault${missing.size === 1 ? '' : 's'} that no longer exist`,
            detail: `${[...missing].join('\n')}\nleft in place: deleting it can duplicate events if the vault comes back`,
        },
    ]
}

function appConfigFindings(ctx: DoctorContext): Finding[] {
    if (ctx.platform !== 'darwin') return []
    const file = join(
        ctx.home,
        'Library',
        'Application Support',
        'com.bismuth.app',
        'config.json',
    )
    const cfg = readJson(file)
    if (!isRecord(cfg) || typeof cfg.vault !== 'string' || !cfg.vault) return []
    if (existsSync(cfg.vault)) return []
    return [
        {
            id: 'runtime.app-config-vault-missing',
            severity: 'info',
            title: 'the app remembers a vault that no longer exists',
            detail: `${cfg.vault} (from ${file}); the first-run vault picker shows again on launch`,
        },
    ]
}

function agentShimFindings(ctx: DoctorContext): Finding[] {
    const paths: string[] = []
    for (const name of listDir(ctx.tmpDir)) {
        if (!name.startsWith(SHIM_PREFIX)) continue
        const path = join(ctx.tmpDir, name)
        try {
            const st = lstatSync(path)
            if (!st.isDirectory() || ctx.now - st.mtimeMs < SHIM_AGE_MS)
                continue
        } catch {
            continue
        }
        paths.push(path)
    }
    if (paths.length === 0) return []
    const n = paths.length
    const what = `leftover terminal agent shim ${plural(n, 'directory', 'directories')}`
    return [
        {
            id: 'runtime.agent-shim',
            severity: 'info',
            title: `${n} ${what}`,
            detail: itemLines(paths),
            repair: removeRepair(paths, `remove ${n} ${what}`, true),
        },
    ]
}

export const runtimeSection: DoctorSection = {
    id: 'runtime',
    title: 'runtime state',
    check: async ctx => [
        ...runRecordFindings(ctx),
        ...trustedCommandFindings(ctx),
        ...gcalFindings(ctx),
        ...appConfigFindings(ctx),
        ...agentShimFindings(ctx),
    ],
}
