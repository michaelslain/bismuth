import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { $ } from 'bun'
import { makeVault } from './helpers'
import { runTaskMigration } from '../src/taskMigrateRun'
import { getFileAccess, setFileAccess, type FileAccess } from '../src/fileAccess'

const read = (root: string, rel: string) => Bun.file(join(root, rel)).text()

const isRepo = async (root: string) =>
    (await $`git -C ${root} rev-parse --git-dir`.nothrow().quiet()).exitCode ===
    0

/** Turn `root` into a git repo with everything already committed, so commitVault finds
 *  nothing to commit and returns false. */
async function commitEverything(root: string): Promise<void> {
    await $`git -C ${root} init -q`.quiet()
    await $`git -C ${root} config user.email t@t`.quiet()
    await $`git -C ${root} config user.name t`.quiet()
    await $`git -C ${root} add -A`.quiet()
    await $`git -C ${root} commit -q -m seed`.quiet()
}

test('a clean vault is not touched and takes no snapshot', async () => {
    const root = makeVault({ 'a.md': '- [ ] already [due 2026-01-01]\n' })
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(false)
    expect(r.blocked).toBe(false)
    expect(r.changed).toBe(0)
    expect(r.snapshot).toBe(false)
    expect(await read(root, 'a.md')).toBe('- [ ] already [due 2026-01-01]\n')
    // Nothing was rewritten, so nothing should have been committed either — a boot-time
    // pass must not turn a plain folder into a git repo for no reason.
    expect(await isRepo(root)).toBe(false)
})

test('a legacy vault is rewritten after a snapshot', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(true)
    expect(r.blocked).toBe(false)
    expect(r.changed).toBe(1)
    expect(r.files).toEqual([{ file: 'a.md', changed: 1 }])
    expect(r.skipped).toEqual([])
    expect(r.snapshot).toBe(true)
    expect(await read(root, 'a.md')).toBe('- [ ] milk [due 2026-09-14]\n')
    // the pre-migration content is recoverable from the snapshot commit
    const log = await $`git -C ${root} log --oneline`.text()
    expect(log).toContain('before task syntax migration')
    const before = await $`git -C ${root} show HEAD:a.md`.text()
    expect(before).toBe('- [ ] milk 📅 2026-09-14\n')
})

test('a second run finds nothing', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    await runTaskMigration(root)
    const again = await runTaskMigration(root)
    expect(again.ran).toBe(false)
    expect(again.changed).toBe(0)
    expect(again.snapshot).toBe(false)
})

test('an unconvertible line is rewritten and reported, not skipped', async () => {
    const root = makeVault({ 'a.md': '- [ ] taxes 📅 2026-02-30\n' })
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(true)
    expect(r.flagged).toEqual([
        { file: 'a.md', line: 0, text: '- [ ] taxes [due 2026-02-30]' },
    ])
})

// server.ts seeds its ChangeTracker from this callback so a note's first save after boot can be
// classified content-only instead of forced structural. It must fire for every note the scan
// actually read — including ones with no legacy signifier at all, since those are exactly the
// notes that would otherwise reach their first PUT /file unseeded.
test('onScanned receives every scanned note with its actual content', async () => {
    const root = makeVault({ 'a.md': 'content of a', 'b.md': 'content of b' })
    const seen = new Map<string, string>()
    await runTaskMigration(root, {
        onScanned: (rel, text) => seen.set(rel, text),
    })
    expect([...seen.keys()].sort()).toEqual(['a.md', 'b.md'])
    // Wave 3 review (I2): the original test only checked which paths were reported, never the
    // text handed alongside them — server.ts seeds the change tracker's FINGERPRINT from this
    // exact string (tracker.seed(rel, text)), so wrong/stale/swapped text here would seed the
    // tracker with the wrong baseline and this test would never notice.
    expect(seen.get('a.md')).toBe('content of a')
    expect(seen.get('b.md')).toBe('content of b')
})

