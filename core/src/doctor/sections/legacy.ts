// The `legacy` section: leftovers of retired Bismuth/claude-bot/obsidian-era installs that no
// current code cleans. Detection is by shape under ctx paths (never homedir()); a foreign link or a
// real directory that merely shares a legacy name is never reported.
import {
    existsSync,
    lstatSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LEGACY_SKILL_IDS } from '../../bismuthInstall'
import { isBismuthOwnedPath } from '../../ownership'
import {
    CLAUDE_BOT_UNIT,
    removeServiceUnit,
    serviceUnitPath,
} from '../../serviceUnit'
import type { DoctorContext, DoctorSection, Finding, Repair } from '../types'

const OBSIDIAN_BUNDLE = 'com.michael.obsidian'
const OBSIDIAN_LIBRARY_DIRS = [
    'WebKit',
    'Caches',
    'Preferences',
    'Saved Application State',
]

/** A symlink's target resolved against the link's own directory, so a relative target cannot pass
 *  the ownership-by-shape check by accident. */
function linkTarget(link: string): string {
    return resolve(dirname(link), readlinkSync(link))
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}

function present(path: string): boolean {
    try {
        return lstatSync(path, { throwIfNoEntry: false }) != null
    } catch {
        return false
    }
}

/** rm -r each path; a no-op for one already gone; one warning per failure. */
function removePaths(paths: string[]): string[] {
    const warnings: string[] = []
    for (const p of paths) {
        try {
            rmSync(p, { recursive: true, force: true })
        } catch (e) {
            warnings.push(`failed to remove ${p}: ${message(e)}`)
        }
    }
    return warnings
}

function removeRepair(
    risk: Repair['risk'],
    description: string,
    paths: string[],
): Repair {
    return { risk, description, apply: async () => removePaths(paths) }
}

function skillLinks(ctx: DoctorContext): Finding[] {
    const out: Finding[] = []
    for (const id of LEGACY_SKILL_IDS) {
        const link = join(ctx.claudeDir, 'skills', id)
        const ours = () => {
            try {
                return (
                    lstatSync(link, {
                        throwIfNoEntry: false,
                    })?.isSymbolicLink() === true &&
                    isBismuthOwnedPath(linkTarget(link), `skills/${id}`)
                )
            } catch {
                return false
            }
        }
        if (!ours()) continue
        out.push({
            id: `legacy.skill-link:${id}`,
            severity: 'warn',
            title: 'old bismuth skill link still installed',
            detail: `${link} -> ${linkTarget(link)}; the guide now ships as docs`,
            repair: {
                risk: 'safe',
                description: `remove the symlink ${link}`,
                async apply() {
                    try {
                        if (ours()) unlinkSync(link)
                        return []
                    } catch (e) {
                        return [`failed to remove ${link}: ${message(e)}`]
                    }
                },
            },
        })
    }
    return out
}

function readMarker(marker: string): string {
    try {
        return readFileSync(marker, 'utf8').trim()
    } catch {
        return '' // unreadable marker
    }
}

/** True when the migrated copy really exists: the marker's destination vault holds a `.daemon`,
 *  at the recorded path or at the same path with its home rewritten onto this context's home (a
 *  renamed account). `.daemon` alone proves nothing (the migration creates it before copying), so
 *  when `~/.claude-bot/memory` exists the copy must hold `.daemon/memory` too. */
function verifiedCopy(ctx: DoctorContext, dest: string): boolean {
    if (!dest) return false
    const needMemory = existsSync(join(ctx.home, '.claude-bot', 'memory'))
    const holds = (vault: string) =>
        existsSync(join(vault, '.daemon')) &&
        (!needMemory || existsSync(join(vault, '.daemon', 'memory')))
    if (holds(dest)) return true
    const rest = dest.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/)
    if (!rest) return false
    return holds(join(ctx.home, rest[1] ?? ''))
}

