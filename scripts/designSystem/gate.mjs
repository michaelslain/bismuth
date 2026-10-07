#!/usr/bin/env node
// design-system skill scripts v5 (2026-10-06) — copied into repos by install-gate; compare this line to detect a stale copy
// A short-output gate for CI / a repo's own test suite: run the design-system audit and fail
// if anything not already accepted into a baseline is found.
//
// Self-contained against checks.mjs ONLY (no audit.mjs / manifest.mjs) — install-gate copies
// just this file plus checks.mjs into the target repo, so it must not reach outside that pair.
//
// Usage: node run-gate.mjs --root <dir> [--baseline <file>] [--init | --prune]
//   --root <dir>       repo root to audit (required)
//   --baseline <file>  JSON { accepted: [{ check, path, count }] } — the ratchet. An entry accepts
//                       up to `count` findings of one check in one file (never a line number);
//                       findings beyond it fail. An entry that accepts MORE than now exists is
//                       STALE and fails too, so a fixed violation must be pruned and headroom
//                       cannot accumulate. Only error-severity checks gate or can be baselined.
//                       Default: <root>/design/baseline.json when it exists, else none.
//   --init             write the baseline from today's findings; refuses if the file exists
//   --prune            rewrite the baseline with entries shrunk to what exists now. It can only
//                       lower or remove entries — never add or raise one. A count-less (pre-v5)
//                       entry is pinned to today's count.
//
// Exit codes: 0 clean, 1 findings remain or the baseline is stale, 2 usage/setup error
// (e.g. no DESIGN.md governance block)

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, extname, relative, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseGovernance, withDefaults, runChecks, BASELINE_PATH, applyBaseline, buildBaseline, shrinkBaseline } from './checks.mjs'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.claude'])
const READ_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro', '.css', '.scss'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

function printHelp() {
    console.log('usage: node run-gate.mjs --root <dir> [--baseline <file>] [--init | --prune]')
    console.log('runs the design-system audit and fails (exit 1) on any finding not in the baseline, or on a stale baseline entry')
    console.log('--init writes the baseline once; --prune shrinks it to what still exists (never adds or raises)')
}

export function parseArgs(argv) {
    const args = {}
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--root') args.root = resolve(argv[++i])
        else if (a === '--baseline') args.baseline = argv[++i]
        else if (a === '--init') args.init = true
        else if (a === '--prune') args.prune = true
        else if (a === '--help' || a === '-h') args.help = true
        else throw new Error(`unknown argument: ${a}`)
    }
    return args
}

function loadBaseline(path) {
    if (!path) return []
    if (!existsSync(path)) throw new Error(`baseline file not found: ${path}`)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const accepted = Array.isArray(data.accepted) ? data.accepted : []
    for (const a of accepted) {
        if (typeof a.check !== 'string' || typeof a.path !== 'string') throw new Error(`baseline entry needs a check and a path: ${JSON.stringify(a)}`)
        if (a.count !== undefined && !(Number.isInteger(a.count) && a.count > 0)) throw new Error(`baseline entry ${a.check} ${a.path}: count must be a positive integer, got ${JSON.stringify(a.count)}`)
    }
    return accepted
}

function writeBaseline(path, accepted) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ accepted }, null, 2) + '\n')
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

    if (args.init && args.prune) {
        console.error('run-gate: --init and --prune are exclusive')
        process.exit(2)
    }
    const baselinePath = args.baseline ?? join(args.root, BASELINE_PATH)
    let accepted
    try {
        if (args.init && existsSync(baselinePath)) throw new Error(`--init refuses to overwrite ${baselinePath} — use --prune to shrink it`)
        accepted = args.init ? [] : loadBaseline(args.baseline ?? (existsSync(baselinePath) ? baselinePath : undefined))
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

    if (args.init) {
        const entries = buildBaseline(findings)
        writeBaseline(baselinePath, entries)
        console.log(`design-system gate: wrote ${baselinePath} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ${entries.reduce((n, e) => n + e.count, 0)} accepted findings`)
        process.exit(0)
    }
    if (args.prune) {
        const shrunk = shrinkBaseline(findings, accepted)
        writeBaseline(baselinePath, shrunk)
        console.log(`design-system gate: pruned ${baselinePath} — ${accepted.length} → ${shrunk.length} entries, ${accepted.reduce((n, e) => n + (e.count ?? 0), 0)} → ${shrunk.reduce((n, e) => n + e.count, 0)} counted findings`)
        accepted = shrunk
    }

    const { remaining, stale, legacy, warnings } = applyBaseline(findings, accepted)

    for (const f of warnings.slice(0, 50)) console.log(`warning ${f.check} ${f.path}:${f.line} ${f.message}`)
    for (const l of legacy) console.log(`note: baseline entry ${l.check} ${l.path} has no count (accepts any number) — run with --prune to pin it at ${l.found}`)

    if (remaining.length === 0 && stale.length === 0) {
        console.log('design-system gate: clean')
        process.exit(0)
    }

    if (remaining.length > 0) {
        console.log(`design-system gate: ${remaining.length} finding${remaining.length === 1 ? '' : 's'}`)
        for (const f of remaining.slice(0, 50)) {
            console.log(`${f.check} ${f.path}:${f.line} ${f.message}`)
        }
        if (remaining.length > 50) console.log(`… and ${remaining.length - 50} more`)
    }
    if (stale.length > 0) {
        console.log(`design-system gate: stale baseline — ${stale.length} entr${stale.length === 1 ? 'y accepts' : 'ies accept'} more than exists; run with --prune and commit design/baseline.json`)
        for (const e of stale.slice(0, 50)) {
            console.log(`stale ${e.check} ${e.path} accepted ${e.accepted ?? 'any'}, found ${e.found} (${e.reason})`)
        }
        if (stale.length > 50) console.log(`… and ${stale.length - 50} more`)
    }
    process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