test('BISMUTH_NO_TASK_MIGRATE skips the whole pass', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    process.env.BISMUTH_NO_TASK_MIGRATE = '1'
    try {
        const r = await runTaskMigration(root)
        expect(r.ran).toBe(false)
        expect(await read(root, 'a.md')).toContain('📅')
        expect(await isRepo(root)).toBe(false)
    } finally {
        delete process.env.BISMUTH_NO_TASK_MIGRATE
    }
})

// `hasLegacySignifier` matches ✅, which is an ordinary emoji people write in prose. A vault
// holding "shipped it ✅" and no legacy task line at all passes the per-file pre-filter and
// rewrites nothing — so `ran` keys off what actually CHANGED, never off what the scan found.
// Getting this wrong reports a migration that did nothing and, worse, git-commits the user's
// whole vault to snapshot a rewrite that never happened.
test('an emoji in prose does not count as a migration', async () => {
    const root = makeVault({
        'a.md': 'shipped it ✅\n\n- [x] real task [done 2026-09-01]\n',
    })
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(false)
    expect(r.changed).toBe(0)
    expect(r.snapshot).toBe(false)
    expect(r.files).toEqual([])
    expect(await isRepo(root)).toBe(false)
    expect(await read(root, 'a.md')).toBe(
        'shipped it ✅\n\n- [x] real task [done 2026-09-01]\n',
    )
})

// migrateTaskLine rebuilds ANY task line it is handed into a canonical field order, and the
// legacy pre-filter only gates per FILE. Without a per-LINE gate, one emoji task in a note
// silently reorders every already-correct task line beside it the first time the user opens
// their vault after upgrading — someone's notes rewritten for no reason.
test('an already-correct line beside a legacy one is left byte-identical', async () => {
    const root = makeVault({
        'a.md': [
            '- [ ] milk 📅 2026-09-14',
            '- [ ] buy bread [high] [due 2026-09-15]',
            '    - [ ] deep   spacing   [low]',
            '',
        ].join('\n'),
    })
    const r = await runTaskMigration(root)
    expect(r.changed).toBe(1)
    expect(await read(root, 'a.md')).toBe(
        [
            '- [ ] milk [due 2026-09-14]',
            '- [ ] buy bread [high] [due 2026-09-15]',
            '    - [ ] deep   spacing   [low]',
            '',
        ].join('\n'),
    )
})

// The user chose an automatic rewrite over a confirmation prompt ON THE CONDITION that a local
// git snapshot is taken first. If the snapshot cannot be taken, the trade is off: abort rather
// than perform a rewrite nobody can undo — and SAY SO, because a silent abort on a machine
// with no usable git means the vault is never migrated and, with the emoji reader gone, every
// date and priority in it is invisible to the app forever with no message anywhere.
test('a failed snapshot blocks the migration and says so', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    // A `.git` that exists but is not a valid gitfile: ensureRepo skips `git init` (something
    // is already there) and its work-tree assertion then fails, so commitVault throws.
    writeFileSync(join(root, '.git'), 'not a gitfile')
    const r = await runTaskMigration(root)
    expect(r.blocked).toBe(true)
    expect(r.snapshotError).toBeTruthy()
    expect(r.ran).toBe(false)
    expect(r.snapshot).toBe(false)
    expect(r.changed).toBe(0)
    expect(r.files).toEqual([])
    expect(await read(root, 'a.md')).toBe('- [ ] milk 📅 2026-09-14\n')
})

// One unreadable file must not abort the run and leave the vault half migrated.
test('an unreadable file is skipped and the rest of the vault still migrates', async () => {
    const root = makeVault({
        'bad.md': '- [ ] taxes 📅 2026-09-14\n',
        'good.md': '- [ ] milk 📅 2026-09-14\n',
    })
    const real = await getFileAccess()
    setFileAccess({
        ...real,
        readNote: (r, rel) =>
            rel === 'bad.md'
                ? Promise.reject(new Error('EACCES'))
                : real.readNote(r, rel),
    } satisfies FileAccess)
    try {
        const r = await runTaskMigration(root)
        expect(r.ran).toBe(true)
        expect(r.files).toEqual([{ file: 'good.md', changed: 1 }])
        expect(r.skipped).toEqual([
            { file: 'bad.md', reason: 'unreadable', error: 'EACCES' },
        ])
        expect(await read(root, 'good.md')).toBe('- [ ] milk [due 2026-09-14]\n')
        expect(await read(root, 'bad.md')).toBe('- [ ] taxes 📅 2026-09-14\n')
    } finally {
        setFileAccess(real)
    }
})

