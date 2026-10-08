// Lightweight git-ref "checkpoint" bookmarks — the daemon's OWN copy of the mechanism in
// core/src/backup.ts (refs/bismuth/<ref>, the same namespace the `bismuth checkpoint`
// CLI/cron prompts already used). Duplicated rather than imported for the same reason as
// lib/visibility.ts / lib/claudeWhich.ts / lib/bismuthPaths.ts: the daemon workspace is a
// separately-bundled standalone binary and must not depend on @bismuth/core. Uses plain `git`
// subprocesses (node:child_process, matching cron.ts's pgrep call) rather than the `bismuth` CLI
// itself — `git` is essentially always present, whereas the bundled CLI may not be installed
// (see Bug #105), and this only needs a handful of read-only-ish git plumbing commands.
//
// Used by incrementalCron.ts to decide whether an "incremental" cron has anything new to look
// at BEFORE a session is ever started (see docs/daemon/crons-and-processes.md).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

const CHECKPOINT_NS = 'refs/bismuth'
const REF_RE = /^[a-zA-Z0-9._-]+$/

export interface ChangedFile {
    /** git name-status code: A(dded) M(odified) D(eleted) R(enamed) C(opied) … */
    status: string
    path: string
}

export interface CheckpointDelta {
    /** The checkpoint ref's SHA the diff is measured from, or null on first run (no ref yet). */
    base: string | null
    /** Current HEAD SHA, or null if the repo has no commits. */
    head: string | null
    /** Commit whose tree is the working tree as seen by this delta (advance the ref to it). */
    snapshot: string | null
    files: ChangedFile[]
}

function refPath(ref: string): string {
    if (!REF_RE.test(ref))
        throw new Error(`invalid checkpoint ref name: ${ref}`)
    return `${CHECKPOINT_NS}/${ref}`
}

/** Run `git <args>` in `dir`, tolerating a non-zero exit (returns whatever stdout it managed). */
async function git(
    dir: string,
    args: string[],
    env?: Record<string, string>,
): Promise<{ stdout: string; ok: boolean }> {
    try {
        const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
            maxBuffer: 64 * 1024 * 1024,
            env: env ? { ...process.env, ...env } : process.env,
        })
        return { stdout, ok: true }
    } catch (err) {
        const stdout =
            typeof (err as { stdout?: unknown })?.stdout === 'string'
                ? (err as { stdout: string }).stdout
                : ''
        return { stdout, ok: false }
    }
}

async function isGitRepo(dir: string): Promise<boolean> {
    return (await git(dir, ['rev-parse', '--git-dir'])).ok
}

async function headSha(dir: string): Promise<string | null> {
    const r = await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    const sha = r.stdout.trim()
    return r.ok && sha ? sha : null
}

// Parse `git diff --name-status -z` output — see core/src/backup.ts's identical parser for why
// `-z` (NUL-delimited, verbatim/unquoted paths) is mandatory: non-ASCII/emoji/space paths survive.
function parseNameStatus(out: string): ChangedFile[] {
    const tokens = out.split('\0').filter(t => t.length > 0)
    const files: ChangedFile[] = []
    for (let i = 0; i < tokens.length;) {
        const status = tokens[i++]![0]!
        if (status === 'R' || status === 'C') i++ // skip oldpath; the new path comes next
        const path = tokens[i++]
        if (path !== undefined) files.push({ status, path })
    }
    return files
}

/** Current SHA of a checkpoint ref, or null if it doesn't exist (or `dir` isn't a git repo yet). */
export async function checkpointRefSha(
    dir: string,
    ref: string,
): Promise<string | null> {
    if (!(await isGitRepo(dir))) return null
    const r = await git(dir, ['rev-parse', '--verify', '--quiet', refPath(ref)])
    const sha = r.stdout.trim()
    return r.ok && sha ? sha : null
}

