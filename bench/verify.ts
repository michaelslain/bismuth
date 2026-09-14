#!/usr/bin/env bun
// bench/verify.ts — the ONE command an implementer runs to prove a task before handing it back.
//
// WHY THIS EXISTS. Measured on this plan's own tasks (2026-09-14): finishing a bench-tooling task
// without this file meant booting Storybook by hand, running `playCheck.ts`, `invariants.ts` and
// `storyAudit.ts` separately, eyeballing three different output shapes, and cross-referencing a
// baseline dir by hand to see whether any shot had moved — 15-22 agent turns and 5-11 screenshot
// reads per implementer, even though the tools themselves finish in seconds. Almost all of that cost
// was ritual (boot, remember three invocations, remember three output shapes, remember the baseline
// diff), not compute. This file IS the ritual, run once: boot Storybook if nothing is listening on
// `--port` (or reuse it if something already is), run the three tools per `--prefix` in order, hash
// every shot against an optional `--baseline`, print ONE summary block, and exit 0/1. An agent (or a
// human) reads the last line and is done.
//
// HOW THIS DIFFERS FROM `checkChanged.ts`. `checkChanged.ts` (→ `bun run visual`) scopes ITS OWN
// diff-derived prefixes and runs ONLY `invariants.ts` — it is the everyday, seconds-fast check a
// person runs after touching a component, and it never touches Storybook's lifecycle (it assumes
// something is already listening on 6006, the repo default). This file takes explicit `--prefix`
// arguments (an `--affected`-style diff-to-prefix mode is deliberately out of scope — see the task
// brief), runs all THREE tools (play, invariants, audit), and owns booting/stopping Storybook itself
// — the shape a task's *final* proof needs, not the shape of an everyday edit-save-check loop.
//
// WHY `--port` HAS NO DEFAULT. Every sibling tool in this directory defaults `--base` to
// `http://localhost:6006`, and that default is a trap the moment you are in a git worktree: 6006 is
// whatever Storybook the MAIN CHECKOUT happens to be running, not this worktree's, so a forgotten
// flag silently measures someone else's tree and reports it as this one's proof. Making `--port`
// required — no default, missing it is a hard usage error — is the only way this file can't fall
// into that trap by omission.
//
// THIS FILE IS THE I/O HALF. `bench/verifyReport.ts` is the pure half — arg parsing, the shot diff,
// the pass/fail verdict, and the exact summary text — and is unit-tested with zero Chrome, zero
// Storybook, zero filesystem involved. Everything in THIS file that isn't "spawn a process, read its
// output, hash a file, write a file" belongs in that module instead.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    parseArgs,
    compareShots,
    HARD_AUDIT_FLAGS,
    summarize,
    type PrefixResult,
    type VerifyInput,
} from './verifyReport'

const parsed = parseArgs(process.argv.slice(2))
if ('error' in parsed) {
    console.error(parsed.error)
    process.exit(2)
}
const ARGS = parsed

const REPO_ROOT = join(import.meta.dir, '..')
const OUT_DIR = ARGS.out ?? join(import.meta.dir, '..', '.claude', 'audit')
const APP_DIR = ARGS.app ?? join(import.meta.dir, '..', 'app')
const BASE = `http://localhost:${ARGS.port}`
const LOG_DIR = join(OUT_DIR, 'logs')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(LOG_DIR, { recursive: true })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const safeName = (s: string) => s.replace(/[^a-z0-9-]/gi, '_')

const indexReady = async (): Promise<boolean> => {
    try {
        const r = await fetch(`${BASE}/index.json`)
        return r.status === 200
    } catch {
        return false
    }
}

