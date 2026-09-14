// core/test/server.selfWrite.test.ts
//
// End-to-end guard for two self-write suppression bugs, measured against a real server + real
// fs.watch:
//   1. PUT /file never marked its write as self-written, so every save produced TWO SSE
//      events (the handler's own invalidate(), then the watcher noticing its own echo).
//   2. The change tracker was never seeded from the boot-time task-migration scan, so the
//      FIRST save of any note after boot was classified fully structural even when it touched
//      no link, tag, icon or visibility — forcing an unnecessary graph+tree rebuild.
// Plus a regression guard for a THIRD, pre-existing bug fixing the first one surfaced: the
// boot-time `.settings` reconcile write used to bump `version` to 1 via its own unsuppressed
// watcher echo, which is what had kept `GET /events` connections from ever hitting an unrelated
// stall — measured: a client connecting while version === 0 received NOTHING until the next
// heartbeat tick (5s default). Suppressing that echo correctly removed the spurious bump, which
// turned the latent stall into a real one — `core/test/server.test.ts`'s daily-note test started
// timing out. See the `: connected\n\n` unconditional flush in server.ts's `GET /events`.
//
// SSE is read with fetch + a ReadableStream reader (Bun has no global EventSource), matching
// sseRefresh.test.ts's approach. Gated with shouldRunSlowTests: this waits on the real watcher
// + debounce + boot-time migration scan, all real time, well over 1s per test.
import { test, expect } from 'bun:test'
import { watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Resolve once `dir` has produced no fs events for `quietMs`, or after `maxMs` regardless.
 *  macOS FSEvents can replay a directory's very recent write history to a BRAND-NEW watcher —
 *  see server.bootConfig.test.ts's identical helper. Used here (Wave 3 review I2) so the
 *  seeding test can start the server with a guarantee that NOTHING will echo a.md/b.md's
 *  pre-boot writes through the watcher: without this, that backlog replay — not seed() — is
 *  what gives a.md its first fingerprint, and the seeding test cannot tell the two apart. */
function waitForFsQuiet(
    dir: string,
    quietMs = 200,
    maxMs = 3000,
): Promise<void> {
    return new Promise(resolve => {
        let settled = false
        let timer: ReturnType<typeof setTimeout>
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            clearTimeout(hardCap)
            try {
                w.close()
            } catch {}
            resolve()
        }
        const w = watch(dir, { recursive: true }, () => {
            clearTimeout(timer)
            timer = setTimeout(finish, quietMs)
        })
        timer = setTimeout(finish, quietMs)
        const hardCap = setTimeout(finish, maxMs)
    })
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
        //
        // Wave 3 review (I2): the ORIGINAL version of this test wrote a.md/b.md via makeVault
        // and then slept BOOT_WATCH_SETTLE_MS before proceeding — which is exactly long enough
        // for macOS's FSEvents backlog-replay of those pre-boot writes to reach the server's own
        // watcher, debounce, and run classifyVault on a.md itself. THAT classify call — not
        // seed() — is what gave a.md its first fingerprint (with seed() stubbed to a no-op, this
        // test still passed). Waiting for the filesystem to go fully quiet BEFORE the server (and
        // its watcher) ever starts removes that backlog entirely: nothing changes on disk after
        // this point until our own PUT, so the watcher has nothing to replay, and the ONLY way
        // a.md can have a fingerprint when our PUT lands is the migration scan's seed() call.
        // Asserting no event names a.md before the PUT makes that a directly-checked invariant,
        // not an assumption.
        const vault = makeVault({
            'a.md': '# a\n[[b]]\n',
            'b.md': '# b\n',
        })
        await waitForFsQuiet(vault)
        const server = createServer({ vault, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            const { events, stop } = collectEvents(base)
            try {
                await waitForMigration(base) // by now seed() has already run, if it's going to
                // Nothing should have named a.md yet — if something did, either the filesystem
                // wasn't actually quiet, or something OTHER than seed() gave a.md a fingerprint.
                expect(events.some(e => e.paths.includes('a.md'))).toBe(false)
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
    'a real external .settings edit shortly after boot is not swallowed by a no-op reconcile',
    async () => {
        // Wave 3 review (M1): the boot-time reconcileSettings call marks `.settings` self-
        // written BEFORE it runs, since most boots it writes nothing (this vault's .settings is
        // ALREADY fully reconciled — nothing for fillMissing to add). The old code re-armed that
        // mark for a full 2s grace window regardless of whether reconcileSettings actually wrote
        // anything, so a genuine external edit to `.settings` — a user hand-editing it, an
        // agent, a sync client — landing inside that window was silently swallowed as if it
        // were this server's own echo. Fixed: unmark (not rearm) on a no-op resolution.
        const vault = makeVault({})
        await initializeSettings(vault) // .settings already matches schema defaults exactly
        await waitForFsQuiet(vault)
        const server = createServer({ vault, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            const { events, stop } = collectEvents(base)
            try {
                // A no-op reconcileSettings is just one fs read + YAML parse — comfortably
                // resolved well within 300ms, long before the 2s grace window the OLD code
                // would have armed regardless.
                await Bun.sleep(300)
                writeFileSync(join(vault, '.settings'), 'dailyNotes: []\n')
                const deadline = Date.now() + 5000
                let saw = false
                while (Date.now() < deadline) {
                    if (events.some(e => e.paths.includes('.settings'))) {
                        saw = true
                        break
                    }
                    await Bun.sleep(50)
                }
                expect(saw).toBe(true)
            } finally {
                stop()
            }
        } finally {
            server.stop(true)
        }
    },
    15_000,
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
