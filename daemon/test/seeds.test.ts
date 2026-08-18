// Versioned seed refresh (daemon/src/daemon/seeds.ts): reconcileSeeds must upgrade an EXISTING
// vault's default cron in place when it's still byte-identical to a known prior stock version
// (so "dream"/"vault-review" ship their incremental-scoping upgrade to already-set-up vaults, not
// just brand-new ones), while never touching a file the user has since customized even slightly.
//
// Versions are named the way PRIOR_SEED_HASHES names them and nowhere else differently: v1 =
// 2026-06-28, v2 = 2026-07-06, v3 = 2026-07-27 (incremental scoping), v4 = the current
// DEFAULT_CRONS content. Every test below says which version it puts on disk, because "the old
// one" is ambiguous across four of them — and that ambiguity is what let a whole version go
// unlisted in the first place.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
    mkdtempSync,
    rmSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
    reconcileSeeds,
    seedsFor,
    PRIOR_SEED_HASHES,
} from '../src/daemon/seeds.ts'
import { vaultPaths, type VaultContext } from '../src/lib/config.ts'
import { DEFAULT_CRONS, type DefaultCron } from '../src/daemon/defaultCrons.ts'
import {
    DREAM_V2_CONTENT,
    DREAM_V2_HASH,
    VAULT_REVIEW_V2_CONTENT,
    VAULT_REVIEW_V2_HASH,
} from './fixtures/oldSeedContent.ts'

const CURRENT_DREAM = DEFAULT_CRONS.find(c => c.name === 'dream')!.content
const CURRENT_VAULT_REVIEW = DEFAULT_CRONS.find(
    c => c.name === 'vault-review',
)!.content

/**
 * Load a default cron's body exactly as it shipped at a given commit, by writing that revision of
 * defaultCrons.ts to a temp file and importing it (the module has no imports of its own, so it
 * loads standalone, and the bytes come back through the real TS parser rather than a hand-rolled
 * un-escaper). Returns null when git history isn't available — a shallow clone must SKIP the test
 * that uses this, not fail it.
 *
 * Deliberately duplicated from defaultCrons.test.ts rather than shared: importing one *.test.ts
 * from another re-registers all of its `test()` calls under the importing file.
 */
async function shippedCronAtCommit(
    commit: string,
    name: string,
): Promise<string | null> {
    const repoRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
    )
    let source: string
    try {
        source = execFileSync(
            'git',
            [
                '-C',
                repoRoot,
                'show',
                `${commit}:daemon/src/daemon/defaultCrons.ts`,
            ],
            {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        )
    } catch {
        return null
    }
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-cron-rev-'))
    try {
        const file = join(dir, `defaultCrons.${commit.slice(0, 12)}.ts`)
        writeFileSync(file, source, 'utf-8')
        const mod = (await import(file)) as { DEFAULT_CRONS?: DefaultCron[] }
        return mod.DEFAULT_CRONS?.find(c => c.name === name)?.content ?? null
    } catch {
        return null
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const sha256 = (s: string) =>
    createHash('sha256').update(s, 'utf-8').digest('hex')

let root: string
let ctx: VaultContext

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bismuth-seeds-'))
    ctx = vaultPaths(root)
})

afterEach(() => {
    rmSync(root, { recursive: true, force: true })
})

test('a fresh vault (nothing on disk) gets every seed written, including the two default crons', async () => {
    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toEqual([])
    expect(result.customized).toEqual([])
    expect(result.written.sort()).toEqual(
        seedsFor(ctx)
            .map(s => s.path)
            .sort(),
    )
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )
    expect(readFileSync(join(ctx.cronsDir, 'vault-review.md'), 'utf-8')).toBe(
        CURRENT_VAULT_REVIEW,
    )
})

