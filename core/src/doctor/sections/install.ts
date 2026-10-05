// The `install` section: is Bismuth's machine-wide install (~/.bismuth/bin, the CLI symlink, the
// MCP registrations) present, current and pointing at THIS home? Every path comes from ctx; a path
// is ours by SHAPE (ownership.ts), so a link written under an older home is recognised, while a
// foreign file or link is never reported and never touched.
import {
    existsSync,
    lstatSync,
    readFileSync,
    readlinkSync,
    unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { MCP_REGISTRARS } from '../../agentBackends/mcpRegistrars'
import type { BismuthMcpSpec } from '../../agentBackends/mcpRegistrars'
import { defaultIO, ensureBismuthInstalled } from '../../bismuthInstall'
import { isBismuthOwnedPath, isOldHomeBismuthPath } from '../../ownership'
import type { DoctorContext, DoctorSection, Finding } from '../types'

/** Seams for the repair halves that close over the REAL home — a test overrides them. */
export const installRepairs = {
    relink: () => defaultIO.linkCli(),
}

function readText(path: string): string | null {
    try {
        return readFileSync(path, 'utf8')
    } catch {
        return null
    }
}

/** A symlink's target resolved against the link's own directory, so a relative target cannot pass
 *  the ownership-by-shape check by accident. */
function linkTarget(link: string): string {
    return resolve(dirname(link), readlinkSync(link))
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}

function versionSkew(ctx: DoctorContext, marker: string): Promise<Finding[]> {
    const src = ctx.installSrc
    if (!src) return Promise.resolve([])
    return defaultIO.hashSrc(src).then(
        hash => {
            if (!hash || hash === marker) return []
            return [
                {
                    id: 'install.version-skew',
                    severity: 'warn',
                    title: 'installed binaries differ from the bundled ones',
                    detail: `${join(ctx.bismuthHome, '.version')} does not match the binaries in ${src}`,
                    repair: {
                        risk: 'safe',
                        description: `reinstall the bismuth binaries from ${src}`,
                        async apply() {
                            try {
                                const r = await ensureBismuthInstalled(src)
                                if (r.action === 'skipped-no-src')
                                    return [
                                        `install source ${src} is missing or incomplete`,
                                    ]
                                return r.warnings
                            } catch (e) {
                                return [`reinstall failed: ${message(e)}`]
                            }
                        },
                    },
                } satisfies Finding,
            ]
        },
        () => [],
    )
}

async function relinkWarnings(): Promise<string[]> {
    try {
        const r = installRepairs.relink()
        if (r.warning) return [r.warning]
        return r.ok ? [] : ['could not link the bismuth CLI onto PATH']
    } catch (e) {
        return [`relink failed: ${message(e)}`]
    }
}

function cliLinkFindings(ctx: DoctorContext): Finding[] {
    const cliDest = join(ctx.bismuthHome, 'bin', 'bismuth')
    let good = false
    const stale: string[] = []
    for (const dir of ctx.linkDirs) {
        const link = join(dir, 'bismuth')
        try {
            const st = lstatSync(link, { throwIfNoEntry: false })
            if (!st?.isSymbolicLink()) continue
            const target = linkTarget(link)
            if (!isBismuthOwnedPath(target, 'bin/bismuth')) continue // foreign
            if (
                isOldHomeBismuthPath(target, 'bin/bismuth', ctx.home) ||
                !existsSync(cliDest)
            )
                stale.push(link)
            else good = true
        } catch {
            // unreadable link — not ours to judge
        }
    }
    const out: Finding[] = stale.map(link => ({
        id: `install.cli-link-stale:${link}`,
        severity: 'warn',
        title: 'cli link points at an old home',
        detail: `${link} does not lead to ${cliDest}`,
        repair: {
            risk: 'safe',
            description: `remove ${link} and relink the bismuth CLI`,
            async apply() {
                const warnings: string[] = []
                try {
                    const st = lstatSync(link, { throwIfNoEntry: false })
                    if (
                        st?.isSymbolicLink() &&
                        isBismuthOwnedPath(linkTarget(link), 'bin/bismuth')
                    )
                        unlinkSync(link)
                } catch (e) {
                    warnings.push(`failed to remove ${link}: ${message(e)}`)
                }
                warnings.push(...(await relinkWarnings()))
                return warnings
            },
        },
    }))
    if (!good && stale.length === 0)
        out.push({
            id: 'install.cli-link-missing',
            severity: 'warn',
            title: 'bismuth cli is not linked onto PATH',
            detail: `no bismuth link to ${cliDest} in ${ctx.linkDirs.join(', ')}`,
            repair: {
                risk: 'safe',
                description: 'link the bismuth CLI onto PATH',
                apply: relinkWarnings,
            },
        })
    return out
}

/** The command path out of `claude mcp get bismuth` (a `  Command: <path>` line), or null when the
 *  output has no such line — an unparseable answer is reported as nothing, never guessed. */
export function parseClaudeMcpCommand(stdout: string): string | null {
    const m = /^\s*Command:\s*(\S.*?)\s*$/m.exec(stdout)
    return m ? m[1] : null
}

async function claudeMcpFindings(ctx: DoctorContext): Promise<Finding[]> {
    const claude = ctx.which('claude')
    if (!claude) return []
    const r = await ctx.exec([claude, 'mcp', 'get', 'bismuth'])
    const repair = {
        risk: 'safe' as const,
        description: 'register the bismuth MCP server with Claude Code',
        async apply() {
            try {
                const res = await defaultIO.registerMcp()
                return res.warning ? [res.warning] : []
            } catch (e) {
                return [`mcp registration failed: ${message(e)}`]
            }
        },
    }
    if (r.code === -1) return [] // could not run claude at all — no answer
    if (r.code !== 0)
        return [
            {
                id: 'install.mcp-claude-missing',
                severity: 'warn',
                title: 'bismuth mcp is not registered with claude code',
                repair,
            },
        ]
    const cmd = parseClaudeMcpCommand(r.stdout)
    if (!cmd || !isBismuthOwnedPath(cmd, 'bin/bismuth-mcp')) return [] // unparseable or foreign
    const stale =
        isOldHomeBismuthPath(cmd, 'bin/bismuth-mcp', ctx.home) ||
        !existsSync(cmd)
    if (!stale) return []
    return [
        {
            id: 'install.mcp-claude-stale',
            severity: 'warn',
            title: 'claude mcp entry points at a missing binary',
            detail: `claude runs ${cmd}, expected ${join(ctx.bismuthHome, 'bin', 'bismuth-mcp')}`,
            repair,
        },
    ]
}

function otherMcpFindings(ctx: DoctorContext): Finding[] {
    const text = readText(join(ctx.bismuthHome, '.mcp-registrations.json'))
    if (!text) return []
    let ledger: unknown
    try {
        ledger = JSON.parse(text)
    } catch {
        return []
    }
    if (!ledger || typeof ledger !== 'object') return []
    const mcpBin = join(ctx.bismuthHome, 'bin', 'bismuth-mcp')
    if (existsSync(mcpBin)) return []
    const spec: BismuthMcpSpec = {
        mcpBin,
        docsDir: join(ctx.bismuthHome, 'docs'),
        cliBin: join(ctx.bismuthHome, 'bin', 'bismuth'),
    }
    return Object.keys(ledger).map(id => {
        const registrar = MCP_REGISTRARS.find(r => r.id === id)
        return {
            id: `install.mcp-other-stale:${id}`,
            severity: 'warn',
            title: `${id} mcp registration points at a missing binary`,
            detail: `${mcpBin} does not exist`,
            repair: registrar
                ? {
                      risk: 'safe',
                      description: `re-register the bismuth MCP server with ${registrar.label}`,
                      async apply() {
                          if (!existsSync(mcpBin))
                              return [
                                  `${mcpBin} is still missing — reinstall bismuth first`,
                              ]
                          try {
                              const r = await registrar.register(spec)
                              return r.warning ? [r.warning] : []
                          } catch (e) {
                              return [
                                  `${id} registration failed: ${message(e)}`,
                              ]
                          }
                      },
                  }
                : undefined,
        } satisfies Finding
    })
}

export const installSection: DoctorSection = {
    id: 'install',
    title: 'install',
    async check(ctx) {
        const marker = readText(join(ctx.bismuthHome, '.version'))?.trim()
        if (!marker)
            return [
                {
                    id: 'install.not-installed',
                    severity: 'info',
                    title: 'bismuth is not installed machine-wide',
                    detail: `no ${join(ctx.bismuthHome, '.version')} — only the bundled app installs it`,
                },
            ]
        return [
            ...(await versionSkew(ctx, marker)),
            ...cliLinkFindings(ctx),
            ...(await claudeMcpFindings(ctx)),
            ...otherMcpFindings(ctx),
        ]
    },
}
