import { test, expect } from 'bun:test'
import { watch } from 'node:fs'
import { createServer } from '../src/server'
import { reconcileSettings } from '../src/settings'
import { makeVault, tempDir } from './helpers'

/** Resolve once `dir` has produced no fs events for `quietMs`, or after `maxMs` regardless.
 *  macOS FSEvents can deliver a write's notification well after the write's own promise
 *  resolved — worse, and more variably, under the CPU/IO load a full `bun test core` run
 *  puts on the box (dozens of other files' real vaults + watchers). A fixed sleep before
 *  attaching createServer's OWN watcher is a coin flip against that lag; actively watching
 *  for the storm to end is not — it waits exactly as long as the filesystem needs to. */
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

// Throwaway machine dirs for createServer's boot-time side effects (daemon machine registry +
// run registry) — mirrors server.test.ts (:19-37) and server.gcal-ticker.test.ts, so this file
// can run standalone (`bun test core/test/server.bootConfig.test.ts`) without touching the real
// ~/.bismuth. BISMUTH_LAYOUT_CACHE_DIR is already redirected process-wide by the test preload
// (core/test/setup.ts); BISMUTH_GCAL_DIR only matters if the auto-sync ticker is enabled, which
// it isn't here (Task 11 gated it behind an explicit opt-in the plain servers below don't set).
process.env.BISMUTH_DAEMON_DIR = tempDir('bismuth-bootcfg-machine-')
process.env.BISMUTH_RUN_DIR = tempDir('bismuth-bootcfg-run-')
process.env.BISMUTH_GCAL_DIR = tempDir('bismuth-bootcfg-gcal-')

/** Build a throwaway vault from `files` and boot a real server on it, with the boot-time task
 *  migration disabled (BISMUTH_NO_TASK_MIGRATE is read synchronously inside createServer, so
 *  setting it only around that one call is enough — see server.test.ts:2522-2535).
 *
 *  Pre-reconciles `.settings` before createServer ever runs, and waits for the resulting write
 *  to fully drain from the filesystem's event stream. createServer's own boot-time
 *  reconcileSettings call (server.ts:373, outside this task's scope — the self-write mark
 *  around it is Task 4's job) writes `.settings` into existence for a vault that doesn't have
 *  one yet, and that write is NOT self-write-marked: the watcher (already attached by the time
 *  the async write lands) sees it as an external change and runs it through the full
 *  settings-changed path (server.ts's classifyVault + its own loadAppConfig reload), bumping
 *  the version independently of anything this test is trying to isolate. Reconciling here first
 *  means the file already exists and is fully schema-filled, so createServer's own call finds
 *  nothing to write — but the `waitForFsQuiet` still matters: without it, THIS write's own
 *  (possibly delayed) fs notification can arrive after createServer's watcher attaches and get
 *  mistaken for an external change all the same. */
async function startTestServer(opts: {
    files: Record<string, string>
}): Promise<{ url: string; stop: () => void }> {
    const vault = makeVault(opts.files, 'bismuth-bootcfg-vault-')
    await reconcileSettings(vault)
    await waitForFsQuiet(vault)
    process.env.BISMUTH_NO_TASK_MIGRATE = '1'
    let server: ReturnType<typeof createServer>
    try {
        server = createServer({ vault, port: 0 })
    } finally {
        delete process.env.BISMUTH_NO_TASK_MIGRATE
    }
    return {
        url: `http://localhost:${server.port}`,
        stop: () => server.stop(true),
    }
}

test('loading an unchanged config at boot does not bump the version or invalidate caches', async () => {
    const { url, stop } = await startTestServer({
        files: { 'a.md': '# a\n[[b]]', 'b.md': '# b' },
    })
    try {
        await fetch(`${url}/tree`)
        await Bun.sleep(500) // the async loadAppConfig of a 2-file vault settles in well under this
        const { version } = await (await fetch(`${url}/version`)).json()
        expect(version).toBe(0)
    } finally {
        stop()
    }
})

test('CORS preflight is cacheable', async () => {
    const { url, stop } = await startTestServer({ files: {} })
    try {
        const res = await fetch(`${url}/tree`, { method: 'OPTIONS' })
        expect(res.headers.get('Access-Control-Max-Age')).toBe('600')
    } finally {
        stop()
    }
})