test("the v2 fixtures ARE PRIOR_SEED_HASHES' v2 entries — one version vocabulary, mechanically enforced", () => {
    // The fixture file and seeds.ts each carry a notion of "an older stock version". If those two
    // drift, the tests below silently stop exercising the version they claim to (this is the same
    // class of confusion — two vocabularies for the same bytes — that hid the original defect).
    // Re-derive from content so the labels cannot be wrong in only one place.
    expect(sha256(DREAM_V2_CONTENT)).toBe(DREAM_V2_HASH)
    expect(PRIOR_SEED_HASHES.dream![1]).toBe(DREAM_V2_HASH)
    expect(sha256(VAULT_REVIEW_V2_CONTENT)).toBe(VAULT_REVIEW_V2_HASH)
    expect(PRIOR_SEED_HASHES['vault-review']![1]).toBe(VAULT_REVIEW_V2_HASH)
})

test('an existing vault whose dream.md still matches stock v2 (2026-07-06, pre-incremental) is upgraded in place', async () => {
    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(join(ctx.cronsDir, 'dream.md'), DREAM_V2_CONTENT, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toContain(join(ctx.cronsDir, 'dream.md'))
    expect(result.customized).toEqual([])
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )
})

test('an existing vault stuck on stock v1 dream.md (2026-06-28) is upgraded — the case that was silently broken', async () => {
    // The real regression: a live vault's dream.md was byte-identical to v1 (7e1ad46, sha256 751039…),
    // never touched by the user — but only v2's hash was listed in PRIOR_SEED_HASHES, so
    // reconcileSeeds read it as user-customized and left it frozen on the pre-incremental prompt
    // forever. Reconstructed from git so it's the true bytes.
    const v1 = await shippedCronAtCommit('7e1ad46', 'dream')
    if (!v1) return // no git history available (shallow clone) — nothing to reconstruct
    expect(sha256(v1)).toBe(
        '751039390e12c74e9bb98044b97eb7bf508e5ec2a73dc71a42942eb61121e870',
    )
    expect(v1).not.toBe(DREAM_V2_CONTENT) // genuinely a DIFFERENT, older stock version than the v2 fixture

    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(join(ctx.cronsDir, 'dream.md'), v1, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toContain(join(ctx.cronsDir, 'dream.md'))
    expect(result.customized).toEqual([])
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )
})

