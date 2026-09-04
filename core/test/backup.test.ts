import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import { rmSync, existsSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeNote } from '../src/files'
import {
    ensureRepo,
    commitVault,
    scheduleBackup,
    checkpointDelta,
    advanceCheckpoint,
    checkpointRef,
} from '../src/backup'
import { $ } from 'bun'

test('scheduleBackup coalesces a burst of autosaves into a single commit', async () => {
    process.env.BISMUTH_BACKUP_DEBOUNCE_MS = '40' // tiny debounce for the test
    const vault = tempDir('bismuth-coalesce-')
    // Three rapid saves (with real changes between) — uncoalesced this would be 3 commits.
    await writeNote(vault, 'a.md', 'v1')
    scheduleBackup(vault, () => 'snap')
    await writeNote(vault, 'a.md', 'v2')
    scheduleBackup(vault, () => 'snap')
    await writeNote(vault, 'b.md', 'v3')
    scheduleBackup(vault, () => 'snap')
    await new Promise(r => setTimeout(r, 300)) // past the debounce + the async commit
    const count = (await $`git -C ${vault} rev-list --count HEAD`.text()).trim()
    expect(count).toBe('1') // coalesced to ONE
    // ...and that one commit captured the latest state of both files.
    const tracked = (await $`git -C ${vault} ls-files`.text())
        .trim()
        .split('\n')
        .sort()
    expect(tracked).toEqual(['a.md', 'b.md'])
    delete process.env.BISMUTH_BACKUP_DEBOUNCE_MS
})

test('ensureRepo inits a git repo; commitVault commits changes locally', async () => {
    const dir = tempDir('bismuth-bk-')
    await ensureRepo(dir)
    expect(existsSync(join(dir, '.git'))).toBe(true)

    await writeNote(dir, 'a.md', '# A')
    const committed = await commitVault(dir, 'snapshot test')
    expect(committed).toBe(true)

    const again = await commitVault(dir, 'snapshot test 2')
    expect(again).toBe(false)

    const count = (await $`git -C ${dir} rev-list --count HEAD`.text()).trim()
    expect(count).toBe('1')
    const remotes = (await $`git -C ${dir} remote`.text()).trim()
    expect(remotes).toBe('')
})

test('ensureExclude does not throw when .git/info dir is absent (existing repo / worktree)', async () => {
    // Simulate a pre-existing git repo where .git/info/ was never created.
    const dir = tempDir('bismuth-bk-noinfo-')
    await $`git -C ${dir} init -q`.quiet()
    await $`git -C ${dir} config user.email "vault@local"`.quiet()
    await $`git -C ${dir} config user.name "OA Test"`.quiet()
    // Remove the info/ subdirectory to reproduce the edge-case.
    const infoDir = join(dir, '.git', 'info')
    if (existsSync(infoDir)) rmSync(infoDir, { recursive: true, force: true })

    // ensureRepo (and thereby ensureExclude) must not throw.
    await expect(ensureRepo(dir)).resolves.toBeUndefined()

    // commitVault must succeed end-to-end even without .git/info/.
    await writeNote(dir, 'note.md', '# Test')
    const committed = await commitVault(dir, 'snapshot without info dir')
    expect(committed).toBe(true)
})

