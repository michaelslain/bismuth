// Machine-wide install of the bismuth CLI + MCP server.
//
// The bundled app ships compiled `bismuth` + `bismuth-mcp` binaries and the docs/ tree as
// a Tauri resource; the sidecar gets its path in BISMUTH_INSTALL_SRC. On boot (and via
// `bismuth install` / an in-app command) we ensure that source is installed under
// ~/.bismuth, the CLI is symlinked onto PATH, and the MCP is registered in the user's
// GLOBAL Claude config (`claude mcp add -s user`) — so every terminal + every Claude
// session gets them, not just Bismuth app tabs.
//
// Version-gated + idempotent: a content hash of the two binaries is stored at
// ~/.bismuth/.version; if it matches AND the symlink + MCP registration are present, the
// ensure is a no-op. Any change to the bundled binaries (a new build) flips the hash and
// triggers a reinstall. Side effects + detection are injectable (InstallIO) for tests.
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
    existsSync,
    mkdirSync,
    rmSync,
    cpSync,
    chmodSync,
    readFileSync,
    writeFileSync,
    lstatSync,
    readlinkSync,
    unlinkSync,
    symlinkSync,
    accessSync,
    constants as fsConstants,
    createReadStream,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { whichClaude } from './claudeWhich'
import {
    MCP_REGISTRARS,
    type BismuthMcpSpec,
} from './agentBackends/mcpRegistrars'
import { isBismuthOwnedPath } from './ownership'
import {
    BISMUTH_DAEMON_UNIT,
    defaultExec,
    removeServiceUnit,
} from './serviceUnit'

const HOME = homedir()
export const BISMUTH_HOME = join(HOME, '.bismuth')
const BIN_DIR = join(BISMUTH_HOME, 'bin')
const DOCS_DIR = join(BISMUTH_HOME, 'docs')
const MARKER = join(BISMUTH_HOME, '.version')
const CLI_DEST = join(BIN_DIR, 'bismuth')
const MCP_DEST = join(BIN_DIR, 'bismuth-mcp')
// Candidate PATH dirs for the CLI symlink, preferred first (machine-wide before per-user).
export const LINK_DIRS: string[] = [
    '/usr/local/bin',
    join(HOME, '.local', 'bin'),
]
const CLAUDE_SKILLS_DIR = join(HOME, '.claude', 'skills')
// The three skills older builds installed (staged into ~/.bismuth/skills + symlinked into
// ~/.claude/skills/<id>). Their content now ships as docs/ guides, so nothing installs them any
// more — the ids survive only so removeLegacySkills() can clean up machines that still have them.
export const LEGACY_SKILL_IDS = [
    'authoring-bismuth-bases',
    'converting-bismuth-to-obsidian',
    'converting-obsidian-to-bismuth',
] as const

/** Per-registrar detect/register status for the "other CLIs" surface (core/src/agentBackends/
 *  mcpRegistrars.ts) — every non-Claude agent CLI Bismuth knows how to register its MCP with. */
export interface AdditionalMcpStatus {
    label: string
    detected: boolean
    registered: boolean
}

export interface BismuthStatus {
    /** A version marker exists at ~/.bismuth/.version. */
    installed: boolean
    /** The stored marker (content hash), or null. */
    version: string | null
    /** Our CLI symlink on PATH, or null. */
    cliPath: string | null
    cliLinked: boolean
    mcpRegistered: boolean
    /** Detected/registered status for every OTHER agent CLI (opt-in — see `mcp.registerWith` in
     *  settingsSchema.ts and `bismuth install --mcp`). Undefined only if the injected IO doesn't
     *  implement `additionalMcpStatus` (older fakes in tests). */
    additionalMcp?: Record<string, AdditionalMcpStatus>
}

export type InstallAction =
    | 'up-to-date'
    | 'installed'
    | 'updated'
    | 'would-install'
    | 'would-update'
    | 'skipped-no-src'

export interface InstallResult {
    action: InstallAction
    status: BismuthStatus
    warnings: string[]
}

