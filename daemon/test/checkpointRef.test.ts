// The git-touching half of the incremental-cron mechanism (daemon/src/lib/checkpointRef.ts) — a
// standalone duplicate of core/src/backup.ts's checkpoint-ref primitives (see that file's own
// backup.test.ts for the byte-identical CLI-facing behavior). Exercised against REAL scratch git
// repos (mkdtemp) rather than mocked, since the whole point is "does git actually report what we
// think it reports" — including the snapshot-based delta core's checkpointDelta doesn't do.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import {
    checkpointRefSha,
    checkpointDelta,
    advanceCheckpointRef,
    commitTimeIso,
    snapshotWorkingTree,
} from '../src/lib/checkpointRef.ts'

let dir: string

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bismuth-ckptref-'))
    await $`git -C ${dir} init -q`.quiet()
    await $`git -C ${dir} config user.email "test@local"`.quiet()
    await $`git -C ${dir} config user.name "Test"`.quiet()
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

function write(name: string, content: string): void {
    writeFileSync(join(dir, name), content)
}

async function commit(msg: string): Promise<void> {
    await $`git -C ${dir} add -A`.quiet()
    await $`git -C ${dir} commit -q -m ${msg}`.quiet()
}

test('checkpointRefSha: null when the repo has no commits, and null before the ref is ever advanced', async () => {
    expect(await checkpointRefSha(dir, 'cron-dream')).toBe(null)
    write('a.md', '# A')
    await commit('init')
    expect(await checkpointRefSha(dir, 'cron-dream')).toBe(null)
})

test('checkpointDelta: repo with no commits yet -> empty delta, base+head both null', async () => {
    expect(await checkpointDelta(dir, 'cron-dream')).toEqual({
        base: null,
        head: null,
        snapshot: null,
        files: [],
    })
})

test('checkpointDelta: first run (no ref yet) reports every tracked file as added', async () => {
    write('a.md', '# A')
    write('b.md', '# B')
    await commit('init')
    const delta = await checkpointDelta(dir, 'cron-dream')
    expect(delta.base).toBe(null)
    expect(delta.head).not.toBe(null)
    expect(delta.files.map(f => f.path).sort()).toEqual(['a.md', 'b.md'])
    expect(delta.files.every(f => f.status === 'A')).toBe(true)
})

test('advanceCheckpointRef sets the ref (to a snapshot); a clean tree then diffs empty', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    expect(await checkpointRefSha(dir, 'cron-dream')).not.toBe(null)
    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([])
})

test('checkpointDelta reports committed changes since the ref, measured from the bookmark not HEAD^', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    const head1 = await checkpointRefSha(dir, 'cron-dream')
    write('b.md', '# B')
    await commit('add b')
    const delta = await checkpointDelta(dir, 'cron-dream')
    expect(delta.base).toBe(head1)
    expect(delta.files).toEqual([{ status: 'A', path: 'b.md' }])
})

test('checkpointDelta unions UNCOMMITTED working-tree changes (tracked edit + untracked new file) without committing anything itself', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')

    write('a.md', '# A edited') // tracked, unstaged modification
    write('c.md', '# C new') // untracked new file
    const delta = await checkpointDelta(dir, 'cron-dream')
    expect(delta.files.map(f => f.path).sort()).toEqual(['a.md', 'c.md'])

    // The diff call must be read-only: the working tree is still dirty afterward.
    const status = (await $`git -C ${dir} status --porcelain`.text()).trim()
    expect(status).not.toBe('')
})

test('checkpointDelta ignores files excluded by .gitignore when listing untracked changes', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    write('.gitignore', 'ignored.md\n')
    await commit('add gitignore')
    await advanceCheckpointRef(dir, 'cron-dream')

    write('ignored.md', '# should not show up')
    const delta = await checkpointDelta(dir, 'cron-dream')
    expect(delta.files.map(f => f.path)).toEqual([])
})

test('advancing to delta.snapshot marks uncommitted work as seen; nothing is committed', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    write('a.md', '# A edited')
    write('c.md', '# C new')
    const delta = await checkpointDelta(dir, 'cron-dream')
    expect(delta.files.map(f => f.path).sort()).toEqual(['a.md', 'c.md'])
    await advanceCheckpointRef(dir, 'cron-dream', delta.snapshot!)
    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([])
    expect((await $`git -C ${dir} status --porcelain`.text()).trim()).not.toBe('')
})

test('an edit made after the snapshot but before advancing shows up next time', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    write('a.md', '# A v2')
    const delta = await checkpointDelta(dir, 'cron-dream')
    write('a.md', '# A v3 during the run')
    await advanceCheckpointRef(dir, 'cron-dream', delta.snapshot!)
    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([
        { status: 'M', path: 'a.md' },
    ])
})

