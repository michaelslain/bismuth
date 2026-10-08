// The vault section of `bismuth doctor`: migrations a vault is still waiting on, and the leftovers
// older Bismuth versions wrote into it. Every repair reuses the function boot already runs
// (migrateSettingsLocation, reconcileSettings, runTaskMigration, flattenBaseViews) — nothing here
// re-implements a migration, it only decides whether one is pending.
import {
    existsSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { baseFormatOf, readBaseConfigRaw } from '../../bases/baseFile'
import { flattenBaseViews } from '../../bases/flattenViews'
import { listBases, listMarkdown } from '../../files'
import { FRONTMATTER_REGEX } from '../../frontmatter'
import {
    LEGACY_SETTINGS_FILE,
    SETTINGS_FILE,
    migrateSettingsLocation,
    reconcileSettings,
    retiredKeysPresent,
} from '../../settings'
import { itemLines } from '../format'
import { pruneExclude, staleExcludeLines } from '../../backup'
import { hasLegacySignifier } from '../../taskLegacy'
import { migrateContent } from '../../taskMigrate'
import { runTaskMigration } from '../../taskMigrateRun'
import type { DoctorContext, DoctorSection, Finding } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000
const PROFILE_MAX_AGE_MS = 7 * DAY_MS

const message = (err: unknown): string =>
    err instanceof Error ? err.message : String(err)

/** Run a repair body so it never throws: a failure becomes a warning. */
async function guarded(body: () => Promise<string[]> | string[]): Promise<string[]> {
    try {
        return await body()
    } catch (err) {
        return [message(err)]
    }
}

// ── settings location ────────────────────────────────────────────────────────────────

/** Mirrors migrateSettingsLocation's own gate: nothing is pending once a `.settings` FILE exists. */
function checkSettingsLocation(vault: string): Finding[] {
    const next = join(vault, SETTINGS_FILE)
    try {
        if (existsSync(next) && statSync(next).isFile()) return []
    } catch {
        /* fall through */
    }
    const legacyRoot = existsSync(join(vault, LEGACY_SETTINGS_FILE))
    const interim = existsSync(join(vault, SETTINGS_FILE, LEGACY_SETTINGS_FILE))
    if (!legacyRoot && !interim) return []
    return [
        {
            id: 'vault.settings-location',
            severity: 'warn',
            title: 'Settings are in an old location',
            detail: legacyRoot
                ? `${LEGACY_SETTINGS_FILE} sits at the vault root; settings now live in the ${SETTINGS_FILE} file`
                : `${SETTINGS_FILE}/${LEGACY_SETTINGS_FILE} is an interim folder layout; settings now live in the ${SETTINGS_FILE} file`,
            repair: {
                risk: 'safe',
                description: `move the old settings file to ${SETTINGS_FILE}`,
                apply: () =>
                    guarded(() => {
                        migrateSettingsLocation(vault)
                        return []
                    }),
            },
        },
    ]
}

function checkRetiredKeys(vault: string): Finding[] {
    const keys = retiredKeysPresent(vault)
    if (keys.length === 0) return []
    return [
        {
            id: 'vault.settings-retired-keys',
            severity: 'info',
            title: 'Settings carry keys Bismuth no longer reads',
            detail: keys.join(', '),
            repair: {
                risk: 'safe',
                description: `remove ${keys.join(', ')} from ${SETTINGS_FILE}, keeping comments and every other key`,
                apply: () =>
                    guarded(async () => {
                        await reconcileSettings(vault)
                        return []
                    }),
            },
        },
    ]
}

// ── notes: task syntax + bases ───────────────────────────────────────────────────────
// listMarkdown skips dot entries, so .git, .daemon, .trash and .ink are never walked.

async function readNotes(vault: string): Promise<Array<{ rel: string; text: string }>> {
    let rels: string[]
    try {
        rels = await listMarkdown(vault)
    } catch {
        return []
    }
    const out: Array<{ rel: string; text: string }> = []
    let n = 0
    for (const rel of rels.sort()) {
        // yield to the event loop so a big vault never stalls core's request handling
        if (++n % 200 === 0) await new Promise(r => setImmediate(r))
        try {
            out.push({ rel, text: readFileSync(join(vault, rel), 'utf8') })
        } catch {
            /* unreadable note — not this section's problem */
        }
    }
    return out
}

function checkTaskSyntax(
    vault: string,
    notes: Array<{ rel: string; text: string }>,
): Finding[] {
    let files = 0
    let lines = 0
    for (const { text } of notes) {
        if (!hasLegacySignifier(text)) continue
        const { changed } = migrateContent(text)
        if (changed === 0) continue
        files++
        lines += changed
    }
    if (files === 0) return []
    return [
        {
            id: 'vault.task-syntax',
            severity: 'warn',
            title: 'Notes still use the old emoji task syntax',
            detail: `${files} ${files === 1 ? 'note' : 'notes'}, ${lines} task ${lines === 1 ? 'line' : 'lines'} — the app no longer reads dates or priorities written as emoji`,
            repair: {
                risk: 'safe',
                description:
                    'convert task lines to bracket fields (a git snapshot of the vault is committed first)',
                apply: () =>
                    guarded(async () => {
                        const r = await runTaskMigration(vault)
                        const warnings: string[] = []
                        if (r.blocked)
                            warnings.push(
                                `vault snapshot failed, nothing was rewritten${r.snapshotError ? `: ${r.snapshotError}` : ''}`,
                            )
                        for (const s of r.skipped)
                            warnings.push(
                                `${s.file} left as is (${s.reason}${s.error ? `: ${s.error}` : ''})`,
                            )
                        for (const f of r.flagged)
                            warnings.push(`${f.file}:${f.line + 1} needs a look: ${f.text}`)
                        return warnings
                    }),
            },
        },
    ]
}

/** The `views` entry count of a `type: base` note whose frontmatter still has the legacy list. */
function legacyViewCount(text: string): number | null {
    // JSON Lines bases are always flat — there is no views: list to find
    if (baseFormatOf(text) === 'jsonl') return null
    const m = text.match(FRONTMATTER_REGEX)
    if (!m) return null
    // cheap pre-check: only a frontmatter with a top-level `views:` key can be a legacy base
    if (!/^views\s*:/m.test(m[1] ?? '')) return null
    let data: Record<string, unknown>
    try {
        // logLevel 'error': a collection key (`? { date }`) is legal YAML that the yaml package warns
        // about on process.emitWarning, and the doctor reads every note in the vault
        data = (parse(m[1] ?? '', { logLevel: 'error' }) ?? {}) as Record<
            string,
            unknown
        >
    } catch {
        return null
    }
    if (!data || typeof data !== 'object') return null
    if (data.type !== 'base' || !('views' in data)) return null
    return Array.isArray(data.views) ? data.views.length : 0
}

function checkBaseViews(
    vault: string,
    notes: Array<{ rel: string; text: string }>,
): Finding[] {
    const single: string[] = []
    const multi: string[] = []
    for (const { rel, text } of notes) {
        const count = legacyViewCount(text)
        if (count === null) continue
        if (count > 1) multi.push(rel)
        else single.push(rel)
    }
    const out: Finding[] = []
    if (multi.length > 0) {
        const n = multi.length
        out.push({
            id: 'vault.base-views-multi',
            severity: 'warn',
            title: `${n} ${n === 1 ? 'base declares' : 'bases declare'} more than one view, so writes to ${n === 1 ? 'it' : 'them'} fail`,
            detail: itemLines(multi),
        })
    }
    if (single.length > 0) {
        const n = single.length
        out.push({
            id: 'vault.base-views-list',
            severity: 'info',
            title: `${n} ${n === 1 ? 'base uses' : 'bases use'} the legacy views: list`,
            detail: itemLines(single),
            repair: {
                risk: 'destructive',
                description: `rewrite ${n} ${n === 1 ? 'base' : 'bases'} with ${n === 1 ? 'its' : 'their'} single view flattened to top-level keys`,
                apply: async () => {
                    const warnings: string[] = []
                    for (const rel of single) {
                        try {
                            const abs = join(vault, rel)
                            const current = readFileSync(abs, 'utf8')
                            const next = flattenBaseViews(current)
                            if (next !== current) writeFileSync(abs, next)
                        } catch (err) {
                            warnings.push(`${rel}: ${message(err)}`)
                        }
                    }
                    return warnings
                },
            },
        })
    }
    return out
}

// ── leftovers ────────────────────────────────────────────────────────────────────────

/** Every file under `dir`, recursively, with its size. */
function filesUnder(dir: string): Array<{ path: string; size: number }> {
    const out: Array<{ path: string; size: number }> = []
    const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name)
            if (e.isDirectory()) walk(p)
            else out.push({ path: p, size: statSync(p).size })
        }
    }
    walk(dir)
    return out
}

