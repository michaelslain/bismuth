// The durable guard on the versioned-seed mechanism, plus the content invariants of the two
// default cron prompts.
//
// The bug this file exists to prevent: seeds.ts can only upgrade an existing vault's cron file in
// place when that file's sha256 appears in PRIOR_SEED_HASHES. Editing a DEFAULT_CRONS prompt
// without appending the OUTGOING body's hash silently strands every vault still running it — the
// file is pristine stock but reconcileSeeds classifies it as user-customized and never touches it
// again. That is not a hypothetical: the first real install sat on stock v1 of `dream` (2026-06-28)
// for a month because only v2's hash (2026-07-06) had been listed. Nothing about that failure is
// visible at review time (the code compiles, every unit test passes, fresh vaults get the new
// prompt), which is why the check has to be mechanical.
//
// Versions are numbered the way PRIOR_SEED_HASHES numbers them and nowhere else differently —
// v1 = 2026-06-28, v2 = 2026-07-06, v3 = 2026-07-27 (incremental scoping), v4 = the current
// DEFAULT_CRONS content. One vocabulary; see daemon/test/fixtures/oldSeedContent.ts.
//
// So: walk this file's own git history, reconstruct every version of DEFAULT_CRONS we ever
// shipped, and assert each one hashes to either the CURRENT content or a listed prior. Historical
// bodies are recovered by writing each revision of defaultCrons.ts to a temp file and importing
// it — the module has no imports of its own, so it loads standalone, and the string comes back
// through the real TS parser rather than a hand-rolled un-escaper that could disagree with it.
//
// TWO WAYS THIS GUARD COULD QUIETLY STOP GUARDING, both closed below. A guard that silently skips
// its own work while still reporting green is strictly worse than no guard: it reintroduces the
// invisible-failure mode the file exists to prevent, and now with a green check mark on top of it.
//
//   1. A REVISION THAT WON'T LOAD. Importing a historical revision straight out of a tmpdir only
//      works because defaultCrons.ts has no imports of its own. The day someone adds a VALUE import
//      — a shared constant, a helper, a re-exported type used at runtime — every revision from that
//      commit forward stops resolving from the temp dir. (`import type` is erased by the transpiler
//      and stays harmless, which is precisely why this is easy to introduce by accident.) Swallowing
//      the failure (returning null and moving on, as this file originally did) would skip exactly
//      the NEWEST versions — the ones most likely to be missing from PRIOR_SEED_HASHES — while a
//      global "we checked something" assertion stayed satisfied by the older, import-free revisions.
//      So: a revision whose file EXISTS but cannot be reconstructed is a hard failure. If you hit
//      it, teach `cronsAtRevision` to materialize what the module needs (e.g. check the whole
//      daemon/src tree out at that revision and import from there). Do NOT turn it back into a skip.
//
//   2. A RENAME. `git log -- <path>` without --follow stops dead at the commit that renamed the
//      file, so a future `defaultCrons.ts` → `defaults/crons.ts` move would silently shrink the
//      walked history to whatever came after the move — again, green, again, checking nothing that
//      matters. We pass --follow AND resolve each commit's OWN path out of --name-only, because
//      --follow alone hands back pre-rename commits whose content lives at a path that
//      `git show <commit>:<today's path>` cannot find. That failure looks identical to "the file
//      didn't exist yet" — the same silent skip arriving by a different route.
//
// The ONE skip that is legitimate: this checkout has no usable git history at all (shallow clone,
// tarball export, CI without .git). The guard is a regression net for developers, not a build
// requirement, so "no history" returns early and "this specific revision would not load" fails.
import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CRONS, type DefaultCron } from '../src/daemon/defaultCrons.ts'
import { PRIOR_SEED_HASHES } from '../src/daemon/seeds.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CRONS_PATH = 'daemon/src/daemon/defaultCrons.ts'

const sha256 = (s: string) =>
    createHash('sha256').update(s, 'utf-8').digest('hex')

function git(repoRoot: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
    })
}

/** One shipped revision of the default-cron module: a commit, plus the path the file lived at IN
 *  that commit. The two differ on either side of a rename, and `git show` needs the historical
 *  path, not today's. */