test('advance without `to` snapshots the working tree', async () => {
    write('a.md', '# A')
    await commit('init')
    write('a.md', '# A dirty')
    await advanceCheckpointRef(dir, 'cron-dream')
    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([])
})

test('snapshotWorkingTree leaves status, index, HEAD and branches untouched', async () => {
    write('a.md', '# A')
    await commit('init')
    write('a.md', '# A edited')
    write('new.md', '# new')
    const idx = join(dir, '.git', 'index')
    const snap = async () => ({
        status: await $`git -C ${dir} status --porcelain`.text(),
        head: await $`git -C ${dir} rev-parse HEAD`.text(),
        branches: await $`git -C ${dir} branch --list`.text(),
        refs: await $`git -C ${dir} for-each-ref`.text(),
    })
    await $`git -C ${dir} status --porcelain`.quiet() // settle the stat cache first
    const raw = () => ({ mtime: statSync(idx).mtimeMs, index: readFileSync(idx).toString('hex') })
    const before = await snap()
    const rawBefore = raw()
    const sha = await snapshotWorkingTree(dir)
    expect(sha).not.toBe(null)
    expect(raw()).toEqual(rawBefore)
    expect(await snap()).toEqual(before)
    const files = (await $`git -C ${dir} ls-tree -r --name-only ${sha}`.text())
        .trim()
        .split('\n')
        .sort()
    expect(files).toEqual(['a.md', 'new.md'])
})

test('snapshot excludes .git/info/exclude and .gitignore entries', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'excl.md\n')
    write('excl.md', 'x')
    write('.gitignore', 'ign.md\n')
    await commit('gitignore')
    await advanceCheckpointRef(dir, 'cron-dream')
    write('ign.md', 'x')
    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([])
})

test('fallbackRefs: used when the ref is absent, base null when none exist, ref wins when present', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'legacy')
    write('b.md', '# B')
    let d = await checkpointDelta(dir, 'cron-dream', { fallbackRefs: ['nope', 'legacy'] })
    expect(d.base).toBe(await checkpointRefSha(dir, 'legacy'))
    expect(d.files).toEqual([{ status: 'A', path: 'b.md' }])
    d = await checkpointDelta(dir, 'cron-dream', { fallbackRefs: ['nope'] })
    expect(d.base).toBe(null)
    expect(d.files.map(f => f.path).sort()).toEqual(['a.md', 'b.md'])
    await advanceCheckpointRef(dir, 'cron-dream')
    d = await checkpointDelta(dir, 'cron-dream', { fallbackRefs: ['legacy'] })
    expect(d.base).toBe(await checkpointRefSha(dir, 'cron-dream'))
    expect(d.files).toEqual([])
})

test('checkpoint refs for different names are independent bookmarks on the same history', async () => {
    write('a.md', '# A')
    await commit('init')
    await advanceCheckpointRef(dir, 'cron-dream')
    await advanceCheckpointRef(dir, 'cron-vault-review')

    write('a.md', '# A v2')
    await commit('edit a')
    await advanceCheckpointRef(dir, 'cron-dream') // only advance dream's bookmark

    expect((await checkpointDelta(dir, 'cron-dream')).files).toEqual([])
    expect((await checkpointDelta(dir, 'cron-vault-review')).files).toEqual([
        { status: 'M', path: 'a.md' },
    ])
})

test("commitTimeIso resolves a commit's ISO-8601 committer date", async () => {
    write('a.md', '# A')
    await commit('init')
    const head = (await $`git -C ${dir} rev-parse HEAD`.text()).trim()
    const iso = await commitTimeIso(dir, head)
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
})

test("commitTimeIso returns null for a SHA that doesn't exist", async () => {
    write('a.md', '# A')
    await commit('init')
    expect(
        await commitTimeIso(dir, '0000000000000000000000000000000000000000'),
    ).toBe(null)
})

test('checkpointDelta rejects an unsafe ref name', async () => {
    write('a.md', '# A')
    await commit('init')
    await expect(checkpointDelta(dir, '../evil')).rejects.toThrow()
})

test('checkpointDelta / advanceCheckpointRef on a non-git directory never throw — empty delta, null advance', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'bismuth-notgit-'))
    try {
        expect(await checkpointDelta(plain, 'cron-dream')).toEqual({
            base: null,
            head: null,
            snapshot: null,
            files: [],
        })
        await advanceCheckpointRef(plain, 'cron-dream')
        expect(await checkpointRefSha(plain, 'cron-dream')).toBe(null)
    } finally {
        rmSync(plain, { recursive: true, force: true })
    }
})
