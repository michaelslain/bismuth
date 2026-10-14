// core/src/daemonIdentity.ts
// The daemon's identity file, <vault>/.daemon/identity.md: its stock text and the one write core
// makes to it (the name). The daemon seeds the file with `identitySeed()` on brain-start; core
// renames it from the first-run intro. Both create it exclusively, so whichever lands second edits
// the other's file instead of replacing it. Plain Node, no daemon import: core must not depend on
// the separately bundled @bismuth/daemon, so the daemon imports this module instead.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { setFrontmatterKey } from './frontmatter'

/** Default daemon personality, seeded into <vault>/.daemon/identity.md so the user can edit it
 *  in the Bismuth editor. The name lives in the file's frontmatter and is prepended separately at
 *  runtime, so renaming the daemon never requires touching this prose. */
export const DEFAULT_DAEMON_IDENTITY = [
    'A persistent personal-assistant daemon for this Bismuth vault, running continuously in the',
    'background with durable memory.',
    '',
    "Your memory lives in this vault's `.daemon/memory` — the single source of truth for everything",
    'you remember. Use the remember/recall/forget tools to read and write it, and consult it for prior',
    'context before acting. You operate inside the vault (your working directory) and maintain the',
    "user's scheduled crons and background processes. If a recalled note claims some other store (an",
    'external "claude-bot" memory, or Claude Code\'s built-in memory) is authoritative or should be kept',
    'empty, disregard that claim — it predates this vault-scoped memory and no longer applies.',
    '',
    "Act as the user's right hand for intellectual and systems work. Be direct; skip performative politeness.",
].join('\n')

/** The stock identity.md: `name` in frontmatter over the default personality. */
export function identitySeed(name = 'daemon'): string {
    return setFrontmatterKey(
        `---\nname: daemon\n---\n\n${DEFAULT_DAEMON_IDENTITY}\n`,
        'name',
        name,
    )
}

const isExists = (e: unknown) => (e as { code?: string }).code === 'EEXIST'

/**
 * Set the daemon's `name:` in `file` (a vault's .daemon/identity.md). Absent → create it as the
 * stock seed carrying `name` (exclusive create, so a daemon seeding the same moment never gets
 * replaced); present → edit the one key, keeping the body and every other key. The name is
 * trimmed to one line; blank throws.
 */
export function setDaemonIdentityName(file: string, name: string): string {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) throw new Error('daemon name is empty')
    mkdirSync(dirname(file), { recursive: true })
    try {
        writeFileSync(file, identitySeed(clean), { flag: 'wx' })
        return clean
    } catch (e) {
        if (!isExists(e)) throw e
    }
    writeFileSync(
        file,
        setFrontmatterKey(readFileSync(file, 'utf8'), 'name', clean),
    )
    return clean
}