// THE SNAPSHOT AND THE WALK DISAGREE ABOUT WHICH FILES EXIST. commitVault is `git add -A`,
// which honours .gitignore / .git/info/exclude / core.excludesFile and records a nested repo as
// a gitlink; listMarkdown is a plain glob that honours none of them. So a file the migration is
// about to overwrite may not be in the snapshot at all — and ignoring `Archive/` in a synced
// notes vault is ordinary practice. Verify against what git actually tracks and SKIP the rest:
// a skipped file keeps its emoji syntax and can be converted by hand later, an overwritten one
// that is in no commit is simply gone.
test('a git-ignored note is skipped, not rewritten, because the snapshot cannot hold it', async () => {
    const root = makeVault({
        '.gitignore': 'Archive/\n',
        'Archive/old.md': '- [ ] taxes 📅 2026-09-14\n',
        'todo.md': '- [ ] milk 📅 2026-09-14\n',
    })
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(true)
    expect(r.files).toEqual([{ file: 'todo.md', changed: 1 }])
    expect(r.skipped).toEqual([
        { file: 'Archive/old.md', reason: 'not-snapshotted' },
    ])
    // untouched on disk, so nothing was destroyed outside the snapshot
    expect(await read(root, 'Archive/old.md')).toBe(
        '- [ ] taxes 📅 2026-09-14\n',
    )
    expect(await read(root, 'todo.md')).toBe('- [ ] milk [due 2026-09-14]\n')
})

// `snapshot` says whether THIS run wrote a snapshot commit. A vault whose repo was already
// clean has its pre-migration content at HEAD already, so there is nothing to commit and the
// field is false while the state is still fully recoverable — which is exactly why the capture
// check above asks git what it tracks rather than trusting this boolean.
test('snapshot is false when the vault repo was already clean', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    await commitEverything(root)
    const r = await runTaskMigration(root)
    expect(r.ran).toBe(true)
    expect(r.snapshot).toBe(false)
    expect(r.changed).toBe(1)
    expect(await read(root, 'a.md')).toBe('- [ ] milk [due 2026-09-14]\n')
    // …and the pre-migration content is still recoverable, from the commit that was already there
    expect(await $`git -C ${root} show HEAD:a.md`.text()).toBe(
        '- [ ] milk 📅 2026-09-14\n',
    )
})

// A failed WRITE only ever reached console.warn, which nobody sees in a bundled app: the toast
// would say "converted 1 note" while a second note silently kept its emoji syntax and, with the
// reader gone, lost its dates until the next launch.
test('a failed write is reported as skipped rather than only logged', async () => {
    const root = makeVault({
        'a.md': '- [ ] milk 📅 2026-09-14\n',
        'b.md': '- [ ] taxes 📅 2026-09-14\n',
    })
    const real = await getFileAccess()
    setFileAccess({
        ...real,
        writeNote: (r, rel, text) =>
            rel === 'b.md'
                ? Promise.reject(new Error('EPERM'))
                : real.writeNote(r, rel, text),
    } satisfies FileAccess)
    try {
        const r = await runTaskMigration(root)
        expect(r.files).toEqual([{ file: 'a.md', changed: 1 }])
        expect(r.skipped).toEqual([
            { file: 'b.md', reason: 'write-failed', error: 'EPERM' },
        ])
        expect(await read(root, 'b.md')).toBe('- [ ] taxes 📅 2026-09-14\n')
    } finally {
        setFileAccess(real)
    }
})