test('commitVault tracks .settings + the durable half of .daemon, never its runtime state', async () => {
    const vault = tempDir('bismuth-backup-')
    await writeNote(vault, 'note.md', '# Note\n')
    // Durable — the user (or the daemon, durably) authored these.
    await writeNote(vault, '.settings', 'appearance:\n  theme: ink\n')
    await writeNote(vault, '.daemon/identity.md', 'name: atlas\n---\nhello\n')
    await writeNote(vault, '.daemon/PAGES.md', '# Pages\n')
    await writeNote(vault, '.daemon/crons/dream.md', 'schedule: 0 3 * * *\n')
    await writeNote(vault, '.daemon/processes/watch.md', 'command: ls\n')
    await writeNote(vault, '.daemon/pages/reply-drafts.md', '# Drafts\n')
    // Runtime — must never reach the history.
    await writeNote(vault, '.daemon/memory/m.md', 'a memory note\n')
    await writeNote(vault, '.daemon/logs/activity-2026-09-01.jsonl', '{}\n')
    await writeNote(vault, '.daemon/session-id', 'abc\n')
    await writeNote(vault, '.daemon/session-ids', 'abc\n')
    await writeNote(vault, '.daemon/session-ids-legacy', 'abc\n')
    await writeNote(vault, '.daemon/crons/.last-fired.json', '{}\n')
    await writeNote(vault, '.daemon/crons/.running.json', '{}\n')
    await writeNote(vault, '.daemon/crons/.triggers/dream', '2026-09-01\n')
    await writeNote(vault, '.daemon/processes/.pids/watch.pid', '123\n')
    await writeNote(vault, '.daemon/pages/.state/reply-drafts.json', '{}\n')
    // The allow-list must fail CLOSED: an undotted runtime file directly under .daemon,
    // which a deny-list would have committed.
    await writeNote(vault, '.daemon/daemon.pid', '12345\n')
    // .ink/ mirrors the vault tree with handwriting overlays. A normal note's overlay IS
    // tracked (existing, correct behaviour); its .daemon shadow must NOT be — gitignore
    // anchoring means the root-anchored '.daemon/*' does not implicitly cover '.ink/.daemon/'
    // the way the old unanchored bare '.daemon' rule did.
    await writeNote(vault, '.ink/Welcome.md.ink', 'x\n')
    await writeNote(vault, '.ink/.daemon/memory/preferences.md.ink', 'x\n')

    const committed = await commitVault(vault, 'snapshot')
    expect(committed).toBe(true)

    const tracked = (await $`git -C ${vault} ls-files`.text()).trim().split('\n')
    expect(tracked.sort()).toEqual([
        '.daemon/PAGES.md',
        '.daemon/crons/dream.md',
        '.daemon/identity.md',
        '.daemon/pages/reply-drafts.md',
        '.daemon/processes/watch.md',
        '.ink/Welcome.md.ink',
        '.settings',
        'note.md',
    ])
})

test('ensureExclude PRUNES the old blanket rules so an existing vault migrates', async () => {
    // A vault backed up by the previous version: .git/info/exclude carries the blanket lines,
    // plus a hand-written rule of the user's that must survive untouched.
    const vault = tempDir('bismuth-backup-migrate-')
    await ensureRepo(vault)
    const excludePath = join(vault, '.git', 'info', 'exclude')
    writeFileSync(excludePath, '# mine\nscratch/\n.settings\n.daemon\n')

    await ensureRepo(vault) // runs ensureExclude again

    const lines = readFileSync(excludePath, 'utf8').split('\n')
    expect(lines).toContain('scratch/') // the user's own rule survives
    expect(lines).toContain('# mine')
    expect(lines).not.toContain('.settings') // blanket rules pruned
    expect(lines).not.toContain('.daemon')
    expect(lines).toContain('.daemon/*') // replaced by the allow-list
    expect(lines).toContain('!.daemon/identity.md')
})

test('checkpoint: first run reports all files; advance + delta tracks only what changed since', async () => {
    const dir = tempDir('bismuth-ckpt-')
    await writeNote(dir, 'a.md', '# A')
    await writeNote(dir, 'b.md', '# B')
    await commitVault(dir, 'init')

    // No ref yet → every tracked file counts as added; base is null.
    expect(await checkpointRef(dir, 'dream')).toBe(null)
    const first = await checkpointDelta(dir, 'dream')
    expect(first.base).toBe(null)
    expect(first.files.map(f => f.path).sort()).toEqual(['a.md', 'b.md'])
    expect(first.files.every(f => f.status === 'A')).toBe(true)

    // Advance the bookmark to HEAD, then nothing has changed since.
    const head = await advanceCheckpoint(dir, 'dream')
    expect(head).not.toBe(null)
    expect(await checkpointRef(dir, 'dream')).toBe(head)
    expect((await checkpointDelta(dir, 'dream')).files).toEqual([])

    // New commit → delta shows only the new file, measured from the bookmark.
    await writeNote(dir, 'c.md', '# C')
    await commitVault(dir, 'add c')
    const delta = await checkpointDelta(dir, 'dream')
    expect(delta.base).toBe(head)
    expect(delta.files).toEqual([{ status: 'A', path: 'c.md' }])
})

