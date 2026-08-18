// Pure skills index/read over the repo's skills/ tree — the MCP-side adapter that makes Bismuth's
// skills reachable from every agent backend, not just Claude Code. Claude Code discovers skills
// itself via ~/.claude/skills/; the other eight backends (opencode, codex, cline, gemini, goose,
// openclaw, and the ACP variants) have no such mechanism, so MCP is the one surface all nine share.
// Mirrors docs.ts's shape (including its path-traversal rejection) on purpose — same repo, same
// pattern, one thing for a reader to already know. No external deps — node:fs + node:path only.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export interface SkillInfo {
    name: string
    description: string
}

// --- internal helpers -------------------------------------------------------

/**
 * Parse the `name`/`description` fields out of a SKILL.md's YAML frontmatter
 * (delimited by `---` lines). Deliberately not a full YAML parser — the
 * frontmatter here is flat `key: value` pairs, same assumption docs.ts's
 * heading parser makes about its own input shape.
 */
function parseFrontmatter(text: string): {
    name?: string
    description?: string
} {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!m) return {}
    const result: { name?: string; description?: string } = {}
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^(name|description):\s*(.*)$/.exec(line)
        if (!kv) continue
        const value = kv[2].trim().replace(/^["']|["']$/g, '')
        if (kv[1] === 'name') result.name = value
        else result.description = value
    }
    return result
}

/** Resolve `target` under `root`, throwing if it would escape (path traversal). */
function resolveWithin(root: string, relPath: string): string {
    const target = resolve(root, relPath)
    const rootWithSep = root.endsWith(sep) ? root : root + sep
    if (target !== root && !target.startsWith(rootWithSep)) {
        throw new Error(`Path traversal rejected: ${relPath}`)
    }
    return target
}

// --- public API -------------------------------------------------------------

/**
 * List every skill under `root` (each a directory containing a SKILL.md) as
 * {name, description}, sourced from that SKILL.md's frontmatter. A skill
 * missing a `name` field falls back to its directory name.
 */
export function listSkills(root: string): SkillInfo[] {
    const skillsRoot = resolve(root)
    let entries
    try {
        entries = readdirSync(skillsRoot, { withFileTypes: true })
    } catch {
        return []
    }

    const result: SkillInfo[] = []
    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMd = join(skillsRoot, entry.name, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        let text = ''
        try {
            text = readFileSync(skillMd, 'utf8')
        } catch {
            continue
        }
        const fm = parseFrontmatter(text)
        result.push({
            name: fm.name ?? entry.name,
            description: fm.description ?? '',
        })
    }

    result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return result
}

/**
 * Read a skill's SKILL.md (default) or one of its `references/<reference>.md`
 * files. Rejects path traversal on both `name` and `reference` the same way
 * docs.ts's readDoc rejects it on a doc path — neither is trusted input.
 */
export function readSkill(
    root: string,
    name: string,
    reference?: string,
): string {
    const skillsRoot = resolve(root)
    const skillDir = resolveWithin(skillsRoot, name)

    const target =
        reference === undefined
            ? join(skillDir, 'SKILL.md')
            : resolveWithin(skillDir, join('references', `${reference}.md`))

    if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(
            reference === undefined
                ? `Skill not found: ${name}`
                : `Reference not found in ${name}: ${reference}`,
        )
    }

    return readFileSync(target, 'utf8')
}
