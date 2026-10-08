#!/usr/bin/env bun
// Docs gate — six cheap, deterministic checks (no LLM):
//   1. LINK CHECK (blocking): every relative .md link under docs/ (and from CLAUDE.md
//      into docs/) must resolve. Exits non-zero on any broken link.
//   1b. ANCHOR CHECK (blocking): every `page.md#heading` and same-page `#heading` link names a
//      heading that exists on the target page — a renamed heading otherwise breaks silently.
//   1c. HISTORY LINT (blocking): docs describe what IS. History words ("no longer", "was
//      removed", "legacy", …), backticked commit hashes and issue numbers fail outside the one
//      page that owns migrations (MIGRATION_PAGES) — an agent reading one section cannot tell a
//      removed name from a live one.
//   2. CITED COMMANDS (blocking): every `bun run <token>` cited in CLAUDE.md must name a
//      script that actually exists in root package.json or a workspace's package.json.
//      Skips file-path tokens (`bun run core/src/server.ts` runs a file, not a script).
//   3. WORKSPACE PARITY (blocking): every workspace directory in root package.json's
//      `workspaces` array must be mentioned by name somewhere in CLAUDE.md.
//   4. STALENESS WARNING (non-blocking, --pre-push only): if the pushed commit range
//      touched core/app/cli source but no docs/** or CLAUDE.md, print a reminder to
//      run /update-docs. Never blocks — docs regen is a deliberate step, not automatic.
//
// Usage: `bun run scripts/check-docs.ts` (checks 1-3) | `... --pre-push` (checks 1-4).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative, basename } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = resolve(import.meta.dir, '..')
const DOCS = join(ROOT, 'docs')

function walk(dir: string): string[] {
    const out: string[] = []
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
        const p = join(dir, name)
        const s = statSync(p)
        if (s.isDirectory()) out.push(...walk(p))
        else if (name.endsWith('.md')) out.push(p)
    }
    return out
}

