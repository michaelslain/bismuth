#!/usr/bin/env node
// design-system skill scripts v4 (2026-09-21) — copied into repos by install-gate; compare this line to detect a stale copy
// A short-output gate for CI / a repo's own test suite: run the design-system audit and fail
// if anything not already accepted into a baseline is found.
//
// Self-contained against checks.mjs ONLY (no audit.mjs / manifest.mjs) — install-gate copies
// just this file plus checks.mjs into the target repo, so it must not reach outside that pair.
//
// Usage: node run-gate.mjs --root <dir> [--baseline <file>]
//   --root <dir>       repo root to audit (required)
//   --baseline <file>  JSON { accepted: [{ check, path }] } — findings matching an entry
//                       (by check + path, ignoring line) are subtracted before the gate decides.
//                       Default: <root>/design/baseline.json when it exists, else none.
//
// Exit codes: 0 clean, 1 findings remain, 2 usage/setup error (e.g. no DESIGN.md governance block)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseGovernance, withDefaults, runChecks, BASELINE_PATH } from './checks.mjs'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.claude'])
const READ_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro', '.css', '.scss'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

function printHelp() {
    console.log('usage: node run-gate.mjs --root <dir> [--baseline <file>]')
    console.log('runs the design-system audit and fails (exit 1) on any finding not in the baseline')
}

export function parseArgs(argv) {
    const args = {}
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--root') args.root = resolve(argv[++i])
        else if (a === '--baseline') args.baseline = argv[++i]
        else if (a === '--help' || a === '-h') args.help = true
        else throw new Error(`unknown argument: ${a}`)
    }
    return args
}

function loadBaseline(path) {
    if (!path) return new Set()
    if (!existsSync(path)) throw new Error(`baseline file not found: ${path}`)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const accepted = Array.isArray(data.accepted) ? data.accepted : []
    return new Set(accepted.map(a => `${a.check} ${a.path}`))
}

function walkFiles(root, subdir) {
    const files = []
    const stack = [join(root, subdir)]
    while (stack.length) {
        const dir = stack.pop()
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch {
            continue
        }
        for (const entry of entries) {
            if (IGNORE_DIRS.has(entry.name)) continue
            const full = join(dir, entry.name)
            if (entry.isDirectory()) stack.push(full)
            else if (entry.isFile() && READ_EXTS.has(extname(entry.name))) {
                files.push(relative(root, full).replace(/\\/g, '/'))
            }
        }
    }
    return files
}

function collectFiles(root, sourceRoots) {
    const seen = new Set()
    const files = []
    for (const src of sourceRoots) {
        for (const relPath of walkFiles(root, src)) {
            if (seen.has(relPath)) continue
            seen.add(relPath)
            const full = join(root, relPath)
            try {
                if (statSync(full).size > MAX_FILE_BYTES) continue
                files.push({ path: relPath, content: readFileSync(full, 'utf8') })
            } catch {
                // unreadable — skip
            }
        }
    }
    return files
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) { printHelp(); process.exit(0) }
    if (!args.root) {
        console.error('run-gate: --root is required')
        process.exit(2)
    }

    const designPath = join(args.root, 'DESIGN.md')
    if (!existsSync(designPath)) {
        console.error(`run-gate: no DESIGN.md at ${designPath} — commit one with a governance: block first (see manifest.mjs --detect)`)
        process.exit(2)
    }
    const gov = parseGovernance(readFileSync(designPath, 'utf8'))
    if (gov === null) {
        console.error(`run-gate: ${designPath} has no governance: block — commit one first (see manifest.mjs --detect)`)
        process.exit(2)
    }
    const manifest = withDefaults(gov)

    let accepted
    try {
        const fallback = join(args.root, BASELINE_PATH)
        accepted = loadBaseline(args.baseline ?? (existsSync(fallback) ? fallback : undefined))
    } catch (err) {
        console.error(`run-gate: ${err.message}`)
        process.exit(2)
    }

    const files = collectFiles(args.root, manifest.source)
    if (files.length === 0) {
        console.error(`run-gate: scanned 0 files under ${args.root} — the manifest's source roots match nothing; refusing to call that clean`)
        process.exit(2)
    }
    const findings = runChecks(manifest, files)
    const remaining = findings.filter(f => !accepted.has(`${f.check} ${f.path}`))

    if (remaining.length === 0) {
        console.log('design-system gate: clean')
        process.exit(0)
    }

    console.log(`design-system gate: ${remaining.length} finding${remaining.length === 1 ? '' : 's'}`)
    for (const f of remaining.slice(0, 50)) {
        console.log(`${f.check} ${f.path}:${f.line} ${f.message}`)
    }
    if (remaining.length > 50) console.log(`… and ${remaining.length - 50} more`)
    process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
