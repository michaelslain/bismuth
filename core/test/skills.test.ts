import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { VIEW_TYPES } from '../src/bases/types'

// Repo root: core/test/skills.test.ts -> ../.. -> repo root.
const REPO_ROOT = join(import.meta.dir, '..', '..')
const SKILL_DIR = join(REPO_ROOT, 'skills', 'authoring-bismuth-bases')
const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
const REFERENCES_DIR = join(SKILL_DIR, 'references')

function skillMdText(): string {
    return readFileSync(SKILL_MD, 'utf-8')
}

function referenceFiles(): string[] {
    return readdirSync(REFERENCES_DIR).filter(f => f.endsWith('.md'))
}

test('SKILL.md has name + description frontmatter', () => {
    const text = skillMdText()
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/)
    expect(fmMatch).not.toBeNull()
    const frontmatter = fmMatch![1]
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
    expect(nameMatch).not.toBeNull()
    expect(nameMatch![1].trim()).toBe('authoring-bismuth-bases')
    expect(descMatch).not.toBeNull()
    expect(descMatch![1].trim().length).toBeGreaterThan(0)
})

test('exactly one reference file per VIEW_TYPES entry (no missing, no extra)', () => {
    const expected = new Set(VIEW_TYPES as readonly string[])
    const actual = new Set(referenceFiles().map(f => f.replace(/\.md$/, '')))
    expect(actual).toEqual(expected)
})

test('every reference file points at a docs/bases/views/*.md page that exists on disk', () => {
    for (const kind of VIEW_TYPES) {
        const refPath = join(REFERENCES_DIR, `${kind}.md`)
        expect(existsSync(refPath)).toBe(true)

        const text = readFileSync(refPath, 'utf-8')
        const pointerMatch = text.match(/docs\/bases\/views\/[\w-]+\.md/)
        expect(pointerMatch).not.toBeNull()

        const docsRelPath = pointerMatch![0] // e.g. "docs/bases/views/kanban.md"
        const docsAbsPath = join(REPO_ROOT, docsRelPath)
        expect(existsSync(docsAbsPath)).toBe(true)
    }
})

test('SKILL.md mentions every view kind', () => {
    const text = skillMdText()
    for (const kind of VIEW_TYPES) {
        // Match the kind as a standalone token (backticked or bare) so e.g. "bar" doesn't
        // false-positive on substrings — VIEW_TYPES entries are all short, distinct words,
        // so a word-boundary regex is sufficient without needing a full markdown parser.
        const re = new RegExp(`\\b${kind}\\b`)
        expect(re.test(text)).toBe(true)
    }
})