// Pull relative .md link targets out of markdown text (skips http(s), strips #anchors). Fenced
// blocks and inline code spans are dropped first: a link shown AS AN EXAMPLE (the conversion
// guides quote Obsidian's `[t](Other%20Note.md)`) is text, not a link, and must not be checked.
function mdLinks(md: string): string[] {
    const text = md
        .replace(/^(\s*)(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, '')
        .replace(/`[^`\n]+`/g, '')
    const out: string[] = []
    for (const m of text.matchAll(/\]\(([^)]+?\.md)(#[^)]*)?\)/g)) {
        const target = m[1]
        if (/^https?:\/\//.test(target)) continue
        out.push(target)
    }
    return out
}

// Blank out every line inside a fenced block (fence lines included), keeping the line count so
// line numbers still match. Line-based: a closing fence is the same character, at least as long.
function blankFences(md: string): string {
    let open: string | null = null
    return md
        .split('\n')
        .map(line => {
            const m = /^\s*(`{3,}|~{3,})/.exec(line)
            if (open === null) {
                if (m) {
                    open = m[1]
                    return ''
                }
                return line
            }
            if (m && m[1][0] === open[0] && m[1].length >= open.length && /^\s*[`~]+\s*$/.test(line))
                open = null
            return ''
        })
        .join('\n')
}

// Markdown with fenced blocks and inline code spans removed — examples are text, not prose.
function proseOnly(md: string): string {
    return blankFences(md).replace(/`[^`\n]+`/g, '')
}

// GitHub-style heading slug. Runs of `-` are collapsed so a link written by GitHub's rule
// ("a — b" → "a--b") and one written by the MCP server's rule ("a-b") compare equal.
function slug(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .replace(/[^a-z0-9 \-]/g, '')
        .trim()
        .replace(/[\s-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

// Every heading slug on a page, with GitHub's -1/-2 suffixes for repeats. Headings inside
// fenced blocks are not headings.
function headingSlugs(md: string): Set<string> {
    const out = new Set<string>()
    const seen = new Map<string, number>()
    for (const m of blankFences(md).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
        const base = slug(m[1])
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        out.add(n === 0 ? base : `${base}-${n}`)
    }
    return out
}

// `[t](page.md#anchor)` and `[t](#anchor)` links outside code, as {target, anchor}; target ''
// means the same page.
function anchorLinks(md: string): { target: string; anchor: string }[] {
    const out: { target: string; anchor: string }[] = []
    for (const m of proseOnly(md).matchAll(/\]\(([^)\s#]*?)#([^)\s]+)\)/g)) {
        const target = m[1]
        if (/^https?:\/\//.test(target)) continue
        if (target && !target.endsWith('.md')) continue
        out.push({ target, anchor: m[2] })
    }
    return out
}

function checkAnchors(): string[] {
    const broken: string[] = []
    const files = walk(DOCS)
    if (existsSync(join(ROOT, 'CLAUDE.md'))) files.push(join(ROOT, 'CLAUDE.md'))
    const cache = new Map<string, Set<string>>()
    const slugsOf = (path: string) => {
        if (!cache.has(path)) cache.set(path, headingSlugs(readFileSync(path, 'utf8')))
        return cache.get(path)!
    }
    for (const f of files) {
        for (const { target, anchor } of anchorLinks(readFileSync(f, 'utf8'))) {
            const path = target ? resolve(dirname(f), target) : f
            if (!existsSync(path)) continue // checkLinks reports the missing page
            if (!slugsOf(path).has(slug(decodeURIComponent(anchor))))
                broken.push(`${relative(ROOT, f)} → ${target}#${anchor}`)
        }
    }
    return broken
}

// The one page allowed to talk about the past: what a user with an older install or vault must do.
const MIGRATION_PAGES = new Set(['overview/migrating.md'])

const HISTORY = [
    /\bno longer\b/i,
    /\b(was|were|has been|have been) (removed|deleted|dropped|retired)\b/i,
    /\b(is|are|now) gone\b/i,
    /\bused to be\b/i,
    /\bpreviously\b/i,
    /\bformerly\b/i,
    /\bvestigial\b/i,
    /\bepitaph\b/i,
    /\blegacy\b/i,
    /\b[0-9a-f]{7,12}\b(?=[^\n]*\bcommit)|\bcommit [0-9a-f]{7,12}\b/i,
    /(^|[\s(])(pre-)?#\d{2,4}\b/,
]

// Lines of prose (code stripped) that narrate history, as "file:line: text".
function historyLines(md: string): { line: number; text: string }[] {
    const out: { line: number; text: string }[] = []
    proseOnly(md)
        .split('\n')
        .forEach((text, i) => {
            if (HISTORY.some(re => re.test(text)))
                out.push({ line: i + 1, text: text.trim().slice(0, 140) })
        })
    return out
}

function checkHistory(): string[] {
    const hits: string[] = []
    for (const f of walk(DOCS)) {
        const rel = relative(DOCS, f)
        if (MIGRATION_PAGES.has(rel)) continue
        for (const h of historyLines(readFileSync(f, 'utf8')))
            hits.push(`docs/${rel}:${h.line}: ${h.text}`)
    }
    return hits
}

function checkLinks(): string[] {
    const broken: string[] = []
    const files = walk(DOCS)
    // CLAUDE.md may link into docs/ too — include it.
    if (existsSync(join(ROOT, 'CLAUDE.md'))) files.push(join(ROOT, 'CLAUDE.md'))
    for (const f of files) {
        for (const link of mdLinks(readFileSync(f, 'utf8'))) {
            const targetPath = resolve(dirname(f), link)
            if (!existsSync(targetPath))
                broken.push(`${relative(ROOT, f)} → ${link}`)
        }
    }
    return broken
}

// Every `bun run <token>` cited anywhere in CLAUDE.md's text (code fences included). The token
// stops at whitespace OR a backtick, so an inline-code citation like `` `bun run typecheck` ``
// yields `typecheck`, not `typecheck\``. Skips file-path tokens (contain `/` or end in .ts/.js —
// those run a file, not a script) and bare flags (`--`, or starting with `-`).
function citedScripts(claudeText: string): string[] {
    const out: string[] = []
    for (const m of claudeText.matchAll(/bun run ([^\s`]+)/g)) {
        const token = m[1]
        if (token === '--' || token.startsWith('-')) continue
        if (token.includes('/') || token.endsWith('.ts') || token.endsWith('.js'))
            continue
        out.push(token)
    }
    return out
}

// Resolve root package.json's `workspaces` array to directory names, relative to root.
// A plain entry ("core") is used as-is; a trailing "/*" glob ("packages/*") is expanded by
// listing that directory's subdirectories.
function workspaceDirs(root: string): string[] {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const workspaces: string[] = pkg.workspaces || []
    const dirs: string[] = []
    for (const entry of workspaces) {
        if (entry.endsWith('/*')) {
            const base = entry.slice(0, -2)
            const baseDir = join(root, base)
            if (!existsSync(baseDir)) continue
            for (const name of readdirSync(baseDir)) {
                if (statSync(join(baseDir, name)).isDirectory())
                    dirs.push(`${base}/${name}`)
            }
        } else {
            dirs.push(entry)
        }
    }
    return dirs
}

// Every script name defined in root package.json or any workspace's package.json.
function definedScripts(root: string): Set<string> {
    const out = new Set<string>()
    const addFrom = (pkgPath: string) => {
        if (!existsSync(pkgPath)) return
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        for (const name of Object.keys(pkg.scripts || {})) out.add(name)
    }
    addFrom(join(root, 'package.json'))
    for (const dir of workspaceDirs(root)) addFrom(join(root, dir, 'package.json'))
    return out
}

// Cited tokens that no package.json (root or workspace) defines as a script.
function missingScripts(cited: string[], defined: Set<string>): string[] {
    const out: string[] = []
    for (const token of cited) {
        if (!defined.has(token) && !out.includes(token)) out.push(token)
    }
    return out
}

// Workspace dirs whose bare name (last path segment) never appears as a whole word in CLAUDE.md.
function unmentionedWorkspaces(claudeText: string, dirs: string[]): string[] {
    const out: string[] = []
    for (const dir of dirs) {
        const name = basename(dir)
        const re = new RegExp(`\\b${name}\\b`)
        if (!re.test(claudeText)) out.push(name)
    }
    return out
}

function changedFiles(range: string): string[] {
    try {
        return execSync(`git diff --name-only ${range}`, {
            cwd: ROOT,
            encoding: 'utf8',
        })
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
    } catch {
        return []
    }
}

function staleness(): string | null {
    // What's about to be pushed to main. If origin/main is unknown, skip silently.
    let range = 'origin/main..HEAD'
    try {
        execSync('git rev-parse --verify origin/main', {
            cwd: ROOT,
            stdio: 'ignore',
        })
    } catch {
        return null
    }
    const changed = changedFiles(range)
    if (changed.length === 0) return null
    // memory/ and daemon/ are listed too: both are real source workspaces added after this regex was
    // written, so source changes there used to slip past the "you changed code but no docs" warning.
    const SOURCE = /^((core|app|cli|mcp|memory|daemon)\/src\/|relay\/)/
    const touchedSource = changed.some(f => SOURCE.test(f))
    const touchedDocs = changed.some(
        f => f.startsWith('docs/') || f === 'CLAUDE.md',
    )
    if (touchedSource && !touchedDocs) {
        const src = changed.filter(f => SOURCE.test(f))
        return `source changed in ${src.length} file(s) but no docs/ or CLAUDE.md updated — consider /update-docs\n  ${src.slice(0, 8).join('\n  ')}${src.length > 8 ? '\n  …' : ''}`
    }
    return null
}

export {
    checkLinks,
    checkAnchors,
    checkHistory,
    headingSlugs,
    anchorLinks,
    historyLines,
    slug,
    mdLinks,
    citedScripts,
    workspaceDirs,
    definedScripts,
    missingScripts,
    unmentionedWorkspaces,
    staleness,
}

if (import.meta.main) {
    const prePush = process.argv.includes('--pre-push')
    let failed = false

    const broken = checkLinks()
    if (broken.length) {
        failed = true
        console.error(`✗ docs link check: ${broken.length} broken link(s):`)
        for (const b of broken) console.error(`  ${b}`)
    } else {
        console.error(`✓ docs link check: all links resolve`)
    }

    const badAnchors = checkAnchors()
    if (badAnchors.length) {
        failed = true
        console.error(`✗ docs anchor check: ${badAnchors.length} link(s) to a missing heading:`)
        for (const b of badAnchors) console.error(`  ${b}`)
    } else {
        console.error(`✓ docs anchor check: every #heading link resolves`)
    }

    const history = checkHistory()
    if (history.length) {
        failed = true
        console.error(
            `✗ docs history lint: ${history.length} line(s) narrate history — describe what IS; ` +
                `what an old install must do goes in docs/overview/migrating.md:`,
        )
        for (const h of history) console.error(`  ${h}`)
    } else {
        console.error(`✓ docs history lint: no history narration outside the migration page`)
    }

    const claudeMdPath = join(ROOT, 'CLAUDE.md')
    const claudeText = existsSync(claudeMdPath)
        ? readFileSync(claudeMdPath, 'utf8')
        : ''

    const cited = citedScripts(claudeText)
    const defined = definedScripts(ROOT)
    const missing = missingScripts(cited, defined)
    if (missing.length) {
        failed = true
        console.error(`✗ cited commands: ${missing.length} miss(es):`)
        for (const m of missing)
            console.error(
                `  CLAUDE.md cites \`bun run ${m}\` but no package.json defines script ${m}`,
            )
    } else {
        console.error(`✓ cited commands: all \`bun run\` tokens resolve`)
    }

    const dirs = workspaceDirs(ROOT)
    const unmentioned = unmentionedWorkspaces(claudeText, dirs)
    if (unmentioned.length) {
        failed = true
        console.error(`✗ workspace parity: ${unmentioned.length} miss(es):`)
        for (const w of unmentioned)
            console.error(
                `  workspace ${w} (package.json) is not mentioned in CLAUDE.md`,
            )
    } else {
        console.error(`✓ workspace parity: every workspace is mentioned in CLAUDE.md`)
    }

    if (failed) process.exit(1)

    if (prePush) {
        const warn = staleness()
        if (warn) {
            console.error(`\n⚠ ${warn}\n  (warning only — not blocking the push)`)
        }
    }
    process.exit(0)
}