/** ISO-8601 committer date of a commit, or null if it can't be resolved. */
export async function commitTimeIso(
    dir: string,
    sha: string,
): Promise<string | null> {
    const r = await git(dir, ['log', '-1', '--format=%cI', sha])
    const iso = r.stdout.trim()
    return r.ok && iso ? iso : null
}

/**
 * A commit whose tree is the current working tree (tracked + untracked, ignore rules respected).
 * Built through a THROWAWAY index file (GIT_INDEX_FILE), so the real index, HEAD, branches and
 * `git status` are untouched; the commit is an unreferenced object. Null when `dir` is not a repo
 * or has no HEAD.
 */
export async function snapshotWorkingTree(dir: string): Promise<string | null> {
    if (!(await isGitRepo(dir))) return null
    const head = await headSha(dir)
    if (!head) return null
    const tmp = await mkdtemp(join(tmpdir(), 'bismuth-snap-'))
    try {
        const env = {
            GIT_INDEX_FILE: join(tmp, 'index'),
            GIT_AUTHOR_NAME: 'bismuth',
            GIT_AUTHOR_EMAIL: 'bismuth@local',
            GIT_COMMITTER_NAME: 'bismuth',
            GIT_COMMITTER_EMAIL: 'bismuth@local',
        }
        if (!(await git(dir, ['read-tree', 'HEAD'], env)).ok) return null
        if (!(await git(dir, ['add', '-A', '--', '.'], env)).ok) return null
        const tree = (await git(dir, ['write-tree'], env)).stdout.trim()
        if (!tree) return null
        const c = await git(
            dir,
            ['commit-tree', tree, '-p', head, '-m', 'bismuth snapshot'],
            env,
        )
        const sha = c.stdout.trim()
        return c.ok && sha ? sha : null
    } finally {
        await rm(tmp, { recursive: true, force: true })
    }
}

/**
 * Files that differ between the checkpoint's base and a snapshot of the working tree taken NOW.
 * Base = the ref, else the first existing `fallbackRefs` entry, else null (every file in the
 * snapshot counts as added). Never commits or moves anything; advance the ref to `snapshot` once
 * the delta has been consumed, so the checkpoint records exactly what was seen.
 */
export async function checkpointDelta(
    dir: string,
    ref: string,
    opts: { fallbackRefs?: string[] } = {},
): Promise<CheckpointDelta> {
    const empty = { base: null, head: null, snapshot: null, files: [] }
    if (!(await isGitRepo(dir))) return empty
    const head = await headSha(dir)
    if (!head) return empty
    const snapshot = await snapshotWorkingTree(dir)
    if (!snapshot) return { ...empty, head }

    let base = await checkpointRefSha(dir, ref)
    for (const fb of base === null ? (opts.fallbackRefs ?? []) : []) {
        base = await checkpointRefSha(dir, fb)
        if (base !== null) break
    }

    let files: ChangedFile[]
    if (base === null) {
        const ls = await git(dir, [
            'ls-tree',
            '-r',
            '--name-only',
            '-z',
            snapshot,
        ])
        files = ls.stdout
            .split('\0')
            .filter(Boolean)
            .map(path => ({ status: 'A', path }))
    } else {
        const d = await git(dir, [
            'diff',
            '--name-status',
            '-z',
            base,
            snapshot,
        ])
        files = parseNameStatus(d.stdout)
    }
    return { base, head, snapshot, files }
}

/**
 * Move the checkpoint ref to `to` (a snapshot sha from checkpointDelta / snapshotWorkingTree), or
 * to a fresh snapshot of the working tree when omitted. Never commits to a branch. No-op when
 * `dir` isn't a repo yet / has no commits.
 */
export async function advanceCheckpointRef(
    dir: string,
    ref: string,
    to?: string,
): Promise<void> {
    const path = refPath(ref)
    if (!(await isGitRepo(dir))) return
    const target = to ?? (await snapshotWorkingTree(dir))
    if (!target) return
    await git(dir, ['update-ref', path, target])
}
