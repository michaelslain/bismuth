// core/test/server.selfWrite.test.ts
//
// End-to-end guard for the two Task 4 bugs measured against a real server + real fs.watch:
//   1. PUT /file never marked its write as self-written, so every save produced TWO SSE
//      events (the handler's own invalidate(), then the watcher noticing its own echo).
//   2. The change tracker was never seeded from the boot-time task-migration scan, so the
//      FIRST save of any note after boot was classified fully structural even when it touched
//      no link, tag, icon or visibility — forcing an unnecessary graph+tree rebuild.
// Plus a regression guard for a THIRD bug these two fixes surfaced: the boot-time `.settings`
// reconcile write used to bump `version` to 1 via its own unsuppressed watcher echo, which is
// what kept `GET /events` connections from ever hitting an unrelated, pre-existing stall — a
// client connecting while version === 0 got NOTHING until the next heartbeat tick (5s default),
// because `fetch()` doesn't resolve/flush a streaming response until the first body chunk
// arrives. Fixing the self-write suppression correctly (bug #1) removed that spurious bump,
// which turned the latent stall into a real one — `core/test/server.test.ts`'s daily-note test
// started timing out. See the `: connected\n\n` unconditional flush in server.ts's `GET /events`.
//
// SSE is read with fetch + a ReadableStream reader (Bun has no global EventSource), matching
// sseRefresh.test.ts's approach. Gated with shouldRunSlowTests: this waits on the real watcher
// + debounce + boot-time migration scan, all real time, well over 1s per test.
import { test, expect } from 'bun:test'
import { createServer } from '../src/server'
import { initializeSettings } from '../src/settings'
import { makeVault } from './helpers'
import { shouldRunSlowTests } from './slowGate'

const t = shouldRunSlowTests(process.env) ? test : test.skip

type Ev = { version: number; paths: string[]; dirty?: { graph: boolean; tree: boolean } }

/** Collects every SSE `data:` frame received on `/events` from the moment this is called,
 *  into the returned array (kept live — callers read it after acting and sleeping). */
function collectEvents(base: string): { events: Ev[]; stop: () => void } {
    const events: Ev[] = []
    const controller = new AbortController()
    void (async () => {
        let res: Response
        try {
            res = await fetch(`${base}/events`, { signal: controller.signal })
        } catch {
            return
        }
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        try {
            for (;;) {
                const { value, done } = await reader.read()
                if (done) return
                buf += decoder.decode(value)
                const frames = buf.split('\n\n')
                buf = frames.pop() ?? ''
                for (const f of frames) {
                    if (!f.startsWith('data: ')) continue // skip `: keepalive` comments
                    events.push(JSON.parse(f.slice(6)))
                }
            }
        } catch {
            // aborted on stop()
        }
    })()
    return { events, stop: () => controller.abort() }
}

async function waitForMigration(base: string): Promise<void> {
    const deadline = Date.now() + 10_000
    for (;;) {
        const r = (await (await fetch(`${base}/tasks/migration`)).json()) as {
            ran: boolean | null
        }
        if (r.ran !== null) return
        if (Date.now() > deadline)
            throw new Error('boot-time task migration never completed')
        await Bun.sleep(50)
    }
}

// makeVault() writes the vault's files synchronously via writeFileSync BEFORE createServer (and
// its fs.watch) ever attaches — but on macOS, FSEvents can still replay that very recent write
// history to a brand-new watcher, so the watcher can fire its own "external change" batch for
// a.md/b.md a beat after boot, wholly unrelated to anything this test does. Left alone, that
// batch's SSE can land inside our own collection window and get mistaken for a second echo of
// OUR write. Settling past it (a full worst-case coalesce window, see changeClassifier.ts's
// MAX_COALESCE_INTERVALS = 4 x the 250ms default debounce) before clearing the collected array
// removes that race without weakening what this test actually asserts.
const BOOT_WATCH_SETTLE_MS = 1200

const putFile = (base: string, path: string, contents: string) =>
    fetch(`${base}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, contents }),
    })

t(
    'one PUT /file produces exactly one SSE event',
    async () => {
        const vault = makeVault({
            'a.md': '# a\n[[b]]\n',
            'b.md': '# b\n',
        })
        const server = createServer({ vault, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            // Wait for the boot-time migration scan so the tracker is seeded — not strictly
            // required for THIS test (which only cares about SSE count, not classification),
            // but keeping the two tests' setup identical is what makes their difference legible.
            await waitForMigration(base)
            const { events, stop } = collectEvents(base)
            try {
                // Let any boot-time watch backlog (see BOOT_WATCH_SETTLE_MS above) fully flush
                // and publish before this test's own trigger — then discard it: it has nothing
                // to do with the write this test is about to make.
                await Bun.sleep(BOOT_WATCH_SETTLE_MS)
                events.length = 0
                const res = await putFile(base, 'a.md', '# a changed\n')
                expect(res.status).toBe(200)
                // Long enough for the OS watcher to notice the write AND for the debounce
                // (default 250ms) to flush it, if self-write suppression were NOT working.
                await Bun.sleep(1500)
                expect(
                    events.filter(e => e.paths.includes('a.md')),
                ).toHaveLength(1)
            } finally {
                stop()
            }
        } finally {
            server.stop(true)
        }
    },
    20_000,
)

t(
    'first content-only save after boot is not structural',
    async () => {
        // a.md's on-disk content at boot IS what the migration scan seeds the tracker with —
        // the PUT below only appends prose, touching no link/tag/icon/visibility, so the
        // seeded fingerprint must make this classify as non-structural on its very FIRST save.
        const vault = makeVault({
            'a.md': '# a\n[[b]]\n',
            'b.md': '# b\n',
        })
        const server = createServer({ vault, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            await waitForMigration(base)
            const { events, stop } = collectEvents(base)
            try {
                await Bun.sleep(BOOT_WATCH_SETTLE_MS)
                events.length = 0
                const res = await putFile(
                    base,
                    'a.md',
                    '# a\n[[b]]\nmore prose\n',
                )
                expect(res.status).toBe(200)
                await Bun.sleep(1500)
                const aEvents = events.filter(e => e.paths.includes('a.md'))
                expect(aEvents.length).toBeGreaterThan(0)
                expect(aEvents.at(-1)!.dirty).toEqual({
                    graph: false,
                    tree: false,
                })
            } finally {
                stop()
            }
        } finally {
            server.stop(true)
        }
    },
    20_000,
)

t(
    'GET /events connects promptly even when version is still 0 at boot',
    async () => {
        // An EMPTY vault with `.settings` pre-materialized (mirrors sseRefresh.test.ts) — so
        // boot's own reconcileSettings write finds nothing to fill and writes nothing, and
        // there's no pre-existing markdown file for a stray macOS FSEvents backlog notice to
        // bump the version on either. version really does stay at 0 through this whole test,
        // the exact condition that used to reach the heartbeat-interval stall once the
        // `.settings` reconcile write stopped spuriously bumping it (see the file header).
        const vault = makeVault({})
        await initializeSettings(vault)
        const server = createServer({ vault, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            const start = Date.now()
            const res = await fetch(`${base}/events`)
            const elapsed = Date.now() - start
            expect(res.status).toBe(200)
            // Generous margin over "instant" while still far short of sseHeartbeatMs's 5000ms
            // default — the old (broken) behaviour hit ~5000ms almost exactly, every time.
            expect(elapsed).toBeLessThan(2000)
            await res.body!.cancel()
        } finally {
            server.stop(true)
        }
    },
    10_000,
)
