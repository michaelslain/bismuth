// Pure decision/templating logic for incremental crons (daemon/src/daemon/incrementalCron.ts) —
// filterCronPaths / decideIncrementalRun / applyIncrementalPlaceholder are exercised here with
// plain fixture data (no git at all); resolveIncrementalRun (the impure glue that wires those
// pure functions to checkpointRef.ts's git calls) is exercised at the end against a REAL scratch
// git repo, covering the full "skip decision" path end to end.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import {
    filterCronPaths,
    formatChangedList,
    decideIncrementalRun,
    applyIncrementalPlaceholder,
    incrementalRefName,
    checkpointDirFor,
    resolveIncrementalRun,
    advanceIncrementalCheckpoint,
    CHANGED_SINCE_PLACEHOLDER,
} from '../src/daemon/incrementalCron.ts'
import { checkpointDelta } from '../src/lib/checkpointRef.ts'
import type { VaultContext } from '../src/lib/config.ts'

// ── Pure functions ────────────────────────────────────────────────────────────

test('incrementalRefName namespaces a cron name under cron-<name>', () => {
    expect(incrementalRefName('dream')).toBe('cron-dream')
    expect(incrementalRefName('vault-review')).toBe('cron-vault-review')
})

test('checkpointDirFor: undefined/"vault" resolves to ctx.root, "memory" resolves to ctx.memoryDir', () => {
    const ctx = {
        root: '/vault',
        memoryDir: '/vault/.daemon/memory',
    } as unknown as VaultContext
    expect(checkpointDirFor(ctx, undefined)).toBe('/vault')
    expect(checkpointDirFor(ctx, 'memory')).toBe('/vault/.daemon/memory')
})

test('filterCronPaths keeps only markdown files and drops anything under .daemon/', () => {
    const files = [
        { status: 'M', path: 'journal/2026-07-25.md' },
        { status: 'A', path: 'reading/book.md' },
        { status: 'M', path: '.daemon/crons/dream.md' },
        { status: 'A', path: '.daemon/memory/note.md' },
        { status: 'A', path: 'attachments/photo.png' },
        { status: 'D', path: 'nested/.daemon/session-id' },
    ]
    expect(filterCronPaths(files)).toEqual([
        { status: 'M', path: 'journal/2026-07-25.md' },
        { status: 'A', path: 'reading/book.md' },
    ])
})

test('formatChangedList renders a compact bulleted block', () => {
    const files = [
        { status: 'M', path: 'a.md' },
        { status: 'A', path: 'b.md' },
    ]
    expect(formatChangedList(files)).toBe('- M a.md\n- A b.md')
})

test('decideIncrementalRun: no ref yet (base=null) never skips, even with an empty file list', () => {
    const d = decideIncrementalRun(
        { base: null, files: [] },
        { refCommitIso: null },
    )
    expect(d.skip).toBe(false)
    if (!d.skip) expect(d.injected.toLowerCase()).toContain('first')
})

test("decideIncrementalRun: ref exists + nothing changed -> skip, with the exact 'skipped: no changes since <iso>' note", () => {
    const d = decideIncrementalRun(
        { base: 'abc123', files: [] },
        { refCommitIso: '2026-07-20T10:00:00Z' },
    )
    expect(d.skip).toBe(true)
    if (d.skip)
        expect(d.note).toBe('skipped: no changes since 2026-07-20T10:00:00Z')
})

test('decideIncrementalRun: ref exists + no resolvable commit time -> skip note falls back gracefully', () => {
    const d = decideIncrementalRun(
        { base: 'abc123', files: [] },
        { refCommitIso: null },
    )
    expect(d.skip).toBe(true)
    if (d.skip) expect(d.note).toBe('skipped: no changes since the last run')
})

test('decideIncrementalRun: ref exists + changes present -> run, with the changed list injected', () => {
    const files = [{ status: 'M', path: 'journal/today.md' }]
    const d = decideIncrementalRun(
        { base: 'abc123', files },
        { refCommitIso: '2026-07-20T10:00:00Z' },
    )
    expect(d.skip).toBe(false)
    if (!d.skip) {
        expect(d.injected).toContain('2026-07-20T10:00:00Z')
        expect(d.injected).toContain('- M journal/today.md')
    }
})

test('applyIncrementalPlaceholder substitutes {{changedSinceLastRun}} verbatim', () => {
    const prompt = `Review the vault.\n\n## Scope\n\n${CHANGED_SINCE_PLACEHOLDER}\n\nGo.`
    const out = applyIncrementalPlaceholder(prompt, 'Changed: a.md, b.md')
    expect(out).toBe(
        'Review the vault.\n\n## Scope\n\nChanged: a.md, b.md\n\nGo.',
    )
    expect(out).not.toContain(CHANGED_SINCE_PLACEHOLDER)
})