interface CronRevision {
    commit: string
    path: string
}

/** Every revision of defaultCrons.ts, newest first, each paired with its path at that commit — or
 *  null when this checkout has no usable history (shallow clone, tarball export, CI without .git),
 *  the one case where skipping the walk is correct.
 *
 *  `--follow` keeps walking across renames; `--name-only` then reports, per commit, the name the
 *  file had THERE, which is exactly what `git show <commit>:<path>` needs. Records are separated by
 *  a NUL (`%x00`) so a path can never be misparsed as a commit line, and vice versa.
 *
 *  Parameterized on the repo so the rename behavior can be proven against a synthetic repo below
 *  rather than asserted in a comment. */
function cronRevisions(
    repoRoot: string = REPO_ROOT,
    path: string = CRONS_PATH,
): CronRevision[] | null {
    let raw: string
    try {
        raw = git(
            repoRoot,
            'log',
            '--follow',
            '--format=%x00%H',
            '--name-only',
            '--',
            path,
        )
    } catch {
        return null
    }
    const revisions: CronRevision[] = []
    for (const record of raw.split('\u0000')) {
        const lines = record
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
        const commit = lines.shift()
        if (!commit || !/^[0-9a-f]{40}$/.test(commit)) continue
        // A merge commit lists no names under --name-only; fall back to today's path rather than
        // dropping the revision entirely (a dropped revision is an unchecked revision).
        revisions.push({ commit, path: lines[lines.length - 1] ?? path })
    }
    return revisions.length > 0 ? revisions : null
}

/** What happened when we tried to reconstruct one revision. The three cases are deliberately
 *  distinct so the caller can treat "the file wasn't there" (fine) differently from "the file was
 *  there and we failed to read it" (a failure of this guard, not of the history). */
type RevisionLoad =
    | { status: 'loaded'; crons: DefaultCron[] }
    | { status: 'absent' }
    | { status: 'unloadable'; reason: string }

/** Load the DEFAULT_CRONS export as it existed at `rev`. The historical module is written to a
 *  temp file and imported, so the shipped bytes are whatever the TS parser produces — identical to
 *  what seeds.ts would have written to disk at that revision.
 *
 *  Parameterized on the repo for the same reason `cronRevisions` is: the "won't load" branch is the
 *  one that used to swallow failures, so it gets proven against a synthetic repo, not just described. */