test('checkpoint: commitMessage commits pending changes before diffing; refs are independent', async () => {
    const dir = tempDir('bismuth-ckpt2-')
    await writeNote(dir, 'a.md', '# A')
    await commitVault(dir, 'init')
    await advanceCheckpoint(dir, 'dream')
    await advanceCheckpoint(dir, 'vault-review')

    // Uncommitted edit + a commitMessage → checkpointDelta commits first, then sees it.
    await writeNote(dir, 'a.md', '# A edited')
    const delta = await checkpointDelta(dir, 'dream', 'checkpoint snapshot')
    expect(delta.files).toEqual([{ status: 'M', path: 'a.md' }])

    // Advancing only dream leaves vault-review where it was — the bookmarks are independent.
    const beforeVR = await checkpointRef(dir, 'vault-review')
    await advanceCheckpoint(dir, 'dream')
    expect(await checkpointRef(dir, 'vault-review')).toBe(beforeVR)
    expect(await checkpointRef(dir, 'dream')).not.toBe(beforeVR)
})

test('checkpoint: rejects an unsafe ref name', async () => {
    const dir = tempDir('bismuth-ckpt3-')
    await writeNote(dir, 'a.md', '# A')
    await commitVault(dir, 'init')
    await expect(checkpointDelta(dir, '../evil')).rejects.toThrow()
})

test('checkpoint: an invalid ref name is a client error (400/EINVAL), not a 500', async () => {
    const dir = tempDir('bismuth-ckpt4-')
    await writeNote(dir, 'a.md', '# A')
    await commitVault(dir, 'init')
    try {
        await checkpointDelta(dir, '../evil')
        throw new Error('expected checkpointDelta to throw')
    } catch (err) {
        expect((err as { statusCode?: number }).statusCode).toBe(400)
        expect((err as { code?: string }).code).toBe('EINVAL')
    }
})

test('checkpoint: non-ASCII / emoji / space paths survive verbatim and resolve on disk', async () => {
    // The real vault is full of these (emoji folders like "📦 projects", curly apostrophes
    // in "America's", accents in "Çelik"). Git's default output octal-escapes + quotes such
    // paths; the -z parser must return them verbatim so the cron can actually open the files.
    const dir = tempDir('bismuth-ckpt-utf8-')
    await writeNote(dir, 'cs/📦 projects/idea.md', '# Idea')
    await writeNote(dir, 'reading/America’s Commute.md', '# r') // U+2019 curly apostrophe
    await writeNote(dir, 'self/old name é.md', '# o') // accent, to be renamed
    await commitVault(dir, 'init')

    // First run (ls-tree path): every tracked file is "A", paths verbatim + on disk.
    const first = await checkpointDelta(dir, 'vault-review')
    const firstPaths = first.files.map(f => f.path).sort()
    expect(firstPaths).toEqual(
        [
            'cs/📦 projects/idea.md',
            'reading/America’s Commute.md',
            'self/old name é.md',
        ].sort(),
    )
    for (const f of first.files)
        expect(existsSync(join(dir, f.path))).toBe(true)

    await advanceCheckpoint(dir, 'vault-review')

    // Modify the emoji-path file, add an accented one, and rename another.
    await writeNote(dir, 'cs/📦 projects/idea.md', '# Idea v2')
    await writeNote(dir, 'self/café notes.md', '# café') // é
    renameSync(
        join(dir, 'self/old name é.md'),
        join(dir, 'self/renamed señor.md'),
    )
    await commitVault(dir, 'edit')

    // Delta (diff path): verbatim paths; the renamed file reports its NEW path; nothing escaped.
    const delta = await checkpointDelta(dir, 'vault-review')
    const present = delta.files.filter(f => f.status !== 'D').map(f => f.path)
    for (const p of present) {
        expect(p).not.toContain('\\') // no octal-escape backslashes
        expect(existsSync(join(dir, p))).toBe(true) // resolves on disk
    }
    expect(present).toContain('cs/📦 projects/idea.md')
    expect(present).toContain('self/café notes.md')
    expect(present).toContain('self/renamed señor.md')
})