/** Effectful + detection operations, injected so the decision logic is unit-testable. */
export interface InstallIO {
    /** Content hash of the source binaries, or null if the source is missing/incomplete. */
    hashSrc(src: string): Promise<string | null>
    readMarker(): string | null
    writeMarker(hash: string): void
    /** Our CLI symlink present on PATH (pointing into ~/.bismuth)? */
    cliLinked(): { linked: boolean; path: string | null }
    mcpRegistered(): Promise<boolean>
    /** Copy bin/ + docs/ from src into ~/.bismuth and chmod the binaries. */
    installFiles(src: string): void
    /** Symlink ~/.bismuth/bin/bismuth onto PATH (never clobbering a foreign file). */
    linkCli(): { ok: boolean; path: string | null; warning?: string }
    /** Remove what older builds installed as skills: our ~/.claude/skills/<id> symlinks and
     *  ~/.bismuth/skills (never a foreign entry). Idempotent + cheap; returns warnings. */
    removeLegacySkills(): string[]
    /** Register the MCP in the user's global Claude config (idempotent remove+add). */
    registerMcp(): Promise<{ ok: boolean; warning?: string }>
    /**
     * Register the MCP with every OTHER (non-Claude) agent CLI id the caller opted into — best
     * effort per id, keyed by registrar id, never throws (see core/src/agentBackends/mcpRegistrars.ts).
     * `ids` of `["all"]` registers with every detected registrar. Optional so existing InstallIO
     * fakes (tests) that predate this multi-CLI step keep type-checking unchanged.
     */
    registerAdditionalMcp?(
        ids: string[],
    ): Promise<Record<string, { ok: boolean; warning?: string }>>
    /** Detected/registered status for every OTHER agent CLI registrar. Optional for the same reason
     *  as registerAdditionalMcp. */
    additionalMcpStatus?(): Promise<Record<string, AdditionalMcpStatus>>
}

function sha256File(path: string): Promise<string> {
    return new Promise((res, rej) => {
        const h = createHash('sha256')
        const s = createReadStream(path)
        s.on('data', c => h.update(c))
        s.on('end', () => res(h.digest('hex')))
        s.on('error', rej)
    })
}

async function runClaude(
    bin: string,
    args: string[],
    timeoutMs = 15_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
        const proc = Bun.spawn([bin, ...args], {
            env: process.env,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const timer = setTimeout(() => proc.kill(), timeoutMs)
        try {
            const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ])
            return { code, stdout, stderr }
        } finally {
            clearTimeout(timer)
        }
    } catch (e) {
        return {
            code: -1,
            stdout: '',
            stderr: e instanceof Error ? e.message : String(e),
        }
    }
}

function isWritableDir(dir: string): boolean {
    try {
        mkdirSync(dir, { recursive: true })
        accessSync(dir, fsConstants.W_OK)
        return true
    } catch {
        return false
    }
}

/** Segment-aligned containment: `dest` IS `home` or lives under `home + '/'` — never a sibling that
 *  merely shares the prefix (`~/.bismuth-dev` is not under `~/.bismuth`). */
function underHome(dest: string, home: string): boolean {
    return dest === home || dest.startsWith(home + '/')
}

/** Is the symlink at `target` ours? By prefix (points into the current ~/.bismuth) OR by shape
 *  (`…/.bismuth/bin/bismuth` under ANY home — a link written before the account's home was
 *  renamed). Never true for a regular file, a directory or a lookalike path. */
export function isOurCliLink(target: string, bismuthHome: string): boolean {
    try {
        const st = lstatSync(target, { throwIfNoEntry: false })
        if (!st?.isSymbolicLink()) return false
        const dest = resolve(dirname(target), readlinkSync(target))
        return (
            underHome(dest, bismuthHome) ||
            isBismuthOwnedPath(dest, 'bin/bismuth')
        )
    } catch {
        return false // unreadable — skip
    }
}

/** Every CLI symlink among the candidate dirs that is ours (current OR old-home). */
export function findOurLinks(
    linkDirs: readonly string[],
    bismuthHome: string,
): string[] {
    return linkDirs
        .map(dir => join(dir, 'bismuth'))
        .filter(link => isOurCliLink(link, bismuthHome))
}

/** The ours-link that resolves to the CURRENT install's binary, or null. */
function findCurrentLink(): string | null {
    for (const link of findOurLinks(LINK_DIRS, BISMUTH_HOME)) {
        try {
            if (resolve(dirname(link), readlinkSync(link)) === CLI_DEST)
                return link
        } catch {
            // unreadable — skip
        }
    }
    return null
}

