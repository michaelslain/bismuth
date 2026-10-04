import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveCommand } from '../src/registry'

// A guide that tells an agent to run `bismuth <phrase>` for a command that does not exist (or was
// renamed) fails at the worst moment: the agent was told to trust the guide (mcp/src/instructions.ts).
// This walks every guide markdown file, pulls every `bismuth ...` phrase out of code (inline spans + fenced lines) and demands the
// real dispatcher resolves it — resolveCommand is the SAME matcher the binary uses.

const REPO_ROOT = join(import.meta.dir, '..', '..')
const GUIDE_ROOTS = [
    join(REPO_ROOT, 'docs', 'bases', 'authoring.md'),
    join(REPO_ROOT, 'docs', 'bases', 'authoring'),
    join(REPO_ROOT, 'docs', 'guides'),
]

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

/** The text of every inline code span and every line inside a fenced block. */
function codeFragments(md: string): string[] {
    const out: string[] = []
    let fence: string | null = null
    for (const line of md.split('\n')) {
        const f = line.match(/^\s*(```+|~~~+)/)
        if (f) {
            if (fence === null) fence = f[1]
            else if (f[1].startsWith(fence)) fence = null
            continue
        }
        if (fence !== null) {
            out.push(line)
            continue
        }
        for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1])
    }
    return out
}

const PHRASE = /(?:^|[\s;|&($])bismuth ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*){0,2})/g

describe('codeFragments + the phrase matcher', () => {
    test('finds a command in an inline span and a fenced line, ignores prose', () => {
        const md = 'prose bismuth nothing\nrun `bismuth base validate x.md` now\n```sh\nbismuth task list --vault v\n```\n'
        const found = codeFragments(md).flatMap(f =>
            [...f.matchAll(PHRASE)].map(m => m[1]),
        )
        expect(found).toEqual(['base validate x', 'task list'])
    })

    test('a longer fence is not closed by a shorter run of the same character', () => {
        const md = '````md\n```sh\nbismuth task list\n```\nbismuth base validate x\n````\nafter `bismuth note read` done\n'
        expect(codeFragments(md)).toEqual([
            'bismuth task list',
            'bismuth base validate x',
            'bismuth note read',
        ])
    })

    test('bismuth_docs_read (underscore) is not a command phrase', () => {
        expect([...'call bismuth_docs_read now'.matchAll(PHRASE)]).toEqual([])
    })
})

describe('every `bismuth ...` command a guide shows resolves in the registry', () => {
    test('no guide cites an unknown command', () => {
        const bad: string[] = []
        for (const file of GUIDE_ROOTS.flatMap(markdownFilesUnder)) {
            for (const frag of codeFragments(readFileSync(file, 'utf-8'))) {
                for (const m of frag.matchAll(PHRASE)) {
                    const words = m[1].split(' ')
                    if (resolveCommand(words) === null)
                        bad.push(
                            `${relative(REPO_ROOT, file)}: \`bismuth ${m[1]}\` resolves to no registered command`,
                        )
                }
            }
        }
        expect(bad).toEqual([])
    })
})