// The write phase writes content computed in the SCAN phase, and the snapshot subprocess chain
// sits between the two — seconds, on a vault's first ever commit, at boot, exactly when the
// daemon is starting. An external write landing in that window would otherwise be silently
// overwritten with pre-scan bytes. Re-read and skip when they differ.
test('a file changed between the scan and the write is skipped, not clobbered', async () => {
    const root = makeVault({ 'a.md': '- [ ] milk 📅 2026-09-14\n' })
    const real = await getFileAccess()
    let scanned = false
    setFileAccess({
        ...real,
        readNote: async (r, rel) => {
            const text = await real.readNote(r, rel)
            if (!scanned) {
                // Stand in for the daemon/CLI/sync client writing while the snapshot runs.
                scanned = true
                await Bun.write(
                    join(root, rel),
                    text + '- [ ] later 📅 2026-10-01\n',
                )
            }
            return text
        },
    } satisfies FileAccess)
    try {
        const r = await runTaskMigration(root)
        expect(r.files).toEqual([])
        expect(r.ran).toBe(false)
        expect(r.skipped).toEqual([
            { file: 'a.md', reason: 'modified-during-migration' },
        ])
        // the external write survived intact
        expect(await read(root, 'a.md')).toBe(
            '- [ ] milk 📅 2026-09-14\n- [ ] later 📅 2026-10-01\n',
        )
    } finally {
        setFileAccess(real)
    }
})

// macOS stores whatever bytes created a file (APFS preserves NFD), while git sets
// core.precomposeunicode and records NFC in its index. So the walked name and the tracked name
// for the SAME file differ by normalisation, and a raw string comparison decides git does not
// track it — leaving an ordinary accented or CJK filename un-migrated and blaming a gitignore
// rule that does not exist. NFD arrives without anything unusual: files off an HFS+ volume, an
// old archive, some sync clients.
const NFD_CAFE = 'cafe\u0301.md' // "café.md" as e + U+0301, not U+00E9

test('a note with an NFD filename is migrated, not reported as untracked', async () => {
    const root = makeVault({
        [NFD_CAFE]: '- [ ] milk 📅 2026-09-14\n',
        'plain.md': '- [ ] taxes 📅 2026-09-14\n',
    })
    const r = await runTaskMigration(root)
    expect(r.skipped).toEqual([])
    expect(r.files.map(f => f.file.normalize('NFC')).sort()).toEqual([
        'café.md',
        'plain.md',
    ])
    expect(await read(root, NFD_CAFE)).toBe('- [ ] milk [due 2026-09-14]\n')
})

// `unreadable` is recorded before anything can know whether the file even HELD legacy syntax —
// it could not be read. A permanently unreadable note (owned by another user in a shared vault,
// or evicted by iCloud "optimize storage") therefore lands in `skipped` on every single boot
// while nothing needs migrating at all. The app must not turn that into a toast every launch,
// so it gates on this shape: skipped entries with neither a run nor a block behind them.
test('an unreadable note in an already-migrated vault reports no run at all', async () => {
    const root = makeVault({
        'fine.md': '- [ ] milk [due 2026-09-14]\n',
        'locked.md': '- [ ] taxes [due 2026-09-14]\n',
    })
    const real = await getFileAccess()
    setFileAccess({
        ...real,
        readNote: (r, rel) =>
            rel === 'locked.md'
                ? Promise.reject(new Error('EACCES'))
                : real.readNote(r, rel),
    } satisfies FileAccess)
    try {
        const r = await runTaskMigration(root)
        expect(r.ran).toBe(false)
        expect(r.blocked).toBe(false)
        expect(r.changed).toBe(0)
        expect(r.snapshot).toBe(false)
        expect(r.skipped).toEqual([
            { file: 'locked.md', reason: 'unreadable', error: 'EACCES' },
        ])
        expect(await isRepo(root)).toBe(false)
    } finally {
        setFileAccess(real)
    }
})