/**
 * Retire the skill install path of older builds: remove `<claudeSkillsDir>/<id>` for each
 * LEGACY_SKILL_IDS entry ONLY when it is a symlink pointing into `bismuthHome` or, by shape, at
 * `…/.bismuth/skills/<id>` under any (older) home (ours — same
 * "never touch a foreign file/dir/link" discipline as linkCli() and the mcpRegistrars.ts
 * isOurs() checks), then remove `<bismuthHome>/skills`. Runs on every ensure pass and from
 * uninstall; a no-op once nothing is left. Parameterized on both dirs so tests can exercise the
 * real fs against throwaway temp dirs, never the developer's actual ~/.claude. Never throws —
 * returns one warning per entry it could not remove.
 */
export function removeLegacySkills(
    bismuthHome: string,
    claudeSkillsDir: string,
): string[] {
    const warnings: string[] = []
    for (const id of LEGACY_SKILL_IDS) {
        const path = join(claudeSkillsDir, id)
        try {
            const st = lstatSync(path, { throwIfNoEntry: false })
            if (st?.isSymbolicLink()) {
                const dest = resolve(dirname(path), readlinkSync(path))
                if (
                    underHome(dest, bismuthHome) ||
                    isBismuthOwnedPath(dest, `skills/${id}`)
                )
                    unlinkSync(path)
            }
        } catch (e) {
            warnings.push(
                `failed to remove legacy Claude Code skill link ${id}: ${e instanceof Error ? e.message : String(e)}`,
            )
        }
    }
    try {
        rmSync(join(bismuthHome, 'skills'), { recursive: true, force: true })
    } catch (e) {
        warnings.push(
            `failed to remove legacy ${join(bismuthHome, 'skills')}: ${e instanceof Error ? e.message : String(e)}`,
        )
    }
    return warnings
}

/**
 * Args for `claude mcp add -s user bismuth …`, extracted as a pure function so registerMcp()'s
 * env wiring — BISMUTH_DOCS_DIR points at the INSTALLED docs path rather than a repo-relative
 * one, since a machine-wide install has no repo root — is unit-testable without spawning the
 * real `claude` binary.
 */
export function claudeMcpAddArgs(): string[] {
    return [
        'mcp',
        'add',
        '-s',
        'user',
        'bismuth',
        '-e',
        `BISMUTH_DOCS_DIR=${DOCS_DIR}`,
        '-e',
        `BISMUTH_CLI=${CLI_DEST}`,
        '--',
        MCP_DEST,
    ]
}

