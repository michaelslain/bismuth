// #51: the per-vault file watcher. `matchesWatch`/`isDaemonInternalPath` are pure and unit-tested
// directly; `createFileWatcher` is the scoped in-process harness the feature's testing mandate
// calls for — a REAL fs.watch over a temp dir with a tiny debounce and a FAKE onBatch runner (no
// cron/session plumbing), proving a rapid-fire burst of writes collapses into exactly one batch.
import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    createFileWatcher,
    isDaemonInternalPath,
    matchesWatch,
    startFileWatch,
    stopFileWatch,
    type FileWatcher,
} from '../src/daemon/fileWatch.ts'

// ── Pure functions ───────────────────────────────────────────────────────────

test('isDaemonInternalPath rejects anything under .daemon/ (the loop guard)', () => {
    expect(isDaemonInternalPath('.daemon')).toBe(true)
    expect(isDaemonInternalPath('.daemon/crons/.last-fired.json')).toBe(true)
    expect(isDaemonInternalPath('.daemon/memory/note.md')).toBe(true)
    expect(isDaemonInternalPath('notes/.daemon-like.md')).toBe(false) // not actually under .daemon/
    expect(isDaemonInternalPath('inbox.md')).toBe(false)
})

test('isDaemonInternalPath normalizes backslash separators before comparing', () => {
    expect(isDaemonInternalPath('.daemon\\crons\\.running.json')).toBe(true)
})

test('matchesWatch treats a plain path as a literal (matches only itself)', () => {
    expect(matchesWatch('inbox.md', 'inbox.md')).toBe(true)
    expect(matchesWatch('inbox.md', 'notes/inbox.md')).toBe(false)
    expect(matchesWatch('inbox.md', 'inbox.md.bak')).toBe(false)
})

test('matchesWatch supports Bun.Glob syntax for directories and extensions', () => {
    expect(matchesWatch('journal/**', 'journal/2026-07-06.md')).toBe(true)
    expect(matchesWatch('journal/**', 'journal/sub/nested.md')).toBe(true)
    expect(matchesWatch('journal/**', 'notes/other.md')).toBe(false)
    expect(matchesWatch('*.md', 'root.md')).toBe(true)
    expect(matchesWatch('*.md', 'notes/nested.md')).toBe(false) // * doesn't cross a path segment
})

test('matchesWatch normalizes backslash separators on both sides', () => {
    expect(matchesWatch('journal/**', 'journal\\sub\\nested.md')).toBe(true)
})

test('matchesWatch fails closed (never matches) on a malformed pattern instead of throwing', () => {
    expect(() => matchesWatch('[', 'anything.md')).not.toThrow()
    expect(matchesWatch('[', 'anything.md')).toBe(false)
})

// ── Debounce harness: one real fs.watch, a fake runner ──────────────────────

let root: string | null = null
let watcher: FileWatcher | null = null

