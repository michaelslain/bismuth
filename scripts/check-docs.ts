#!/usr/bin/env bun
// Docs gate — four cheap, deterministic checks (no LLM):
//   1. LINK CHECK (blocking): every relative .md link under docs/ (and from CLAUDE.md
//      into docs/) must resolve. Exits non-zero on any broken link.
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

// Pull relative .md link targets out of a markdown file (skips http(s), strips #anchors).
function mdLinks(file: string): string[] {
    const text = readFileSync(file, 'utf8')
    const out: string[] = []
    for (const m of text.matchAll(/\]\(([^)]+?\.md)(#[^)]*)?\)/g)) {
        const target = m[1]
        if (/^https?:\/\//.test(target)) continue
        out.push(target)
    }
    return out
}

function checkLinks(): string[] {
    const broken: string[] = []
    const files = walk(DOCS)
    // CLAUDE.md may link into docs/ too — include it.
    if (existsSync(join(ROOT, 'CLAUDE.md'))) files.push(join(ROOT, 'CLAUDE.md'))
    for (const f of files) {
        for (const link of mdLinks(f)) {
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