function checkInkDir(vault: string): Finding[] {
    const dir = join(vault, '.ink')
    if (!existsSync(dir)) return []
    let files: Array<{ path: string; size: number }>
    try {
        files = filesUnder(dir)
    } catch {
        return []
    }
    const nonEmpty = files.filter(f => f.size > 0)
    if (nonEmpty.length > 0)
        return [
            {
                id: 'vault.ink-dir',
                severity: 'info',
                title: '.ink/ is a retired folder that still holds data',
                detail: `${nonEmpty.length} of ${files.length} sidecar files are not empty, so it is left alone — ink now lives in fenced blocks inside notes`,
            },
        ]
    return [
        {
            id: 'vault.ink-dir',
            severity: 'info',
            title: '.ink/ is a retired folder of empty sidecars',
            detail: `${files.length} empty ${files.length === 1 ? 'file' : 'files'}; ink now lives in fenced blocks inside notes`,
            repair: {
                risk: 'destructive',
                description: 'delete the .ink folder',
                apply: () =>
                    guarded(() => {
                        // Re-verify at apply time: only ever delete a folder that is still all empty.
                        if (!existsSync(dir)) return []
                        if (filesUnder(dir).some(f => f.size > 0))
                            return ['.ink now holds data, left in place']
                        rmSync(dir, { recursive: true, force: true })
                        return []
                    }),
            },
        },
    ]
}