// ── The redirected-repo guard ───────────────────────────────────────────────────────────────────
//
// This is the regression test for how this repository's own history got stamped: git injects
// GIT_DIR into hook environments, the gate forwarded it to test subprocesses, and `git -C <tempdir>`
// then resolved to the Bismuth checkout instead — staging the temp vault into the real index and
// writing `user.name = Bismuth` / `user.email = vault@local` into the checkout's config, which went
// on to author 326 commits. See the GIT_LOCATION_VARS comment in core/src/backup.ts.

test('a leaked GIT_DIR cannot redirect a backup into another repository', async () => {
    const decoy = tempDir('bismuth-decoy-')
    await $`git -C ${decoy} init -q`.quiet()
    const decoyHeadBefore = existsSync(join(decoy, '.git', 'index'))

    const vault = tempDir('bismuth-leak-')
    await writeNote(vault, 'note.md', '# vault content')

    // Exactly the hazard: a repo-location var pointing somewhere else entirely.
    const saved = process.env.GIT_DIR
    process.env.GIT_DIR = join(decoy, '.git')
    try {
        // The env is stripped, so the backup targets the vault and succeeds…
        await expect(commitVault(vault, 'snapshot')).resolves.toBe(true)
    } finally {
        if (saved === undefined) delete process.env.GIT_DIR
        else process.env.GIT_DIR = saved
    }

    // …the VAULT got the commit,
    const inVault = (
        await $`git -C ${vault} log --format=%s`.env({ ...process.env, GIT_DIR: undefined }).text()
    ).trim()
    expect(inVault).toBe('snapshot')

    // …and the decoy was never written to: no commits, and its index is untouched.
    const decoyLog = await $`git -C ${decoy} log --format=%s`
        .env({ ...process.env, GIT_DIR: undefined })
        .nothrow()
        .quiet()
    expect(decoyLog.exitCode).not.toBe(0) // no HEAD — nothing was ever committed here
    expect(existsSync(join(decoy, '.git', 'index'))).toBe(decoyHeadBefore)

    // …and the decoy's identity was never stamped by us.
    const name = await $`git -C ${decoy} config --local --get user.name`
        .env({ ...process.env, GIT_DIR: undefined })
        .nothrow()
        .quiet()
    expect(name.stdout.toString().trim()).not.toBe('Bismuth')
})


test('a vault that is a git WORKTREE is allowed — the guard checks the work tree, not the git dir', async () => {
    // A worktree's `.git` is a FILE containing `gitdir: …`, so its git dir lives in another repo.
    // That is byte-identical to the "redirected" shape, and deliberately NOT rejected: the work
    // tree still resolves to the vault, so `add -A` stages the vault's own files and nothing
    // foreign is committed. Rejecting it would break anyone keeping a vault as a worktree.
    const host = tempDir('bismuth-host-')
    await $`git -C ${host} init -q`.quiet()
    await $`git -C ${host} -c user.email=t@t -c user.name=t commit -q --allow-empty -m base`.quiet()
    const vault = join(host, '..', `wt-${Date.now()}`)
    await $`git -C ${host} worktree add -q ${vault}`.quiet()

    await writeNote(vault, 'note.md', '# in a worktree')
    await expect(commitVault(vault, 'snapshot')).resolves.toBe(true)

    rmSync(vault, { recursive: true, force: true })
})