function claudeBotFindings(ctx: DoctorContext): Finding[] {
    const out: Finding[] = []
    const unit = serviceUnitPath(ctx.platform, ctx.home, CLAUDE_BOT_UNIT)
    if (unit && existsSync(unit))
        out.push({
            id: 'legacy.claude-bot-service',
            severity: 'warn',
            title: 'old claude-bot launch agent still installed',
            detail: unit,
            repair: {
                risk: 'destructive',
                description: `unload and delete ${unit}`,
                apply: () =>
                    removeServiceUnit(
                        {
                            platform: ctx.platform,
                            home: ctx.home,
                            exec: ctx.exec,
                        },
                        CLAUDE_BOT_UNIT,
                    ),
            },
        })

    const clone = join(ctx.bismuthHome, 'claude-bot')
    if (present(clone))
        out.push({
            id: 'legacy.claude-bot-clone',
            severity: 'info',
            title: 'old claude-bot checkout still on disk',
            detail: clone,
            repair: removeRepair('destructive', `delete ${clone}`, [clone]),
        })

    const marker = join(ctx.bismuthHome, 'daemon', '.claude-bot-migrated')
    const migrated = present(marker)
    const markerDest = migrated ? readMarker(marker) : ''
    const botHome = join(ctx.home, '.claude-bot')
    if (present(botHome)) {
        if (!migrated)
            out.push({
                id: 'legacy.claude-bot-home',
                severity: 'warn',
                title: 'old claude-bot data not migrated yet',
                detail: `${botHome} has no ${marker}; start the daemon so it migrates, then re-run doctor`,
            })
        else if (verifiedCopy(ctx, markerDest))
            out.push({
                id: 'legacy.claude-bot-home',
                severity: 'info',
                title: 'old claude-bot data already migrated',
                detail: `${botHome} was migrated (marker ${marker})`,
                repair: removeRepair('destructive', `delete ${botHome}`, [
                    botHome,
                ]),
            })
        else
            // The migration is copy-only, so with no copy to be found this may be the only one.
            out.push({
                id: 'legacy.claude-bot-home',
                severity: 'warn',
                title: 'claude-bot memory not found in a migrated vault',
                detail: `${botHome} is marked migrated (${marker}), but ${markerDest ? `${markerDest}/.daemon/memory` : 'the marker names no destination'} does not exist; doctor will not delete the only copy`,
            })
    }

    if (migrated) {
        const dest = markerDest
        if (dest && !existsSync(dest))
            out.push({
                id: 'legacy.claude-bot-marker-old-home',
                severity: 'info',
                title: 'claude-bot migration marker names a missing path',
                detail: `${marker} points at ${dest}, which does not exist (an old home?)`,
            })
    }
    return out
}

function obsidianFindings(ctx: DoctorContext): Finding[] {
    const paths: string[] = []
    for (const dir of OBSIDIAN_LIBRARY_DIRS) {
        const lib = join(ctx.home, 'Library', dir)
        try {
            for (const name of readdirSync(lib))
                if (name.startsWith(OBSIDIAN_BUNDLE))
                    paths.push(join(lib, name))
        } catch {
            // no such Library dir
        }
    }
    if (paths.length === 0) return []
    return [
        {
            id: 'legacy.obsidian-bundle-dirs',
            severity: 'info',
            title: 'old com.michael.obsidian app data still on disk',
            detail: paths.join('\n'),
            repair: removeRepair(
                'destructive',
                `delete ${paths.length} ${OBSIDIAN_BUNDLE} entr${paths.length === 1 ? 'y' : 'ies'} under ~/Library`,
                paths,
            ),
        },
    ]
}

export const legacySection: DoctorSection = {
    id: 'legacy',
    title: 'legacy leftovers',
    async check(ctx) {
        const out: Finding[] = [...skillLinks(ctx)]
        const skillsDir = join(ctx.bismuthHome, 'skills')
        if (present(skillsDir))
            out.push({
                id: 'legacy.skills-dir',
                severity: 'warn',
                title: 'old bismuth skills directory still on disk',
                detail: skillsDir,
                repair: removeRepair('safe', `delete ${skillsDir}`, [
                    skillsDir,
                ]),
            })
        out.push(...claudeBotFindings(ctx), ...obsidianFindings(ctx))
        const sandboxes = join(ctx.bismuthHome, 'sandboxes')
        if (present(sandboxes))
            out.push({
                id: 'legacy.sandboxes',
                severity: 'info',
                title: 'sandboxes directory from removed tooling',
                detail: `${sandboxes} came from operator tooling no longer in the repo; doctor never deletes it — remove it by hand if unwanted`,
            })
        return out
    },
}