function checkDaemonMd(vault: string): Finding[] {
    if (!existsSync(join(vault, 'DAEMON.md'))) return []
    return [
        {
            id: 'vault.daemon-md',
            severity: 'info',
            title: 'DAEMON.md is an orphan from the old daemon',
            detail: 'nothing reads it any more; delete it if you do not need what it says',
        },
    ]
}

function oldVisibilityProfiles(vault: string, now: number): string[] {
    const dir = join(vault, '.daemon', 'tmp')
    let names: string[]
    try {
        names = readdirSync(dir)
    } catch {
        return []
    }
    return names
        .filter(n => /^visibility-.+\.sb$/.test(n))
        .map(n => join(dir, n))
        .filter(p => {
            try {
                return now - statSync(p).mtimeMs > PROFILE_MAX_AGE_MS
            } catch {
                return false
            }
        })
}

function checkVisibilityProfiles(vault: string, now: number): Finding[] {
    const old = oldVisibilityProfiles(vault, now)
    if (old.length === 0) return []
    return [
        {
            id: 'vault.visibility-profiles',
            severity: 'info',
            title: 'Old sandbox profiles are piling up in .daemon/tmp',
            detail: `${old.length} visibility-*.sb ${old.length === 1 ? 'file' : 'files'} older than 7 days; they are rewritten on demand`,
            repair: {
                risk: 'safe',
                description: 'delete visibility-*.sb profiles older than 7 days',
                apply: () =>
                    guarded(() => {
                        for (const p of oldVisibilityProfiles(vault, now)) {
                            try {
                                unlinkSync(p)
                            } catch {
                                /* already gone */
                            }
                        }
                        return []
                    }),
            },
        },
    ]
}

function checkBackupExclude(vault: string): Finding[] {
    const stale = staleExcludeLines(vault)
    if (stale.length === 0) return []
    return [
        {
            id: 'vault.backup-exclude',
            severity: 'info',
            title: '.git/info/exclude holds rules from an older backup',
            detail: `${[...new Set(stale)].join(', ')} would keep ignoring files the snapshot now tracks`,
            repair: {
                risk: 'safe',
                description: 'remove those lines from .git/info/exclude (your own lines stay)',
                apply: () =>
                    guarded(() => {
                        pruneExclude(vault)
                        return []
                    }),
            },
        },
    ]
}

/** JSON Lines bases whose line 1 does not parse as a config object: the base cannot load. */
async function checkJsonlBases(vault: string): Promise<Finding[]> {
    let rels: string[]
    try {
        rels = await listBases(vault)
    } catch {
        return []
    }
    const broken: string[] = []
    for (const rel of rels.sort()) {
        try {
            const text = readFileSync(join(vault, rel), 'utf8')
            if (readBaseConfigRaw(text) === null) broken.push(rel)
        } catch {
            /* unreadable base — not this check's problem */
        }
    }
    if (broken.length === 0) return []
    const n = broken.length
    return [
        {
            id: 'vault.base-jsonl-config',
            severity: 'warn',
            title: `${n} ${n === 1 ? 'JSON Lines base has' : 'JSON Lines bases have'} an unparseable first line`,
            detail: itemLines(broken),
        },
    ]
}

export const vaultSection: DoctorSection = {
    id: 'vault',
    title: 'vault',
    needsVault: true,
    async check(ctx: DoctorContext): Promise<Finding[]> {
        const vault = ctx.vault
        if (!vault) return []
        const notes = await readNotes(vault)
        return [
            ...checkSettingsLocation(vault),
            ...checkRetiredKeys(vault),
            ...checkTaskSyntax(vault, notes),
            ...checkBaseViews(vault, notes),
            ...(await checkJsonlBases(vault)),
            ...checkInkDir(vault),
            ...checkDaemonMd(vault),
            ...checkVisibilityProfiles(vault, ctx.now),
            ...checkBackupExclude(vault),
        ]
    },
}