test('applyIncrementalPlaceholder is a no-op when the prompt has no placeholder (degrade gracefully)', () => {
    const prompt = 'Just do the thing.'
    expect(applyIncrementalPlaceholder(prompt, 'Changed: a.md')).toBe(prompt)
})

// ── Impure glue, against a real scratch git repo ────────────────────────────────

let dir: string
let ctx: VaultContext

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bismuth-incr-'))
    await $`git -C ${dir} init -q`.quiet()
    await $`git -C ${dir} config user.email "test@local"`.quiet()
    await $`git -C ${dir} config user.name "Test"`.quiet()
    ctx = {
        root: dir,
        memoryDir: join(dir, '.daemon', 'memory'),
    } as unknown as VaultContext
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

test('resolveIncrementalRun: first run (no ref yet) never skips, regardless of content', async () => {
    write('note.md', '# Note')
    await commit('init')
    const plan = await resolveIncrementalRun(ctx, {
        name: 'vault-review',
        prompt: `Body ${CHANGED_SINCE_PLACEHOLDER} end`,
    })
    expect(plan.skip).toBe(false)
    if (!plan.skip) expect(plan.prompt).toContain('first incremental run')
})

test('resolveIncrementalRun: after advancing with no further changes, the plan is skip=true with a readable note', async () => {
    write('note.md', '# Note')
    await commit('init')
    await advanceIncrementalCheckpoint(dir, incrementalRefName('vault-review'))

    const plan = await resolveIncrementalRun(ctx, {
        name: 'vault-review',
        prompt: `Body ${CHANGED_SINCE_PLACEHOLDER} end`,
    })
    expect(plan.skip).toBe(true)
    if (plan.skip) expect(plan.note).toMatch(/^skipped: no changes since /)
})

test('resolveIncrementalRun: a changed markdown note since the ref -> runs with the file injected into the prompt', async () => {
    write('note.md', '# Note')
    await commit('init')
    await advanceIncrementalCheckpoint(dir, incrementalRefName('vault-review'))

    write('note.md', '# Note v2')
    await commit('edit')

    const plan = await resolveIncrementalRun(ctx, {
        name: 'vault-review',
        prompt: `Body\n${CHANGED_SINCE_PLACEHOLDER}\nend`,
    })
    expect(plan.skip).toBe(false)
    if (!plan.skip) {
        expect(plan.prompt).toContain('note.md')
        expect(plan.prompt).not.toContain(CHANGED_SINCE_PLACEHOLDER)
    }
})

test('resolveIncrementalRun: a change OUTSIDE the markdown filter (e.g. a .daemon-ish or non-md file) still skips', async () => {
    write('note.md', '# Note')
    await commit('init')
    await advanceIncrementalCheckpoint(dir, incrementalRefName('vault-review'))

    write('attachment.png', 'not markdown')
    await commit('add attachment')

    const plan = await resolveIncrementalRun(ctx, {
        name: 'vault-review',
        prompt: `Body ${CHANGED_SINCE_PLACEHOLDER}`,
    })
    expect(plan.skip).toBe(true)
})

test('resolveIncrementalRun respects checkpointDir: "memory" checks ctx.memoryDir, independent of ctx.root', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(ctx.memoryDir, { recursive: true })
    await $`git -C ${ctx.memoryDir} init -q`.quiet()
    await $`git -C ${ctx.memoryDir} config user.email "test@local"`.quiet()
    await $`git -C ${ctx.memoryDir} config user.name "Test"`.quiet()
    writeFileSync(join(ctx.memoryDir, 'm.md'), '# memory note')
    await $`git -C ${ctx.memoryDir} add -A`.quiet()
    await $`git -C ${ctx.memoryDir} commit -q -m init`.quiet()
    await advanceIncrementalCheckpoint(
        ctx.memoryDir,
        incrementalRefName('dream'),
    )

    // Vault root has unrelated, uncommitted noise — must not affect the memory-scoped decision.
    write('unrelated.md', 'vault content, irrelevant to dream')

    const plan = await resolveIncrementalRun(ctx, {
        name: 'dream',
        prompt: CHANGED_SINCE_PLACEHOLDER,
        checkpointDir: 'memory',
    })
    expect(plan.skip).toBe(true)
})

test('advanceIncrementalCheckpoint moves the ref to HEAD and is reflected by a subsequent checkpointDelta', async () => {
    write('note.md', '# Note')
    await commit('init')
    const ref = incrementalRefName('dream')
    await advanceIncrementalCheckpoint(dir, ref)
    expect((await checkpointDelta(dir, ref)).files).toEqual([])
})
