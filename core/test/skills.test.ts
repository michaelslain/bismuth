import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { VIEW_TYPES } from '../src/bases/types'
import { SKILL_IDS } from '../src/bismuthInstall'

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

// --- Every shipped skill ------------------------------------------------------------------
// Delivery (core/src/bismuthInstall.ts SKILL_IDS) and the skills/ tree must never drift apart, and
// every doc a skill cites must exist — a skill that sends an agent to a missing page is a silent
// failure at the exact moment the agent trusts it.

const SKILLS_ROOT = join(REPO_ROOT, 'skills')

function skillDirs(): string[] {
    return readdirSync(SKILLS_ROOT, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
}

function frontmatterOf(text: string): Record<string, string> {
    const m = text.match(/^---\n([\s\S]*?)\n---/)
    const out: Record<string, string> = {}
    if (!m) return out
    for (const line of m[1].split('\n')) {
        const kv = line.match(/^([\w-]+):\s*(.*)$/)
        if (kv) out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2')
    }
    return out
}

function markdownFilesUnder(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) out.push(...markdownFilesUnder(full))
        else if (e.name.endsWith('.md')) out.push(full)
    }
    return out
}

// Repo-relative docs/**/*.md citations in a skill's text. URLs are stripped
// first: a link into another project's own docs (e.g. .../main/docs/X.md) is
// not a citation of this repo's docs/ and must not be checked against it.
function citedDocs(text: string): string[] {
    const stripped = text.replace(/https?:\/\/\S+/g, ' ')
    return [...stripped.matchAll(/\bdocs\/[\w./-]+\.md\b/g)].map(m =>
        m[0].replace(/[.)]+$/, ''),
    )
}

describe('every shipped skill', () => {
    test('the directories under skills/ are exactly SKILL_IDS', () => {
        expect(skillDirs()).toEqual([...SKILL_IDS])
    })

    for (const id of SKILL_IDS) {
        test(`${id}: frontmatter name matches the dir, description is 1..1024 chars`, () => {
            const fm = frontmatterOf(
                readFileSync(join(SKILLS_ROOT, id, 'SKILL.md'), 'utf-8'),
            )
            expect(fm.name).toBe(id)
            expect((fm.description ?? '').length).toBeGreaterThan(0)
            expect(fm.description.length).toBeLessThanOrEqual(1024)
        })

        test(`${id}: references/ is flat (the MCP reads by bare name)`, () => {
            const refs = join(SKILLS_ROOT, id, 'references')
            if (!existsSync(refs)) return
            const nested = readdirSync(refs, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name)
            expect(nested).toEqual([])
        })
    }

    test('every docs/**/*.md path a skill cites exists on disk', () => {
        const missing: string[] = []
        for (const file of markdownFilesUnder(SKILLS_ROOT)) {
            const text = readFileSync(file, 'utf-8')
            for (const token of citedDocs(text)) {
                if (!existsSync(join(REPO_ROOT, token)))
                    missing.push(
                        `${relative(REPO_ROOT, file)} cites ${token} (no such file)`,
                    )
            }
        }
        expect(missing).toEqual([])
    })
})

describe('citedDocs', () => {
    test('ignores docs/ paths inside URLs, still reports bare ones', () => {
        const text =
            'see (https://raw.githubusercontent.com/o/r/main/docs/x.md) and docs/nonexistent-zzz.md here'
        expect(citedDocs(text)).toEqual(['docs/nonexistent-zzz.md'])
    })
})
