import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { VIEW_TYPES } from '../src/bases/types'

// The agent guides live in docs/ and are reached through the MCP server instructions +
// bismuth_docs_read (mcp/src/instructions.ts). They are the pages an agent trusts most — it was
// TOLD to read them before acting — so they get drift tests ordinary docs pages do not.

// Repo root: core/test/guides.test.ts -> ../.. -> repo root.
const REPO_ROOT = join(import.meta.dir, '..', '..')
const AUTHORING_MD = join(REPO_ROOT, 'docs', 'bases', 'authoring.md')
const REFERENCES_DIR = join(REPO_ROOT, 'docs', 'bases', 'authoring')
const GUIDE_ROOTS = [
    AUTHORING_MD,
    REFERENCES_DIR,
    join(REPO_ROOT, 'docs', 'guides'),
]

function authoringMdText(): string {
    return readFileSync(AUTHORING_MD, 'utf-8')
}

function referenceFiles(): string[] {
    return readdirSync(REFERENCES_DIR).filter(f => f.endsWith('.md'))
}

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

// bases/authoring.md tells agents every kind page has these three sections, so
// `bismuth_docs_read {path, section}` can fetch just one — the promise has to hold.
test('every kind page has Working example, Config keys and Failure modes sections', () => {
    for (const kind of VIEW_TYPES) {
        const text = readFileSync(join(REFERENCES_DIR, `${kind}.md`), 'utf-8')
        for (const h of ['## Working example', '## Config keys', '## Failure modes'])
            expect(text.split('\n').includes(h), `${kind}.md lacks ${h}`).toBe(true)
    }
})

test('bases/authoring.md mentions every view kind', () => {
    const text = authoringMdText()
    for (const kind of VIEW_TYPES) {
        // Match the kind as a standalone token (backticked or bare) so e.g. "bar" doesn't
        // false-positive on substrings — VIEW_TYPES entries are all short, distinct words,
        // so a word-boundary regex is sufficient without needing a full markdown parser.
        const re = new RegExp(`\\b${kind}\\b`)
        expect(re.test(text)).toBe(true)
    }
})

// --- Every guide page --------------------------------------------------------------------
// Every doc a guide cites must exist — a guide that sends an agent to a missing page is a silent
// failure at the exact moment the agent trusts it.

function markdownFilesUnder(path: string): string[] {
    if (!statSync(path).isDirectory()) return [path]
    const out: string[] = []
    for (const e of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, e.name)
        if (e.isDirectory()) out.push(...markdownFilesUnder(full))
        else if (e.name.endsWith('.md')) out.push(full)
    }
    return out
}

// Repo-relative docs/**/*.md citations in a guide's text. URLs are stripped
// first: a link into another project's own docs (e.g. .../main/docs/X.md) is
// not a citation of this repo's docs/ and must not be checked against it.
function citedDocs(text: string): string[] {
    const stripped = text.replace(/https?:\/\/\S+/g, ' ')
    return [...stripped.matchAll(/\bdocs\/[\w./-]+\.md\b/g)].map(m =>
        m[0].replace(/[.)]+$/, ''),
    )
}

describe('every guide page', () => {
    test('every docs/**/*.md path a guide cites exists on disk', () => {
        const missing: string[] = []
        for (const file of GUIDE_ROOTS.flatMap(markdownFilesUnder)) {
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

    test('no guide still points at the retired skill surface', () => {
        const stale: string[] = []
        for (const file of GUIDE_ROOTS.flatMap(markdownFilesUnder)) {
            const text = readFileSync(file, 'utf-8')
            for (const bad of ['bismuth_skill', 'SKILL.md', 'references/', '.bismuth/skills'])
                if (text.includes(bad))
                    stale.push(`${relative(REPO_ROOT, file)} mentions ${bad}`)
        }
        expect(stale).toEqual([])
    })
})

describe('citedDocs', () => {
    test('ignores docs/ paths inside URLs, still reports bare ones', () => {
        const text =
            'see (https://raw.githubusercontent.com/o/r/main/docs/x.md) and docs/nonexistent-zzz.md here'
        expect(citedDocs(text)).toEqual(['docs/nonexistent-zzz.md'])
    })
})