/** The real, default IO — does the actual fs + claude work. */
export const defaultIO: InstallIO = {
    async hashSrc(src) {
        const cli = join(src, 'bin', 'bismuth')
        const mcp = join(src, 'bin', 'bismuth-mcp')
        if (!existsSync(cli) || !existsSync(mcp)) return null
        return `${await sha256File(cli)}:${await sha256File(mcp)}`
    },
    readMarker() {
        try {
            return existsSync(MARKER)
                ? readFileSync(MARKER, 'utf8').trim() || null
                : null
        } catch {
            return null
        }
    },
    writeMarker(hash) {
        mkdirSync(BISMUTH_HOME, { recursive: true })
        writeFileSync(MARKER, hash)
    },
    cliLinked() {
        const path = findCurrentLink()
        return { linked: path != null && existsSync(CLI_DEST), path }
    },
    async mcpRegistered() {
        const claude = whichClaude()
        if (!claude) return false
        const r = await runClaude(claude, ['mcp', 'get', 'bismuth'])
        return r.code === 0
    },
    installFiles(src) {
        mkdirSync(BIN_DIR, { recursive: true })
        cpSync(join(src, 'bin'), BIN_DIR, { recursive: true })
        for (const f of [CLI_DEST, MCP_DEST])
            if (existsSync(f)) chmodSync(f, 0o755)
        rmSync(DOCS_DIR, { recursive: true, force: true })
        const docsSrc = join(src, 'docs')
        if (existsSync(docsSrc)) cpSync(docsSrc, DOCS_DIR, { recursive: true })
    },
    linkCli() {
        for (const dir of LINK_DIRS) {
            if (!isWritableDir(dir)) continue
            const target = join(dir, 'bismuth')
            try {
                const st = lstatSync(target, { throwIfNoEntry: false })
                if (st) {
                    // Ours by prefix or by shape (an old-home link) is replaced in place; a
                    // foreign file/symlink is never clobbered — try the next dir.
                    if (!isOurCliLink(target, BISMUTH_HOME)) continue
                    unlinkSync(target)
                }
                symlinkSync(CLI_DEST, target)
                return { ok: true, path: target }
            } catch {
                // not writable / race — try next dir
            }
        }
        return {
            ok: false,
            path: null,
            warning: 'no writable PATH dir for the bismuth CLI symlink',
        }
    },
    removeLegacySkills() {
        return removeLegacySkills(BISMUTH_HOME, CLAUDE_SKILLS_DIR)
    },
    async registerMcp() {
        const claude = whichClaude()
        if (!claude)
            return {
                ok: false,
                warning: 'claude not found on PATH — skipped MCP registration',
            }
        await runClaude(claude, ['mcp', 'remove', '-s', 'user', 'bismuth']) // ignore if absent
        const add = await runClaude(claude, claudeMcpAddArgs())
        if (add.code !== 0)
            return {
                ok: false,
                warning: `claude mcp add failed: ${add.stderr.trim() || add.stdout.trim()}`,
            }
        return { ok: true }
    },
    async registerAdditionalMcp(ids) {
        const spec: BismuthMcpSpec = {
            mcpBin: MCP_DEST,
            docsDir: DOCS_DIR,
            cliBin: CLI_DEST,
        }
        const wantAll = ids.includes('all')
        const out: Record<string, { ok: boolean; warning?: string }> = {}
        for (const registrar of MCP_REGISTRARS) {
            if (!wantAll && !ids.includes(registrar.id)) continue
            out[registrar.id] = await registrar.register(spec)
        }
        return out
    },
    async additionalMcpStatus() {
        const out: Record<string, AdditionalMcpStatus> = {}
        for (const registrar of MCP_REGISTRARS) {
            const detected = registrar.detect() != null
            out[registrar.id] = {
                label: registrar.label,
                detected,
                registered: detected ? await registrar.isRegistered() : false,
            }
        }
        return out
    },
}

/** Read-only status. Never throws. */
export async function getBismuthStatus(
    io: InstallIO = defaultIO,
): Promise<BismuthStatus> {
    const version = io.readMarker()
    const { linked, path } = io.cliLinked()
    let mcpRegistered = false
    try {
        mcpRegistered = await io.mcpRegistered()
    } catch {
        mcpRegistered = false
    }
    const additionalMcp = io.additionalMcpStatus
        ? await io.additionalMcpStatus()
        : undefined
    return {
        installed: version != null,
        version,
        cliPath: path,
        cliLinked: linked,
        mcpRegistered,
        additionalMcp,
    }
}

/**
 * Registration of Bismuth's MCP server with OTHER (non-Claude) agent CLIs. Runs only for CLIs the
 * user named — either on demand (`bismuth install --mcp <cli>`) or, on boot, for whatever is listed
 * in `mcp.registerWith` (naming a CLI there IS the opt-in). A CLI absent from both is never touched,
 * which is the whole point: Claude auto-registers because Bismuth is a Claude-first app, but writing
 * uninvited into someone's Codex or Gemini config is not ours to do.
 * `ids` of `["all"]` registers with every detected registrar. Best-effort per id; never throws.
 */
export async function registerAdditionalMcp(
    ids: string[],
    io: InstallIO = defaultIO,
): Promise<Record<string, { ok: boolean; warning?: string }>> {
    if (!io.registerAdditionalMcp) return {}
    return io.registerAdditionalMcp(ids)
}

/**
 * Version-gated, idempotent ensure. `src` = the install source dir (bin/ + docs/), normally
 * BISMUTH_INSTALL_SRC. No-op when the bundled-binary hash matches the stored marker AND
 * the CLI symlink + MCP registration are present — apart from the legacy-skill cleanup, which
 * runs on every non-dry pass (a machine already at the current hash still gets cleaned).
 * Never throws — failures surface as warnings.
 */
