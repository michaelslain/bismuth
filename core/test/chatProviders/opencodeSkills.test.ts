// The vault's skills as the compact profile's lean text.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vaultSkillNote } from '../../src/chatProviders/opencode/opencodeSkills'
import { tempDir } from '../tempDirs'

describe('vaultSkillNote', () => {
    test('names each skill with its description and path', () => {
        const v = tempDir('bismuth-oc-skills-')
        mkdirSync(join(v, '.claude/skills/bench-skill'), { recursive: true })
        writeFileSync(
            join(v, '.claude/skills/bench-skill/SKILL.md'),
            '---\nname: bench-skill\ndescription: Use when the bench asks for the bench skill.\n---\n\n# x\n',
        )
        const note = vaultSkillNote(v)
        expect(note).toContain('- bench-skill: Use when the bench asks for the bench skill.')
        expect(note).toContain('.claude/skills/bench-skill/SKILL.md')
        // Far under opencode's ~1,340-token skill tool.
        expect(note.length).toBeLessThan(400)
    })

    test('a vault with no skills gives no note', () => {
        expect(vaultSkillNote(tempDir('bismuth-oc-noskills-'))).toBe('')
    })
})
