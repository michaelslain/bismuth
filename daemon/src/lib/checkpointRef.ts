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
): Promise<{ stdout: string; ok: boolean }> {
    try {
        const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
            maxBuffer: 64 * 1024 * 1024,
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
 * Files changed in `dir` since the checkpoint ref `refs/bismuth/<ref>`, UNIONED with whatever is
 * currently uncommitted (tracked modifications/deletions vs HEAD, plus untracked-but-not-ignored
 * new files). Deliberately NEVER commits anything itself (unlike core's checkpointDelta, which a
 * caller can ask to auto-commit first) — a cron pre-check has no business writing to the user's
 * vault/memory repo on its own. See incrementalCron.ts / advanceCheckpointRef for the edge this
 * implies: an uncommitted file reviewed this run but committed only later (by the app's own
 * autosave, or the user) will resurface on the NEXT diff too, because advancing the ref can only
 * ever mark committed history. Accepted trade-off — see cron.ts's fireJob doc comment.
 *
 * If the ref doesn't exist yet (first run), every tracked file at HEAD counts as the delta and
 * `base` is null. If the repo has no commits at all yet, returns an empty delta (head: null).
 */
export async function checkpointDelta(
    dir: string,
    ref: string,
): Promise<CheckpointDelta> {
    if (!(await isGitRepo(dir))) return { base: null, head: null, files: [] }
    const head = await headSha(dir)
    if (!head) return { base: null, head: null, files: [] }

    const refSha = await checkpointRefSha(dir, ref)
    let committed: ChangedFile[]
    if (refSha === null) {
        const ls = await git(dir, [
            'ls-tree',
            '-r',
            '--name-only',
            '-z',
            'HEAD',
        ])
        committed = ls.stdout
            .split('\0')
            .filter(Boolean)
            .map(path => ({ status: 'A', path }))
    } else {
        const d = await git(dir, [
            'diff',
            '--name-status',
            '-z',
            refSha,
            'HEAD',
        ])
        committed = parseNameStatus(d.stdout)
    }

    const wt = await git(dir, ['diff', '--name-status', '-z', 'HEAD'])
    const tracked = parseNameStatus(wt.stdout)
    const untrackedOut = await git(dir, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
    ])
    const untracked: ChangedFile[] = untrackedOut.stdout
        .split('\0')
        .filter(Boolean)
        .map(path => ({ status: 'A', path }))

    // Merge by path — working-tree status wins over the committed-range status for the same path
    // (it's the freshest truth); iteration order gives committed entries first so a path present in
    // both only shows up once, with the working-tree version.
    const merged = new Map<string, ChangedFile>()
    for (const f of committed) merged.set(f.path, f)
    for (const f of [...tracked, ...untracked]) merged.set(f.path, f)

    return { base: refSha, head, files: [...merged.values()] }
}

/**
 * Advance the checkpoint ref to current HEAD. Never commits (see checkpointDelta's doc comment).
 * Returns the new ref SHA, or null if `dir` isn't a repo yet / has no commits.
 */
export async function advanceCheckpointRef(
    dir: string,
    ref: string,
): Promise<string | null> {
    if (!(await isGitRepo(dir))) return null
    const head = await headSha(dir)
    if (!head) return null
    await git(dir, ['update-ref', refPath(ref), 'HEAD'])
    return head
}