export async function ensureBismuthInstalled(
    src: string | undefined,
    io: InstallIO = defaultIO,
    opts: { dryRun?: boolean; registerWith?: string[] } = {},
): Promise<InstallResult> {
    const status0 = await getBismuthStatus(io)
    if (!src) return { action: 'skipped-no-src', status: status0, warnings: [] }

    const hash = await io.hashSrc(src)
    if (!hash)
        return { action: 'skipped-no-src', status: status0, warnings: [] }

    const wasInstalled = status0.version != null
    if (
        status0.version === hash &&
        status0.cliLinked &&
        status0.mcpRegistered
    ) {
        const warnings = opts.dryRun ? [] : io.removeLegacySkills()
        return { action: 'up-to-date', status: status0, warnings }
    }
    if (opts.dryRun) {
        return {
            action: wasInstalled ? 'would-update' : 'would-install',
            status: status0,
            warnings: [],
        }
    }

    const warnings: string[] = []
    io.installFiles(src)
    const link = io.linkCli()
    if (link.warning) warnings.push(link.warning)
    warnings.push(...io.removeLegacySkills())
    const mcp = await io.registerMcp()
    if (mcp.warning) warnings.push(mcp.warning)
    // Other CLIs the user LISTED in `mcp.registerWith`. Naming a CLI there is the explicit opt-in —
    // the setting would be a footgun otherwise: a user who adds "codex", restarts, and finds nothing
    // registered has been silently ignored. So consent recorded in settings is acted on here, while a
    // CLI absent from the list is still never touched. Best-effort + idempotent, like every step above.
    if (opts.registerWith?.length) {
        const results = await registerAdditionalMcp(opts.registerWith, io)
        for (const [id, r] of Object.entries(results)) {
            if (r.warning) warnings.push(`${id}: ${r.warning}`)
        }
    }
    io.writeMarker(hash)

    const status = await getBismuthStatus(io)
    return { action: wasInstalled ? 'updated' : 'installed', status, warnings }
}

/** Remove the daemon service, every CLI symlink that is ours, the global MCP registration, and ~/.bismuth. Never throws. */
export async function uninstallBismuth(): Promise<{
    removed: boolean
    warnings: string[]
}> {
    const warnings: string[] = []
    // First, unload the daemon service: it is KeepAlive, so deleting ~/.bismuth/bin/bismuth-daemon
    // out from under it would leave it crash-looping on a missing binary.
    warnings.push(
        ...(await removeServiceUnit(
            { platform: process.platform, home: homedir(), exec: defaultExec },
            BISMUTH_DAEMON_UNIT,
        )),
    )
    for (const link of findOurLinks(LINK_DIRS, BISMUTH_HOME)) {
        try {
            unlinkSync(link)
        } catch (e) {
            warnings.push(
                `failed to remove CLI symlink ${link}: ${e instanceof Error ? e.message : String(e)}`,
            )
        }
    }
    // Same reasoning as the "other CLI" registrars below: don't leave dangling
    // ~/.claude/skills/<id> symlinks (from older builds) pointing into ~/.bismuth/skills, which is
    // about to be deleted. Only removes OUR symlinks — a foreign entry stays untouched.
    warnings.push(...removeLegacySkills(BISMUTH_HOME, CLAUDE_SKILLS_DIR))
    try {
        const claude = whichClaude()
        if (claude)
            await runClaude(claude, ['mcp', 'remove', '-s', 'user', 'bismuth'])
    } catch {
        // best-effort
    }
    // Best-effort: reverse any of the opt-in "other CLI" registrations too, so an uninstall doesn't
    // leave a dangling ~/.codex/~/.cline/~/.openclaw/~/.gemini/~/.qwen/~/.copilot/~/.config/amp/
    // ~/.factory/~/.config/crush/~/.config/goose entry pointing at a bin dir that's about to be
    // deleted. Each registrar's own unregister() already no-ops when we never registered it (or
    // it's a foreign entry), so this is safe to run unconditionally.
    for (const registrar of MCP_REGISTRARS) {
        try {
            await registrar.unregister()
        } catch {
            // best-effort
        }
    }
    try {
        rmSync(BISMUTH_HOME, { recursive: true, force: true })
    } catch (e) {
        warnings.push(
            `failed to remove ${BISMUTH_HOME}: ${e instanceof Error ? e.message : String(e)}`,
        )
    }
    return { removed: true, warnings }
}
