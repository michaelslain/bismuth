// scripts/passCache.ts
//
// Which git trees have already passed a test tier, so a gate never re-runs tests on content that
// passed them. A tree id names the exact bytes of every tracked file, so a pass recorded for a tree
// holds for any commit, branch or worktree with that tree. Records live in
// `<git common dir>/bismuth-gate/passes.jsonl`, shared by every worktree of the repo.
//
// A record is either a full pass (`base` absent: every test of the tier ran) or a selection pass:
// the tests `scripts/testGraph.ts` selects for the diff from `base` passed. A tree is green when it
// has a full pass, or a selection pass whose base is green: the tests the diff cannot reach have
// the same inputs as on the base, where they passed.
//
// A record is written only for a run whose working tree had no unstaged or untracked changes, so
// what ran was exactly the tree. It also carries the Bun version; a record from another version
// does not count.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** `fast`: typecheck + the fast tests (BISMUTH_FAST_TESTS=1). `full`: typecheck + every test.
 *  A full pass counts as a fast pass. */
export type Tier = 'fast' | 'full'

export type PassRecord = {
    tree: string
    tier: Tier
    /** The tree the selection was taken against; absent for a full pass. */
    base?: string
    bun: string
    at: string
}

const MAX_RECORDS = 5000

function git(args: string[]): { ok: boolean; out: string } {
    const r = spawnSync('git', args, { encoding: 'utf8' })
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() }
}

export function cacheFile(cwd = process.cwd()): string {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf8',
    })
    const common = r.stdout.trim() || '.git'
    const abs = isAbsolute(common) ? common : resolve(cwd, common)
    return join(abs, 'bismuth-gate', 'passes.jsonl')
}

export function readPasses(file = cacheFile()): PassRecord[] {
    let text = ''
    try {
        text = readFileSync(file, 'utf8')
    } catch {
        return []
    }
    const out: PassRecord[] = []
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
            out.push(JSON.parse(line))
        } catch {
            /* a torn line from an interrupted write */
        }
    }
    return out
}

export function recordPass(
    rec: Omit<PassRecord, 'bun' | 'at'>,
    file = cacheFile(),
): void {
    mkdirSync(join(file, '..'), { recursive: true })
    const full: PassRecord = {
        ...rec,
        bun: Bun.version,
        at: new Date().toISOString(),
    }
    appendFileSync(file, JSON.stringify(full) + '\n')
    const all = readPasses(file)
    if (all.length > MAX_RECORDS)
        writeFileSync(
            file,
            all
                .slice(-MAX_RECORDS / 2)
                .map(r => JSON.stringify(r))
                .join('\n') + '\n',
        )
}

const covers = (have: Tier, want: Tier) => have === want || have === 'full'

/** Has `tree` passed `tier`, directly or through a chain of selection passes ending in a full one?
 *  Pure over `passes`. */
export function isGreen(
    tree: string,
    tier: Tier,
    passes: PassRecord[],
    bun = Bun.version,
    seen = new Set<string>(),
): boolean {
    if (seen.has(tree)) return false
    seen.add(tree)
    const mine = passes.filter(
        p => p.tree === tree && p.bun === bun && covers(p.tier, tier),
    )
    if (mine.some(p => !p.base)) return true
    return mine.some(
        p => p.base && isGreen(p.base, tier, passes, bun, new Set(seen)),
    )
}

/** The tree id of a revision (`HEAD`, a sha, `main`), or undefined if it does not resolve. */
export function treeOf(rev: string): string | undefined {
    const r = git(['rev-parse', '--verify', '--quiet', `${rev}^{tree}`])
    return r.ok && r.out ? r.out : undefined
}

/** The tree of the index: what `git commit` would record. Writes only tree objects. */
export function indexTree(): string | undefined {
    const r = git(['write-tree'])
    return r.ok && r.out ? r.out : undefined
}

/** `git status` lines, untracked files included. */
function statusLines(): string[] {
    const r = spawnSync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { encoding: 'utf8' },
    )
    return (r.stdout ?? '').split('\n').filter(Boolean)
}

/** No staged, unstaged or untracked change: the working tree is exactly HEAD's tree. */
export function workingTreeClean(): boolean {
    return statusLines().length === 0
}

/** No unstaged or untracked change: the working tree is exactly the index's tree. */
export function workingTreeMatchesIndex(): boolean {
    return statusLines().every(l => l[1] === ' ' && !l.startsWith('??'))
}