async function cronsAtRevision(
    rev: CronRevision,
    repoRoot: string = REPO_ROOT,
): Promise<RevisionLoad> {
    let source: string
    try {
        source = git(repoRoot, 'show', `${rev.commit}:${rev.path}`)
    } catch {
        return { status: 'absent' } // the file didn't exist at that commit (e.g. the commit that deleted it)
    }
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-cron-history-'))
    try {
        const file = join(dir, `defaultCrons.${rev.commit.slice(0, 12)}.ts`)
        writeFileSync(file, source, 'utf-8')
        const mod = (await import(file)) as { DEFAULT_CRONS?: DefaultCron[] }
        const crons = mod.DEFAULT_CRONS
        if (!Array.isArray(crons) || crons.length === 0) {
            return {
                status: 'unloadable',
                reason: 'the module imported but exported no DEFAULT_CRONS entries',
            }
        }
        return { status: 'loaded', crons }
    } catch (err) {
        return {
            status: 'unloadable',
            reason: (err as Error)?.message ?? String(err),
        }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

test('CRONS_PATH still points at the real module (a stale constant would degrade every git query below to a no-op skip)', () => {
    expect(existsSync(join(REPO_ROOT, CRONS_PATH))).toBe(true)
})

test('every historical shipped version of each default cron is either current or listed in PRIOR_SEED_HASHES', async () => {
    const revisions = cronRevisions()
    if (!revisions) return // no git history here — nothing to verify, and that is not a failure

    const currentByName = new Map(
        DEFAULT_CRONS.map(c => [c.name, sha256(c.content)]),
    )
    const unaccounted: string[] = []
    const unloadable: string[] = []
    let versionsChecked = 0

    for (const rev of revisions) {
        const loaded = await cronsAtRevision(rev)
        if (loaded.status === 'absent') continue // nothing shipped at that revision
        if (loaded.status === 'unloadable') {
            unloadable.push(
                `${rev.path} @ ${rev.commit.slice(0, 8)} — ${loaded.reason}`,
            )
            continue
        }
        for (const cron of loaded.crons) {
            versionsChecked++
            const hash = sha256(cron.content)
            if (hash === currentByName.get(cron.name)) continue
            if ((PRIOR_SEED_HASHES[cron.name] ?? []).includes(hash)) continue
            unaccounted.push(
                `${cron.name} @ ${rev.commit.slice(0, 8)} → ${hash}\n` +
                    `    A vault still on this stock version will be misread as user-customized and never ` +
                    `upgraded. Append this hash to PRIOR_SEED_HASHES["${cron.name}"] in daemon/src/daemon/seeds.ts.`,
            )
        }
    }

    // PER-REVISION, and loud: a revision that exists but cannot be reconstructed is a revision this
    // guard is NOT checking, and the ones it would stop checking first are the newest — see the
    // header. Fix the loader when this fires; never relax it back into a `continue`.
    expect(
        unloadable,
        'revisions of defaultCrons.ts that exist in git but could not be reconstructed — this guard is only as strong as its ability to load EVERY revision',
    ).toEqual([])
    expect(versionsChecked).toBeGreaterThan(0) // the walk actually found history to check
    expect(unaccounted).toEqual([])
})

test("the history walk follows a rename and resolves each revision's own path", () => {
    // Proves fix #2 mechanically instead of trusting the --follow flag to still be there: build a
    // throwaway repo whose cron module was renamed mid-history and assert the walk reaches the
    // pre-rename commit AND reports the old path for it. Without --follow the walk stops at the
    // rename; with --follow but today's path, `git show` can't read the pre-rename blob. Both
    // regressions look like "fewer versions checked", which no other assertion here would notice.
    const repo = mkdtempSync(join(tmpdir(), 'bismuth-cron-rename-'))
    const g = (...args: string[]) =>
        execFileSync(
            'git',
            [
                '-C',
                repo,
                '-c',
                'user.email=t@example.com',
                '-c',
                'user.name=t',
                '-c',
                'commit.gpgsign=false',
                ...args,
            ],
            {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        )
    try {
        g('init', '-q')
        mkdirSync(join(repo, 'daemon', 'src', 'daemon'), { recursive: true })
        const before = join(repo, 'daemon', 'src', 'daemon', 'oldName.ts')
        const after = join(repo, 'daemon', 'src', 'daemon', 'defaultCrons.ts')
        writeFileSync(
            before,
            'export const DEFAULT_CRONS = [{ name: "dream", content: "v1" }]\n',
            'utf-8',
        )
        g('add', '-A')
        g('commit', '-qm', 'add')
        g(
            'mv',
            'daemon/src/daemon/oldName.ts',
            'daemon/src/daemon/defaultCrons.ts',
        )
        g('commit', '-qm', 'rename')
        writeFileSync(
            after,
            'export const DEFAULT_CRONS = [{ name: "dream", content: "v2" }]\n',
            'utf-8',
        )
        g('add', '-A')
        g('commit', '-qm', 'edit')

        const revisions = cronRevisions(repo)
        expect(revisions).not.toBeNull()
        // Newest first: the edit and the rename see the new name, the original add sees the old one —
        // three revisions, where a --follow-less walk would have found only two.
        expect(revisions!.map(r => r.path)).toEqual([
            'daemon/src/daemon/defaultCrons.ts',
            'daemon/src/daemon/defaultCrons.ts',
            'daemon/src/daemon/oldName.ts',
        ])
        // ...and every (commit, path) pair the walk produced is actually readable, which is the whole
        // point of carrying the historical path around.
        for (const rev of revisions!)
            expect(g('show', `${rev.commit}:${rev.path}`)).toContain(
                'DEFAULT_CRONS',
            )
    } finally {
        rmSync(repo, { recursive: true, force: true })
    }
})

test('a revision that exists but cannot be reconstructed reports `unloadable`, never a silent skip', async () => {
    // Proves fix #1 mechanically. This is the exact self-disabling scenario: defaultCrons.ts grows a
    // value import and stops resolving out of a tmpdir. The original catch-all folded that into the
    // same `null` the "file didn't exist here" branch returned, so the newest revisions dropped out of
    // the walk while the suite stayed green off the older ones. The loader must be able to SAY which
    // of the two happened; the walk above turns `unloadable` into a failure. Two flavors, because both
    // would strand versions: an unresolvable import, and a module that parses fine but hands back no
    // crons (a rename of the export, a refactor into a builder function).
    const repo = mkdtempSync(join(tmpdir(), 'bismuth-cron-unloadable-'))
    const g = (...args: string[]) =>
        execFileSync(
            'git',
            [
                '-C',
                repo,
                '-c',
                'user.email=t@example.com',
                '-c',
                'user.name=t',
                '-c',
                'commit.gpgsign=false',
                ...args,
            ],
            {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        )
    try {
        g('init', '-q')
        mkdirSync(join(repo, 'daemon', 'src', 'daemon'), { recursive: true })
        const file = join(repo, 'daemon', 'src', 'daemon', 'defaultCrons.ts')

        writeFileSync(
            file,
            'import { PROMPT } from "./not-a-real-sibling.ts"\nexport const DEFAULT_CRONS = [{ name: "dream", content: PROMPT }]\n',
            'utf-8',
        )
        g('add', '-A')
        g('commit', '-qm', 'value import that cannot resolve standalone')
        const withImport = g('rev-parse', 'HEAD').trim()

        writeFileSync(file, 'export const SOMETHING_ELSE = 1\n', 'utf-8')
        g('add', '-A')
        g('commit', '-qm', 'no DEFAULT_CRONS export')
        const withoutExport = g('rev-parse', 'HEAD').trim()

        // Assert the REASON too, so neither flavor can pass by accidentally tripping the other's branch.
        const broken = await cronsAtRevision(
            { commit: withImport, path: CRONS_PATH },
            repo,
        )
        expect(broken.status).toBe('unloadable')
        expect(broken.status === 'unloadable' ? broken.reason : '').toContain(
            'not-a-real-sibling',
        )

        const empty = await cronsAtRevision(
            { commit: withoutExport, path: CRONS_PATH },
            repo,
        )
        expect(empty.status).toBe('unloadable')
        expect(empty.status === 'unloadable' ? empty.reason : '').toContain(
            'no DEFAULT_CRONS entries',
        )

        // ...and the legitimate skip still reads as a skip, so the distinction is real and not just a
        // relabeling of everything as a failure.
        const gone = await cronsAtRevision(
            { commit: withImport, path: 'daemon/src/daemon/never-existed.ts' },
            repo,
        )
        expect(gone.status).toBe('absent')
    } finally {
        rmSync(repo, { recursive: true, force: true })
    }
})

test('the specific stock version the first real install shipped with is listed (regression: it was not)', () => {
    // sha256 of the v1 `dream` body (2026-06-28, commit 7e1ad46). A pristine, never-edited copy of
    // this was sitting in a live vault while PRIOR_SEED_HASHES listed only v2, so reconcileSeeds
    // refused to upgrade it. Pinned literally so the entry can never be dropped even if the history
    // walk above is skipped for want of git history.
    expect(PRIOR_SEED_HASHES.dream).toContain(
        '751039390e12c74e9bb98044b97eb7bf508e5ec2a73dc71a42942eb61121e870',
    )
    // sha256 of the v1 `vault-review` body (7e1ad46, and unchanged through f48076b), likewise
    // unlisted before this fix.
    expect(PRIOR_SEED_HASHES['vault-review']).toContain(
        '355f4e794b4eb3860f30d271b0622c4a11e7d1d51c240159d77b1ead4bf38a39',
    )
})

test('PRIOR_SEED_HASHES never lists the CURRENT content (that would make an up-to-date file look like a stale prior)', () => {
    for (const cron of DEFAULT_CRONS) {
        expect(PRIOR_SEED_HASHES[cron.name] ?? []).not.toContain(
            sha256(cron.content),
        )
    }
})

test('PRIOR_SEED_HASHES entries are unique, lowercase hex sha256s, and cover every default cron', () => {
    for (const cron of DEFAULT_CRONS) {
        const hashes = PRIOR_SEED_HASHES[cron.name]
        expect(hashes, `no prior-hash history for "${cron.name}"`).toBeDefined()
        for (const h of hashes!) expect(h).toMatch(/^[0-9a-f]{64}$/)
        expect(new Set(hashes).size).toBe(hashes!.length)
    }
})

// ---------------------------------------------------------------------------
// Prompt content invariants. These are cheap string assertions, but each one pins a defect that
// actually shipped and cost the user a month of useless cron runs.
// ---------------------------------------------------------------------------

const DREAM = DEFAULT_CRONS.find(c => c.name === 'dream')!.content
const VAULT_REVIEW = DEFAULT_CRONS.find(c => c.name === 'vault-review')!.content

test('both prompts still carry the {{changedSinceLastRun}} placeholder the daemon substitutes', () => {
    // incrementalCron.ts replaces this token before the session starts; losing it silently reverts
    // both crons to re-surveying everything every run.
    expect(DREAM).toContain('{{changedSinceLastRun}}')
    expect(VAULT_REVIEW).toContain('{{changedSinceLastRun}}')
})

test('both prompts keep their incremental frontmatter contract intact', () => {
    expect(DREAM).toStartWith(
        '---\nname: dream\nschedule: 0 * * * *\ntimeout: 1800\ncatchup: true\nincremental: true\ncheckpointDir: memory\n---\n',
    )
    expect(VAULT_REVIEW).toStartWith(
        '---\nname: vault-review\nschedule: 0 */4 * * *\ntimeout: 900\ncatchup: true\nnotify: true\nincremental: true\n---\n',
    )
})

test('dream forbids writing a memory note about its own runs, and tells it to delete one it inherits', () => {
    // The live graph's largest note was `memory-consolidation-dream-cycle.md` (19 KB) — a status log
    // dream appended a "Cycle N" block to every hour. The prohibition and the cleanup must both be
    // present, or the note simply reappears.
    expect(DREAM).toContain(
        'NEVER write a memory note about yourself, this cron, or how a run went',
    )
    expect(DREAM).toContain('It is not a note')
    expect(DREAM).toContain('`forget` it on this run')
    expect(DREAM).toContain(
        'Write a memory note about this cron, its runs, or its results',
    )
})

test("dream's report is printed output, never remembered as a note", () => {
    expect(DREAM).toContain('PRINT — do not `remember`')
    // ...and the old wording that merely said "End with a one-line summary" (which read as an
    // invitation to write it somewhere) is gone.
    expect(DREAM).not.toContain('End with a one-line summary')
})

test("dream's bloat gate measures the notes, not the git repo the memory dir happens to be", () => {
    // `du -sh $BISMUTH_MEMORY_DIR` reported 31 MB on a graph of 0.6 MB of markdown — the other 28 MB
    // was .git (one autosave commit per write). The gate must exclude dot-directories, and the
    // threshold must be on the scale of the actual content.
    expect(DREAM).not.toContain('```bash\ndu -sh') // no runnable du gate survives anywhere in the prompt
    expect(DREAM).toContain("find . -name '.?*' -prune -o -type f -name '*.md'")
    expect(DREAM).toContain('exceeds **5 MB**')
    expect(DREAM).not.toContain('> 50 MB')
    expect(DREAM).not.toContain('back under 50 MB')
})

test("dream collapses date-stamped snapshots and refuses the 'historical record' excuse", () => {
    expect(DREAM).toContain(
        'Collapse date-stamped snapshots into ONE canonical living note',
    )
    expect(DREAM).toContain(
        '"It is a historical record" is NOT a reason to keep a duplicate',
    )
    // The real filenames from the user's graph, kept as the worked example so the rule is unambiguous.
    expect(DREAM).toContain(
        'michael-vault-review-july-26-evening-escalation.md',
    )
    expect(DREAM).toContain('vault-review-2026-07-24-checkpoint.md')
    expect(DREAM).toContain('michael-quant-trading-status-july-25-2026.md')
    // ...and a run that merges nothing while duplicates exist must be reported as a failure.
    expect(DREAM).toContain('the run FAILED')
})

test("dream's cluster-detection shell one-liner survives template-literal escaping verbatim", () => {
    // The prompt is a TS template literal; a mis-escaped `$` or backtick would ship a broken command
    // to a model that has no way to notice. Pin the exact bytes of the sed pipeline.
    expect(DREAM).toContain(
        "ls *.md | sed -E 's/[-_](19|20)[0-9]{2}.*$//; s/[-_](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*.*$//; s/\\.md$//' | sort | uniq -c | sort -rn",
    )
    // The awk size sum likewise: a literal backslash-n reaches awk's printf, not a real newline.
    expect(DREAM).toContain(
        'awk \'{ bytes += $5 } END { printf "%d notes, %d KB of markdown\\n", NR, bytes/1024 }\'',
    )
    expect(DREAM).not.toContain('${') // no accidental interpolation site left in the shipped text
})

/** Pull the Step 3 cluster-detection pipeline out of the SHIPPED prompt (the block containing
 *  `uniq -c`), so the test below runs the exact bytes the model will run — not a copy that could
 *  drift away from the prompt without anyone noticing. */
function shippedClusterCommand(): string {
    const match = DREAM.match(/```bash\n([^`]*uniq -c[^`]*)\n```/)
    expect(
        match,
        "Step 3's cluster-detection bash block is gone from the dream prompt",
    ).not.toBeNull()
    return match![1]!
}

/** Pull one of Step 3's worked-example filename lists out of the shipped prompt. */
function shippedExample(marker: string): string[] {
    const match = DREAM.match(
        new RegExp(`${marker}\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``),
    )
    expect(
        match,
        `Step 3's worked example "${marker}" is gone from the dream prompt`,
    ).not.toBeNull()
    return match![1]!.split('\n').filter(Boolean)
}

/** Run the shipped pipeline against a throwaway memory dir containing exactly `files`, and return
 *  the `uniq -c` output as {stem, count} pairs. */
function clusterStems(files: string[]): { stem: string; count: number }[] {
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-cron-cluster-'))
    try {
        for (const f of files) writeFileSync(join(dir, f), 'x\n', 'utf-8')
        const out = execFileSync('bash', ['-c', shippedClusterCommand()], {
            encoding: 'utf-8',
            env: { ...process.env, BISMUTH_MEMORY_DIR: dir },
            stdio: ['ignore', 'pipe', 'ignore'],
        })
        return out
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => {
                const [count, ...rest] = l.split(/\s+/)
                return { stem: rest.join(' '), count: Number(count) }
            })
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

test("KNOWN DIVERGENCE: Step 3's shipped command splits its own seven-file worked example into TWO stems, not one", () => {
    // The prompt calls this exact set "ONE note, not seven", but the sed pipeline it ships alongside
    // only strips date/month tokens from the RIGHT of a name — it never normalizes a leading
    // qualifier. So `michael-vault-review-july-22-2026-final.md` reduces to `michael-vault-review`
    // while `vault-review-2026-07-24-checkpoint.md` reduces to `vault-review`, and the worked example
    // comes back as two clusters. The prose that follows the command still covers the gap (the model
    // is separately told to treat "several notes that clearly share a topic once you strip the above"
    // as one cluster), so the prompt is not broken — but the command demonstrably does not produce
    // the result its own example claims, and that mismatch is worth being visible rather than folklore.
    //
    // This test PINS the divergence, it does not bless it. If someone teaches the pipeline to fold the
    // leading qualifier (e.g. a second sed pass, or clustering on the longest common suffix), this
    // will fail — update the expectation to the single `vault-review` cluster and delete this comment.
    const stems = clusterStems(shippedExample('ONE note, not seven:'))
    expect(stems).toEqual([
        { stem: 'michael-vault-review', count: 5 },
        { stem: 'vault-review', count: 2 },
    ])
})

test("Step 3's shipped command DOES collapse the two-file worked example, so the pipeline itself works", () => {
    // The counterexample that proves the divergence above is about the leading qualifier and nothing
    // else: when the names share a prefix, the same command collapses them exactly as advertised.
    const stems = clusterStems(shippedExample('ONE note, not two:'))
    expect(stems).toEqual([{ stem: 'michael-quant-trading-status', count: 2 }])
})

test('vault-review names canonical notes and forbids dated ones as an instruction, not a preference', () => {
    expect(VAULT_REVIEW).toContain('canonical notes ONLY')
    expect(VAULT_REVIEW).toContain('`user-beliefs`')
    expect(VAULT_REVIEW).toContain('`user-projects`')
    expect(VAULT_REVIEW).toContain(
        '**Never create a note whose name contains a date or a month.**',
    )
    expect(VAULT_REVIEW).toContain(
        'michael-vault-review-july-27-evening-critical-update',
    )
    expect(VAULT_REVIEW).toContain('This is an instruction, not a preference')
    expect(VAULT_REVIEW).toContain(
        'Never write a note about this review itself',
    )
    // It must REWRITE the canonical note rather than create a sibling.
    expect(VAULT_REVIEW).toContain(
        '`remember` the SAME name with the full rewritten body',
    )
    // The old soft wording is what failed; it must not survive.
    expect(VAULT_REVIEW).not.toContain(
        'Prefer updating one consolidated note per topic',
    )
})

// Bug (observed 2026-08-06, a real vault): a cron run wrote two plain, frontmatter-less markdown
// files into `<vault>/memory/` instead of the memory graph at `<vault>/.daemon/memory`. They never
// went through `remember`, so they carried no `type:`/`tags:`/`created:`/`updated:`, were absent
// from the memory dir's own git repo, and sat orphaned in the user's vault with nothing linking to
// them.
//
// The prompt-side cause is directly measurable here and was true of every version shipped up to and
// including v4: `dream` named `$BISMUTH_MEMORY_DIR` ten times, and `vault-review` — the cron that
// actually writes findings — named it ZERO times, while telling the model to "fix the memory" with
// a working directory of the vault ROOT. An agent asked to record something, given no location and
// no usable tool, resolves a path against its cwd; `memory/` is the obvious guess.
//
// So the invariant is not "dream mentions the variable" but "EVERY default cron that can write a
// memory note says where memory is". Asserted over DEFAULT_CRONS as a whole rather than over the
// two names, so a third seeded cron added later inherits the check instead of quietly skipping it.
test('every default cron names the memory dir it is allowed to write to', () => {
    for (const cron of DEFAULT_CRONS) {
        expect(
            `${cron.name}: ${cron.content.includes('$BISMUTH_MEMORY_DIR')}`,
        ).toBe(`${cron.name}: true`)
    }
})

test('vault-review points memory writes at the graph, not at a path relative to its cwd', () => {
    // The location, and the ONE mechanism that produces a well-formed note.
    expect(VAULT_REVIEW).toContain('Your memory graph is `$BISMUTH_MEMORY_DIR`')
    expect(VAULT_REVIEW).toContain(
        'the `remember` tool is the ONLY way to put one there',
    )
    // The specific wrong turn that produced the orphaned notes, named so the model can recognize it:
    // cwd is the vault, so a cwd-relative `memory/` is the user's vault, not the graph.
    expect(VAULT_REVIEW).toContain(
        'Your working directory is the VAULT, not the memory graph',
    )
    expect(VAULT_REVIEW).toContain('NEVER create a memory note with Write/Edit')
    // And the degrade path: no tools must mean "write nothing", never "improvise a location". This
    // is the half that matters when the MCP block is absent entirely (session.ts's mcpBin() gate).
    expect(VAULT_REVIEW).toContain('Do not improvise a location')
    expect(VAULT_REVIEW).toContain('write nothing')
})