afterEach(() => {
    watcher?.close()
    watcher = null
    if (root) {
        rmSync(root, { recursive: true, force: true })
        root = null
    }
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEBOUNCE_MS = 150
// The burst test spreads its writes over two 20ms gaps; a window this much wider keeps them inside
// it however late those timers fire on a loaded machine.
const BURST_DEBOUNCE_MS = 1000
// A fresh FSEvents watch takes from well under a second to over three to start delivering on a
// loaded machine, and a write made before then is never reported. So every wait polls for the
// batch it expects against this deadline instead of sleeping a guessed settle time, and an
// "exactly these batches" assertion ends at a marker written after the action: FSEvents reports
// in order, so once the marker's batch lands, every batch from before it has too.
const WAIT_MS = 15_000
const TEST_MS = 30_000

async function until(ok: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + WAIT_MS
    while (!ok()) {
        if (Date.now() > deadline)
            throw new Error(`no ${what} within ${WAIT_MS}ms`)
        await sleep(25)
    }
}

const named = (batches: string[][], path: string) =>
    batches.findIndex(b => b.includes(path))

let markers = 0
/** Writes a fresh marker file and waits for its batch; returns that batch's index. */
async function mark(batches: string[][]): Promise<number> {
    const name = `marker-${++markers}.md`
    writeFileSync(join(root!, name), '')
    await until(() => named(batches, name) >= 0, `batch naming ${name}`)
    return named(batches, name)
}

// Probe rewrites are spaced well past the debounce: each one restarts it, so a faster cadence
// would hold every flush back for as long as the probing lasts.
const probeEvery = (debounceMs: number) => debounceMs * 4

/** Rewrites a probe until a batch names it (the watch is live), lets the last rewrite flush, and
 *  clears `batches` for the test proper. */
async function live(
    batches: string[][],
    debounceMs = DEBOUNCE_MS,
): Promise<void> {
    const deadline = Date.now() + WAIT_MS
    while (named(batches, 'probe.md') < 0) {
        if (Date.now() > deadline)
            throw new Error('the watch never reported its probe')
        writeFileSync(join(root!, 'probe.md'), String(Date.now()))
        await sleep(probeEvery(debounceMs))
    }
    await mark(batches)
    batches.length = 0
}

test(
    'createFileWatcher collapses a rapid-fire burst into exactly one batch',
    async () => {
        root = mkdtempSync(join(tmpdir(), 'bismuth-filewatch-'))
        const batches: string[][] = []
        watcher = createFileWatcher(root, {
            debounceMs: BURST_DEBOUNCE_MS,
            onBatch: paths => {
                batches.push(paths)
            },
        })
        expect(watcher).not.toBeNull()
        await live(batches, BURST_DEBOUNCE_MS)

        // A burst of writes within the debounce window — like an editing session's autosaves. The
        // gaps put them in separate event deliveries, so only the debounce can collapse them.
        writeFileSync(join(root, 'a.md'), '1')
        await sleep(20)
        writeFileSync(join(root, 'a.md'), '2')
        await sleep(20)
        writeFileSync(join(root, 'b.md'), '1')

        // Exactly one batch, covering both changed files.
        await until(() => batches.length > 0, 'batch for the burst')
        const end = await mark(batches)
        expect(batches.slice(0, end)).toHaveLength(1)
        expect(new Set(batches[0])).toEqual(new Set(['a.md', 'b.md']))
    },
    TEST_MS,
)

test(
    'createFileWatcher fires a second, separate batch for changes after the first flush',
    async () => {
        root = mkdtempSync(join(tmpdir(), 'bismuth-filewatch-'))
        const batches: string[][] = []
        watcher = createFileWatcher(root, {
            debounceMs: DEBOUNCE_MS,
            onBatch: paths => {
                batches.push(paths)
            },
        })
        await live(batches)

        writeFileSync(join(root, 'one.md'), '1')
        await until(() => named(batches, 'one.md') >= 0, 'batch naming one.md')

        writeFileSync(join(root, 'two.md'), '1')
        await until(() => named(batches, 'two.md') >= 0, 'batch naming two.md')
        expect(batches).toEqual([['one.md'], ['two.md']])
    },
    TEST_MS,
)

test(
    'createFileWatcher never includes .daemon/** churn in a batch',
    async () => {
        root = mkdtempSync(join(tmpdir(), 'bismuth-filewatch-'))
        mkdirSync(join(root, '.daemon', 'crons'), { recursive: true })
        const batches: string[][] = []
        watcher = createFileWatcher(root, {
            debounceMs: DEBOUNCE_MS,
            onBatch: paths => {
                batches.push(paths)
            },
        })
        await live(batches)

        // Simulate the daemon's own bookkeeping churn alongside a real vault edit.
        writeFileSync(join(root, '.daemon', 'crons', '.last-fired.json'), '{}')
        writeFileSync(join(root, 'real-note.md'), 'hello')
        await until(
            () => named(batches, 'real-note.md') >= 0,
            'batch naming real-note.md',
        )
        const end = await mark(batches)

        expect(batches.slice(0, end)).toEqual([['real-note.md']])
    },
    TEST_MS,
)

test("createFileWatcher returns null for a root that doesn't exist (never throws)", () => {
    const fw = createFileWatcher(
        join(tmpdir(), 'bismuth-does-not-exist-' + Date.now()),
        {
            onBatch: () => {},
        },
    )
    expect(fw).toBeNull()
})

test(
    'startFileWatch invalidates the brain map for the vault on a batch, even one that only touches .daemon/',
    async () => {
        root = mkdtempSync(join(tmpdir(), 'bismuth-filewatch-'))
        mkdirSync(join(root, '.daemon'), { recursive: true })
        const calls: string[] = []
        const ctx = { root } as never
        startFileWatch(ctx, DEBOUNCE_MS, dir => calls.push(dir))
        try {
            // Rewriting a .daemon/ file until it invalidates also waits for the watch to go live.
            const deadline = Date.now() + WAIT_MS
            while (calls.length === 0) {
                if (Date.now() > deadline)
                    throw new Error('a .daemon/-only batch never invalidated')
                writeFileSync(join(root, '.daemon', 'state.json'), '{}')
                await sleep(probeEvery(DEBOUNCE_MS))
            }
            const before = calls.length
            writeFileSync(join(root, '.settings'), 'x')
            await until(
                () => calls.length > before,
                'invalidation for .settings',
            )
            expect(new Set(calls)).toEqual(new Set([root]))
        } finally {
            stopFileWatch(ctx)
        }
    },
    TEST_MS,
)
