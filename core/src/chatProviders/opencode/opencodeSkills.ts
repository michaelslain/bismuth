// core/src/chatProviders/opencode/opencodeSkills.ts
// The vault's skills as Bismuth's own lean text. The compact opencode profile denies opencode's
// `skill` tool, whose schema and listing cost about 1,340 tokens beside the one skill a vault has;
// this names each skill in a line instead, and the model reads the SKILL.md with its read tool.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../../frontmatter'

/** Most skills named: a vault with more gets the first of them, so the note stays small. */
const MAX_SKILLS = 12
/** Longest description kept per skill, in characters. */
const MAX_DESCRIPTION = 120

/** The note naming the vault's skills (`.claude/skills/<name>/SKILL.md`), or '' when it has none.
 *  Never throws. */
export function vaultSkillNote(cwd: string): string {
    const root = join(cwd, '.claude', 'skills')
    const lines: string[] = []
    try {
        if (!existsSync(root)) return ''
        for (const dir of readdirSync(root).sort()) {
            const file = join(root, dir, 'SKILL.md')
            if (!existsSync(file)) continue
            const fm = parseFrontmatter(readFileSync(file, 'utf8')).data
            const name = typeof fm?.name === 'string' ? fm.name : dir
            const raw = typeof fm?.description === 'string' ? fm.description : ''
            const desc = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION)
            lines.push(`- ${name}${desc ? `: ${desc}` : ''} (.claude/skills/${dir}/SKILL.md)`)
            if (lines.length >= MAX_SKILLS) break
        }
    } catch {
        return ''
    }
    if (lines.length === 0) return ''
    return `Skills in this vault (read a skill's SKILL.md before using it):\n${lines.join('\n')}`
}