test('an existing vault stuck on stock v1 vault-review.md (2026-06-28) is upgraded too', async () => {
    const v1 = await shippedCronAtCommit('7e1ad46', 'vault-review')
    if (!v1) return
    expect(sha256(v1)).toBe(
        '355f4e794b4eb3860f30d271b0622c4a11e7d1d51c240159d77b1ead4bf38a39',
    )

    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(join(ctx.cronsDir, 'vault-review.md'), v1, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toContain(join(ctx.cronsDir, 'vault-review.md'))
    expect(readFileSync(join(ctx.cronsDir, 'vault-review.md'), 'utf-8')).toBe(
        CURRENT_VAULT_REVIEW,
    )
})

test('a vault on stock v3 dream.md (2026-07-27, the incremental-scoping release) is upgraded to v4', async () => {
    // v3 shipped in 5991271 — the current version until this change, a prior version as of it.
    // Without appending its hash, every vault that took that release would freeze on prompts whose
    // dream cron writes a status note about itself and measures .git as if it were the notes.
    const v3 = await shippedCronAtCommit('5991271', 'dream')
    if (!v3) return
    expect(sha256(v3)).toBe(
        'd324876622fd7a3453217a90605521f13f17e538ac10da8cbf36464e7c559a1c',
    )

    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(join(ctx.cronsDir, 'dream.md'), v3, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toContain(join(ctx.cronsDir, 'dream.md'))
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )
})

test('an existing vault whose vault-review.md still matches stock v2 (2026-07-06) is upgraded in place', async () => {
    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(
        join(ctx.cronsDir, 'vault-review.md'),
        VAULT_REVIEW_V2_CONTENT,
        'utf-8',
    )

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toContain(join(ctx.cronsDir, 'vault-review.md'))
    expect(readFileSync(join(ctx.cronsDir, 'vault-review.md'), 'utf-8')).toBe(
        CURRENT_VAULT_REVIEW,
    )
})

test('a user-customized dream.md (matches NO stock version, v1 through v4) is left completely untouched', async () => {
    mkdirSync(ctx.cronsDir, { recursive: true })
    // Edit a phrase that's actually inside the seeded BODY (not just a surrounding JS comment) so
    // the fixture is genuinely byte-different from every stock version, not just from v2.
    expect(DREAM_V2_CONTENT).toContain("Consolidate this vault's memory graph")
    const customized = DREAM_V2_CONTENT.replace(
        "Consolidate this vault's memory graph",
        "MY CUSTOM: consolidate this vault's memory graph",
    )
    expect(customized).not.toBe(DREAM_V2_CONTENT) // sanity: the replace actually took effect
    expect(PRIOR_SEED_HASHES.dream).not.toContain(sha256(customized)) // ...and it is no stock version
    writeFileSync(join(ctx.cronsDir, 'dream.md'), customized, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toEqual([])
    expect(result.customized).toContain(join(ctx.cronsDir, 'dream.md'))
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        customized,
    ) // byte-identical, untouched
})

test('a dream.md the user wrote from scratch (unrelated content) is also left untouched, not treated as customized-from-nothing', async () => {
    mkdirSync(ctx.cronsDir, { recursive: true })
    const scratch =
        '---\nname: dream\nschedule: 0 3 * * *\n---\n\nMy own thing.\n'
    writeFileSync(join(ctx.cronsDir, 'dream.md'), scratch, 'utf-8')

    const result = await reconcileSeeds(ctx)
    expect(result.customized).toContain(join(ctx.cronsDir, 'dream.md'))
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(scratch)
})

test('a dream.md already on the CURRENT (incremental) version is a no-op — not written, refreshed, or flagged customized', async () => {
    // Fully seed the vault first (writes everything, including a fresh dream.md at CURRENT_DREAM),
    // then reconcile again — a clean second pass touches nothing.
    await reconcileSeeds(ctx)
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )

    const result = await reconcileSeeds(ctx)
    expect(result.written).toEqual([])
    expect(result.refreshed).toEqual([])
    expect(result.customized).toEqual([])
    expect(readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')).toBe(
        CURRENT_DREAM,
    )
})

test('non-versioned seeds (identity.md, PAGES.md) are never refreshed or flagged even when their content is stale/different', async () => {
    mkdirSync(ctx.daemonDir, { recursive: true })
    writeFileSync(
        ctx.identityFile,
        '---\nname: daemon\n---\n\nSome old identity text.\n',
        'utf-8',
    )

    const result = await reconcileSeeds(ctx)
    expect(result.refreshed).toEqual([])
    expect(result.customized.some(p => p === ctx.identityFile)).toBe(false)
    expect(readFileSync(ctx.identityFile, 'utf-8')).toBe(
        '---\nname: daemon\n---\n\nSome old identity text.\n',
    )
})

test('running reconcileSeeds twice in a row is idempotent (second pass is a no-op)', async () => {
    mkdirSync(ctx.cronsDir, { recursive: true })
    writeFileSync(join(ctx.cronsDir, 'dream.md'), DREAM_V2_CONTENT, 'utf-8')

    const first = await reconcileSeeds(ctx)
    expect(first.refreshed).toContain(join(ctx.cronsDir, 'dream.md'))

    const second = await reconcileSeeds(ctx)
    expect(second.written).toEqual([])
    expect(second.refreshed).toEqual([])
    expect(second.customized).toEqual([])
})

test('a missing crons dir (never seeded before) still yields written for both default crons with the CURRENT incremental content', async () => {
    const result = await reconcileSeeds(ctx)
    expect(existsSync(join(ctx.cronsDir, 'dream.md'))).toBe(true)
    expect(existsSync(join(ctx.cronsDir, 'vault-review.md'))).toBe(true)
    const dreamBody = readFileSync(join(ctx.cronsDir, 'dream.md'), 'utf-8')
    expect(dreamBody).toContain('incremental: true')
    expect(dreamBody).toContain('{{changedSinceLastRun}}')
    expect(result.written.length).toBeGreaterThan(0)
})