const listPortPids = (port: number): string[] => {
    try {
        const r = Bun.spawnSync(['lsof', `-tiTCP:${port}`, '-sTCP:LISTEN'])
        const out = new TextDecoder().decode(r.stdout).trim()
        return out ? out.split('\n').filter(Boolean) : []
    } catch {
        return []
    }
}
const killPid = (pid: string, sig: 'TERM' | 'KILL') => {
    try {
        Bun.spawnSync(['kill', `-${sig}`, pid])
    } catch {
        /* best effort — a pid that raced its own exit is not an error here */
    }
}

/** Picks the one line worth showing out of a crashed tool's stderr. Bun prints an uncaught
 *  `throw new Error(...)` as a source-context block ending in an `error: <message>` line, followed
 *  by a trailing `Bun vX.Y.Z (platform arch)` banner with no diagnostic value of its own — a plain
 *  "last non-empty line" picks up that banner instead of the actual message (confirmed against a
 *  real `--story does-not-exist-` run against storyAudit.ts). Prefer the `error:` line; fall back to
 *  the last non-banner, non-empty line for a crash shaped some other way. */
const extractToolError = (stderr: string): string => {
    const lines = stderr.split('\n').map(l => l.trim())
    const errLine = [...lines].reverse().find(l => l.startsWith('error:'))
    if (errLine) return errLine.slice('error:'.length).trim()
    const nonEmpty = lines.filter(Boolean)
    const useful = nonEmpty.filter(l => !/^Bun v[\d.]+ \(/.test(l))
    return useful.at(-1) ?? nonEmpty.at(-1) ?? ''
}

// ── Storybook lifecycle ──────────────────────────────────────────────────────────────────────────

let startedByVerify = false
let storybookProc: ReturnType<typeof Bun.spawn> | null = null
let cleanedUp = false

/** Stops the server verify itself started, unless `force` (the failed-to-boot path, which has
 *  nothing worth keeping) or `--keep` was passed. Idempotent — safe to call from both the normal
 *  completion path and the finally/SIGINT safety net. Confirms via `lsof` afterwards and kills any
 *  survivor, per the brief's stop contract. */
const stopStorybookIfOwned = async (force: boolean): Promise<boolean> => {
    if (cleanedUp) return false
    cleanedUp = true
    if (!startedByVerify) return false
    if (!force && ARGS.keep) {
        console.error(`storybook left running on :${ARGS.port} (--keep)`)
        return false
    }
    if (storybookProc) {
        try {
            storybookProc.kill()
        } catch {
            /* already gone */
        }
        const exited = await Promise.race([
            storybookProc.exited.then(() => true),
            sleep(5000).then(() => false),
        ])
        if (!exited) {
            try {
                storybookProc.kill('SIGKILL')
            } catch {
                /* already gone */
            }
            await storybookProc.exited.catch(() => {})
        }
    }
    const survivors = listPortPids(ARGS.port)
    if (survivors.length) {
        console.error(`${survivors.length} process(es) still on :${ARGS.port} after stop — killing: ${survivors.join(', ')}`)
        for (const pid of survivors) killPid(pid, 'KILL')
    }
    return true
}

process.on('SIGINT', async () => {
    await stopStorybookIfOwned(false)
    process.exit(130)
})

// ── Tool runners — each captures stdout+stderr to its own log AND parses the result ────────────────

const runCapturing = async (
    argv: string[],
    logFile: string,
): Promise<{ stdout: string; stderr: string; code: number }> => {
    const proc = Bun.spawn(['bun', ...argv], {
        cwd: REPO_ROOT,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    writeFileSync(logFile, `$ bun ${argv.join(' ')}\nexit ${code}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`)
    return { stdout, stderr, code }
}

const runPlay = async (prefix: string): Promise<PrefixResult['play']> => {
    const logFile = join(LOG_DIR, `playCheck.${safeName(prefix)}.log`)
    const { stdout, stderr } = await runCapturing(
        ['bench/playCheck.ts', '--base', BASE, '--story', prefix, '--json'],
        logFile,
    )
    try {
        const parsed = JSON.parse(stdout)
        const results = parsed.results as { id: string; outcome: string }[]
        const failed = results
            .filter(r => r.outcome === 'FAIL' || r.outcome === 'ERROR' || r.outcome === 'UNSAFE')
            .map(r => r.id)
        return {
            pass: parsed.counts.pass,
            fail: parsed.counts.fail,
            skip: parsed.counts.skip,
            error: parsed.counts.error,
            unsafe: parsed.counts.unsafe,
            failed,
        }
    } catch {
        return { toolError: extractToolError(stderr) || 'playCheck.ts produced non-JSON output' }
    }
}

const runInvariants = async (prefix: string): Promise<PrefixResult['invariants']> => {
    const logFile = join(LOG_DIR, `invariants.${safeName(prefix)}.log`)
    const { stdout, stderr, code } = await runCapturing(
        ['bench/invariants.ts', '--base', BASE, '--story', prefix, '--json'],
        logFile,
    )
    try {
        const parsed = JSON.parse(stdout)
        const findings = parsed.findings as { story: string }[]
        const blank = parsed.blank as string[]
        const failed = [...new Set([...findings.map(f => f.story), ...blank])]
        return { exit: code, findings: findings.length, blank: blank.length, failed }
    } catch {
        return { toolError: extractToolError(stderr) || 'invariants.ts produced non-JSON output' }
    }
}

/** Unlike its two siblings, storyAudit.ts has no `--json` mode — its machine-readable output is the
 *  `report.json` file it writes into `--out`, read immediately after the process exits. Because
 *  `--story` runs never clear `--out` (storyAudit.ts:212), records are merged into
 *  `<out>/verify-report.json` keyed by story id rather than overwritten, so a later prefix's audit
 *  never erases an earlier prefix's in the SAME verify invocation. */
const runAudit = async (prefix: string): Promise<PrefixResult['audit']> => {
    const logFile = join(LOG_DIR, `storyAudit.${safeName(prefix)}.log`)
    const { stderr, code } = await runCapturing(
        ['bench/storyAudit.ts', '--base', BASE, '--story', prefix, '--out', OUT_DIR],
        logFile,
    )
    if (code !== 0) return { toolError: extractToolError(stderr) || `storyAudit.ts exited ${code}` }

    const reportPath = join(OUT_DIR, 'report.json')
    if (!existsSync(reportPath))
        return { toolError: 'storyAudit.ts exited 0 but wrote no report.json' }

    let records: any[]
    try {
        records = JSON.parse(readFileSync(reportPath, 'utf8'))
    } catch {
        return { toolError: 'storyAudit.ts report.json was not valid JSON' }
    }

    const mergedPath = join(OUT_DIR, 'verify-report.json')
    const merged: Record<string, any> = existsSync(mergedPath)
        ? JSON.parse(readFileSync(mergedPath, 'utf8'))
        : {}
    for (const rec of records) merged[rec.id] = rec
    writeFileSync(mergedPath, JSON.stringify(merged, null, 2))

    const hard: { id: string; kind: string; detail: string }[] = []
    const leads: { id: string; kind: string; detail: string }[] = []
    for (const rec of records) {
        for (const f of rec.flags ?? []) {
            const entry = { id: rec.id, kind: f.kind, detail: String(f.detail ?? '') }
            if (HARD_AUDIT_FLAGS.has(f.kind)) hard.push(entry)
            else leads.push(entry)
        }
    }
    return { stories: records.length, hard, leads }
}

// ── Baseline shot comparison ─────────────────────────────────────────────────────────────────────

const md5File = (path: string): string => {
    const hasher = new Bun.CryptoHasher('md5')
    hasher.update(readFileSync(path))
    return hasher.digest('hex')
}

/** Hashes every `.png` in `dir` whose story id (the filename minus extension — storyAudit.ts names
 *  shots `<id-with-unsafe-chars-underscored>.png`, and real story ids never contain characters that
 *  transform needs to touch) matches one of this run's prefixes. */
const hashShots = (dir: string, prefixes: string[]): Record<string, string> => {
    if (!existsSync(dir)) return {}
    const matches = (id: string) => prefixes.some(p => id === p || id.startsWith(p))
    const out: Record<string, string> = {}
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.png')) continue
        if (!matches(name.slice(0, -'.png'.length))) continue
        out[name] = md5File(join(dir, name))
    }
    return out
}

const resolveBaselineShotsDir = (dir: string): string => {
    const nested = join(dir, 'shots')
    return existsSync(nested) ? nested : dir
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

let storybook: VerifyInput['storybook']

if (await indexReady()) {
    storybook = 'reused'
} else {
    startedByVerify = true
    const bin = join(APP_DIR, 'node_modules', '.bin', 'storybook')
    const logPath = join(OUT_DIR, 'storybook.log')
    storybookProc = Bun.spawn([bin, 'dev', '-p', String(ARGS.port), '--no-open'], {
        cwd: APP_DIR,
        env: { ...process.env, BROWSER: 'none', CI: '1' },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    // Two Bun.file() sinks writing the SAME path truncate each other (confirmed empirically — the
    // later stream's writes clobber the earlier one's), so stdout and stderr are pumped by hand into
    // one file with a plain node:fs append instead of being passed as spawn's stdio sinks directly.
    writeFileSync(logPath, '')
    const pump = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return
        for await (const chunk of stream) appendFileSync(logPath, chunk)
    }
    void pump(storybookProc.stdout as any)
    void pump(storybookProc.stderr as any)

    const deadline = Date.now() + ARGS.bootTimeout
    for (;;) {
        if (await indexReady()) {
            storybook = 'started'
            break
        }
        if (Date.now() > deadline) {
            storybook = 'failed-to-boot'
            break
        }
        await sleep(500)
    }
}

if (storybook === 'failed-to-boot') {
    if (existsSync(join(OUT_DIR, 'storybook.log'))) {
        const lines = readFileSync(join(OUT_DIR, 'storybook.log'), 'utf8').split('\n')
        console.error(`storybook never answered ${BASE}/index.json within ${ARGS.bootTimeout}ms — last log lines:`)
        console.error(lines.slice(-30).join('\n'))
    }
    await stopStorybookIfOwned(true)
    const input: VerifyInput = {
        base: BASE,
        storybook: 'failed-to-boot',
        stopped: true,
        out: OUT_DIR,
        prefixes: [],
    }
    const { text, ok } = summarize(input)
    writeFileSync(join(OUT_DIR, 'verify-summary.json'), JSON.stringify({ ...input, ok }, null, 2))
    console.log(text)
    process.exit(1)
}

let ok = true
try {
    const prefixResults: PrefixResult[] = []
    for (const prefix of ARGS.prefixes) {
        const play = await runPlay(prefix)
        const invariants = await runInvariants(prefix)
        const audit = await runAudit(prefix)
        prefixResults.push({ prefix, play, invariants, audit })
    }

    let shots: VerifyInput['shots']
    if (ARGS.baseline) {
        const baselineDir = resolveBaselineShotsDir(ARGS.baseline)
        const current = hashShots(join(OUT_DIR, 'shots'), ARGS.prefixes)
        const baseline = hashShots(baselineDir, ARGS.prefixes)
        shots = { ...compareShots(current, baseline), baseline: baselineDir }
    }

    const stopped = await stopStorybookIfOwned(false)

    const input: VerifyInput = {
        base: BASE,
        storybook,
        stopped,
        out: OUT_DIR,
        prefixes: prefixResults,
        shots,
    }
    const rendered = summarize(input)
    ok = rendered.ok
    writeFileSync(join(OUT_DIR, 'verify-summary.json'), JSON.stringify({ ...input, ok }, null, 2))
    console.log(rendered.text)
} finally {
    await stopStorybookIfOwned(false)
}

process.exit(ok ? 0 : 1)
